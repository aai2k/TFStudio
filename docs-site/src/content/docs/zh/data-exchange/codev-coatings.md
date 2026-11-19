---
title: CODE V 镀膜
description: 读写 CODE V MULTILAYER (MUL) 镀膜：把 .seq 或 .mul 文件中的膜层导入设计或镀膜库，或把当前设计导出为 .seq 文件。
ribbonIcon: codev-coatings
---

CODE V 镀膜在 TFStudio 与 CODE V 之间传递镀膜。它读取 CODE V MULTILAYER（`MUL`）镀膜，即输入膜层堆栈的 `.seq` 命令文件或 CODE V 由其保存的 `.mul` 文件，并把当前设计的一面写成 `.seq`，CODE V 运行它即可生成 `.mul`。导入与导出是同一行中的两个标签页；该行右端的警告徽标列出上一次读取或导出所记录的问题。

<!-- shot: codev-coatings | a CODE V command file for a 15-layer TiO2 / SiO2 mirror at 45° read, its media, wavelengths, angles and layers shown, then imported as the mirror design's front coating -->
![CODE V 镀膜](/screenshots/codev-coatings-zh.png)

## 计算的量

**导入**：文件中的入射介质和基底、波长、入射角和参考波长、标题，以及从入射介质到基底的各膜层，厚度以 nm 计，CODE V 固定的膜层（代码 100）带有锁定标记。

**导出**：**生成预览**在保存之前显示完整的 `.seq` 文件。

## 控件与设置

**打开 .seq 或 .mul…**读取镀膜文件。

**导入 → 正面镀膜**和**导入 → 背面镀膜**替换当前设计的相应镀膜；设计保留自己的介质和基底，文件的 `INC` 和 `SUB` 只显示而不应用。材料放入以 `CODE V` 和文件名命名的用户目录。背面镀膜把文件的第一层放在出射侧，与导出时的写法相同。勾选**对称（背面 = 正面）**时只提供正面导入，**忽略另一面**所略去的那一面不能导入。撤销可恢复镀膜；目录保留。

**保存到镀膜库…**通过[镀膜库](/zh/design/coating-library/)的对话框把膜系保存到“我的镀膜”，置于文件的 `INC` 与 `SUB` 之间（$n$ 为 1 且无 $k$ 时保存为空气）。其波段从文件的波长开始，文件只有一个波长时取[光学评价](/zh/analysis/optical-evaluation/)的波段，入射角取第一个 `ANG`。材料随保存的镀膜一起携带，因此不会向你的目录添加任何内容。

| 导出字段 | 写入 |
|---|---|
| **面** | **正面**：入射介质、正面镀膜、基底。**背面**：以出射介质作为入射介质，背面镀膜从出射侧写起，然后是基底，因为 CODE V 要求元件任一面都是前方为空气、后方为玻璃。 |
| **标题 (TIT)** | 最多 80 个字符，初始为设计名称 |
| **文件名 (SAV)** | 文件最后一条命令写出的 `.mul`；**保存 .seq…**使用同一名称 |
| **REF (nm)** | 参考波长，初始为设计的参考波长 |
| **分析波长，WL (nm)** | 起点、终点和步长，以 nm 计，最多 100 个波长 |
| **入射角，ANG (°)** | 最多五个，从 0 到小于 90° |

设计中有本机找不到的材料时，在替换该材料之前不能导出。

## 文件格式与限制

- 从 `.seq` 中，导入读取 `MDA` 膜系：`PHT`、`TIT`、`WL`、`WLG`、`REF`、`ANG`、`INC`、`COA`、`GRO` 与 `END` 组、`SUB` 以及 `MIC` 目录。分析、绘图、优化和文件命令被跳过；其他命令也被跳过，并在徽标中列出。`.mul` 按 CODE V 保存的格式读取，包括其示例镀膜和 CODE V 11.2 保存的文件。
- CODE V 从一条 `WL`、`MWL` 或 `EXT` 命令或一行 `MIC` 中最多读取 21 个值；导入同样只保留前 21 个，并给出警告。以小数逗号书写的数（`403,03`）能被读取但会给出警告，因为 CODE V 不读取它。
- `WLG` 按 CODE V 的方式以单精度生成波长，因此 `WLG 400 800 10` 显示为 400 到 799.9997 nm，没有 `REF` 的文件为 599.9998 nm。
- 导入的 `MIC` 材料在其 `MWL` 点、各波长和 `REF` 上制表，$n$ 与 $k$ 在点之间和点之外都按 CODE V 11.2 对其表格的插值方式取值。以波数表示厚度的膜层若需读取超出 `REF` 的表格，会有警告指出该材料。
- 与其他膜层耦合的膜层（代码 1 到 99）导入为自由膜层，因为 TFStudio 没有耦合膜层，报告会给出其数量。再次导入同一文件时沿用其目录，目录中已有的材料（包括编辑过的）保持不变。

| 项目 | CODE V | 导出时 |
|---|---|---|
| 膜层 | 最多 1000 | 超过 1000 时拒绝 |
| 分析波长，`WL` | 最多 100 | 超过 100 时拒绝；每条 `WL` 命令最多 21 个 |
| 入射角，`ANG` | 最多 5 | 字段最多容纳五个 |
| 每种 `MIC` 材料的点数，`MWL` | 最多 21 | 在各波长处采样；超过 21 时，在 CODE V 插值偏差最大处逐点添加，直到每个波长都与写出的 6 位小数相符或已保留 21 个点，并给出警告 |
| 材料标签 | 6 个字符 | 由材料名生成，两个标签相同时加编号 |
| 入射介质和基底 | 只有 $n$ | 有吸收介质的 $k$ 被舍去，并给出警告 |
| 厚度 | nm（`PHT Y`）或 `REF` 处的波数（`PHT N`） | nm，`PHT Y` |
| 固定膜层 | 代码 100 | 锁定层写为 100，其他写为 0 |

$n$ 与 $k$ 在各波长上不变的材料以数值写在其 `COA` 行上，而不是写成 `MIC` 条目，$k$ 写为正数。CODE V 从入射介质向内列出膜层，因此设计编辑器的第 1 层是最后一行 `COA`。文件以 `SAV` 结束，运行后写出由 `MLT` 附加到透镜表面的 `.mul`；在透镜上 CODE V 从玻璃取基底折射率，因此 `SUB` 只在 `MUL` 内部起作用。导出已在 CODE V 11.2 中确认可用，未在其他版本中检查。

## 理论

`PHT N` 厚度 $T$ 是以 `REF` 处波数表示的光学厚度：

$$
d = T \cdot \text{REF} / n(\text{REF})
$$

$n$ 为该层在 `REF` 处折射率的实部；文件没有 `REF` 时取中心分析波长处的值，与 CODE V 相同。`.mul` 以这种方式保存所有厚度，并用其旁边保存的 $n(\text{REF})$ 读回。

## 参考文献

- CODE V Multilayer Design Reference Manual, chapter "Multilayer Coating Design and Analysis (MUL)": *MDA Sub-Option* for the commands and their limits, *Technical Notes* for the order of the media on each kind of surface.
