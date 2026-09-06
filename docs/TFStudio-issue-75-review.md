# TFStudio Issue #75 单一 Data Folder 功能评审意见

## 1. 评审范围与结论

本评审仅针对 issue #75：

> **Feature proposal — one data folder with file move**

不涉及 OD 及相关事项。

维护者最终要求并不是最初 proposal 中的“Preferences 联动其他目录”，而是进一步收敛为：

> **只保留一个 TFStudio Data folder 设置，现有固定子目录全部位于该根目录下；用户修改根目录时，实际迁移整个数据目录。**

默认根目录仍为：

```text
Documents\TFStudio
```

修改目录不能只是切换路径，否则原数据会立即从应用视图中消失。

### 总体结论

**方案方向正确，不需要重新设计；但现有设计/实施计划仍需按 issue #75 做一次收敛修订后再实施。**

主要需要修正：

1. 固定子目录明确为当前 1.7.2 的 **9 项**；
2. 正确处理 configured root 与临时 fallback root；
3. startup validation 按维护者要求实现；
4. 跨盘事务严格保持 `copy → verify → save setting → delete`；
5. 优先复用已有 `applyChange`；
6. Reset 必须等价于 `set(defaultPath)`；
7. 删除非必要的 progress IPC、legacy UI 等扩展；
8. 补齐 docs、changelog 和关键故障测试。

---

## 2. 数据目录模型

当前 TFStudio 1.7.2 的 `FOLDER_SPECS` 已确认共有 9 项：

```text
Projects
Materials
MeritFunctions
Qualifiers
Integrals
ReportPresets
Branding
Preferences
Coatings
```

其中 `Coatings` 为 1.7.2 新增目录；最初 proposal 中列出的 8 项是因为当时漏写了它。

aai2k 在 issue 中多次明确使用：

```text
nine subfolders
nine resolved subfolder paths
```

并要求：

> Keep `FOLDER_SPECS` and the keys.

因此新结构应为：

```text
TFStudio Data folder
│
├─ Projects
├─ Materials
├─ MeritFunctions
├─ Qualifiers
├─ Integrals
├─ ReportPresets
├─ Branding
├─ Preferences
└─ Coatings
```

`Data folder` 是**根目录设置在 UI 中的新名称**，不是额外的 `Data` 子目录。

### 设计原则

目录集合必须来自当前代码：

```text
FOLDER_SPECS
```

而不能从旧 settings 中反推。

因此即使用户从 1.7.1 升级，旧 settings 中不存在 `Coatings`，新版本仍应根据当前 `FOLDER_SPECS` 正常解析：

```text
<root>/Coatings
```

---

## 3. Settings 与版本兼容

新模型只保留：

```json
{
  "folders": {
    "root": "..."
  }
}
```

维护者明确要求：

- 一个 optional root 替代所有 per-key overrides；
- 每个目录解析为 `root + subdir`；
- `userDocsDir` 返回 root；
- `toSettings()` 写 `{ root }`；
- 未修改默认目录时返回 `{}`，fresh install 不写 folders 配置。

### 3.1 Legacy settings

TFStudio 1.5.0–1.7.1 的 per-folder path：

```text
忽略
→ 写一条 log
→ 下一次 settings write 时丢弃
```

不建议再增加专门的 legacy UI warning；issue 只要求 ignore + log + drop。

---

## 4. configured root 与 active root 必须分离

这是当前设计中最重要的状态语义。

维护者明确规定：

```text
configured root 位于 USB / 外部硬盘
        ↓
设备启动时不可用
        ↓
本次运行暂时使用 Documents\TFStudio
        ↓
重新 seed bundled materials
        ↓
UI 显示 fallback 原因
        ↓
设备恢复后重新启动
        ↓
重新使用原 configured root
```

而 fallback 期间保存到 `Documents\TFStudio` 的数据继续留在那里，不自动搬回。

因此推荐状态模型：

