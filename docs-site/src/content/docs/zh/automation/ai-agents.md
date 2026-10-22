---
title: AI 助手（MCP）
description: 通过模型上下文协议（MCP），让 AI 助手打开、计算、精炼并保存 TFStudio 设计。
---

TFStudio 可以通过模型上下文协议（MCP）把它的设计工具交给 Claude 等 AI 助手使用。助手随后可以打开和构建设计、计算光谱和评价函数、运行精炼与合成，并把结果保存为 `.tfs` 文件，供你在应用中打开。它与应用各窗口使用同一套计算代码，因此给出的数值与应用显示的一致。

## 连接助手

已安装的应用本身就是服务器。以 `--mcp` 启动时，TFStudio 不打开任何窗口，通过标准输入和标准输出与助手通信。应用打开时它也可以同时运行。

**Claude Desktop**：依次打开 Settings、Developer、Edit Config，在 `claude_desktop_config.json` 的 `mcpServers` 下加入 TFStudio，并填写你的安装路径：

```json
{
  "mcpServers": {
    "tfstudio": {
      "command": "C:\\Users\\you\\AppData\\Local\\Programs\\TFStudio\\TFStudio.exe",
      "args": ["--mcp"]
    }
  }
}
```

**Claude Code**：在终端中添加。

```bash
claude mcp add tfstudio -- "C:\Users\you\AppData\Local\Programs\TFStudio\TFStudio.exe" --mcp
```

添加服务器后重启助手。

服务器使用应用所用的数据文件夹：默认是 `Documents\TFStudio`，除非你在设置中移动过它。它看到的材料，包括你自己的材料目录和库目录，与应用看到的相同。它只读取设计和材料目录，只写入助手保存的 `.tfs` 文件，已存在的文件只有在助手明确要求时才会被覆盖。此外它在应用旁保留自己的日志 `mcp-server.log`，并在应用的设置文件夹中保留自己的浏览器配置，因此不会影响正在打开的应用。

## 助手能做什么

| 类别 | 工具 |
| ---- | ---- |
| 设计 | `openDesign`、`newDesign`、`setDesignSetup`、`saveDesign`、`showDesign`、`listDesigns`、`copyDesign` |
| 膜层堆栈 | `insertLayer`、`deleteLayer`、`setLayer`、`stackFromFormula` |
| 评价函数 | `setMerit`、`merit` |
| 材料 | `findMaterials`、`materialNK` |
| 分析 | `spectrum`、`layerSensitivity` |
| 运行 | `refine`、`synthesize`、`monteCarlo`、`jobStatus`、`stopJob`、`listJobs` |
| 打开的设计（需 `--live`） | `listAppDesigns`、`readAppDesign`、`applyToApp` |

`spectrum` 按[光学评价](/zh/analysis/optical-evaluation/)窗口的方式计算 R、T、A、Rs 和 Rp；`merit` 按[评价函数编辑器](/zh/design/merit-function-editor/)的显示给出总值和每一行；`refine` 可运行[精炼](/zh/synthesis/refinement/)窗口的任一方法；`synthesize` 运行[针法](/zh/synthesis/needle/)、[渐进演化](/zh/synthesis/gradual-evolution/)、[结构优化器](/zh/synthesis/structural-optimizer/)或深度合成。`monteCarlo` 和 `layerSensitivity` 与[蒙特卡洛](/zh/analysis/error-analysis/)和[层灵敏度](/zh/analysis/layer-sensitivity/)窗口的计算相同。评价函数的行使用[操作数参考](/zh/design/operands/)中的操作数。

## 工作方式

- **按 id 处理设计。** 助手处理的是服务器以 `d1` 等 id 保存的设计。除非服务器以 `--live` 运行，它的操作不会影响应用中打开的设计；要查看结果，请打开它保存的文件。
- **完整路径。** 文件按完整路径打开和保存，例如 `C:\Users\you\Documents\TFStudio\Projects\AR.tfs`，因为服务器运行所在的文件夹取决于助手启动它的方式。
- **运行即任务。** `refine`、`synthesize` 和 `monteCarlo` 在独立线程上启动一个任务，并在半分钟内返回任务状态。对于更长的运行，助手用 `jobStatus` 跟踪，用 `stopJob` 停止。改变了设计的运行会把结果作为新设计加入，起始设计保持不变，便于比较。
- **单位。** 波长和膜层厚度单位为 nm，角度为入射介质中的度数，基底厚度单位为 mm。R、T 和 A 为 1 的分数，评价函数目标值也是如此，而评价函数编辑器中显示的是百分比。
- **拒绝。** 拼错的参数、未知的材料或工具无法使用的值都会被拒绝，并给出说明工具接受什么的信息，因此不会按助手未要求的值运行。

## 处理打开的设计

加上 `--live` 后，助手还可以处理 TFStudio 中打开的设计，你可以看着它变化。在 TFStudio 中依次打开首选项、自动化，开启**允许 AI 助手处理打开的设计**。然后在添加服务器的地方，在 `--mcp` 后面加上 `--live`，使其参数为：

```json
"args": ["--mcp", "--live"]
```

在 Claude Code 中，命令以 `--mcp --live` 结尾。助手读取打开的设计的副本，用上面的工具修改副本，再把它写回：

- **一步撤销。** 它写回的每次修改都是设计历史中的一步，按 Ctrl+Z 即可撤销，并会有通知说明它修改了哪个设计。修改在你保存设计之前一直是未保存的。
- **只写打开的设计。** 助手可以读取项目资源管理器中的任何设计，但只写入当前打开的那一个。
- **你的编辑优先。** 如果设计在助手读取之后发生了变化，无论是编辑、撤销还是运行，它的写入都会被拒绝，并被告知重新读取设计，因此你所做的不会被覆盖。应用的某个窗口中正在运行时，写入也会被拒绝。
- **运行不打开窗口。** 助手启动的精炼或合成在服务器中运行。如果助手要求写回，运行结束时若设计仍与助手读取时相同，结果会作为一步写回。被停止的运行不写入任何内容。
- **新材料。** 服务器在启动时读取材料目录，因此你之后在应用中添加的材料，要在你重启助手后才能被助手使用。
- **默认关闭。** 开关开启期间，你运行的任何程序都可以读取你的设计并修改打开的设计，就像它也可以修改你的设计文件一样；这台计算机的其他用户无法访问。没有助手工作时请将其关闭。
