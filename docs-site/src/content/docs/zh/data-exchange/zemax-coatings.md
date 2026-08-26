---
title: Zemax 镀膜
description: 读写 Zemax OpticStudio 的 COATING.DAT，导入材料和镀膜堆栈，或导出活动设计。
ribbonIcon: zemax-coatings
---

**Zemax 镀膜（Zemax Coatings）** 窗口读写 Zemax OpticStudio 的 `COATING.DAT` 文件。从 `COATING.DAT` 将镀膜堆栈（及其材料）导入到 TFStudio 设计中，或将活动设计导出为 `COAT` 堆栈及其 `MATE` 材料定义，供 OpticStudio 使用。

`COATING.DAT` 是 Zemax 的镀膜数据库：一个包含 `MATE`（材料）和 `COAT`（镀膜堆栈）记录，以及理想与列表式镀膜模型（`IDEAL`、`IDEAL2`、`TABLE`、`TAPR`、`ENCRYPTED`）的文本文件。窗口解析整个文件，并以三个标签页呈现：**Coatings（镀膜）**、**Materials（材料）** 和 **Export（导出）**。使用顶部的 **Load（加载）** 按钮载入文件；在你切换工具时，解析出的内容和你的选择会保持不变。

## 设置

**参考波长（Reference wavelength）**：λ₀，用于在 Zemax 的相对厚度（以波为单位）与物理厚度（纳米）之间进行转换，导入和导出时均使用。

**Coatings（镀膜）标签页**：列出文件中每一个 `COAT` 堆栈及其类型和层数。选择一个层堆栈并按 **Import to front（导入到前表面）** 将其作为前表面设计加载；该堆栈的 `MATE` 材料会自动注册到一个 `Zemax <file>` 目录中，以便设计立即解析其材料。加密的堆栈被锁定，无法导入。

**Materials（材料）标签页**：列出每一个 `MATE` 表格。勾选你需要的，使用 **Import selected（导入所选）** 或 **Import all（导入全部）** 将它们添加到目录中，而不影响设计。

**Export（导出）标签页**：根据当前前表面设计生成 `COAT` + `MATE` 文本，并在保存前提供实时预览：

- **Thickness mode（厚度模式）**：写入**绝对**厚度（µm）或**相对**波数。
- **Material scope（材料范围）**：仅导出设计**使用**的材料，或导出**全部**目录材料。
- **Coating name（镀膜名称）**：`COAT` 记录的名称。
- **Sample grid（采样网格）**：将每种材料的 n,k 列表化写入其 `MATE` 记录时所用的波长范围和步长。

## 如何解读

TFStudio 与 Zemax 在若干约定上有所不同，窗口会自动为你处理：

| 量             | Zemax                    | TFStudio                      |
| -------------- | ------------------------ | ----------------------------- |
| 波长           | 微米（µm）               | 纳米（nm）                    |
| 消光系数       | 存储 **−k**              | `k > 0`（在 I/O 时翻转符号）  |
| 层厚度         | 相对 `T`（波数）         | 物理 `d = T·λ₀ / n₀`          |
| 层顺序         | 最外层 → 基底            | 相同的内部存储顺序            |

层顺序无需反转。Zemax 从最外层到基底的顺序，正是 TFStudio 存储前表面镀膜的方式（设计编辑器只是将其反向显示）。将一个设计导出到 `COATING.DAT` 再导入回来，会同时保留层厚度和 k 符号约定。只有 `IDEAL`、`IDEAL2` 和 `TABLE` 类型的材料模型能干净地映射到 TFStudio 的色散；`ENCRYPTED` 的 Zemax 材料无法被解码。

## 参考文献

- Zemax OpticStudio Help → *The Coating Tab → Coating File Definitions*（`MATE`、`COAT`、`IDEAL`、`TABLE`），即 `COATING.DAT` 格式的来源。