```javascript
const state = {
  baseDir,          // Documents\TFStudio
  configuredRoot,   // settings 中用户真正配置的 root
  rootDir,          // 当前本次运行实际使用的 root
  rejected,         // configuredRoot 暂不可用的原因
};
```

例如：

```text
configuredRoot = E:\TFStudio
E: 当前不可用

rootDir = Documents\TFStudio
configuredRoot 仍然 = E:\TFStudio
```

### 关键约束

fallback 时**绝不能清除 configuredRoot**。

否则设备恢复后，应用无法满足：

```text
restart with the drive back uses the configured folder again
```

同理，fallback 期间其他 settings 被写入时，也不能因为当前：

```text
rootDir == defaultRoot
```

就把：

```text
folders.root = E:\TFStudio
```

误删。

因此：

\[
\boxed{\text{持久化来源应是 configuredRoot，而不是当前 active rootDir}}
\]

---

## 5. Startup validation

这一部分应严格按 aai2k 给出的实现要求处理。

`load(settings)` 应：

```text
读取 folders.root
↓
若为相对路径，则相对 exeDir resolve
↓
验证 absolute
↓
mkdir
↓
write probe
↓
成功：使用 configured root
失败：fallback 到 Documents\TFStudio
```

因此不能简单规定：

```text
configured path 不存在 → rejected
```

正确的是：

### 路径不存在，但设备可用

```text
mkdir succeeds
write probe succeeds
→ accepted
```

### USB / drive 不存在或不可写

```text
mkdir/write probe fails
→ rejected
→ fallback
```

---

## 6. `checkTarget()` 与 startup validation 分开

虽然 startup validation 可以 `mkdir + probe`，但用户主动迁移的新 target 有另一套规则：

1. target 必须为空或不存在；
2. target 不能在 current 内；
3. current 不能在 target 内。

因此不能继续用同一个“target 必须为空”的函数去验证已经使用过的 configured root。

推荐职责直接贴合维护者给出的结构：

### `dataFolderMove.js`

```javascript
checkTarget(current, target)
moveTree(from, to)
```

### `userPaths.load()`

负责：

```text
configured root resolve
mkdir
write probe
fallback
rejected
legacy settings
```

不必再额外公开 `validateConfiguredRoot()` 等 API。

---

## 7. `dataFolderMove.js`

维护者对该模块已经给出非常具体的要求：

```text
new file
CommonJS
fs and path injected

checkTarget(current, target)
moveTree(from, to)
```

并要求 async fs，因为仅 RII mirror 就可能有约 4000 个文件，需要避免阻塞窗口。

因此建议公共 API 保持最小：

```javascript
createDataFolderMove({ fs, path }) => ({
  checkTarget,
  moveTree
});
```

以下功能可以作为内部 helper：

```text
tree traversal
file-count tally
byte tally
copy
verify
partial cleanup
delete
```

没有必要全部暴露成公共 API。

---

## 8. 同盘与跨盘移动

### 同盘

维护者明确要求：

```text
same drive → file-system rename
```

### 跨盘

推荐流程：

```text
try rename
   ↓
EXDEV
   ↓
async copy
   ↓
verify
```

因此没有必要提前通过 `stat.dev` 判断磁盘。

---

## 9. 跨盘完整性与事务

跨盘复制必须同时验证：

```text
file count
+
total bytes
```

仅比较 total bytes 不够。

### 9.1 正确事务顺序

维护者的核心安全规则是：

```text
copy
↓
save setting
↓
delete old
```

失败语义：

#### copy failure

```text
删除 partial target
保留 old data
保留 old setting
```

#### settings write failure

```text
删除 new copy
保留 old data
保留 old setting
```

#### old-folder delete failure

```text
new setting 保持有效
new data 保持有效
old folder 留下
UI inline 提示
```

其总体原则是：

> **The user always has one complete copy.**

因此完整顺序应解释为：

```text
checkTarget
↓
copy
↓
verify fileCount + bytes
↓
save/apply setting
↓
delete old
```

即：

