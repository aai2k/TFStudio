---
title: Zemax 镀膜
description: 读写 Zemax OpticStudio 的 COATING.DAT，导入材料和镀膜堆栈，把镀膜保存到镀膜库，或导出活动设计。
ribbonIcon: zemax-coatings
---

**Zemax 镀膜（Zemax Coatings）** 窗口读写 Zemax OpticStudio 的 `COATING.DAT` 文件。从 `COATING.DAT` 将镀膜堆栈（及其材料）导入到 TFStudio 设计中，把一个镀膜保存到[镀膜库](/zh/design/coating-library/)，或将活动设计导出为 `COAT` 堆栈及其 `MATE` 材料定义，供 OpticStudio 使用。

`COATING.DAT` 是 Zemax 的镀膜数据库：一个包含 `MATE`（材料）和 `COAT`（镀膜堆栈）记录，以及理想与列表式镀膜模型（`IDEAL`、`IDEAL2`、`TABLE`、`TAPR`、`ENCRYPTED`）的文本文件。窗口解析整个文件，并以三个标签页呈现：**Coatings（镀膜）**、**Materials（材料）** 和 **Export（导出）**。标签页与参考波长位于同一行，上一次操作的结果显示在这一行的右端。使用 Coatings 或 Materials 标签页左侧面板中的 **Load COATING.DAT（载入 COATING.DAT）** 载入文件；在你切换工具时，解析出的内容和你的选择会保持不变。

## 设置

**参考 λ₀ (nm)**：用于在 Zemax 的相对厚度（以波为单位）与物理厚度（纳米）之间进行转换，导入和导出时均使用。

**Coatings（镀膜）标签页**：面板列出文件中每一条镀膜记录及其类型和层数。选择一个层堆栈，其各层显示在右侧。只有 `COAT` 层堆栈可以导入；理想、表格和加密记录带锁形标记列出。

- **Import → front coating（导入 → 正面镀膜）** 将该堆栈作为活动设计的正面镀膜载入。其 `MATE` 材料会自动注册到一个 `Zemax <file>` 目录中，以便设计立即解析其材料。
- **Save to Coating Library…（保存到镀膜库…）** 把该堆栈保存到“我的镀膜”，使用的对话框与镀膜库中 **Save current coating…（保存当前镀膜…）** 相同：给它一个名称、类型和用途说明，并设置它所针对的波段、入射角和偏振。`COAT` 记录不指定入射介质和基底，因此保存的镀膜采用活动设计的入射介质和基底。其各层与 **Import → front coating** 放到设计上的各层相同，相对厚度按参考波长换算，该参考波长随镀膜一起保存。其材料嵌入镀膜中，因此在从未载入该文件的计算机上也能使用。保存不会向你的材料目录添加任何内容。

**Materials（材料）标签页**：列出每一条 `MATE` 记录，每行一条。勾选你需要的，使用 **Import selected（导入所选）** 或 **Import all（导入全部）** 将它们添加到目录中，而不影响设计。

**Export（导出）标签页**：根据当前前表面设计生成 `COAT` + `MATE` 文本，并在保存前提供预览：

- **Layer thickness（膜层厚度）**：写入**绝对 (µm)** 物理厚度，或以 λ₀ 波数计的**相对（波）**厚度。
- **Include materials（包含材料）**：仅导出**设计所用**的材料，或导出**全部目录材料**。
- **Coating name（镀膜名称）**：`COAT` 记录的名称。
- **Material sampling grid（材料采样网格）**：将每种材料的 n,k 列表化写入其 `MATE` 记录时所用的波长范围和步长。

## 定义了两次的名称

一个文件可以在不止一条 `MATE` 记录中定义同一个材料名称。窗口匹配名称时不区分大小写，因此 `SiO2` 和 `SIO2` 算作同一个名称。Materials 标签页在每个这样的行上标出它是该名称的第几条记录，例如 **2 / 2**，窗口顶行的一条提示列出这些名称。

每条记录单独导入。第一条保留原名，后面的在名称后加 (2)、(3)，因此同时导入两条时，目录中的一条绝不会替换另一条。引用这种材料的镀膜层使用该名称的最后一条记录，导入、保存到镀膜库以及 Coatings 标签页显示的厚度都是如此。如果这些记录不同，在依赖该镀膜之前请确认文件指的是哪一条。

## 如何解读

TFStudio 与 Zemax 在若干约定上有所不同，窗口会自动为你处理：

| 量             | Zemax                    | TFStudio                      |
| -------------- | ------------------------ | ----------------------------- |
| 波长           | 微米（µm）               | 纳米（nm）                    |
| 消光系数       | 存储 **−k**              | `k > 0`（在 I/O 时翻转符号）  |
| 层厚度         | 相对 `T`（波数）         | 物理 `d = T·λ₀ / n₀`          |
| 层顺序         | 最外层 → 基底            | 相同的内部存储顺序            |

层顺序无需反转。Zemax 从最外层到基底的顺序，正是 TFStudio 存储前表面镀膜的方式（设计编辑器只是将其反向显示）。将一个设计导出到 `COATING.DAT` 再导入回来，会同时保留层厚度和 k 符号约定。`IDEAL`、`IDEAL2` 和 `TABLE` 镀膜以反射率和透射率而不是膜层描述一个表面，`ENCRYPTED` 镀膜无法解码，因此它们都不会成为膜层堆栈。

## 参考文献

- Zemax OpticStudio Help → *The Coating Tab → Coating File Definitions*（`MATE`、`COAT`、`IDEAL`、`TABLE`），即 `COATING.DAT` 格式的来源。