\[
\boxed{
\text{copy}
\rightarrow
\text{verify}
\rightarrow
\text{persist}
\rightarrow
\text{delete}
}
\]

---

## 10. `moveTree` 与 `applyChange` 的职责

Comment #3 一方面写：

```text
moveTree:
rename first;
on EXDEV copy, verify, delete
```

另一方面又明确要求：

```text
paths:set(dir)
→ checkTarget
→ moveTree
→ existing applyChange transaction
→ then the delete
```

结合 Comment #1 更详细的事务规则，应该以：

```text
settings 成功后才能 destructive delete
```

为最高约束。

因此跨盘时更合理的职责是：

```text
moveTree
→ copy + verify
→ 返回移动方式/状态

paths:set
→ existing applyChange
→ success
→ delete old
```

具体实现形式可以不同，但不能在 settings 成功前删除唯一旧副本。

---

## 11. 优先复用现有 `applyChange`

维护者明确要求：

> `paths:set(dir)` runs `checkTarget`, `moveTree`, the existing `applyChange` transaction, then the delete.

因此不建议重新建立一整套：

```text
persistRoot
new transaction coordinator
new recovery protocol
```

实施时应首先检查并复用现有 `applyChange`。

只有现有机制不足以保证 settings rollback 时，才做最小扩展。

---

## 12. 同盘 settings failure

issue 没有详细规定：

```text
rename 成功
+
settings write 失败
```

的处理。

但如果不恢复，会出现：

```text
实际数据在 newRoot
settings 仍指向 oldRoot
```

因此建议增加补偿：

```text
rename old → new
↓
applyChange fails
↓
rename new → old
```

这是实现安全措施，而不是新的维护者 API 要求。

若补偿也失败，至少必须向用户报告**真实数据位置**，不能假装已经恢复。

---

## 13. Reset

维护者已经明确：

```text
paths:reset is set(defaultPath)
```

因此 Reset 必须真正执行：

```text
currentRoot
↓
move
↓
Documents\TFStudio
```

而不是只：

```javascript
rootDir = baseDir;
```

Reset 与 Browse 修改 root 一样，都应经过：

```text
unsaved guard
target check
move
settings transaction
busy state
```

---

## 14. IPC、Renderer 与 UI

维护者指定：

```text
paths:choose → 只返回选择路径
paths:set(dir) → 执行移动事务
paths:reset → set(defaultPath)
paths:reveal(key?) → root 和子目录都能 Open
```

`handleUserPathChanged` 不再接受 key，而是统一 reload：

```text
design tree
catalogs
```

unsaved-designs guard 应覆盖所有 root change。

### FoldersPane

最终 UI 应为：

```text
Data folder

/current/root
[Browse] [Reset] [Open]

default / rejected / error note

----------------------

9 个 read-only subfolder paths
```

### 用户交互

Browse：

```text
choose
↓
app 自己的 confirm dialog
↓
Moving…
↓
buttons disabled
↓
success / inline error
```

无需新增百分比 progress、byte progress 或 `paths:move-progress` IPC；issue 只要求 busy state。

### 错误显示

以下信息均应 inline：

```text
rejected reason
move error
old-folder-still-there warning
```

---

## 15. Portable build

若 configured root 位于 exeDir 下：

```text
settings 保存相对路径
```

启动时：

```text
相对 exeDir resolve
```

这样便携版所在 USB 更换盘符后仍然有效。

此项必须加入测试。

---

## 16. i18n、Docs 与 Changelog

维护者要求：

```text
tabs.folders
folders.title
→ "Data folder"
```

并增加：

```text
hint
confirm
busy state
refusal reasons
leftover-folder notice
```

中文由 imyu37 完成，俄文由 aai2k 完成。

因此当前 PR：

```text
zh → imyu37
ru → aai2k
```

不要为了 scanner 擅自修改俄文。

同时必须更新：

1. docs 中相关 wording；
2. changelog 一行，说明：
   - one data folder replaces per-folder paths；
   - files move with it；
   - 1.5–1.7 per-folder paths are no longer read。

---

## 17. 建议删除或降级的设计

以下内容不应作为 issue #75 的核心要求：

### 删除/不新增

```text
progress percentage
byte-progress IPC
onMoveProgress preload API
legacy UI warning
大量 public file-move helper
独立的新 transaction framework
```

### 可作为轻量加固

```text
main-process move mutex
same-drive compensating rename
rollback failure reporting
dirCount extra verification
```

原则是：

> **优先满足维护者给出的既有架构和事务，避免扩大 PR diff。**

---

## 18. 重点测试与 Merge Gate

### 数据模型与兼容

- [ ] `FOLDER_SPECS` 保留当前 9 项；
- [ ] 包含 `Coatings`；
- [ ] 1.5.0–1.7.1 legacy per-folder settings 被忽略；
- [ ] legacy 仅 log 一次；
- [ ] 下一次 settings write 删除旧 keys；
- [ ] 从旧版本升级后仍按当前 9 项解析目录。

### Startup

- [ ] relative root 按 exeDir resolve；
- [ ] configured root 支持 `mkdir + write probe`；
- [ ] device unavailable → fallback；
- [ ] `configuredRoot` 不因 fallback 丢失；
- [ ] default root 重新 seed bundled materials；
- [ ] pane 显示 rejected 原因；
- [ ] drive 恢复后 restart 自动重新使用 configured root；
- [ ] fallback 期间新数据继续留在 default root。

### Target validation

- [ ] target 不存在 → 允许；
- [ ] target 空 → 允许；
- [ ] target 非空 → 拒绝；
- [ ] target/current 双向嵌套 → 拒绝。

### Move

- [ ] same drive 使用 rename；
- [ ] EXDEV 进入 async copy；
- [ ] file count 相等；
- [ ] total bytes 相等；
- [ ] copy failure 删除 partial target；
- [ ] settings failure 删除 new copy；
- [ ] old delete 只发生在 settings 成功之后；
- [ ] delete failure 保留 new setting 并 inline warning；
- [ ] 始终至少存在一份完整数据。

### Reset

- [ ] `reset = set(defaultPath)`；
- [ ] 数据实际迁移回 default；
- [ ] override 正确清除。

### UI

- [ ] app confirm dialog；
- [ ] Moving…；
- [ ] buttons disabled；
- [ ] unsaved-designs guard；
- [ ] 1 个 root row；
- [ ] 9 个 read-only subfolder rows；
- [ ] root/subfolder Open；
- [ ] rejected/error/leftover notice inline。

### Delivery

- [ ] English strings；
- [ ] Chinese strings；
- [ ] Russian 留给 aai2k；
- [ ] docs 更新；
- [ ] changelog 更新。

---

## 19. 最终评审结论

Issue #75 的最终实现可以概括为：

```text
one optional folders.root
        +
current 9-entry FOLDER_SPECS
        +
filesystem move
        +
existing applyChange transaction
```

现有方案无需再次重构，主要做以下收敛：

1. 统一按 1.7.2 当前 **9 个固定子目录**实现；
2. 明确 `Coatings` 属于当前目录模型；
3. 分离 `configuredRoot` 与 fallback 时的 active `rootDir`；
4. 保证 fallback 不覆盖原配置；
5. startup 使用维护者要求的 `mkdir + write probe`；
6. `dataFolderMove` 保持 `checkTarget + moveTree` 最小公共接口；
7. 使用 async fs；
8. 跨盘严格执行 **copy → verify → settings → delete**；
9. 优先复用现有 `applyChange`；
10. Reset 等价于 `set(defaultPath)`；
11. UI 只需 confirm + Moving… + disabled buttons + inline status；
12. 删除不必要的 progress IPC、legacy UI 和过度事务抽象；
13. 中文由 imyu37 完成，俄文留给 aai2k；
14. 补齐 docs、changelog 及 startup/failure/upgrade 测试。

完成以上修订后，设计即可进入正式编码与 PR 阶段。
