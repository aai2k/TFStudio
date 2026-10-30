---
title: API 参考
description: "TFStudio 脚本所用的对象，JavaScript 与 Python 两种写法：每个方法和属性接受什么、给出什么、拒绝什么，并附两种语言的示例。"
---

TFStudio 的脚本和程序所用的对象，分 JavaScript 和 Python 两种写法。每一节是一个对象：先说明它是什么，再列出它的每个方法和属性，JavaScript 写法与 Python 写法并排，说明它接受什么、给出什么、拒绝什么，并附两种语言各一个示例。[脚本控制台](/zh/automation/script-console/)可以在打开的设计上运行这两种语言的脚本；[Python](/zh/automation/python/) 页面说明如何在你自己的程序中使用同样的对象。

波长和膜层厚度单位为 nm，角度为入射介质中的度数，基底厚度单位为 mm，R、T 和 A 用 0 到 1 之间的小数表示，评价函数目标值也是如此。膜层按设计编辑器的方式编号：1 是紧邻基底的那一层。

JavaScript 的名称采用 camelCase，可选参数放在末尾的选项对象中；Python 的名称采用 snake_case，可选参数以关键字参数给出。两种语言一致时，条目只说一次，名称不同时给出两种写法。两者不同时，分别说明各自的行为。改变设计的方法会直接修改该设计，copy() 可以先保留一份副本。

方法会拒绝它不认识的选项和无法使用的值，并给出说明它接受什么的信息，因此不会用你无意给出的值运行：JavaScript 抛出带有该信息的 Error，Python 引发 `tfstudio.TFStudioError`。

每个示例都自己构建要处理的设计，并打印得到的结果，因此无论打开的是哪个设计都能运行，也不会改动它。这些示例都是脚本控制台的脚本，只有自己启动 TFStudio 的 Python 示例除外；要在程序中运行某个示例，把它放进 `with tfstudio.TFStudio() as tf:` 中。

## 正面、背面与整体

设计的 `sides` 说明哪些面带有膜层，`scoreOn` / `score_on` 说明单面镀膜的设计是只按镀膜面评价，还是按整个元件（包括基底的另一面）评价。它们就是设计编辑器中的“表面”和“忽略另一面”，每个光谱、评价函数、运行和公差检查都遵循它们，详见[表面与评估模式](/zh/design/evaluation-modes/)页面：

| `sides` | `scoreOn` / `score_on` | 设计编辑器中 | 计算对象，`mode` |
| ------- | ---------------------- | ------ | ----------- |
| `'front'` | `'side'` | 表面：正面；忽略另一面：勾选 | `'front'`（评价：正面） |
| `'front'` | `'whole part'` | 表面：正面；忽略另一面：不勾选 | `'total'`（评价：整体） |
| `'back'` | `'side'` | 表面：背面；忽略另一面：勾选 | `'back'`（评价：背面） |
| `'back'` | `'whole part'` | 表面：背面；忽略另一面：不勾选 | `'total'`（评价：整体） |
| `'both'` | 任意 | 表面：两面 | `'total'`（评价：整体） |
| `'symmetric'` | 任意 | 表面：两面，对称（背面 = 正面） | `'total'`（评价：整体） |

每个结果都在其 `mode` 中说明它的计算对象：[SpecReport](#specreport)、[Yield](#yield)、[Spectrum](#spectrum-1)、[IndexProfile](#indexprofile)、[LayerThicknesses](#layerthicknesses)、[Admittance](#admittance-1)、[ElectricField](#electricfield)、[Color](#color-1)、[Integrals](#integrals-1)、[Ellipsometry](#ellipsometry-1)、[GroupDelay](#groupdelay)、[Pulse](#pulse-1)、[Inhomogeneities](#inhomogeneities-1)、[Roughness](#roughness-1)、[RunResult](#runresult)、[MonteCarlo](#montecarlo)和[LayerSensitivity](#layersensitivity)。

## TFStudio

**JavaScript**：TFStudio，计算方式与应用相同。在脚本控制台中，`tf` 就是它，打开的设计在 `tf.design` 中。

**Python**：由本程序启动、不打开窗口的 TFStudio，计算方式与应用相同。with 块结束时将其结束，close() 也会将其结束。两者都没有时，一旦程序不再持有它，也不再持有它给出的任何东西（设计、材料、tf.materials 或 tf.app），它就会结束。因此，从自己创建了 TFStudio() 的函数中返回的设计仍然可以计算。

| JavaScript | Python |
| ---------- | ------ |
| 在脚本控制台中为 `tf`，由控制台交给脚本。 | `tfstudio.TFStudio(exe=..., live=False, data_dir=...)` |

| Python | 默认值 | 含义 |
| ------ | --- | --- |
| `exe` |  | TFStudio 的可执行文件。不给出时，依次使用 TFSTUDIO_EXE 指定的那个、随该包提供的 TFStudio，最后是安装程序记录的 TFStudio。 |
| `live` | `False` | 为 True 时，它连接到打开的 TFStudio 应用，由 tf.app 读取和写入应用中的设计。 |
| `data_dir` |  | 一个 TFStudio 数据文件夹，用其中的材料目录代替应用的材料目录。不给出时，使用应用的。 |

**拒绝**：

- Python 引发 `ServerError`：找不到 TFStudio、TFStudio 无法启动，或它使用的协议与该包不同

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
console.log(Math.max(...design.spectrum(400, 700).R));
```

```python
import tfstudio

with tfstudio.TFStudio() as tf:
    design = tf.new_design("Mirror")
    design.stack("(HL)^4 H")
    print(max(design.spectrum(400, 700).R))
```

### design

| JavaScript | Python |
| ---------- | ------ |
| `tf.design` | `tf.design` |
| `tf.design = value` | `tf.design = value` |

在脚本控制台中，是脚本开始时应用中打开的设计，一个 Design；没有打开设计时为 `null` / `None`；在程序中为 `null` / `None`。脚本结束时，留在这里的设计，无论 `tf.design` 是被直接修改还是被设为另一个 Design，都会作为撤销可以撤回的一步应用到打开的设计上，前提是该设计在此期间没有改变。打开的设计保留它的名称，即其文件的名称，因此当设计除名称外与开始时相同时，不会应用任何内容。

```js
if (tf.design) console.log('The open design is', tf.design.name, 'with', tf.design.layers.length, 'front layers');
else console.log('No design is open');
```

```python
if tf.design:
    print("The open design is", tf.design.name, "with", len(tf.design.layers), "front layers")
else:
    print("No design is open")
```

### info

| JavaScript | Python |
| ---------- | ------ |
| `tf.info` | `tf.info` |

**JavaScript**：启动 TFStudio 时得到的情况，一个对象：`wasm`，快速内核加载成功时为 `true`；`dataDir`，读取了其材料目录的数据文件夹，或 null；`unreadable`，无法读取的材料目录文件。

**Python**：为本程序服务的 TFStudio 在启动时给出的信息，一个 dict：version、wasm（快速内核是否加载）、dataDir（数据文件夹，或 None）、unreadable（无法读取的材料目录）和 live。

```js
console.log(tf.info.wasm, tf.info.dataDir);
```

```python
print(tf.info["version"], tf.info["dataDir"])
```

### materials

| JavaScript | Python |
| ---------- | ------ |
| `tf.materials` | `tf.materials` |

TFStudio 材料目录中的材料，一个 Materials。

```js
const [n, k] = tf.materials.get('TiO2').nk(550);
console.log(n, k);
```

```python
n, k = tf.materials["TiO2"].nk(550)
print(n, k)
```

### newDesign / new_design

| JavaScript | Python |
| ---------- | ------ |
| `tf.newDesign(name, { substrate, reference })` | `tf.new_design(name="New Design", substrate="BK7", reference=550)` |

按应用的方式新建的设计：空气中的裸基底，没有膜层，镀膜在正面，并按镀膜面评价。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `name` | `name` | `'New Design'` | 设计的名称。 |
| `substrate` | `substrate` | `'BK7'` | 基底材料，按 id 指定。 |
| `reference` | `reference` | `550` | 参考波长，单位 nm，堆栈公式在该波长处计算四分之一波长。 |

**返回**：一个 Design。

**拒绝**：

- 找不到对应材料的材料 id，或小于等于 0 的参考波长

```js
const design = tf.newDesign('Mirror 550', { substrate: 'BK7', reference: 550 });
console.log(design);
```

```python
design = tf.new_design("Mirror 550", substrate="BK7", reference=550)
print(design)
```

### openDesign / open_design

| JavaScript | Python |
| ---------- | ------ |
| `tf.openDesign(path)` | `tf.open_design(path)` |

从 .tfs 文件读取的设计，读取方式与“文件 > 打开”相同，检查和修复也相同。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `path` | `path` |  | **JavaScript**：文件，使用完整路径。相对路径以程序启动时所在的文件夹为基准：在脚本控制台中，是启动 TFStudio 时所在的文件夹，通常是其安装文件夹。<br>**Python**：文件。相对路径以程序的工作文件夹为基准：在脚本控制台中，是脚本所在的文件夹；未保存的脚本则是数据文件夹。 |

**返回**：一个 Design。

**拒绝**：

- 无法读取的文件，或不包含可用设计的文件

```js
const file = require('path').join(require('os').homedir(), `mirror-${Date.now()}.tfs`);
const mirror = tf.newDesign('Mirror');
mirror.stack('(HL)^4 H');
mirror.save(file);
const design = tf.openDesign(file);
console.log(design.name, design.layers.length, 'layers, from', file);
```

```python
import time

name = "mirror-{}.tfs".format(time.time_ns())
mirror = tf.new_design("Mirror")
mirror.stack("(HL)^4 H")
mirror.save(name)
design = tf.open_design(name)
print(design.name, len(design.layers), "layers, from", name)
```

### readSpectrumFile / read_spectrum_file

| JavaScript | Python |
| ---------- | ------ |
| `tf.readSpectrumFile(path, { angle, pol, quantity, scale, xUnit })` | `tf.read_spectrum_file(path, angle=..., pol=..., quantity=..., scale=..., x_unit=...)` |

**JavaScript**：按实测光谱窗口的导入方式读取光谱文件：CSV 或文本表格，波长列之后每列一条曲线；或 JCAMP-DX 文件，每个光谱一条曲线；每条都是该窗口会添加到设计中的曲线。选项代替导入面板的设置，面板只询问文件未写明的内容：文件在表头行或列标题中写明的入射角或偏振予以保留，与窗口中相同。

**Python**：按实测光谱窗口的导入方式读取光谱文件：CSV 或文本表格，波长列之后每列一条曲线；或 JCAMP-DX 文件，每个光谱一条曲线；每条都是该窗口会添加到设计中的曲线。关键字参数代替导入面板的设置，面板只询问文件未写明的内容：文件在表头行或列标题中写明的入射角或偏振予以保留，与窗口中相同。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `path` | `path` |  | **JavaScript**：文件，给出完整路径。相对路径按 `openDesign` 的方式解释。<br>**Python**：文件。相对路径按 open_design() 的方式解释。 |
| `angle` | `angle` |  | **JavaScript**：入射角，单位度，用于文件未说明入射角的曲线；两者都未给出时为 0。<br>**Python**：入射角，单位度，用于文件未说明入射角的曲线。不给出时，两者都未给出则为 0。 |
| `pol` | `pol` |  | **JavaScript**：`'avg'`、`'s'` 或 `'p'`，用于文件未说明偏振的曲线；两者都未给出时为 `'avg'`。标题中写明偏振的列（如 Rs）保留其偏振，未写明偏振的 A 列为 `'avg'`。<br>**Python**："avg"、"s" 或 "p"，用于文件未说明偏振的曲线。不给出时，两者都未给出则为 "avg"。标题中写明偏振的列（如 Rs）保留其偏振，未写明偏振的 A 列为 "avg"。 |
| `quantity` | `quantity` |  | **JavaScript**：对表格文件，所有列的物理量 `'T'`、`'R'` 或 `'A'`；不给出时，取各列标题所写的物理量，标题未写时为 T。<br>**Python**：对表格文件，所有列的物理量 "T"、"R" 或 "A"。不给出时，取各列标题所写的物理量，标题未写时为 T。 |
| `scale` | `scale` |  | **JavaScript**：对表格文件，所有列数值的写法：`'fraction'`、`'percent'` 或 `'absorbance'`；不给出时，取导入对各列的判断。<br>**Python**：对表格文件，所有列数值的写法："fraction"、"percent" 或 "absorbance"。不给出时，取导入对各列的判断。 |
| `xUnit` | `x_unit` |  | **JavaScript**：对表格文件，其波长列的单位：`'nm'`、`'um'`、`'cm-1'` 或 `'eV'`；不给出时，取导入对它的判断。<br>**Python**：对表格文件，其波长列的单位："nm"、"um"、"cm-1" 或 "eV"。不给出时，取导入对它的判断。 |

**返回**：**JavaScript**：一个对象：`format`，`'table'` 或 `'jcamp'`；`fileName`；`xUnit`，表格波长读取时所用的单位，或 null；`skippedRows`，表格中不含数据行的行数；以及 `curves`，每条为 `{ name, quantity, angle, pol, wavelength, values }`，波长单位 nm 且递增，R、T 和 A 为 1 的分数，可交给 `design.compareMeasured()`。<br>**Python**：一个 SpectrumFile，即命名元组：format，"table" 或 "jcamp"；file_name；x_unit，表格波长读取时所用的单位，或 None；skipped_rows，表格中不含数据行的行数；以及 curves，每条为一个 MeasuredCurve，即由 name、quantity、angle、pol、wavelength 和 values 组成的命名元组，波长单位 nm 且递增，R、T 和 A 为 1 的分数，可交给 design.compare_measured()。

**拒绝**：

- 无法读取或不含导入可读光谱的文件、不接受的选项或选项无法取的值，或对 JCAMP-DX 文件给出 angle 和 pol 以外的选项

```js
const file = require('path').join(require('os').homedir(), `scan-${Date.now()}.csv`);
require('fs').writeFileSync(file, 'Wavelength (nm),%R\n450,2.1\n550,0.9\n650,1.8\n');
const [scan] = tf.readSpectrumFile(file).curves;
console.log(scan.name, scan.quantity, scan.wavelength, scan.values);
```

```python
import time

name = "scan-{}.csv".format(time.time_ns())
with open(name, "w") as f:
    f.write("Wavelength (nm),%R\n450,2.1\n550,0.9\n650,1.8\n")
scan = tf.read_spectrum_file(name).curves[0]
print(scan.name, scan.quantity, scan.wavelength, scan.values)
```

### readEllipsometryFile / read_ellipsometry_file

| JavaScript | Python |
| ---------- | ------ |
| `tf.readEllipsometryFile(path, { angle, side, deltaConvention, xUnit, quantities })` | `tf.read_ellipsometry_file(path, angle=..., side=..., delta_convention="azzam", x_unit=..., quantities=...)` |

**JavaScript**：按实测椭偏窗口的导入方式读取椭偏仪文件：一列波长和若干列以度为单位的 Ψ 与 Δ 组成的表格，每列按窗口的方式判定类型，得到的是窗口“添加全部已标注列”会添加的曲线。选项代替导入面板的设置：文件在表头行或列标题中写明的入射角予以保留，与窗口中相同；表头写明的面填入面板，`side` 可替换它。

**Python**：按实测椭偏窗口的导入方式读取椭偏仪文件：一列波长和若干列以度为单位的 Psi 与 Delta 组成的表格，每列按窗口的方式判定类型，得到的是窗口“添加全部已标注列”会添加的曲线。关键字参数代替导入面板的设置：文件在表头行或列标题中写明的入射角予以保留，与窗口中相同；表头写明的面填入面板，side 可替换它。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `path` | `path` |  | **JavaScript**：文件，给出完整路径。相对路径按 `openDesign` 的方式解释。<br>**Python**：文件。相对路径按 open_design() 的方式解释。 |
| `angle` | `angle` |  | **JavaScript**：入射角，单位度，用于文件未说明入射角的列；两者都未给出时为 70。<br>**Python**：入射角，单位度，用于文件未说明入射角的列。不给出时，两者都未给出则为 70。 |
| `side` | `side` |  | **JavaScript**：`'front'` 或 `'back'`，测量的面；不给出时，取文件表头写明的面，未写明时为 `'front'`。<br>**Python**："front" 或 "back"，测量的面。不给出时，取文件表头写明的面，未写明时为 "front"。 |
| `deltaConvention` | `delta_convention` | `'azzam'` | **JavaScript**：文件中 Δ 的符号约定：`'azzam'`，或 `'reversed'`，即 360 度减去前者。<br>**Python**：文件中 Delta 的符号约定："azzam"，或 "reversed"，即 360 度减去前者。 |
| `xUnit` | `x_unit` |  | **JavaScript**：波长列的单位：`'nm'`、`'um'`、`'cm-1'` 或 `'eV'`；不给出时，取导入对它的判断。<br>**Python**：波长列的单位："nm"、"um"、"cm-1" 或 "eV"。不给出时，取导入对它的判断。 |
| `quantities` | `quantities` |  | 各列的类型，按文件中的顺序：`'PSI'`、`'DEL'`，或 `null` / `None` 表示取导入给出的类型；没有类型的列不读入。 |

**返回**：**JavaScript**：一个对象：`fileName`；`xUnit`，读取波长时所用的单位；`skippedRows`，不含数据行的行数；以及 `curves`，每条为 `{ name, quantity, angle, side, deltaConvention, cosDelta, wavelength, values }`：quantity 为 `'PSI'` 或 `'DEL'`，Ψ 的 deltaConvention 为 null，看起来像 cos Δ 的 Δ 的 cosDelta 为 true，波长单位 nm 且递增，数值单位为度，可交给 `design.addMeasuredCurves()` 和 `design.compareMeasured()`。<br>**Python**：一个 EllipsometryFile，即命名元组：file_name；x_unit，读取波长时所用的单位；skipped_rows，不含数据行的行数；以及 curves，每条为一个 EllipsometryCurve，即由 name、quantity（"PSI" 或 "DEL"）、angle、side、delta_convention（Psi 为 None）、cos_delta（看起来像 cos Delta 的 Delta 为 True）、wavelength 和 values 组成的命名元组，波长单位 nm 且递增，数值单位为度，可交给 design.add_measured_curves() 和 design.compare_measured()。

**拒绝**：

- 无法读取或不含数字表格的文件、不接受的选项或选项无法取的值

```js
const file = require('path').join(require('os').homedir(), `witness-${Date.now()}.csv`);
require('fs').writeFileSync(file, '# AOI 65 deg, front side\nWavelength (nm),Psi (deg),Delta (deg)\n500,24.9,242.6\n600,20.7,218.4\n');
const [psi, delta] = tf.readEllipsometryFile(file).curves;
console.log(psi.angle, psi.values, delta.values);
```

```python
import time

name = "witness-{}.csv".format(time.time_ns())
with open(name, "w") as f:
    f.write("# AOI 65 deg, front side\nWavelength (nm),Psi (deg),Delta (deg)\n500,24.9,242.6\n600,20.7,218.4\n")
psi, delta = tf.read_ellipsometry_file(name).curves
print(psi.angle, psi.values, delta.values)
```

### exportMeasuredCurves / export_measured_curves

| JavaScript | Python |
| ---------- | ------ |
| `tf.exportMeasuredCurves(design, path, { curves, format, xUnit, scale, overwrite })` | `tf.export_measured_curves(design, path, curves=..., format="csv", x_unit="nm", scale="percent", overwrite=False)` |

**JavaScript**：把设计所含的实测曲线写入文件，与导出选项卡的写法相同：R、T 和 A 按实测光谱窗口的方式写成 CSV（各列上方是条件行）或 JCAMP-DX；Ψ 和 Δ 按实测椭偏窗口的方式写成以度为单位的 CSV。不给出选项时，使用窗口的出厂格式：CSV、nm、R、T 和 A 用百分比。

**Python**：把设计所含的实测曲线写入文件，与导出选项卡的写法相同：R、T 和 A 按实测光谱窗口的方式写成 CSV（各列上方是条件行）或 JCAMP-DX；Psi 和 Delta 按实测椭偏窗口的方式写成以度为单位的 CSV。不给出关键字参数时，使用窗口的出厂格式：CSV、nm、R、T 和 A 用百分比。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `design` | `design` |  | 设计，一个 Design。 |
| `path` | `path` |  | **JavaScript**：要写入的文件，给出完整路径。相对路径按 `openDesign` 的方式解释。<br>**Python**：要写入的文件。相对路径按 open_design() 的方式解释。 |
| `curves` | `curves` |  | **JavaScript**：要写出的曲线的名称，全部为 R、T 和 A，或全部为 Ψ 和 Δ。不给出时，写出设计所含的全部 R、T 和 A 曲线；没有这类曲线时写出其 Ψ 和 Δ。<br>**Python**：要写出的曲线的名称，全部为 R、T 和 A，或全部为 Psi 和 Delta。不给出时，写出设计所含的全部 R、T 和 A 曲线；没有这类曲线时写出其 Psi 和 Delta。 |
| `format` | `format` | `'csv'` | `'csv'`，或 `'jcamp'` 表示 JCAMP-DX，后者只用于 R、T 和 A。 |
| `xUnit` | `x_unit` | `'nm'` | **JavaScript**：波长列的单位：R、T 和 A 为 `'nm'`、`'um'` 或 `'cm-1'`，Ψ 和 Δ 为 `'nm'`、`'um'` 或 `'eV'`。<br>**Python**：波长列的单位：R、T 和 A 为 "nm"、"um" 或 "cm-1"，Psi 和 Delta 为 "nm"、"um" 或 "eV"。 |
| `scale` | `scale` | `'percent'` | 对 R、T 和 A，`'percent'` 或 `'fraction'`。 |
| `overwrite` | `overwrite` | `false` / `False` | **JavaScript**：覆盖已存在的文件。<br>**Python**：为 True 时，覆盖已存在的文件。 |

**拒绝**：

- 不是 Design 或不含实测曲线的设计、设计不含的曲线名称、两类曲线混在一起、不接受的选项或选项无法取的值，或已存在的文件（未给出 `overwrite` 时）

```js
const file = require('path').join(require('os').homedir(), `bench-${Date.now()}.csv`);
const design = tf.newDesign('AR');
design.addMeasuredCurves({ name: 'Bench R', quantity: 'R', angle: 8, wavelength: [450, 550, 650], values: [0.021, 0.009, 0.018] });
tf.exportMeasuredCurves(design, file, { scale: 'fraction' });
console.log(require('fs').readFileSync(file, 'utf8'));
```

```python
import time

name = "bench-{}.csv".format(time.time_ns())
design = tf.new_design("AR")
design.add_measured_curves({"name": "Bench R", "quantity": "R", "angle": 8,
                            "wavelength": [450, 550, 650], "values": [0.021, 0.009, 0.018]})
tf.export_measured_curves(design, name, scale="fraction")
print(open(name).read())
```

### saveZemaxCoating / save_zemax_coating

| JavaScript | Python |
| ---------- | ------ |
| `tf.saveZemaxCoating(design, path, { name, thickness, wavelength, start, end, step, scope, side, overwrite })` | `tf.save_zemax_coating(design, path, name="TFSTUDIO_DESIGN", thickness="absolute", wavelength=550, start=400, end=800, step=25, scope="used", side=..., overwrite=False)` |

**JavaScript**：按 Zemax 镀膜窗口导出标签页的写法，把设计的一个面写成 Zemax OpticStudio 的 COATING.DAT 文件：每种材料一条 MATE 记录，n 和 k 从 `start` 到 `end` 每隔 `step` nm 取样，波长以 µm 写出，折射率虚部写为 -k；然后是该面膜层的一条 COAT 记录，从入射介质一侧开始。背面从出射介质写到基底，因此无论哪一面，文件的含义都是从空气到玻璃。

**Python**：按 Zemax 镀膜窗口导出标签页的写法，把设计的一个面写成 Zemax OpticStudio 的 COATING.DAT 文件：每种材料一条 MATE 记录，n 和 k 从 start 到 end 每隔 step nm 取样，波长以 um 写出，折射率虚部写为 -k；然后是该面膜层的一条 COAT 记录，从入射介质一侧开始。背面从出射介质写到基底，因此无论哪一面，文件的含义都是从空气到玻璃。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `design` | `design` |  | 设计，一个 Design。 |
| `path` | `path` |  | **JavaScript**：要写入的文件，给出完整路径。相对路径按 `openDesign` 的方式解释。<br>**Python**：要写入的文件。相对路径按 open_design() 的方式解释。 |
| `name` | `name` | `'TFSTUDIO_DESIGN'` | COAT 记录的名称，以大写写出，字母、数字、`_` 和 `.` 以外的字符都写为 `_`，并截断为 32 个字符。 |
| `thickness` | `thickness` | `'absolute'` | **JavaScript**：`'absolute'`，每层的物理厚度，单位 µm；或 `'relative'`，每层的光学厚度，以 `wavelength` 的波数计。<br>**Python**："absolute"，每层的物理厚度，单位 um；或 "relative"，每层的光学厚度，以 wavelength 的波数计。 |
| `wavelength` | `wavelength` | `550` | **JavaScript**：λ₀，单位 nm，用于相对厚度。<br>**Python**：参考波长，单位 nm，用于相对厚度。 |
| `start` | `start` | `400` | MATE 记录的第一个波长，单位 nm。 |
| `end` | `end` | `800` | MATE 记录的最后一个波长，单位 nm，大于 `start`。 |
| `step` | `step` | `25` | MATE 记录的波长步长，单位 nm。 |
| `scope` | `scope` | `'used'` | `'used'`，设计用到的材料，包括其介质和基底；或 `'all'`，另加此处各材料目录中的全部材料。 |
| `side` | `side` |  | **JavaScript**：`'front'` 或 `'back'`。不给出时为正面；仅背面镀膜的设计为背面。<br>**Python**："front" 或 "back"。不给出时为正面；仅背面镀膜的设计为背面。 |
| `overwrite` | `overwrite` | `false` / `False` | **JavaScript**：覆盖已存在的文件。<br>**Python**：为 True 时，覆盖已存在的文件。 |

**拒绝**：

- 不是 Design 的设计、没有膜层的面、它不接受的选项或选项不能取的值、不构成范围的 start 和 end、未给出 `overwrite` 时已存在的文件，或用到找不到对应材料的设计

```js
const file = require('path').join(require('os').homedir(), `COATING-${Date.now()}.DAT`);
const design = tf.newDesign('AR');
design.stack('0.5H L');
tf.saveZemaxCoating(design, file, { name: 'AR', thickness: 'relative' });
const text = require('fs').readFileSync(file, 'utf8');
console.log(text.slice(text.indexOf('COAT')));
```

```python
import time

name = "COATING-{}.DAT".format(time.time_ns())
design = tf.new_design("AR")
design.stack("0.5H L")
tf.save_zemax_coating(design, name, name="AR", thickness="relative")
text = open(name).read()
print(text[text.index("COAT"):])
```

### readZemaxCoating / read_zemax_coating

| JavaScript | Python |
| ---------- | ------ |
| `tf.readZemaxCoating(path, { wavelength })` | `tf.read_zemax_coating(path, wavelength=550)` |

按 Zemax 镀膜窗口的列法读取 Zemax OpticStudio 的 COATING.DAT 文件：其 MATE 记录按材料标签页的列法，其镀膜按镀膜标签页的列法，相对厚度在 `wavelength` 处换算为 nm。不向任何材料目录写入内容。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `path` | `path` |  | **JavaScript**：文件，给出完整路径。相对路径按 `openDesign` 的方式解释。<br>**Python**：文件。相对路径按 open_design() 的方式解释。 |
| `wavelength` | `wavelength` | `550` | **JavaScript**：λ₀，单位 nm；文件以波数给出的厚度在此波长处换算为 nm。<br>**Python**：波长，单位 nm；文件以波数给出的厚度在此波长处换算为 nm。 |

**返回**：**JavaScript**：一个对象：`fileName`；`materials`，每条 MATE 记录为 `{ name, repeat, importedAs, wavelength, n, k }`，文件多次定义同一名称时 repeat 为 `{ index, count }`，否则为 null，importedAs 为导入时给它的名称，波长单位 nm 且递增，k 大于等于 0；以及 `coatings`，每条 COAT 为 `{ name, type, layers }`，type 为 `'stack'`（膜层堆栈，唯一可导入的类型），或 `'ideal'`、`'table'` 或 `'encrypted'`，layers 除膜层堆栈外均为 null，每层为 `{ material, thickness, fileThickness, mode }`，thickness 单位 nm（相对厚度而文件没有给出其材料的折射率时为 null），fileThickness 为文件中写的值，mode 为 `'absolute'` 或 `'relative'`。<br>**Python**：一个 ZemaxCoatingFile，即命名元组：file_name；materials，每条为一个 ZemaxMaterial，即由 name、repeat（文件多次定义同一名称时为由 index 和 count 组成的 dict，从 1 开始计数；否则为 None）、imported_as（导入时给它的名称）、wavelength（单位 nm，递增）、n 和 k（大于等于 0）组成的命名元组；以及 coatings，每条为一个 ZemaxCoating，即由 name、type（"stack"，唯一可导入的类型，或 "ideal"、"table" 或 "encrypted"）和 layers 组成的命名元组，layers 除膜层堆栈外均为 None，每层为一个 ZemaxLayer，即由 material、thickness（单位 nm；相对厚度而文件没有给出其材料的折射率时为 None）、file_thickness（文件中写的值）和 mode（"absolute" 或 "relative"）组成的命名元组。

**拒绝**：

- **JavaScript**：无法读取的文件或既没有 MATE 记录也没有镀膜的文件、它不接受的选项，或选项不能取的值<br>**Python**：无法读取的文件或既没有 MATE 记录也没有镀膜的文件，或 wavelength 不能取的值

```js
const file = require('path').join(require('os').homedir(), `COATING-${Date.now()}.DAT`);
require('fs').writeFileSync(file, 'MATE TIO2\n0.4 2.35 0\n0.8 2.25 0\nMATE SIO2\n0.4 1.47 0\n0.8 1.45 0\nCOAT AR\nTIO2 0.25 0\nSIO2 0.25 0\n');
const read = tf.readZemaxCoating(file);
for (const layer of read.coatings[0].layers) console.log(layer.material, layer.thickness.toFixed(2), 'nm');
```

```python
import time

name = "COATING-{}.DAT".format(time.time_ns())
with open(name, "w") as f:
    f.write("MATE TIO2\n0.4 2.35 0\n0.8 2.25 0\nMATE SIO2\n0.4 1.47 0\n0.8 1.45 0\nCOAT AR\nTIO2 0.25 0\nSIO2 0.25 0\n")
for layer in tf.read_zemax_coating(name).coatings[0].layers:
    print(layer.material, round(layer.thickness, 2), "nm")
```

### saveCodevCoating / save_codev_coating

| JavaScript | Python |
| ---------- | ------ |
| `tf.saveCodevCoating(design, path, { title, saveName, start, end, step, angles, wavelength, side, overwrite })` | `tf.save_codev_coating(design, path, title=..., save_name=..., start=400, end=800, step=10, angles=[0], wavelength=..., side=..., overwrite=False)` |

按 CODE V 镀膜窗口导出标签页的写法，把设计的一个面写成 CODE V 的 .seq 命令文件：在 MULTILAYER 选项中输入膜层堆栈的命令，厚度单位 nm，从入射介质一侧开始，厚度为零的膜层略去；每种材料在最多 21 个分析波长处的 n 和 k 组成的 MIC 表；以及让 CODE V 将其保存为 .mul 的 SAV。背面从出射介质写到基底。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `design` | `design` |  | 设计，一个 Design。 |
| `path` | `path` |  | **JavaScript**：要写入的文件，给出完整路径。相对路径按 `openDesign` 的方式解释。<br>**Python**：要写入的文件。相对路径按 open_design() 的方式解释。 |
| `title` | `title` |  | **JavaScript**：TIT，膜层堆栈的标题，截断为 80 个字符，并去掉单引号。不给出时为设计的名称。<br>**Python**：TIT，膜层堆栈的标题，截断为 80 个字符，并去掉单引号。不给出时为设计的名称。 |
| `saveName` | `save_name` |  | **JavaScript**：SAV 保存 .mul 时所用的名称，字母、数字、`_` 和 `-` 以外的每一串连续字符都写为一个 `_`。不给出时为设计的名称。<br>**Python**：SAV 保存 .mul 时所用的名称，字母、数字、_ 和 - 以外的每一串连续字符都写为一个 _。不给出时为设计的名称。 |
| `start` | `start` | `400` | 第一个分析波长，单位 nm。 |
| `end` | `end` | `800` | 最后一个分析波长，单位 nm，大于 `start`。 |
| `step` | `step` | `10` | 分析波长的步长，单位 nm；CODE V 最多接受 100 个分析波长。 |
| `angles` | `angles` | `[0]` | ANG，入射角，单位度，大于等于 0 且小于 90；CODE V 最多接受 5 个。 |
| `wavelength` | `wavelength` |  | **JavaScript**：REF，参考波长，单位 nm。不给出时为设计的参考波长。<br>**Python**：REF，参考波长，单位 nm。不给出时为设计的参考波长。 |
| `side` | `side` |  | **JavaScript**：`'front'` 或 `'back'`。不给出时为正面；仅背面镀膜的设计为背面。<br>**Python**："front" 或 "back"。不给出时为正面；仅背面镀膜的设计为背面。 |
| `overwrite` | `overwrite` | `false` / `False` | **JavaScript**：覆盖已存在的文件。<br>**Python**：为 True 时，覆盖已存在的文件。 |

**返回**：写出时的提示，与窗口在文本下方列出的相同：取样波长少于其自身数据点的材料，或写出时未带 k 的吸收介质。

**拒绝**：

- 不是 Design 的设计、没有膜层的面、超出 MUL 选项限制（1000 层、100 个波长、5 个角度）的膜层堆栈、它不接受的选项或选项不能取的值、不构成范围的 start 和 end、未给出 `overwrite` 时已存在的文件，或用到找不到对应材料的设计

```js
const file = require('path').join(require('os').homedir(), `ar-${Date.now()}.seq`);
const design = tf.newDesign('AR');
design.stack('0.5H L');
console.log(tf.saveCodevCoating(design, file, { angles: [0, 45] }));
console.log(require('fs').readFileSync(file, 'utf8').split('\n').filter(line => /^(COA|SUB|SAV)/.test(line.trim())).join('\n'));
```

```python
import time

name = "ar-{}.seq".format(time.time_ns())
design = tf.new_design("AR")
design.stack("0.5H L")
print(tf.save_codev_coating(design, name, angles=[0, 45]))
print([line for line in open(name).read().splitlines() if line.strip().startswith(("COA", "SUB", "SAV"))])
```

### readCodevCoating / read_codev_coating

| JavaScript | Python |
| ---------- | ------ |
| `tf.readCodevCoating(path)` | `tf.read_codev_coating(path)` |

按 CODE V 镀膜窗口导入标签页的显示读取 CODE V 镀膜文件，可以是 .seq 命令文件，也可以是 CODE V 保存的 .mul：膜层堆栈在其膜层周围设定的内容，以及从入射介质一侧开始的各层；文件以 REF 的波数给出的厚度换算为 nm。不向任何材料目录写入内容。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `path` | `path` |  | **JavaScript**：文件，给出完整路径；名称以 .mul 结尾的按保存的 .mul 读取，其他按命令读取。相对路径按 `openDesign` 的方式解释。<br>**Python**：文件；名称以 .mul 结尾的按保存的 .mul 读取，其他按命令读取。相对路径按 open_design() 的方式解释。 |

**返回**：**JavaScript**：一个对象：`fileName`；`title`；`reference`，REF，单位 nm；`wavelengths`，分析波长，单位 nm；`angles`，单位度；`incident` 和 `substrate`，各为 `{ label, n, k }`，MIC 材料给出其标签，n 和 k 为 null，常数折射率则 label 为 null；`layers`，每层为 `{ index, thickness, code, locked }`，index 与 `incident` 相同，thickness 单位 nm，code 为其 COA 代码（100 固定，0 自由，1 到 99 耦合），locked 表示代码是否为 100；以及 `warnings`，读取时的提示。<br>**Python**：一个 CodevCoatingFile，即命名元组：file_name；title；reference，REF，单位 nm；wavelengths，分析波长，单位 nm；angles，单位度；incident 和 substrate，各为一个 CodevIndex，即由 label、n 和 k 组成的命名元组，MIC 材料给出其标签，n 和 k 为 None，常数折射率则 label 为 None；layers，每层为一个 CodevLayer，即由 index（一个 CodevIndex）、thickness（单位 nm）、code（其 COA 代码：100 固定，0 自由，1 到 99 耦合）和 locked（代码是否为 100）组成的命名元组；以及 warnings，读取时的提示。

**拒绝**：

- 无法读取的文件，或没有输入读取器能读取的膜层堆栈的文件，并说明读取在何处停止

```js
const file = require('path').join(require('os').homedir(), `ar-${Date.now()}.seq`);
require('fs').writeFileSync(file, "MUL\nMDA\nPHT Y\nTIT 'AR'\nWLG 400 700 50\nREF 550\nCOA 99.6 100 1.38\nCOA 59.8 0 2.3\nSUB 1.52\nEND\nMEX\n");
const read = tf.readCodevCoating(file);
for (const layer of read.layers) console.log('n', layer.index.n, layer.thickness, 'nm', layer.locked ? 'locked' : '');
```

```python
import time

name = "ar-{}.seq".format(time.time_ns())
with open(name, "w") as f:
    f.write("MUL\nMDA\nPHT Y\nTIT 'AR'\nWLG 400 700 50\nREF 550\nCOA 99.6 100 1.38\nCOA 59.8 0 2.3\nSUB 1.52\nEND\nMEX\n")
for layer in tf.read_codev_coating(name).layers:
    print("n", layer.index.n, layer.thickness, "nm", "locked" if layer.locked else "")
```

### app

| JavaScript | Python |
| ---------- | ------ |
| JavaScript 中没有：脚本处理的是打开的设计 `tf.design`。 | `tf.app` |

打开的 TFStudio 应用，一个 App，用于以 live=True 启动的 TFStudio()。

```python
import tfstudio

with tfstudio.TFStudio(live=True) as tf:
    print(tf.app.open_design().name)
```

### close

| JavaScript | Python |
| ---------- | ------ |
| JavaScript 中没有：控制台的 TFStudio 就是应用本身。 | `tf.close()` |

结束为本程序服务的 TFStudio，若它正在运行，先停止该运行。此后，来自它的设计不能再计算。

```python
import tfstudio

tf = tfstudio.TFStudio()
print(tf.info["version"])
tf.close()
```

## Design

一个薄膜设计，内容与 .tfs 文件相同：介质和基底、每一面的膜层，以及评价函数。`tf.newDesign()` / `tf.new_design()`、`tf.openDesign()` / `tf.open_design()` 和 copy() 会给出一个设计；在脚本控制台中，`tf.design` 是打开的设计。

改变设计的方法会直接修改该设计：stack()、各项膜层编辑、clean()、refine() 和 synthesize()。copy() 可以先保留一份副本。

**Python**：在以 live=True 启动的程序中，tf.app.open_design() 从应用中读取一个设计，push() 把它写回。

```js
const design = tf.newDesign('Mirror 550', { substrate: 'BK7', reference: 550 });
design.stack('(HL)^4 H', { H: 'TiO2', L: 'SiO2' });
console.log(design);
```

```python
design = tf.new_design("Mirror 550", substrate="BK7", reference=550)
design.stack("(HL)^4 H", H="TiO2", L="SiO2")
print(design)
```

### name

| JavaScript | Python |
| ---------- | ------ |
| `design.name` | `design.name` |
| `design.name = value` | `design.name = value` |

设计的名称。在脚本控制台中，给 `tf.design` 起的新名称不会应用到打开的设计上，打开的设计的名称就是其文件的名称。

**拒绝**：

- 不是文本或为空的名称

```js
const design = tf.newDesign('Bare BK7');
design.name = 'BK7 window';
console.log(design.name);
```

```python
design = tf.new_design("Bare BK7")
design.name = "BK7 window"
print(design.name)
```

### reference

| JavaScript | Python |
| ---------- | ------ |
| `design.reference` | `design.reference` |
| `design.reference = value` | `design.reference = value` |

参考波长，单位 nm，堆栈公式在该波长处计算四分之一波长。设置它会按比例缩放每一层，使其四分之一波长数保持不变，与设计编辑器中参考波长字段的做法相同。

**拒绝**：

- 小于等于 0 的波长

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
design.reference = 600;
console.log(design.reference, 'nm, layer 1', design.layers[1].thickness, 'nm');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
design.reference = 600
print(design.reference, "nm, layer 1", design.layers[1].thickness, "nm")
```

### sides

| JavaScript | Python |
| ---------- | ------ |
| `design.sides` | `design.sides` |
| `design.sides = value` | `design.sides = value` |

哪些面带有膜层：`'front'`、`'back'`、`'both'`，或 `'symmetric'`，即背面是正面的镜像。把设计设为对称时，其背面变为正面的镜像。

它与 `scoreOn` / `score_on` 一起决定光谱、评价函数和每次运行的计算对象：仅正面、仅背面，或整个元件；每个结果都在其 `mode` 中给出这一点。

**拒绝**：

- 其他任何值

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
design.sides = 'both';
console.log(design.sides, design.spectrum(400, 700).mode);
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
design.sides = "both"
print(design.sides, design.spectrum(400, 700).mode)
```

### scoreOn / score_on

| JavaScript | Python |
| ---------- | ------ |
| `design.scoreOn` | `design.score_on` |
| `design.scoreOn = value` | `design.score_on = value` |

单面镀膜的设计如何评价：`'side'`，仅评价其镀膜面；`'whole part'`，包括基底的另一面。两面都镀膜的设计按整个元件评价。它就是设计编辑器中的“忽略另一面”：勾选时为 `'side'`。

**拒绝**：

- 其他任何值

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
design.scoreOn = 'whole part';
console.log(design.scoreOn, design.spectrum(400, 700).mode);
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
design.score_on = "whole part"
print(design.score_on, design.spectrum(400, 700).mode)
```

### incidentMedium / incident_medium

| JavaScript | Python |
| ---------- | ------ |
| `design.incidentMedium` | `design.incident_medium` |
| `design.incidentMedium = value` | `design.incident_medium = value` |

光入射一侧的介质，按材料 id 指定。

**拒绝**：

- 找不到对应材料的材料 id

```js
const design = tf.newDesign('Prism coating');
design.stack('(HL)^2');
design.incidentMedium = 'BK7';
console.log(design.incidentMedium);
```

```python
design = tf.new_design("Prism coating")
design.stack("(HL)^2")
design.incident_medium = "BK7"
print(design.incident_medium)
```

### exitMedium / exit_medium

| JavaScript | Python |
| ---------- | ------ |
| `design.exitMedium` | `design.exit_medium` |
| `design.exitMedium = value` | `design.exit_medium = value` |

基底后面的介质，按材料 id 指定。

**拒绝**：

- 找不到对应材料的材料 id

```js
const design = tf.newDesign('Cemented');
design.exitMedium = 'BK7';
console.log(design.exitMedium);
```

```python
design = tf.new_design("Cemented")
design.exit_medium = "BK7"
print(design.exit_medium)
```

### substrate

| JavaScript | Python |
| ---------- | ------ |
| `design.substrate` | `design.substrate` |

基底：其材料和厚度，一个 Substrate。

```js
const design = tf.newDesign('Bare BK7');
design.substrate.thickness = 3;
console.log(design.substrate);
```

```python
design = tf.new_design("Bare BK7")
design.substrate.thickness = 3
print(design.substrate)
```

### layers

| JavaScript | Python |
| ---------- | ------ |
| `design.layers` | `design.layers` |

正面的膜层，一个 Layers，从紧邻基底的 1 开始编号。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
design.layers[1].thickness = 12.5;
console.log(design.layers);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
design.layers[1].thickness = 12.5
print(design.layers)
```

### backLayers / back_layers

| JavaScript | Python |
| ---------- | ------ |
| `design.backLayers` | `design.back_layers` |

背面的膜层，一个 Layers，从紧邻基底的 1 开始编号。对称设计的背面是正面的镜像，不能在这里修改。

```js
const design = tf.newDesign('Two-sided AR');
design.sides = 'both';
design.backLayers.append('MgF2', 100);
console.log(design.backLayers);
```

```python
design = tf.new_design("Two-sided AR")
design.sides = "both"
design.back_layers.append("MgF2", 100)
print(design.back_layers)
```

### merit

| JavaScript | Python |
| ---------- | ------ |
| `design.merit` | `design.merit` |

评价函数，一个 Merit：它的各行，以及这些行合计得到的评价函数值。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
design.merit.add('RAV', 420, 680, { target: 0 });
console.log(design.merit.value);
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
design.merit.add("RAV", 420, 680, target=0)
print(design.merit.value)
```

### specification

| JavaScript | Python |
| ---------- | ------ |
| `design.specification` | `design.specification` |

规格，一个 Specification：规格说明窗口中判定通过或不通过的各项检查、对它们的判定，以及相对它们的良率。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^5 H');
design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.9 });
console.log(design.specification.check().passed);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^5 H")
design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.9)
print(design.specification.check().passed)
```

### stack

| JavaScript | Python |
| ---------- | ------ |
| `design.stack(formula, { at, side, fromSubstrate, H })` | `design.stack(formula, at=..., side="front", from_substrate=True, H=...)` |

用堆栈公式构建的膜层替换一面的膜层，与堆栈公式对话框的“替换”相同。每个字母是参考波长处的四分之一波长，因此 `'(HL)^5 H'` 是十一个四分之一波长层。如果单面镀膜的设计中被填充的一面不参与评价，设计会变为两面镀膜，与对话框的做法相同。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `formula` | `formula` |  | 只写膜层，例如 `'(HL)^5 H'`；介质保持设计原有的。 |
| `at` | `at` |  | 计算四分之一波长所用的波长，单位 nm，之后设计将其作为参考波长。不给出时，使用设计的参考波长。 |
| `side` | `side` | `'front'` | `'front'` 或 `'back'`；对称设计取正面。 |
| `fromSubstrate` | `from_substrate` | `true` / `True` | 为 `true` / `True` 时，公式的第一个字母是基底上的那一层；为 `false` / `False` 时，是紧邻入射介质的那一层。 |
| `H` | `H` |  | 字母 H 的材料，按 id 指定，例如 `'Ta2O5'`；公式中的其他字母同理。未给出的字母：H 为 TiO2，L 为 SiO2，M 为 Al2O3。 |

**拒绝**：

- 无法解析的公式（并说明解析在何处停止）；写出了介质的公式；公式中没有用到的字母；stack 不接受的选项；对称设计的背面；或找不到对应材料的材料 id

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H', { H: 'Ta2O5', L: 'SiO2', at: 600 });
console.log(design.layers.length, 'layers at', design.reference, 'nm');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H", H="Ta2O5", L="SiO2", at=600)
print(len(design.layers), "layers at", design.reference, "nm")
```

### clean

| JavaScript | Python |
| ---------- | ------ |
| `design.clean({ minThickness, merge, back })` | `design.clean(min_thickness=5, merge=True, back=True)` |

按设计清理器窗口的方式清理膜层堆栈：相邻的同材料膜层合并为一层，薄于 `minThickness` / `min_thickness` 的膜层被移除，并分多轮进行，因为移除一层后可能使两个同材料膜层相邻接触。被锁定的膜层永远不会被合并或移除，对称设计的背面跟随其正面。之后设计中保存的是清理后的膜层。

**JavaScript**：由于堆栈改变，评价函数值通常会略微变差。要做到窗口的“重新优化”所做的，先添加一个目标为 `minThickness` 的 MNT 行，再用 sqp 精炼：`design.merit.add('MNT', { target: 5 })`，然后 `await design.refine({ method: 'sqp', maxIter: 80 })`。各层随后停在窗口的这一轮精炼给出的厚度上。窗口的这一轮精炼让每层不低于 `minThickness`，sqp 让每层保持在 MNT 行的界限之内；没有这一行时，refine 只让各层不低于 1 nm。

**Python**：由于堆栈改变，评价函数值通常会略微变差。要做到窗口的“重新优化”所做的，先添加一个目标为 min_thickness 的 MNT 行，再用 sqp 精炼：design.merit.add("MNT", target=5)，然后 design.refine(method="sqp", max_iter=80)。各层随后停在窗口的这一轮精炼给出的厚度上。窗口的这一轮精炼让每层不低于 min_thickness，sqp 让每层保持在 MNT 行的界限之内；没有这一行时，refine 只让各层不低于 1 nm。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `minThickness` | `min_thickness` | `5` | 保留的最薄膜层，单位 nm：比它薄的膜层会被移除。为 0 时不移除任何膜层。 |
| `merge` | `merge` | `true` / `True` | 为 `true` / `True` 时，合并相邻的同材料膜层。 |
| `back` | `back` | `true` / `True` | 为 `true` / `True` 时同时清理背面，设计只按正面计算、膜层编辑不允许修改其背面时也是如此；为 `false` / `False` 时只清理正面，设计只在背面镀膜时也是如此。 |

**返回**：一个 CleanReport。

**拒绝**：

- **JavaScript**：clean 不接受的选项、不是大于等于 0 的数的 minThickness、不是 `true` 或 `false` 的 merge 或 back，或没有膜层的设计<br>**Python**：不是大于等于 0 的数的 min_thickness、不是 True 或 False 的 merge 或 back，或没有膜层的设计

```js
const design = tf.newDesign('Stack with a thin layer');
design.stack('(HL)^2 0.03H L');
const report = design.clean({ minThickness: 5 });
for (const op of report.operations) console.log(op.kind, op.side, 'layer', op.number, op.material, op.thickness);
console.log(design.layers.length, 'layers now');
```

```python
design = tf.new_design("Stack with a thin layer")
design.stack("(HL)^2 0.03H L")
report = design.clean(min_thickness=5)
for op in report.operations:
    print(op.kind, op.side, "layer", op.number, op.material, op.thickness)
print(len(design.layers), "layers now")
```

### scaleThicknesses / scale_thicknesses

| JavaScript | Python |
| ---------- | ------ |
| `design.scaleThicknesses(factor, { side })` | `design.scale_thicknesses(factor, side=...)` |

把某一面每个未锁定的膜层按同一系数加厚或减薄。被锁定的膜层保持不变，对称设计的背面跟随其正面。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `factor` | `factor` |  | 每个厚度所乘的系数，大于 0：1.02 使每个未锁定的膜层厚 2%。 |
| `side` | `side` |  | `'front'` 或 `'back'`。不给出时为正面，只在背面镀膜的设计则为背面。 |

**拒绝**：

- **JavaScript**：不是大于 0 的数的系数、scaleThicknesses 不接受的选项、`'front'` 或 `'back'` 以外的面，或设计不允许编辑的一面，例如对称设计的背面<br>**Python**：不是大于 0 的数的系数、"front" 或 "back" 以外的面，或设计不允许编辑的一面，例如对称设计的背面

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
design.scaleThicknesses(1.05);
console.log(design.layers[1].thickness, 'nm');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
design.scale_thicknesses(1.05)
print(design.layers[1].thickness, "nm")
```

### quantize

| JavaScript | Python |
| ---------- | ------ |
| `design.quantize({ mode, value, side })` | `design.quantize(mode="step", value=..., side=...)` |

按设计编辑器中“取整 / 量化厚度”对话框的方式对某一面未锁定的膜层取整：取到 nm 的若干位小数，取到最接近的整数个控制步长，或取到参考波长处最接近的整数个 QWOT 增量。被锁定的膜层保持不变，对称设计的背面跟随其正面。薄于半个步长的膜层会取整为 0 nm，与对话框相同；在 `'qwot'` 模式下，材料没有四分之一波长的膜层保持不变。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `mode` | `mode` | `'step'` | `'decimals'`、`'step'`（控制步长，单位 nm）或 `'qwot'`（QWOT 增量）。 |
| `value` | `value` |  | 小数位数（0 到 8）、步长（单位 nm）或 QWOT 增量，取决于模式。不给出时，取对话框打开时的值：2 位、0.1 nm 或 1 个 QWOT。 |
| `side` | `side` |  | `'front'` 或 `'back'`。不给出时为正面，只在背面镀膜的设计则为背面。 |

**拒绝**：

- **JavaScript**：quantize 不接受的选项、`'decimals'`、`'step'` 或 `'qwot'` 以外的模式、该模式不接受的值、`'front'` 或 `'back'` 以外的面，或设计不允许编辑的一面<br>**Python**："decimals"、"step" 或 "qwot" 以外的模式、该模式不接受的值、"front" 或 "back" 以外的面，或设计不允许编辑的一面

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
design.quantize({ mode: 'step', value: 0.5 });
console.log(design.layers);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
design.quantize("step", 0.5)
print(design.layers)
```

### perturb

| JavaScript | Python |
| ---------- | ------ |
| `design.perturb(percent, { side, seed })` | `design.perturb(percent=2, side=..., seed=...)` |

按设计编辑器中“扰动厚度”对话框的方式，给某一面未锁定的膜层加上随机厚度误差：每个厚度乘以 1 + k · percent / 100，其中 k 对每层在 -1 到 1 之间均匀抽取。被锁定的膜层保持不变，对称设计的背面跟随其正面。相同的种子、设计和 percent 给出相同的误差。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `percent` | `percent` | `2` | 最大误差，为每个厚度的 ± %，大于 0 且不超过 100。 |
| `side` | `side` |  | `'front'` 或 `'back'`。不给出时为正面，只在背面镀膜的设计则为背面。 |
| `seed` | `seed` |  | **JavaScript**：抽样的起始数，1 到 2^32 - 1 之间的整数。不给出或为 null 时，使用一个新的种子。<br>**Python**：抽样的起始数，1 到 2^32 - 1 之间的整数。不给出时，使用一个新的种子。 |

**返回**：抽样开始所用的种子。

**拒绝**：

- **JavaScript**：不大于 0 或超过 100 的 percent、perturb 不接受的选项、不是 1 到 2^32 - 1 之间整数的种子、`'front'` 或 `'back'` 以外的面，或设计不允许编辑的一面<br>**Python**：不大于 0 或超过 100 的 percent、不是 1 到 2^32 - 1 之间整数的种子、"front" 或 "back" 以外的面，或设计不允许编辑的一面

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
const seed = design.perturb(3, { seed: 7 });
console.log('seed', seed, design.layers);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
seed = design.perturb(3, seed=7)
print("seed", seed, design.layers)
```

### copyFrontToBack / copy_front_to_back

| JavaScript | Python |
| ---------- | ------ |
| `design.copyFrontToBack()` | `design.copy_front_to_back()` |

按设计编辑器中“复制到背面”的方式，把正面的膜层复制到背面：背面得到从基底向外相同的膜层堆栈，其原有膜层被替换。`sides` 保持不变，因此要两面都镀膜，请将其设为 `'both'`。

**拒绝**：

- 设计不允许编辑的正面，即只在背面镀膜且只按该面评价的设计

```js
const design = tf.newDesign('Two-sided AR');
design.stack('H L');
design.sides = 'both';
design.copyFrontToBack();
console.log(design.backLayers);
```

```python
design = tf.new_design("Two-sided AR")
design.stack("H L")
design.sides = "both"
design.copy_front_to_back()
print(design.back_layers)
```

### copyBackToFront / copy_back_to_front

| JavaScript | Python |
| ---------- | ------ |
| `design.copyBackToFront()` | `design.copy_back_to_front()` |

按设计编辑器中“复制到正面”的方式，把背面的膜层复制到正面：正面得到从基底向外相同的膜层堆栈，其原有膜层被替换。`sides` 保持不变。

**拒绝**：

- 设计不允许编辑的背面：对称设计的背面，或只在正面镀膜且只按该面评价的设计的背面

```js
const design = tf.newDesign('Two-sided AR');
design.sides = 'both';
design.backLayers.append('MgF2', 100);
design.copyBackToFront();
console.log(design.layers);
```

```python
design = tf.new_design("Two-sided AR")
design.sides = "both"
design.back_layers.append("MgF2", 100)
design.copy_back_to_front()
print(design.layers)
```

### differences

| JavaScript | Python |
| ---------- | ------ |
| `design.differences(other)` | `design.differences(other)` |

本设计与 `other` 之间的不同之处：它们的设置和膜层，膜层按从基底起的编号逐面比较，因此在靠近基底处加一层，会使其外侧的每一层都显示为改变。数值按精确值比较。名称、评价函数的行、规格检查、入射锥角和设计携带的材料不参与比较。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `other` | `other` |  | 与本设计比较的 Design。 |

**返回**：**JavaScript**：一个对象：`same`，所比较的内容都相同时为 true；`setup`，每项不同的设置，形如 `{ setting, before, after }`，setting 为本对象中的名称（`'incidentMedium'`、`'exitMedium'`、`'substrate.material'`、`'substrate.thickness'`、`'reference'`、`'sides'` 或 `'scoreOn'`），before 为本设计中的值，after 为 `other` 中的值；`layers`，每个不同的膜层，正面在前，形如 `{ side, number, before, after, change }`，before 和 after 为 `{ material, thickness, locked }`，该设计没有这一编号的膜层时为 null，change 为 after 的厚度减去 before 的厚度，单位 nm，或为 null。<br>**Python**：命名元组 Differences：same，所比较的内容都相同时为 True；setup，每项不同的设置，为 SetupChange（setting、before、after），setting 为本包中的名称（"incident_medium"、"exit_medium"、"substrate.material"、"substrate.thickness"、"reference"、"sides" 或 "score_on"），before 为本设计中的值，after 为 other 中的值；layers，每个不同的膜层，正面在前，为 LayerChange（side、number、before、after、change），before 和 after 为 LayerState（material、thickness、locked），该设计没有这一编号的膜层时为 None，change 为 after 的厚度减去 before 的厚度，单位 nm，或为 None。

**拒绝**：

- 不是 Design 的 other

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
const kicked = design.copy();
kicked.perturb(2, { seed: 3 });
for (const l of design.differences(kicked).layers) console.log(l.side, l.number, l.change);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
kicked = design.copy()
kicked.perturb(2, seed=3)
for layer in design.differences(kicked).layers:
    print(layer.side, layer.number, layer.change)
```

### edgeFilter / edge_filter

| JavaScript | Python |
| ---------- | ------ |
| `design.edgeFilter({ pass, edge, angle, a, b, incident, lower, upper, step, periods })` | `design.edge_filter(pass_="short", edge=..., angle=0, a=..., b=..., incident=..., lower=0.1, upper=1, step=0.05, periods=10)` |

**JavaScript**：按边缘滤光片窗口的方式搜索非偏振边缘滤光片的周期：五层周期 (aA bB cA bB aA) 或 (aB bA cB bA aB)，其 s 与 p 截止带边缘在该入射角下落在边缘波长处，a、b、c 为边缘波长处的四分之一波倍数；最好的在前：截止带最宽者优先，其次是通带最宽者。在 0° 时搜索给出正反两种排列的四分之一波周期，c 为 null。A 与 B 按其在边缘波长处的实折射率视为无损耗。不给选项时，使用窗口在此设计上打开时的设置。

**Python**：按边缘滤光片窗口的方式搜索非偏振边缘滤光片的周期：五层周期 (aA bB cA bB aA) 或 (aB bA cB bA aB)，其 s 与 p 截止带边缘在该入射角下落在边缘波长处，a、b、c 为边缘波长处的四分之一波倍数；最好的在前：截止带最宽者优先，其次是通带最宽者。在 0° 时搜索给出正反两种排列的四分之一波周期，c 为 None。A 与 B 按其在边缘波长处的实折射率视为无损耗。不给关键字参数时，使用窗口在此设计上打开时的设置。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `pass` | `pass_` | `'short'` | `'short'` 为短波通，`'long'` 为长波通。 |
| `edge` | `edge` |  | 边缘波长，单位 nm。不给出时为设计的参考波长。 |
| `angle` | `angle` | `0` | 入射角，单位为度，在入射介质中计，从 0 起，小于 90。 |
| `a` | `a` |  | 材料 A，按 id 给出。不给出时为正面膜层中折射率最低的材料；正面材料不足两种时为 SiO2。 |
| `b` | `b` |  | 材料 B，按 id 给出。不给出时为正面膜层中折射率最高的材料，或 TiO2。 |
| `incident` | `incident` |  | 光射来的介质，按 id 给出。不给出时为设计的入射介质。 |
| `lower` | `lower` | `0.1` | 搜索的第一个 a，单位为四分之一波，从 0 起。 |
| `upper` | `upper` | `1` | 搜索的最后一个 a，单位为四分之一波，大于 lower 且不超过 2。 |
| `step` | `step` | `0.05` | a 的步长，不小于 0.0001；在大于 0 的入射角下，以最细步长搜索最宽范围需要几分钟。 |
| `periods` | `periods` | `10` | 每个解的公式重复的周期数。 |

**返回**：**JavaScript**：一个对象：`pass`、`edge`（nm）、`angle`；`materials` 和 `indices`，各为 `{ a, b, incident }`，即所搜索材料的 id 及其在边缘处的实折射率；`absorbing`，A 与 B 中在该处 k 大于 0 的材料 id；`periods`；以及 `solutions`，最好的在前，每个为 `{ outer, a, b, c, sigma, zoneS, zoneP, passWidth, formula }`：outer 为 `'A'` 或 `'B'`，即外层和中心层的材料；a、b、c 以四分之一波计；sigma 为边缘处的 N11，+1 或 -1；zoneS 与 zoneP 为 s 与 p 截止带的宽度，passWidth 为通带宽度，单位 nm，通带不结束时为 Infinity；formula 为按堆栈公式写出的滤光片，H 为 A 与 B 中折射率较高者。<br>**Python**：一个 EdgeFilter，即具名元组：pass_、edge（nm）、angle；materials 和 indices，各为含 a、b、incident 的 dict，即所搜索材料的 id 及其在边缘处的实折射率；absorbing，A 与 B 中在该处 k 大于 0 的材料 id；periods；以及 solutions，最好的在前，每个为一个 EdgeSolution：outer 为 "A" 或 "B"，即外层和中心层的材料；a、b、c 以四分之一波计；sigma 为边缘处的 N11，+1 或 -1；zone_s 与 zone_p 为 s 与 p 截止带的宽度，pass_width 为通带宽度，单位 nm，通带不结束时为 inf；formula 为按堆栈公式写出的滤光片，H 为 A 与 B 中折射率较高者。

**拒绝**：

- 不接受的选项或选项不能取的值、找不到对应材料的材料 id、在边缘波长处没有折射率的材料、A 与 B 在该处折射率相同，或材料超过其临界角

```js
const design = tf.newDesign('Edge');
const found = design.edgeFilter({ edge: 1000, angle: 45, a: 'SiO2', b: 'TiO2' });
console.log(found.solutions.length, 'periods; best', found.solutions[0].formula);
```

```python
design = tf.new_design("Edge")
found = design.edge_filter(edge=1000, angle=45, a="SiO2", b="TiO2")
print(len(found.solutions), "periods; best", found.solutions[0].formula)
```

### applyEdgeFilter / apply_edge_filter

| JavaScript | Python |
| ---------- | ------ |
| `design.applyEdgeFilter({ solution, side, mode })` | `design.apply_edge_filter(solution=0, side=..., mode="replace")` |

**JavaScript**：按边缘滤光片窗口“替换”或“追加”放入所列周期的方式放入边缘滤光片：搜索与 edgeFilter() 使用相同选项时相同，所选的解通过堆栈公式构建，每对相接的外层合并为一层。“替换”用滤光片取代该面的膜层，把边缘波长设为参考波长，并把所搜索的介质设为正面滤光片的入射介质或背面滤光片的出射介质；“追加”把膜层加在该面原有膜层的外侧。向单面设计未镀膜的一面放入膜层时，若另一面有膜层，设计变为两面镀膜；若另一面没有膜层，则只在放入的一面镀膜，与窗口相同。

**Python**：按边缘滤光片窗口“替换”或“追加”放入所列周期的方式放入边缘滤光片：搜索与 edge_filter() 使用相同关键字参数时相同，所选的解通过堆栈公式构建，每对相接的外层合并为一层。“替换”用滤光片取代该面的膜层，把边缘波长设为参考波长，并把所搜索的介质设为正面滤光片的入射介质或背面滤光片的出射介质；“追加”把膜层加在该面原有膜层的外侧。向单面设计未镀膜的一面放入膜层时，若另一面有膜层，设计变为两面镀膜；若另一面没有膜层，则只在放入的一面镀膜，与窗口相同。它也接受 edge_filter() 的关键字参数，用于搜索。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `options` |  |  | **JavaScript**：edgeFilter() 的选项，以及以下各项。 |
| `solution` | `solution` | `0` | 选用哪个解，即它在 `edgeFilter()` / `edge_filter()` 列表中的位置，从 0 起，0 为最好的。 |
| `side` | `side` |  | `'front'` 或 `'back'`。不给出时为正面，只在背面镀膜的设计则为背面。对称设计取正面。 |
| `mode` | `mode` | `'replace'` | `'replace'` 或 `'append'`。 |

**拒绝**：

- **JavaScript**：edgeFilter() 抛出的错误、不在列表中的解、`'front'` 或 `'back'` 以外的面、对称设计的背面，或 `'replace'` 或 `'append'` 以外的模式<br>**Python**：edge_filter() 引发的错误、不在列表中的解、"front" 或 "back" 以外的面、对称设计的背面，或 "replace" 或 "append" 以外的模式

```js
const design = tf.newDesign('Short-wave pass');
design.applyEdgeFilter({ edge: 700, a: 'SiO2', b: 'TiO2', periods: 8 });
console.log(design.layers.length, 'layers; reference', design.reference, 'nm');
```

```python
design = tf.new_design("Short-wave pass")
design.apply_edge_filter(edge=700, a="SiO2", b="TiO2", periods=8)
print(len(design.layers), "layers; reference", design.reference, "nm")
```

### needleProfile / needle_profile

| JavaScript | Python |
| ---------- | ------ |
| `design.needleProfile({ pool, side, step, intraSamples })` | `design.needle_profile(pool, side=..., step=0.5, intra_samples=16)` |

各材料的薄层放在哪里会降低评价函数值，与针法手动窗口的“计算 P 函数”所求的相同：把材料池中每种材料的针层放在某一面各膜层的每个界面上以及每层内部的各点上，求光学评价函数值对针层厚度的斜率。梯度为负处，放入针层会降低评价函数值。扫描计入启用的评价函数行，但不含 MNT、MXT 和 PPEF 行，与窗口相同。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `pool` | `pool` |  | **JavaScript**：针层可用的材料，按 id 给出：一种或多种，不得重复。<br>**Python**：针层可用的材料，为 id 列表：一种或多种，不得重复。 |
| `side` | `side` |  | `'front'` 或 `'back'`。不给出时为正面，只在背面镀膜的设计则为背面。窗口不扫描的一面会被拒绝：对称设计的背面，或单面镀膜设计未镀膜的一面。 |
| `step` | `step` | `0.5` | 探测针层的厚度，单位 nm，不小于 0.05；没有精确公式的斜率按这一厚度做差分：即窗口的“探测 δ”。 |
| `intraSamples` | `intra_samples` | `16` | 每层内部的取点数，为 2 到 60 的整数：即窗口的“每层剖面点数”。 |

**返回**：**JavaScript**：一个对象：`mode`，所扫描的面；`mf0`，扫描所计的设计当前光学评价函数值，没有候选时为 null；以及 `candidates`，按扫描顺序排列，窗口会判定设计已达到针法最优时为空，每个为 `{ material, kind, layer, position, fraction, depth, gradient }`：kind 为 `'gap'` 或 `'inside'`；layer 对 `'inside'` 为被分开的膜层编号，紧邻基底的为 1，否则为 null；position 对 `'gap'` 为该间隙与基底之间的膜层数，否则为 null；fraction 对 `'inside'` 为膜层被分开的位置，从光先到达的一侧算起（正面为入射介质一侧，背面为基底一侧），否则为 null；depth 为从同一侧算起的深度，单位 nm；gradient 为光学评价函数值对针层厚度的斜率，单位为每 nm。针层成为第 `position + 1` 或第 `layer + 1` 层。<br>**Python**：一个 NeedleProfile，即具名元组：mode，所扫描的面；mf0，扫描所计的设计当前光学评价函数值，没有候选时为 None；以及 candidates，按扫描顺序排列，窗口会判定设计已达到针法最优时为空，每个为一个 NeedleCandidate：material；kind 为 "gap" 或 "inside"；layer 对 "inside" 为被分开的膜层编号，紧邻基底的为 1，否则为 None；position 对 "gap" 为该间隙与基底之间的膜层数，否则为 None；fraction 对 "inside" 为膜层被分开的位置，从光先到达的一侧算起（正面为入射介质一侧，背面为基底一侧），否则为 None；depth 为从同一侧算起的深度，单位 nm；gradient 为光学评价函数值对针层厚度的斜率，单位为每 nm。针层成为第 position + 1 或第 layer + 1 层。

**拒绝**：

- **JavaScript**：不接受的选项或选项不能取的值、窗口不扫描的一面、没有扫描所计评价函数行的设计，或材料池中找不到对应材料的材料 id<br>**Python**：参数不能取的值、窗口不扫描的一面、没有扫描所计评价函数行的设计，或材料池中找不到对应材料的材料 id

```js
const design = tf.newDesign('AR');
design.stack('H L');
design.merit.add('RAV', 450, 650, { target: 0 });
const profile = design.needleProfile({ pool: ['TiO2', 'SiO2', 'MgF2'] });
const best = profile.candidates.reduce((a, b) => (b.gradient < a.gradient ? b : a));
console.log(profile.candidates.length, 'candidates; steepest', best.material, best.kind, best.gradient);
```

```python
design = tf.new_design("AR")
design.stack("H L")
design.merit.add("RAV", 450, 650, target=0)
profile = design.needle_profile(["TiO2", "SiO2", "MgF2"])
best = min(profile.candidates, key=lambda c: c.gradient)
print(len(profile.candidates), "candidates; steepest", best.material, best.kind, best.gradient)
```

### insertNeedle / insert_needle

| JavaScript | Python |
| ---------- | ------ |
| `design.insertNeedle(candidate, { thickness, side })` | `design.insert_needle(candidate, thickness=..., side=...)` |

放入一个针层，与针法手动窗口的“应用插入”放入从剖面中选中的候选相同：在候选的间隙处放入一层候选材料，或在候选的位置把其膜层分成两层。对称设计的背面跟随其正面。不给出 `thickness` 时，针层从窗口的起始厚度开始：在 1 到 60 nm 之间用黄金分割搜索求得的光学评价函数值最低的厚度，该范围内没有更好的厚度时为 1 nm。

**JavaScript**：要做到“应用插入”在勾选“插入后精炼”时所做的，先添加一个 1 nm 的 MNT 行（窗口的最小厚度），再用 sqp 精炼：`design.merit.add('MNT', { target: 1 })`，然后 `await design.refine({ method: 'sqp', maxIter: 80 })`。各层随后停在窗口精炼给出的厚度上。

**Python**：要做到“应用插入”在勾选“插入后精炼”时所做的，先添加一个 1 nm 的 MNT 行（窗口的最小厚度），再用 sqp 精炼：design.merit.add("MNT", target=1)，然后 design.refine(method="sqp", max_iter=80)。各层随后停在窗口精炼给出的厚度上。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `candidate` | `candidate` |  | **JavaScript**：needleProfile() 在此设计和此面上给出的一个候选。<br>**Python**：needle_profile() 在此设计和此面上给出的一个 NeedleCandidate，或含其各字段的 dict。 |
| `thickness` | `thickness` |  | 针层的厚度，单位 nm：在间隙处为 1 到 200，在膜层内部为 1 到被分开膜层的厚度减 1（至少为 2）：即窗口滑块的范围。不给出时为窗口的起始厚度。 |
| `side` | `side` |  | 与 `needleProfile()` / `needle_profile()` 相同的面。 |

**拒绝**：

- **JavaScript**：不接受的选项、needleProfile() 拒绝的面、超出窗口在该处范围的厚度、此设计和此面没有的候选，或在不给出厚度时，没有扫描所计评价函数行的设计<br>**Python**：needle_profile() 拒绝的面、超出窗口在该处范围的厚度、此设计和此面没有的候选，或在不给出厚度时，没有扫描所计评价函数行的设计

```js
const design = tf.newDesign('AR');
design.stack('H L');
design.merit.add('RAV', 450, 650, { target: 0 });
const { candidates } = design.needleProfile({ pool: ['TiO2', 'SiO2', 'MgF2'] });
design.insertNeedle(candidates.reduce((a, b) => (b.gradient < a.gradient ? b : a)));
console.log(design.layers.length, 'layers; optical merit', design.merit.opticalValue);
```

```python
design = tf.new_design("AR")
design.stack("H L")
design.merit.add("RAV", 450, 650, target=0)
profile = design.needle_profile(["TiO2", "SiO2", "MgF2"])
design.insert_needle(min(profile.candidates, key=lambda c: c.gradient))
print(len(design.layers), "layers; optical merit", design.merit.optical_value)
```

### spectrum

| JavaScript | Python |
| ---------- | ------ |
| `design.spectrum(start, end, { step, angles })` | `design.spectrum(start, end, step=1, angles=[0])` |

一段波长范围内的 R、T 和 A，包括非偏振光以及 s 和 p 偏振，计算方式与光学评估窗口相同。计算对象由设计的 `sides` 和 `scoreOn` / `score_on` 决定，光谱的 `mode` 说明是哪一个。设有入射锥角的设计会在其锥角内取平均。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `start` | `start` |  | 起始波长，单位 nm。 |
| `end` | `end` |  | 结束波长，单位 nm，大于 `start`。 |
| `step` | `step` | `1` | 波长步长，单位 nm。 |
| `angles` | `angles` | `[0]` | 入射角，为入射介质中的度数，每个都在 0 到 90 之间，不含 90。 |

**返回**：一个 Spectrum。

**拒绝**：

- 不构成范围的范围、0 到 90 以外的角度、用到找不到对应材料的设计，或超过一百万个点（波长数乘以角度数）：请加大波长步长或减少角度

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
const s = design.spectrum(400, 800, { step: 1, angles: [0, 45] });
console.log(s.mode, Math.max(...s.R), Math.min(...s.angle(45).Tp));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
s = design.spectrum(400, 800, step=1, angles=[0, 45])
print(s.mode, max(s.R), min(s.angle(45).Tp))
```

### edgeShift / edge_shift

| JavaScript | Python |
| ---------- | ------ |
| `design.edgeShift(start, end, angles, { quantity, level, edgeSide, direction, step })` | `design.edge_shift(start, end, angles, quantity="T", level=0.5, edge_side=..., direction="max", step=1)` |

在多个入射角下，设计的光谱在波段的峰旁穿越某一电平的位置，以及该边缘相对第一个入射角下的位置移动了多少；每个都按规格窗口的 EDGE_LAMBDA 检查的方法求出，与光谱曲线的 edge() 相同。计算对象随设计的 `sides` 和 `scoreOn` / `score_on` 而定，与光谱相同；带有入射锥角的设计会在锥角上取平均。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `start` | `start` |  | 波段的起始波长，单位 nm。 |
| `end` | `end` |  | 波段的结束波长，单位 nm，大于 `start`。 |
| `angles` | `angles` |  | 入射角，为入射介质中的度数，每个都在 0 到 90 之间，不含 90。 |
| `quantity` | `quantity` | `'T'` | `'R'`、`'T'` 或 `'A'`（非偏振光），或 `'Rs'`、`'Rp'`、`'Ts'`、`'Tp'`、`'As'` 或 `'Ap'`。 |
| `level` | `level` | `0.5` | 穿越的电平，0 到 1 之间的比例；小于 0.001 或大于 0.999 时按 0.001 或 0.999 计。 |
| `edgeSide` | `edge_side` |  | **JavaScript**：`'right'` 表示峰以上的交点；否则取峰以下的交点，峰以下没有交点时取峰以上的交点。<br>**Python**："right" 表示峰以上的交点。不给出时，取峰以下的交点，峰以下没有交点时取峰以上的交点。 |
| `direction` | `direction` | `'max'` | `'max'`，电平为波段内最大值的该比例；或 `'min'`，电平为从波段内最小值到 1 之间该比例处的值。 |
| `step` | `step` | `1` | 搜索峰所用的步长，单位 nm：1、0.1、0.01 或 0.001。交点在不粗于该步长、且至少 301 个采样点的波段扫描上确定。 |

**返回**：**JavaScript**：一个对象：`angles`，以及每个入射角在下列各项中的一个值：`edge`，交点，单位 nm；`shift`，该边缘减去第一个入射角下的边缘，单位 nm；光谱在波段内不穿越该电平时两者都为 null；`reason`，此时为 `'edgeNotCrossed'`，否则为 null；`peak`、`peakValue` 和 `levelValue`；还有 `level`，所用的电平，以及 `mode`、`quantity`、`direction` 和 `step`。<br>**Python**：一个 EdgeShift，即命名元组：angles，以及每个入射角在下列各项中的一个值：edge，交点，单位 nm；shift，该边缘减去第一个入射角下的边缘，单位 nm；光谱在波段内不穿越该电平时两者都为 None；reason，此时为 "edgeNotCrossed"，否则为 None；peak、peak_value 和 level_value；还有 level，所用的电平，以及 mode、quantity、direction 和 step。

**拒绝**：

- 不构成范围的波段、空的入射角列表或超出 0 到 90 的入射角、不接受的选项或选项不能取的值，或引用了找不到对应材料的设计

```js
const design = tf.newDesign('Long-wave pass');
design.stack('(0.5H L 0.5H)^8');
const moved = design.edgeShift(600, 760, [0, 15, 30, 45], { level: 0.5 });
moved.angles.forEach((angle, i) => console.log(angle, 'degrees:', moved.edge[i].toFixed(2), 'nm, moved', moved.shift[i].toFixed(2), 'nm'));
```

```python
design = tf.new_design("Long-wave pass")
design.stack("(0.5H L 0.5H)^8")
moved = design.edge_shift(600, 760, [0, 15, 30, 45], level=0.5)
for angle, edge, shift in zip(moved.angles, moved.edge, moved.shift):
    print(angle, "degrees:", round(edge, 2), "nm, moved", round(shift, 2), "nm")
```

### compareMeasured / compare_measured

| JavaScript | Python |
| ---------- | ------ |
| `design.compareMeasured(measured, { curve, angle, pol, quantity, scale, xUnit, grid, step, thinEvery, start, end, db, levelFree })` | `design.compare_measured(measured, curve=..., angle=..., pol=..., quantity=..., scale=..., x_unit=..., grid="measured", step=..., thin_every=2, start=..., end=..., db=False, level_free=False)` |

**JavaScript**：设计与一条实测曲线相差多少，按“拟合…”对话框所写的 MCURVE 评价函数行的方式评分：R、T 和 A 按实测光谱窗口的对话框，Ψ 和 Δ 按实测椭偏窗口的对话框。曲线在对话框的网格上取样，并限制在设计的每种材料都有数据的范围内，设计在每个点按曲线的入射角和偏振读取。R、T 和 A 的计算对象取决于设计的 `sides` 和 `scoreOn`，与评价函数的评分方式相同，有入射锥角的设计在其锥角上平均；Ψ 和 Δ 只在正面计算，每个 Δ 差值沿圆周取较短的一侧。

**Python**：设计与一条实测曲线相差多少，按“拟合…”对话框所写的 MCURVE 评价函数行的方式评分：R、T 和 A 按实测光谱窗口的对话框，Psi 和 Delta 按实测椭偏窗口的对话框。曲线在对话框的网格上取样，并限制在设计的每种材料都有数据的范围内，设计在每个点按曲线的入射角和偏振读取。R、T 和 A 的计算对象取决于设计的 sides 和 score_on，与评价函数的评分方式相同，有入射锥角的设计在其锥角上平均；Psi 和 Delta 只在正面计算，每个 Delta 差值沿圆周取较短的一侧。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `measured` | `measured` |  | **JavaScript**：光谱文件的路径，按 `tf.readSpectrumFile()` 的方式读取；或它或 `tf.readEllipsometryFile()` 给出的那种曲线 `{ wavelength, values, quantity, angle, pol, name }`，数值为 1 的分数，未给出时 quantity 为 `'T'`，angle 为 0，pol 为 `'avg'`；Ψ 或 Δ 曲线还接受 `side` 和 `deltaConvention`，数值单位为度。<br>**Python**：光谱文件的路径，按 tf.read_spectrum_file() 的方式读取；或它给出的 MeasuredCurve、tf.read_ellipsometry_file() 给出的 EllipsometryCurve；或由 wavelength、values、quantity、angle、pol 和 name 组成的 dict，数值为 1 的分数，未给出时 quantity 为 "T"，angle 为 0，pol 为 "avg"；Psi 或 Delta 曲线还接受 side 和 delta_convention，数值单位为度。 |
| `curve` | `curve` |  | 对含多条曲线的文件，要比较的那条，按其名称或从 0 起的编号。 |
| `angle` | `angle` |  | 对文件，与 `tf.readSpectrumFile()` / `tf.read_spectrum_file()` 的取法相同。 |
| `pol` | `pol` |  | 对文件，与 `tf.readSpectrumFile()` / `tf.read_spectrum_file()` 的取法相同。 |
| `quantity` | `quantity` |  | 对文件，与 `tf.readSpectrumFile()` / `tf.read_spectrum_file()` 的取法相同。 |
| `scale` | `scale` |  | 对文件，与 `tf.readSpectrumFile()` / `tf.read_spectrum_file()` 的取法相同。 |
| `xUnit` | `x_unit` |  | 对文件，与 `tf.readSpectrumFile()` / `tf.read_spectrum_file()` 的取法相同。 |
| `grid` | `grid` | `'measured'` | `'measured'`，曲线自身的点；`'thinned'`，每 `thinEvery-th` / `thin_every-th` 个点取一个，外加最后一个；或 `'uniform'`，每隔 `step` nm 取一点，点与点之间按对话框的方式读取曲线。 |
| `step` | `step` |  | **JavaScript**：网格为 `'uniform'` 时的步长，单位 nm；不给出时为曲线点距的中位数。<br>**Python**：网格为 "uniform" 时的步长，单位 nm。不给出时为曲线点距的中位数。 |
| `thinEvery` | `thin_every` | `2` | 网格为 `'thinned'` 时保留哪些点。 |
| `start` | `start` |  | **JavaScript**：比较的第一个波长，单位 nm；不给出时为曲线的第一个波长。<br>**Python**：比较的第一个波长，单位 nm。不给出时为曲线的第一个波长。 |
| `end` | `end` |  | **JavaScript**：比较的最后一个波长，单位 nm；不给出时为曲线的最后一个波长。<br>**Python**：比较的最后一个波长，单位 nm。不给出时为曲线的最后一个波长。 |
| `db` | `db` | `false` / `False` | 对 T 曲线，`true` / `True` 以 dB 比较，与对话框的 dB 标度相同。 |
| `levelFree` | `level_free` | `false` / `False` | 对 R、T 和 A，`true` / `True` 在求 RMS 之前减去平均差值，与电平自由的 MCURVE 行的评分方式相同。 |

**返回**：**JavaScript**：一个对象：`rms`，MCURVE 行的值，为 1 的分数，使用 `db` 时为 dB，Ψ 和 Δ 为度；`ppef`，针对它的 PPEF 行的值，单位 dB，Ψ 和 Δ 为 null；`level`，使用 `levelFree` 时减去的平均差值，否则为 null；`wavelength`，比较的波长，单位 nm，以及每个波长处的 `measured`、`design` 和 `deviation`，即设计值减实测值（再减 `level`）；`clipped`，比较的波长少于所要求的时为 true；以及 `mode`、`name`、`quantity`、`angle`、`pol`、`grid`、`db` 和 `levelFree`。<br>**Python**：一个 MeasuredDifference，即命名元组：rms，MCURVE 行的值，为 1 的分数，使用 db 时为 dB，Psi 和 Delta 为度；ppef，针对它的 PPEF 行的值，单位 dB，Psi 和 Delta 为 None；level，使用 level_free 时减去的平均差值，否则为 None；wavelength，比较的波长，单位 nm，以及每个波长处的 measured、design 和 deviation，即设计值减实测值（再减 level）；clipped，比较的波长少于所要求的时为 True；以及 mode、name、quantity、angle、pol、grid、db 和 level_free。

**拒绝**：

- **JavaScript**：既不是文件路径也不是曲线的 measured、无法读取或不含光谱的文件、含多条曲线却未给出 `curve` 的文件、不接受的选项或选项无法取的值、没有可比较的点、法向入射或背面测得的 Ψ 或 Δ 曲线或在只以背面评价的设计上的此类曲线，或设计中有无法解析的材料<br>**Python**：既不是文件路径也不是曲线的 measured、无法读取或不含光谱的文件、含多条曲线却未给出 curve 的文件、不接受的选项或选项无法取的值、没有可比较的点、法向入射或背面测得的 Psi 或 Delta 曲线或在只以背面评价的设计上的此类曲线，或设计中有无法解析的材料

```js
const design = tf.newDesign('AR');
design.stack('0.5H L');
const scan = { quantity: 'R', wavelength: [450, 550, 650], values: [0.021, 0.009, 0.018] };
const d = design.compareMeasured(scan);
console.log('RMS', d.rms.toFixed(4), 'PPEF', d.ppef.toFixed(2), 'dB');
```

```python
design = tf.new_design("AR")
design.stack("0.5H L")
scan = {"quantity": "R", "wavelength": [450, 550, 650], "values": [0.021, 0.009, 0.018]}
d = design.compare_measured(scan)
print("RMS", round(d.rms, 4), "PPEF", round(d.ppef, 2), "dB")
```

### addMeasuredCurves / add_measured_curves

| JavaScript | Python |
| ---------- | ------ |
| `design.addMeasuredCurves(curves)` | `design.add_measured_curves(curves)` |

**JavaScript**：按实测光谱和实测椭偏窗口的导入方式把实测曲线加入设计，每条都有自己的 id：R、T 和 A 加入设计的光谱，Ψ 和 Δ 加入其椭偏数据，排在已有曲线之后。设计会保存它们，窗口会显示它们，`fitMeasured()` 可把其中一条变为评价函数行。曲线只含给出的内容：来源文件、文件所用的单位以及是否为百分比都不属于它。

**Python**：按实测光谱和实测椭偏窗口的导入方式把实测曲线加入设计，每条都有自己的 id：R、T 和 A 加入设计的光谱，Psi 和 Delta 加入其椭偏数据，排在已有曲线之后。设计会保存它们，窗口会显示它们，fit_measured() 可把其中一条变为评价函数行。曲线只含给出的内容：来源文件、文件所用的单位以及是否为百分比都不属于它。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `curves` | `curves` |  | **JavaScript**：一条曲线或曲线列表，即 `tf.readSpectrumFile()` 或 `tf.readEllipsometryFile()` 给出的那种 `{ wavelength, values, quantity, angle, pol, name }`：R、T 和 A 为 1 的分数，未给出时 quantity 为 `'T'`，angle 为 0，pol 为 `'avg'`；Ψ 或 Δ 曲线还接受 `side` 和 `deltaConvention`，未给出时为 `'front'` 和 `'azzam'`，数值单位为度。<br>**Python**：一条曲线或曲线列表：tf.read_spectrum_file() 给出的 MeasuredCurve、tf.read_ellipsometry_file() 给出的 EllipsometryCurve，或由 wavelength、values、quantity、angle、pol 和 name 组成的 dict，R、T 和 A 为 1 的分数，未给出时 quantity 为 "T"，angle 为 0，pol 为 "avg"；Psi 或 Delta 曲线还接受 side 和 delta_convention，未给出时为 "front" 和 "azzam"，数值单位为度。 |

**拒绝**：

- **JavaScript**：不是由这些字段组成的对象的曲线，或字段无法取的值<br>**Python**：不属于上述任一种的曲线，或字段无法取的值

```js
const design = tf.newDesign('AR');
design.addMeasuredCurves({ name: 'Bench R', quantity: 'R', wavelength: [450, 550, 650], values: [0.021, 0.009, 0.018] });
console.log(design.compareMeasured({ quantity: 'R', wavelength: [450, 550, 650], values: [0.021, 0.009, 0.018] }).rms);
```

```python
design = tf.new_design("AR")
design.add_measured_curves({"name": "Bench R", "quantity": "R",
                            "wavelength": [450, 550, 650], "values": [0.021, 0.009, 0.018]})
print(design.compare_measured({"quantity": "R", "wavelength": [450, 550, 650],
                               "values": [0.021, 0.009, 0.018]}).rms)
```

### fitMeasured / fit_measured

| JavaScript | Python |
| ---------- | ------ |
| `design.fitMeasured(curve, { grid, step, thinEvery, start, end, db, weight, output, constraints })` | `design.fit_measured(curve, grid="measured", step=..., thin_every=2, start=..., end=..., db=False, weight=1, output="append", constraints=...)` |

**JavaScript**：为设计所含的一条实测曲线加入“拟合…”对话框所加的评价函数行：R、T 和 A 按实测光谱窗口的对话框，Ψ 和 Δ 按实测椭偏窗口的对话框。MCURVE 块保存在对话框网格上取样的曲线，并限制在设计的每种材料都有数据的范围内；Ψ 或 Δ 块只在正面评分。给出 `constraints` 时，其后跟随一行 MNT 和一行 MXT，与对话框的厚度约束所加的相同。用相同选项调用 `compareMeasured()` 可得到该块的值。

**Python**：为设计所含的一条实测曲线加入“拟合…”对话框所加的评价函数行：R、T 和 A 按实测光谱窗口的对话框，Psi 和 Delta 按实测椭偏窗口的对话框。MCURVE 块保存在对话框网格上取样的曲线，并限制在设计的每种材料都有数据的范围内；Psi 或 Delta 块只在正面评分。给出 constraints 时，其后跟随一行 MNT 和一行 MXT，与对话框的厚度约束所加的相同。用相同关键字参数调用 compare_measured() 可得到该块的值。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `curve` | `curve` |  | 设计所含的一条曲线的名称。 |
| `grid` | `grid` | `'measured'` | `'measured'`，曲线自身的点；`'thinned'`，每 `thinEvery-th` / `thin_every-th` 个点取一个，外加最后一个；或 `'uniform'`，每隔 `step` nm 取一点，点与点之间按对话框的方式读取曲线。 |
| `step` | `step` |  | **JavaScript**：网格为 `'uniform'` 时的步长，单位 nm；不给出时为曲线点距的中位数。<br>**Python**：网格为 "uniform" 时的步长，单位 nm。不给出时为曲线点距的中位数。 |
| `thinEvery` | `thin_every` | `2` | 网格为 `'thinned'` 时保留哪些点。 |
| `start` | `start` |  | **JavaScript**：保留的第一个波长，单位 nm；不给出时为曲线的第一个波长。<br>**Python**：保留的第一个波长，单位 nm。不给出时为曲线的第一个波长。 |
| `end` | `end` |  | **JavaScript**：保留的最后一个波长，单位 nm；不给出时为曲线的最后一个波长。<br>**Python**：保留的最后一个波长，单位 nm。不给出时为曲线的最后一个波长。 |
| `db` | `db` | `false` / `False` | 对 T 曲线，`true` / `True` 以 dB 拟合，与对话框的 dB 标度相同。 |
| `weight` | `weight` | `1` | 该块的权重，0 或以上。 |
| `output` | `output` | `'append'` | `'append'` 把这些行加在设计已有的评价函数行之后；`'replace'` 用它们取代全部已有的行。 |
| `constraints` | `constraints` |  | **JavaScript**：`{ min: 10, max: 1000, weight: 1 }`，厚度单位 nm，用于加入对话框作用于所有膜层的 MNT 和 MXT 行。<br>**Python**：由 min、max 和 weight 组成的 dict，厚度单位 nm，未给出时为 10、1000 和 1，用于加入对话框作用于所有膜层的 MNT 和 MXT 行。不给出时不加入。 |

**拒绝**：

- **JavaScript**：设计不含的曲线或有两条同名曲线、不接受的选项或选项无法取的值、没有可保留的点、法向入射或背面测得的 Ψ 或 Δ 曲线或在只以背面评价的设计上的此类曲线，或设计中有无法解析的材料<br>**Python**：设计不含的曲线或有两条同名曲线、不接受的选项或选项无法取的值、没有可保留的点、法向入射或背面测得的 Psi 或 Delta 曲线或在只以背面评价的设计上的此类曲线，或设计中有无法解析的材料

```js
const design = tf.newDesign('AR');
design.stack('0.5H L');
design.addMeasuredCurves({ name: 'Bench R', quantity: 'R', wavelength: [450, 500, 550, 600, 650], values: [0.021, 0.012, 0.009, 0.011, 0.018] });
design.fitMeasured('Bench R', { start: 470, end: 640 });
console.log(design.merit.value);
```

```python
design = tf.new_design("AR")
design.stack("0.5H L")
design.add_measured_curves({"name": "Bench R", "quantity": "R", "wavelength": [450, 500, 550, 600, 650],
                            "values": [0.021, 0.012, 0.009, 0.011, 0.018]})
design.fit_measured("Bench R", start=470, end=640)
print(design.merit.value)
```

### indexProfile / index_profile

| JavaScript | Python |
| ---------- | ------ |
| `design.indexProfile({ wavelength, side })` | `design.index_profile(wavelength=..., side=...)` |

各膜层在某一波长处的折射率，按深度排列，与折射率分布窗口的显示相同。所用的面与光谱一样由设计的 `sides` 和 `scoreOn` / `score_on` 决定，除非给出 `side`：对于一面，膜层按光从该面介质射来时遇到它们的顺序排列；对于整个元件，依次为正面、基底和背面，与窗口的“整体”视图相同。没有厚度的膜层被略去，与窗口的做法相同。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `wavelength` | `wavelength` |  | 读取 n 和 k 所用的波长，单位 nm。不给出时，使用设计的参考波长。 |
| `side` | `side` |  | `'front'`、`'back'` 或 `'total'`（整个元件）。不给出时，使用设计的评价对象。 |

**返回**：一个 IndexProfile。

**拒绝**：

- **JavaScript**：它不接受的选项、小于等于 0 的波长、不是 `'front'`、`'back'` 或 `'total'` 的面、没有厚度大于 0 nm 的膜层的面，或用到找不到对应材料的设计<br>**Python**：小于等于 0 的波长、不是 "front"、"back" 或 "total" 的面、没有厚度大于 0 nm 的膜层的面，或用到找不到对应材料的设计

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
const profile = design.indexProfile({ wavelength: 633 });
for (const l of profile.layers) console.log(l.number, l.material, l.n.toFixed(4), l.start.toFixed(1), 'to', l.end.toFixed(1), 'nm');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
profile = design.index_profile(wavelength=633)
for l in profile.layers:
    print(l.number, l.material, round(l.n, 4), round(l.start, 1), "to", round(l.end, 1), "nm")
```

### layerThicknesses / layer_thicknesses

| JavaScript | Python |
| ---------- | ------ |
| `design.layerThicknesses({ wavelength, side })` | `design.layer_thicknesses(wavelength=..., side=...)` |

每层的物理厚度和光学厚度，与膜层厚度窗口列出的相同，光学厚度取自某一波长。所用的面与光谱一样由设计的 `sides` 和 `scoreOn` / `score_on` 决定，除非给出 `side`；对于整个元件，先列正面的膜层，再列背面的。每层都有一行，没有厚度的膜层也是如此。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `wavelength` | `wavelength` |  | 计算光学厚度所用的波长 λ0，单位 nm。不给出时，使用设计的参考波长。 |
| `side` | `side` |  | `'front'`、`'back'` 或 `'total'`（两面）。不给出时，使用设计的评价对象。 |

**返回**：一个 LayerThicknesses。

**拒绝**：

- **JavaScript**：它不接受的选项、小于等于 0 的波长、不是 `'front'`、`'back'` 或 `'total'` 的面、没有膜层的面，或用到找不到对应材料的设计<br>**Python**：小于等于 0 的波长、不是 "front"、"back" 或 "total" 的面、没有膜层的面，或用到找不到对应材料的设计

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
for (const row of design.layerThicknesses({ wavelength: 600 }).rows) console.log(row.number, row.material, row.thickness.toFixed(2), 'nm, QWOT', row.qwot.toFixed(4));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
for row in design.layer_thicknesses(wavelength=600).rows:
    print(row.number, row.material, round(row.thickness, 2), "nm, QWOT", round(row.qwot, 4))
```

### totalThickness / total_thickness

| JavaScript | Python |
| ---------- | ------ |
| `design.totalThickness({ side })` | `design.total_thickness(side=...)` |

各膜层的物理厚度，单位 nm。不给出 `side` 时，计入 TT 评价函数行所求和的面，与该行的读数相同：正面镀膜或对称的设计计入正面，背面镀膜的设计计入背面，两面镀膜的设计计入两面。因此对称设计的正面只计一次。`'total'` 计入设计所含的正面和背面，对称设计的背面按其正面的镜像计入。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `side` | `side` |  | `'front'`、`'back'` 或 `'total'`（两面）。不给出时，使用镀膜面。 |

**返回**：厚度，单位 nm。

**拒绝**：

- **JavaScript**：它不接受的选项，或不是 `'front'`、`'back'` 或 `'total'` 的面<br>**Python**：不是 "front"、"back" 或 "total" 的面

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
design.sides = 'symmetric';
console.log(design.totalThickness(), 'nm coated,', design.totalThickness({ side: 'total' }), 'nm on both sides');
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
design.sides = "symmetric"
print(design.total_thickness(), "nm coated,", design.total_thickness(side="total"), "nm on both sides")
```

### opticalThickness / optical_thickness

| JavaScript | Python |
| ---------- | ------ |
| `design.opticalThickness({ side })` | `design.optical_thickness(side=...)` |

各膜层的光学厚度，即设计参考波长处 n 与厚度之积的总和，单位 nm，计入的膜层与相同 `side` 下 `totalThickness()` / `total_thickness()` 计入的相同。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `side` | `side` |  | `'front'`、`'back'` 或 `'total'`（两面）。不给出时，使用镀膜面。 |

**返回**：光学厚度，单位 nm；所计入的膜层中有找不到其材料的膜层时为 `null` / `None`。

**拒绝**：

- **JavaScript**：它不接受的选项，或不是 `'front'`、`'back'` 或 `'total'` 的面<br>**Python**：不是 "front"、"back" 或 "total" 的面

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
console.log(design.opticalThickness(), 'nm, seven quarter waves of', design.reference / 4, 'nm');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
print(design.optical_thickness(), "nm, seven quarter waves of", design.reference / 4, "nm")
```

### layerCounts / layer_counts

| JavaScript | Python |
| ---------- | ------ |
| `design.layerCounts({ side })` | `design.layer_counts(side=...)` |

每种材料各有多少层，计入的膜层与相同 `side` 下 `totalThickness()` / `total_thickness()` 计入的相同。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `side` | `side` |  | `'front'`、`'back'` 或 `'total'`（两面）。不给出时，使用镀膜面。 |

**返回**：**JavaScript**：一个按材料 id 给出层数的对象。<br>**Python**：一个按材料 id 给出层数的 dict。

**拒绝**：

- **JavaScript**：它不接受的选项，或不是 `'front'`、`'back'` 或 `'total'` 的面<br>**Python**：不是 "front"、"back" 或 "total" 的面

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H', { H: 'Ta2O5', L: 'SiO2' });
console.log(design.layerCounts());
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H", H="Ta2O5", L="SiO2")
print(design.layer_counts())
```

### admittance

| JavaScript | Python |
| ---------- | ------ |
| `design.admittance(wavelength, { angle, side, plane })` | `design.admittance(wavelength=..., angle=0, side=..., plane="admittance")` |

**JavaScript**：一个镀膜面在某一波长处的 s 和 p 导纳轨迹，与导纳图窗口绘出并在其表格中列出的相同：从基底的导纳出发，经过每层外表面处的导纳，到镀膜的外表面。除非给出 `side`，计算在正面进行；仅背面镀膜的设计在背面进行。与窗口一样，不使用设计的入射锥角。复数值为 `{ re, im }`，采用 Macleod 的符号，即窗口所用的符号：吸收材料的折射率为 n − ik。

**Python**：一个镀膜面在某一波长处的 s 和 p 导纳轨迹，与导纳图窗口绘出并在其表格中列出的相同：从基底的导纳出发，经过每层外表面处的导纳，到镀膜的外表面。除非给出 side，计算在正面进行；仅背面镀膜的设计在背面进行。与窗口一样，不使用设计的入射锥角。复数值为 Python 的 complex，采用 Macleod 的符号，即窗口所用的符号：吸收材料的折射率为 n − ik。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `wavelength` | `wavelength` |  | 波长，单位 nm。不给出时，使用设计的参考波长。 |
| `angle` | `angle` | `0` | 入射角，单位为度，在光射来的介质中计，从 0 起，小于 90。 |
| `side` | `side` |  | `'front'` 或 `'back'`。不给出时，仅背面镀膜的设计用背面，其他设计用正面。 |
| `plane` | `plane` | `'admittance'` | 圆弧所在的平面：`'admittance'` 为 Y 平面，`'reflection'` 为反射系数 Γ 的平面。 |

**返回**：一个 Admittance。

**拒绝**：

- **JavaScript**：它不接受的选项、小于等于 0 的波长、0 到 90 以外的角度、不是 `'front'` 或 `'back'` 的面、不是 `'admittance'` 或 `'reflection'` 的平面、没有膜层的面，或用到找不到对应材料的设计<br>**Python**：小于等于 0 的波长、0 到 90 以外的角度、不是 "front" 或 "back" 的面、不是 "admittance" 或 "reflection" 的平面、没有膜层的面，或用到找不到对应材料的设计

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
const locus = design.admittance(550, { angle: 45 });
const { Y, gamma } = locus.s.boundaries.at(-1);
console.log(locus.mode, 'Y', Y.re.toFixed(4), Y.im.toFixed(4), 'Rs', (gamma.re ** 2 + gamma.im ** 2).toFixed(6));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
locus = design.admittance(550, angle=45)
front = locus.s.boundaries[-1]
print(locus.mode, "Y", front.Y, "Rs", abs(front.gamma) ** 2)
```

### electricField / electric_field

| JavaScript | Python |
| ---------- | ------ |
| `design.electricField(wavelength, { angle, side, pointsPerLayer, depthUnit, reference })` | `design.electric_field(wavelength=..., angle=0, side=..., points_per_layer=60, depth_unit="nm", reference=...)` |

一个镀膜面在某一波长处 s、p 和非偏振光的电场，与电场窗口的计算相同，从光射来的介质到基底。除非给出 `side`，计算在正面进行；仅背面镀膜的设计在背面进行。与窗口一样，不使用设计的入射锥角。|E|² 为入射 |E|² 的比例，幅值以 V/m 计，对应 1 W/m² 的入射光。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `wavelength` | `wavelength` |  | 波长，单位 nm。不给出时，使用设计的参考波长。 |
| `angle` | `angle` | `0` | 入射角，单位为度，在光射来的介质中计，从 0 起，小于 90。 |
| `side` | `side` |  | `'front'` 或 `'back'`。不给出时，仅背面镀膜的设计用背面，其他设计用正面。 |
| `pointsPerLayer` | `points_per_layer` | `60` | 每层取的采样点数，为 2 或更大的整数。 |
| `depthUnit` | `depth_unit` | `'nm'` | `depth` 的单位：`'nm'`、`'OT'`（n 与厚度之积的累加，nm）、`'QWOT'` 或 `'FWOT'`。 |
| `reference` | `reference` |  | 光学深度单位读取 n 所用的波长 λ0，单位 nm。不给出时，使用设计的参考波长。 |

**返回**：一个 ElectricField。

**拒绝**：

- **JavaScript**：它不接受的选项、小于等于 0 的波长或参考波长、0 到 90 以外的角度、不是 `'front'` 或 `'back'` 的面、它没有的深度单位、不是 2 或更大整数的 pointsPerLayer、超过一百万个采样点、没有厚度大于 0 nm 的膜层的面，或用到找不到对应材料的设计<br>**Python**：小于等于 0 的波长或参考波长、0 到 90 以外的角度、不是 "front" 或 "back" 的面、它没有的深度单位、不是 2 或更大整数的 points_per_layer、超过一百万个采样点、没有厚度大于 0 nm 的膜层的面，或用到找不到对应材料的设计

```js
const design = tf.newDesign('Mirror', { reference: 1064 });
design.stack('(HL)^4 H');
const field = design.electricField(1064, { angle: 45 });
const peak = field.p.e2.indexOf(Math.max(...field.p.e2));
console.log('peak |E|², p:', field.p.e2[peak].toFixed(4), 'at', field.z[peak].toFixed(1), 'nm');
```

```python
design = tf.new_design("Mirror", reference=1064)
design.stack("(HL)^4 H")
field = design.electric_field(1064, angle=45)
peak = field.p.e2.index(max(field.p.e2))
print("peak |E|², p:", round(field.p.e2[peak], 4), "at", round(field.z[peak], 1), "nm")
```

### color

| JavaScript | Python |
| ---------- | ------ |
| `design.color({ quantity, angle, pol, observer, illuminant, step, side })` | `design.color(quantity="R", angle=0, pol="avg", observer=2, illuminant="D65", step=0.5, side=...)` |

设计的反射率或透射率的 CIE 颜色，与颜色评估窗口的计算相同：在一种光源下 R 或 T 在 380-780 nm 波段上的三刺激值，以及窗口显示的各颜色空间、主波长、相关色温和 sRGB 色块。计算对象由设计的 `sides` 和 `scoreOn` / `score_on` 决定，与光谱相同，除非给出 `side`；设有入射锥角的设计会像窗口一样在其锥角内取平均。没有膜层的面给出其裸表面的颜色。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `quantity` | `quantity` | `'R'` | 计算颜色的量：`'R'` 或 `'T'`。 |
| `angle` | `angle` | `0` | 入射角，单位为度，在入射介质中计，从 0 起，小于 90。 |
| `pol` | `pol` | `'avg'` | 偏振：`'avg'`（非偏振）、`'s'` 或 `'p'`。 |
| `observer` | `observer` | `2` | CIE 标准观察者，按其视场角度给出：`2`（CIE 1931）或 `10`（CIE 1964）。 |
| `illuminant` | `illuminant` | `'D65'` | CIE 光源：`'D65'`、`'D50'`、`'A'` 或 `'E'`。 |
| `step` | `step` | `0.5` | 用于积分颜色的光谱的波长步长，单位 nm。 |
| `side` | `side` |  | `'front'`、`'back'` 或 `'total'`（整个元件）。不给出时，使用设计的评价对象。 |

**返回**：一个 Color。

**拒绝**：

- **JavaScript**：它不接受的选项、它没有的量、偏振、观察者、光源或面、0 到 90 以外的角度、小于等于 0 的步长、超过一百万个波长，或用到找不到对应材料的设计<br>**Python**：它没有的量、偏振、观察者、光源或面、0 到 90 以外的角度、小于等于 0 的步长、超过一百万个波长，或用到找不到对应材料的设计

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
const c = design.color({ quantity: 'R', illuminant: 'D65' });
console.log(c.mode, 'x', c.x.toFixed(4), 'y', c.y.toFixed(4), 'Y', c.Y.toFixed(2), '%, dominant', c.dominant.wavelength?.toFixed(1), 'nm');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
c = design.color(quantity="R", illuminant="D65")
print(c.mode, "x", round(c.x, 4), "y", round(c.y, 4), "Y", round(c.Y, 2), "%, dominant",
      c.dominant.wavelength, "nm")
```

### integrals

| JavaScript | Python |
| ---------- | ------ |
| `design.integrals({ start, end, step, angle, pol, custom, side })` | `design.integrals(start=300, end=2500, step=0.5, angle=0, pol="avg", custom=..., side=...)` |

**JavaScript**：设计的 T、R 和 A 的加权平均，与积分值窗口的计算相同：每个积分为在其权重的波段上的 ∫ C(λ) w(λ) dλ / ∫ w(λ) dλ，在光谱的网格上计算。内置的行即窗口的行，从 Tvis 到 RNIR；你自己的行由 `custom` 给出。计算对象由设计的 `sides` 和 `scoreOn` 决定，与光谱相同，除非给出 `side`；设有入射锥角的设计会像窗口一样在其锥角内取平均。光谱未覆盖其波段的行没有数值：它的各个数为 NaN，`covered` 为 false。权重在整个波段上为 0 的行同样没有数值，但 `covered` 为 true。

**Python**：设计的 T、R 和 A 的加权平均，与积分值窗口的计算相同：每个积分为在其权重的波段上的 ∫ C(λ) w(λ) dλ / ∫ w(λ) dλ，在光谱的网格上计算。内置的行即窗口的行，从 Tvis 到 RNIR；你自己的行由 custom 给出。计算对象由设计的 sides 和 score_on 决定，与光谱相同，除非给出 side；设有入射锥角的设计会像窗口一样在其锥角内取平均。光谱未覆盖其波段的行没有数值：它的各个数为 nan，covered 为 False。权重在整个波段上为 0 的行同样没有数值，但 covered 为 True。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `start` | `start` | `300` | 光谱的起始波长，单位 nm。 |
| `end` | `end` | `2500` | 终止波长，单位 nm，大于 `start`。 |
| `step` | `step` | `0.5` | 波长步长，单位 nm。 |
| `angle` | `angle` | `0` | 入射角，单位为度，在入射介质中计，从 0 起，小于 90。 |
| `pol` | `pol` | `'avg'` | 偏振：`'avg'`（非偏振）、`'s'` 或 `'p'`。 |
| `custom` | `custom` | `[]` | **JavaScript**：你自己的行，每行为 `{ key, quantity, source, detector, band }`：`key` 为其名称，不能与其他行相同；`quantity` 为 `'T'`、`'R'` 或 `'A'`；`source` 为 `{ id }`，id 为 `'D65'`、`'D50'`、`'A'`、`'AM1.5G'`、`'E'`、带 `T`（其温度，单位 K）的 `'blackbody'`，或带 `table`（其 `[nm, value]` 行，至少两行且波长不同）的 `'custom'`；`detector` 为 `{ id }`，id 为 `'photopic'`、`'flat'` 或带其 `table` 的 `'custom'`；`band` 为以 nm 计的 `[start, end]`，并受权重自身范围的限制。字段不给出时：`'T'`、D65、明视觉和 380-780 nm；黑体的 T 为 5778 K。<br>**Python**：你自己的行，每行是一个 dict，含 key、quantity、source、detector 和 band：key 为其名称，不能与其他行相同；quantity 为 "T"、"R" 或 "A"；source 为 {"id": ...}，id 为 "D65"、"D50"、"A"、"AM1.5G"、"E"、带 "T"（其温度，单位 K）的 "blackbody"，或带 "table"（其 [nm, value] 行，至少两行且波长不同）的 "custom"；detector 为 {"id": ...}，id 为 "photopic"、"flat" 或带其 "table" 的 "custom"；band 为以 nm 计的 [start, end]，并受权重自身范围的限制。字段不给出时："T"、D65、明视觉和 380-780 nm；黑体的 T 为 5778 K。不给出时，没有你自己的行。 |
| `side` | `side` |  | `'front'`、`'back'` 或 `'total'`（整个元件）。不给出时，使用设计的评价对象。 |

**返回**：一个 Integrals。

**拒绝**：

- **JavaScript**：它不接受的选项、不成范围的波长、0 到 90 以外的角度、它没有的偏振或面、超过一百万个波长、带有它没有或无法使用的字段的自定义行、与其他行相同的 key，或用到找不到对应材料的设计<br>**Python**：不成范围的波长、0 到 90 以外的角度、它没有的偏振或面、超过一百万个波长、带有它没有或无法使用的字段的自定义行、与其他行相同的 key，或用到找不到对应材料的设计

```js
const design = tf.newDesign('AR');
design.stack('HL');
const iv = design.integrals({ custom: [{ key: 'T3000K', source: { id: 'blackbody', T: 3000 }, band: [400, 700] }] });
console.log('Tvis', iv.get('Tvis').value.toFixed(4), 'T3000K', iv.get('T3000K').value.toFixed(4));
```

```python
design = tf.new_design("AR")
design.stack("HL")
iv = design.integrals(custom=[{"key": "T3000K", "source": {"id": "blackbody", "T": 3000},
                               "band": [400, 700]}])
print("Tvis", round(iv["Tvis"].value, 4), "T3000K", round(iv["T3000K"].value, 4))
```

### ellipsometry

| JavaScript | Python |
| ---------- | ------ |
| `design.ellipsometry(start, end, { step, angles, side, deltaConvention })` | `design.ellipsometry(start=400, end=800, step=0.5, angles=[65], side=..., delta_convention="azzam")` |

一个镀膜面的 Ψ 和 Δ 随波长的变化，在一个或多个入射角下，与椭偏仪评估窗口的光谱扫描计算的相同，由 ρ = r_p / r_s = tan Ψ · exp(i Δ) 得出。除非给出 `side`，计算在正面进行；仅背面镀膜的设计在背面进行；没有膜层的面给出其裸表面的结果。与窗口一样，不使用设计的入射锥角。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `start` | `start` | `400` | 起始波长，单位 nm。 |
| `end` | `end` | `800` | 结束波长，单位 nm，大于 `start`。 |
| `step` | `step` | `0.5` | 波长步长，单位 nm。 |
| `angles` | `angles` | `[65]` | 入射角，单位为度，在光射来的介质中计，每个从 0 起，小于 90。 |
| `side` | `side` |  | `'front'` 或 `'back'`。不给出时，仅背面镀膜的设计用背面，其他设计用正面。 |
| `deltaConvention` | `delta_convention` | `'azzam'` | Δ 的符号：`'azzam'` 为椭偏仪记录的 Azzam-Bashara 符号，`'reversed'` 为 360 度减去该值。两者的 Ψ 相同。 |

**返回**：一个 Ellipsometry。

**拒绝**：

- **JavaScript**：它不接受的选项、不构成范围的波长范围、0 到 90 以外的角度、不是 `'front'` 或 `'back'` 的面、不是 `'azzam'` 或 `'reversed'` 的符号约定、超过一百万个点（波长数乘以角度数），或用到找不到对应材料的设计<br>**Python**：不构成范围的波长范围、0 到 90 以外的角度、不是 "front" 或 "back" 的面、不是 "azzam" 或 "reversed" 的符号约定、超过一百万个点（波长数乘以角度数），或用到找不到对应材料的设计

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
const e = design.ellipsometry(400, 800, { step: 1, angles: [55, 70] });
console.log(e.mode, 'Psi at 55 degrees from', Math.min(...e.psi).toFixed(2), 'to', Math.max(...e.psi).toFixed(2));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
e = design.ellipsometry(400, 800, step=1, angles=[55, 70])
print(e.mode, "Psi at 55 degrees from", round(min(e.psi), 2), "to", round(max(e.psi), 2))
```

### ellipsometryVsAngle / ellipsometry_vs_angle

| JavaScript | Python |
| ---------- | ------ |
| `design.ellipsometryVsAngle(wavelength, start, end, { step, side, deltaConvention })` | `design.ellipsometry_vs_angle(wavelength=..., start=45, end=80, step=0.5, side=..., delta_convention="azzam")` |

一个镀膜面的 Ψ 和 Δ 在某一波长处随入射角的变化，与椭偏仪评估窗口的角度扫描计算的相同。角度从 `start` 起，按 `step` 递增，每个取整到 0.001 度，直到 `end`。除非给出 `side`，计算在正面进行；仅背面镀膜的设计在背面进行；没有膜层的面给出其裸表面的结果。与窗口一样，不使用设计的入射锥角。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `wavelength` | `wavelength` |  | 波长，单位 nm。不给出时，使用设计的参考波长。 |
| `start` | `start` | `45` | 起始入射角，单位为度，在光射来的介质中计，不小于 0。 |
| `end` | `end` | `80` | 结束角度，单位为度，大于 `start`，最大 89.5。 |
| `step` | `step` | `0.5` | 角度步长，单位为度，从 0.05 到跨度，即 `end` 减 `start`。 |
| `side` | `side` |  | `'front'` 或 `'back'`。不给出时，仅背面镀膜的设计用背面，其他设计用正面。 |
| `deltaConvention` | `delta_convention` | `'azzam'` | Δ 的符号：`'azzam'` 为椭偏仪记录的 Azzam-Bashara 符号，`'reversed'` 为 360 度减去该值。两者的 Ψ 相同。 |

**返回**：一个 Ellipsometry。

**拒绝**：

- **JavaScript**：它不接受的选项、小于等于 0 的波长、不构成 0 到 89.5 之间范围的角度、小于 0.05 度或大于跨度的步长、不是 `'front'` 或 `'back'` 的面、不是 `'azzam'` 或 `'reversed'` 的符号约定，或用到找不到对应材料的设计<br>**Python**：小于等于 0 的波长、不构成 0 到 89.5 之间范围的角度、小于 0.05 度或大于跨度的步长、不是 "front" 或 "back" 的面、不是 "azzam" 或 "reversed" 的符号约定，或用到找不到对应材料的设计

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
const e = design.ellipsometryVsAngle(633, 45, 80, { step: 0.5 });
console.log('lowest Psi', e.psi.min().toFixed(3), 'at', e.psi.angle[e.psi.indexOf(e.psi.min())], 'degrees');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
e = design.ellipsometry_vs_angle(633, 45, 80, step=0.5)
print("lowest Psi", round(e.psi.min(), 3), "at", e.psi.angle[e.psi.index(e.psi.min())], "degrees")
```

### groupDelay / group_delay

| JavaScript | Python |
| ---------- | ------ |
| `design.groupDelay(start, end, { step, angle, pol, response, side, reference })` | `design.group_delay(start=400, end=800, step=0.5, angle=0, pol="avg", response="R", side=..., reference=...)` |

**JavaScript**：设计的反射光或透射光的相位、群延迟、GDD、TOD 和 CDC 随波长的变化，与群延迟 / GDD 窗口的计算相同。除非给出 `side`，计算在正面进行；仅背面镀膜的设计在背面进行；没有膜层的面给出其裸表面的结果。`side: 'total'` 只与 `response: 'T'` 一起使用，是脉冲分析计算的整个元件：正面膜层、穿过一次基底以及背面膜层。与窗口一样，不使用设计的入射锥角。

**Python**：设计的反射光或透射光的相位、群延迟、GDD、TOD 和 CDC 随波长的变化，与群延迟 / GDD 窗口的计算相同。除非给出 side，计算在正面进行；仅背面镀膜的设计在背面进行；没有膜层的面给出其裸表面的结果。side="total" 只与 response="T" 一起使用，是脉冲分析计算的整个元件：正面膜层、穿过一次基底以及背面膜层。与窗口一样，不使用设计的入射锥角。

**JavaScript**：GD、GDD 和 TOD 是每个波长处的解析值，因此与网格无关。相位沿网格解缠，因此在均匀网格上，跨过比步长更窄的共振时可能相差 2π。对于整个元件，基底自身的相位 −2π n d cosθ / λ（n、d 和 θ 为其折射率、厚度和光在其中的角度）按原样加入，因此只有膜层的相位被解缠。`step: 'auto'` 给出窗口自己的网格，它在反射极小值和表格节点处加点，因此在其上取的平均值会偏向那里的尖峰。

**Python**：GD、GDD 和 TOD 是每个波长处的解析值，因此与网格无关。相位沿网格解缠，因此在均匀网格上，跨过比步长更窄的共振时可能相差 2π。对于整个元件，基底自身的相位 −2π n d cosθ / λ（n、d 和 θ 为其折射率、厚度和光在其中的角度）按原样加入，因此只有膜层的相位被解缠。step="auto" 给出窗口自己的网格，它在反射极小值和表格节点处加点，因此在其上取的平均值会偏向那里的尖峰。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `start` | `start` | `400` | 起始波长，单位 nm。 |
| `end` | `end` | `800` | 结束波长，单位 nm，大于 `start`。 |
| `step` | `step` | `0.5` | 波长步长，单位 nm；或 `'auto'`，即窗口自己的网格。 |
| `angle` | `angle` | `0` | 入射角，单位为度，在光射来的介质中计，从 0 起，小于 90。 |
| `pol` | `pol` | `'avg'` | 偏振：`'avg'`、`'s'` 或 `'p'`。 |
| `response` | `response` | `'R'` | 取其相位的光：`'R'` 为反射光，`'T'` 为透射光。 |
| `side` | `side` |  | **JavaScript**：`'front'`、`'back'`，或在 `response: 'T'` 时为 `'total'`（整个元件）。不给出时，仅背面镀膜的设计用背面，其他设计用正面。<br>**Python**："front"、"back"，或在 response="T" 时为 "total"（整个元件）。不给出时，仅背面镀膜的设计用背面，其他设计用正面。 |
| `reference` | `reference` |  | 一个波长，单位 nm：相位随之在离它最近的采样点处为 0，与窗口绘图的方式相同；该采样点没有数值时，相位保持为绝对值，`reference` 为 `null` / `None`。不给出时，相位为绝对值。 |

**返回**：一个 GroupDelay。

**拒绝**：

- **JavaScript**：它不接受的选项、不构成范围的波长范围、既不是正数也不是 `'auto'` 的步长、0 到 90 以外的角度、它没有的偏振、响应或面、`response: 'R'` 时的 `'total'`、不是大于 0 的波长的参考、超过一百万个波长，或用到找不到对应材料的设计<br>**Python**：不构成范围的波长范围、既不是正数也不是 "auto" 的步长、0 到 90 以外的角度、它没有的偏振、响应或面、response="R" 时的 "total"、不是大于 0 的波长的参考、超过一百万个波长，或用到找不到对应材料的设计

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^8 H');
const g = design.groupDelay(500, 600, { step: 1 });
console.log(g.mode, 'GDD from 520 to 580 nm:', g.gdd.min(520, 580).toFixed(3), 'to', g.gdd.max(520, 580).toFixed(3), 'fs²');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^8 H")
g = design.group_delay(500, 600, step=1)
print(g.mode, "GDD from 520 to 580 nm:", round(g.gdd.min(520, 580), 3), "to", round(g.gdd.max(520, 580), 3), "fs²")
```

### setPulseSpectrum / set_pulse_spectrum

| JavaScript | Python |
| ---------- | ------ |
| `design.setPulseSpectrum(fileOrRows)` | `design.set_pulse_spectrum(file_or_rows)` |

**JavaScript**：设置设计为脉冲分析保存的光谱，与窗口的“载入文件…”和“应用”的设置方式相同：文本表格按曲线编辑器的读法读取，波长列的单位取其标题所写的单位；或直接给出若干行。每行为一个波长和一个强度；给出第三列时，还有以弧度表示的光谱相位。对波长而言，强度按单位波长的强度读取，与光谱仪的记录方式相同。各行按给出的单位、按升序保存，并随设计一起保存。`source: 'design'` 时 pulse() 读取它们，其中心波长即为它们的重心，窗口的“应用”也把中心波长移到该处。

**Python**：设置设计为脉冲分析保存的光谱，与窗口的“载入文件…”和“应用”的设置方式相同：文本表格按曲线编辑器的读法读取，波长列的单位取其标题所写的单位；或直接给出若干行。每行为一个波长和一个强度；给出第三列时，还有以弧度表示的光谱相位。对波长而言，强度按单位波长的强度读取，与光谱仪的记录方式相同。各行按给出的单位、按升序保存，并随设计一起保存。source="design" 时 pulse() 读取它们，其中心波长即为它们的重心，窗口的“应用”也把中心波长移到该处。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `fileOrRows` | `file_or_rows` |  | **JavaScript**：文本表格的路径，给出完整路径；或若干行 `[wavelength nm, intensity]` 或 `[wavelength nm, intensity, phase rad]`。<br>**Python**：文本表格的路径；或若干行 [wavelength nm, intensity] 或 [wavelength nm, intensity, phase rad]。相对路径以程序的工作文件夹为基准。 |

**拒绝**：

- 无法读取或没有波长和强度列的文件、不是两个或三个数的行、波长大于 0 且强度不小于 0 的行少于两行、没有强度大于 0 的行，或部分行有相位而其他行没有

```js
const rows = [];
for (let w = 760; w <= 840; w += 2) rows.push([w, Math.exp(-(((w - 800) / 20) ** 2))]);
const design = tf.newDesign('Mirror', { reference: 800 });
design.stack('(HL)^8 H');
design.setPulseSpectrum(rows);
console.log('centre', design.pulse({ source: 'design' }).centre, 'nm');
```

```python
import math

rows = [[w, math.exp(-((w - 800) / 20) ** 2)] for w in range(760, 841, 2)]
design = tf.new_design("Mirror", reference=800)
design.stack("(HL)^8 H")
design.set_pulse_spectrum(rows)
print("centre", design.pulse(source="design").centre, "nm")
```

### pulse

| JavaScript | Python |
| ---------- | ------ |
| `design.pulse({ source, shape, centre, duration, bandwidth, order, gdd, tod, side, response, pol, angle, passes })` | `design.pulse(source="model", shape="gaussian", centre=..., duration=10, bandwidth=100, order=2, gdd=0, tod=0, side=..., response="R", pol="avg", angle=0, passes=1)` |

**JavaScript**：脉冲经过设计后在时间和光谱上的变化，与脉冲分析窗口的计算相同：脉冲在一个镀膜面上反射或透射，或穿过整个元件，即正面膜层、穿过一次基底以及背面膜层，取从中射出的第一个脉冲；连续反射或穿过 `passes` 次。其光谱为以中心波长为中心的高斯、sech² 或超高斯光谱，或在 `source: 'design'` 时为设计保存的光谱（setPulseSpectrum()），再叠加 `gdd` 和 `tod` 给出的啁啾。与窗口一样，不使用设计的入射锥角。不给出选项时，使用窗口打开时的设置，面为 PR、GD、GDD 和 TOD 评价函数行所评价的面：仅背面镀膜的设计为背面，其他设计为正面。窗口打开时，除非只有背面有膜层，否则选择正面，因此一面没有膜层时两者可能不同；没有膜层的面给出其裸表面的结果。

**Python**：脉冲经过设计后在时间和光谱上的变化，与脉冲分析窗口的计算相同：脉冲在一个镀膜面上反射或透射，或穿过整个元件，即正面膜层、穿过一次基底以及背面膜层，取从中射出的第一个脉冲；连续反射或穿过 passes 次。其光谱为以中心波长为中心的高斯、sech² 或超高斯光谱，或在 source="design" 时为设计保存的光谱（set_pulse_spectrum()），再叠加 gdd 和 tod 给出的啁啾。与窗口一样，不使用设计的入射锥角。不给出关键字参数时，使用窗口打开时的设置，面为 PR、GD、GDD 和 TOD 评价函数行所评价的面：仅背面镀膜的设计为背面，其他设计为正面。窗口打开时，除非只有背面有膜层，否则选择正面，因此一面没有膜层时两者可能不同；没有膜层的面给出其裸表面的结果。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `source` | `source` | `'model'` | `'model'`，即 `shape` 给出的光谱；或 `'design'`，即设计保存的光谱。 |
| `shape` | `shape` | `'gaussian'` | `'gaussian'` 或 `'sech2'`，即给定 `duration` 的脉冲；或 `'superGaussian'`，即给定 `bandwidth` 和 `order` 的光谱。 |
| `centre` | `centre` |  | **JavaScript**：中心波长，单位 nm，即啁啾所围绕展开的载波。不给出时为 800 nm；`source: 'design'` 时为光谱在频率上的重心，精确到百分之一纳米，与“应用”的设置相同。<br>**Python**：中心波长，单位 nm，即啁啾所围绕展开的载波。不给出时为 800 nm；source="design" 时为光谱在频率上的重心，精确到百分之一纳米，与“应用”的设置相同。 |
| `duration` | `duration` | `10` | 变换极限脉冲的强度半高全宽，单位 fs，用于 `'gaussian'` 和 `'sech2'`。 |
| `bandwidth` | `bandwidth` | `100` | 光谱的强度半高全宽，单位 nm，用于 `'superGaussian'`。 |
| `order` | `order` | `2` | 超高斯的阶数，大于 0；2 为高斯，阶数越高，光谱顶部越平。 |
| `gdd` | `gdd` | `0` | 输入自身的 GDD，单位 fs²，以中心波长为展开点。 |
| `tod` | `tod` | `0` | 输入自身的 TOD，单位 fs³，以中心波长为展开点。 |
| `side` | `side` |  | **JavaScript**：`'front'`、`'back'`，或在 `response: 'T'` 时为 `'total'`（整个元件）。不给出时，仅背面镀膜的设计用背面，其他设计用正面。<br>**Python**："front"、"back"，或在 response="T" 时为 "total"（整个元件）。不给出时，仅背面镀膜的设计用背面，其他设计用正面。 |
| `response` | `response` | `'R'` | `'R'` 为反射脉冲，`'T'` 为透射脉冲。 |
| `pol` | `pol` | `'avg'` | 偏振：`'avg'`、`'s'` 或 `'p'`。 |
| `angle` | `angle` | `0` | 入射角，单位为度，在光射来的介质中计，从 0 起，小于 90。 |
| `passes` | `passes` | `1` | 在膜层上反射或穿过膜层的次数，为整数。 |

**返回**：一个 Pulse。

**拒绝**：

- **JavaScript**：它不接受的选项或选项不能取的值、`response: 'R'` 时的 `'total'`、对不含强度大于零的光谱的设计使用 `source: 'design'`、用到找不到对应材料的设计、对其中心波长而言过短的脉冲、无法在整个光谱上计算的响应，或没有光从元件射出<br>**Python**：它不接受的选项或选项不能取的值、response="R" 时的 "total"、对不含强度大于零的光谱的设计使用 source="design"、用到找不到对应材料的设计、对其中心波长而言过短的脉冲、无法在整个光谱上计算的响应，或没有光从元件射出

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^8 H');
const p = design.pulse({ centre: 550, duration: 20, passes: 2 });
console.log('output FWHM', p.metrics.outputFwhm.toFixed(2), 'fs, peak', (100 * p.metrics.peakVsFlp).toFixed(1), '% of the Fourier-limited pulse');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^8 H")
p = design.pulse(centre=550, duration=20, passes=2)
print("output FWHM", round(p.metrics.output_fwhm, 2), "fs, peak", round(100 * p.metrics.peak_vs_flp, 1), "% of the Fourier-limited pulse")
```

### processSteps / process_steps

| JavaScript | Python |
| ---------- | ------ |
| `design.processSteps(start, end, { step, side, otherSide, quantity, angle, pol, chips })` | `design.process_steps(start=400, end=1100, step=0.5, side=..., other_side="bare", quantity="T", angle=0, pol="avg", chips=...)` |

按工艺导出器窗口计算各层完成光谱的方式，给出腔体内监控仪在一面的每层之后读到的光谱：膜层从基底向外沉积，空层略去，被测件在空气中读取。在工件上，另一面在整个运行中保持裸露或带有其全部镀膜；在监控片上，每片监控片从裸监控片玻璃开始自成一次运行，每层厚度为其在工件上厚度的 `witnessRatio` / `witness_ratio` 倍。不使用设计的入射锥角。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `start` | `start` | `400` | 起始波长，单位 nm。 |
| `end` | `end` | `1100` | 终止波长，单位 nm，大于 `start`。 |
| `step` | `step` | `0.5` | 波长步长，单位 nm。 |
| `side` | `side` |  | `'front'` 或 `'back'`，即沉积的那一面。不给出时为正面，只在背面镀膜的设计则为背面。 |
| `otherSide` | `other_side` | `'bare'` | `'bare'` 或 `'coated'`：工件的另一面无镀膜或带有其镀膜。监控片上不使用。 |
| `quantity` | `quantity` | `'T'` | `'T'`、`'R'` 或 `'A'`。 |
| `angle` | `angle` | `0` | 入射角，单位为度，在空气中计，从 0 起，小于 90。 |
| `pol` | `pol` | `'avg'` | `'avg'`、`'s'` 或 `'p'`。 |
| `chips` | `chips` |  | **JavaScript**：在监控片上时为 `{ layersPerChip, plan, glass, witnessRatio }`，各项均可省略：`plan` 为该面从基底向外每一层的监控片编号，包括空层，代替每片 `layersPerChip` 层（两者都不给时为 3）；`glass` 为监控片玻璃，按 id 给出，不给出时为基底；`witnessRatio` 为监控片厚度与工件厚度之比，从 0.05 到 10，不给出时为 1。不给出时为工件。<br>**Python**：在监控片上时为含 layers_per_chip、plan、glass 和 witness_ratio 的 dict，各项均可省略：plan 为该面从基底向外每一层的监控片编号，包括空层，代替每片 layers_per_chip 层（两者都不给时为 3）；glass 为监控片玻璃，按 id 给出，不给出时为基底；witness_ratio 为监控片厚度与工件厚度之比，从 0.05 到 10，不给出时为 1。不给出时为工件。 |

**返回**：**JavaScript**：一个对象：`mode`，沉积的那一面；`quantity`；`wavelength`（nm）；`bare`，第一层之前的光谱；以及 `steps`，每沉积一层一项，每项为 `{ step, layer, material, thickness, chip, values }`：step 从 1 起，layer 为它在设计编辑器中的编号，从紧邻基底的 1 起，material 按 id 给出，thickness 为所读取被测件上的厚度，单位 nm，chip 为它的监控片编号，工件上为 null，values 为该层完成时的光谱，以 1 的分数表示。<br>**Python**：一个 ProcessSteps，即具名元组：mode，沉积的那一面；quantity；wavelength（nm）；bare，第一层之前的光谱；以及 steps，每沉积一层一个 ProcessStep：step 从 1 起，layer 为它在设计编辑器中的编号，从紧邻基底的 1 起，material 按 id 给出，thickness 为所读取被测件上的厚度，单位 nm，chip 为它的监控片编号，工件上为 None，values 为该层完成时的光谱，以 1 的分数表示。

**拒绝**：

- 不接受的选项或选项不能取的值、不构成范围的波长、超过一百万个波长、长度不等于该面层数的监控片方案、找不到对应材料的监控片玻璃，或引用了找不到对应材料的设计

```js
const design = tf.newDesign('AR');
design.stack('H L');
const run = design.processSteps(400, 800, { step: 5 });
const at = run.wavelength.indexOf(550);
for (const s of run.steps) console.log('step', s.step, s.material, 'T at 550 nm', s.values[at].toFixed(4));
```

```python
design = tf.new_design("AR")
design.stack("H L")
run = design.process_steps(400, 800, step=5)
at = run.wavelength.index(550)
for s in run.steps:
    print("step", s.step, s.material, "T at 550 nm", round(s.values[at], 4))
```

### exportProcess / export_process

| JavaScript | Python |
| ---------- | ------ |
| `design.exportProcess(folder, start, end, { format, files, header, delimiter, scale, decimals, decimalMark })` | `design.export_process(folder, start=400, end=1100, format="res", files="step", header="layers", delimiter=",", scale="percent", decimals=5, decimal_mark=".")` |

**JavaScript**：把工艺导出器窗口“保存”为一次运行写出的文件写入文件夹：每步一个 `.res` 文件（01.res、02.res……），或 CSV、文本文件，每步一个或每次运行一个表格，每个光谱都按 processSteps() 的方式计算。在监控片上，每片监控片的文件放在该文件夹内各自的子文件夹中。文件夹中已有同名文件时会被替换，与“保存”相同。

**Python**：把工艺导出器窗口“保存”为一次运行写出的文件写入文件夹：每步一个 `.res` 文件（01.res、02.res……），或 CSV、文本文件，每步一个或每次运行一个表格，每个光谱都按 process_steps() 的方式计算。在监控片上，每片监控片的文件放在该文件夹内各自的子文件夹中。文件夹中已有同名文件时会被替换，与“保存”相同。它也接受 process_steps() 的关键字参数，用于设定这次运行。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `folder` | `folder` |  | 写入文件的文件夹，必须已经存在。 |
| `start` | `start` | `400` | 写入的起始波长，单位 nm。 |
| `end` | `end` | `1100` | 写入的终止波长，单位 nm，大于 `start`。 |
| `options` |  |  | **JavaScript**：processSteps() 的选项，以及以下各项。 |
| `format` | `format` | `'res'` | **JavaScript**：`'res'`、`'csv'` 或 `'txt'`。`.res` 文件只有一种格式，以下选项不改变它。<br>**Python**："res"、"csv" 或 "txt"。`.res` 文件只有一种格式，以下关键字参数不改变它。 |
| `files` | `files` | `'step'` | `'step'` 为每步一个文件，`'table'` 为每次运行一个文件，每步一列。 |
| `header` | `header` | `'layers'` | `'layers'` 为带膜层表的 `.res` 文件头；`'conditions'` 为实测光谱导入能读回的条件行；`'none'` 为无文件头。 |
| `delimiter` | `delimiter` | `','` | `','`、`';'`、制表符或空格。 |
| `scale` | `scale` | `'percent'` | `'percent'` 或 `'fraction'`。 |
| `decimals` | `decimals` | `5` | 每个数值的小数位数，从 0 到 12 的整数。 |
| `decimalMark` | `decimal_mark` | `'.'` | `'.'` 或 `','`；用逗号时分隔符不能是逗号。 |

**返回**：写入的文件路径，按运行顺序。

**拒绝**：

- **JavaScript**：processSteps() 抛出的错误、不接受的输出选项或值、不存在的文件夹，或没有可沉积膜层的面<br>**Python**：process_steps() 引发的错误、不接受的输出选项或值、不存在的文件夹，或没有可沉积膜层的面

```js
const fs = require('fs'), path = require('path'), os = require('os');
const design = tf.newDesign('AR');
design.stack('H L');
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'process-'));
console.log(design.exportProcess(folder, 400, 800, { step: 1 }));
```

```python
import tempfile
design = tf.new_design("AR")
design.stack("H L")
print(design.export_process(tempfile.mkdtemp(), 400, 800, step=1))
```

### monitorWorksheet / monitor_worksheet

| JavaScript | Python |
| ---------- | ------ |
| `design.monitorWorksheet({ side, quantity, angle, pol, chips, wavelengths, signalErrorPct, noiseFloorPct, maxTerminationErrPct })` | `design.monitor_worksheet(side=..., quantity="T", angle=0, pol="avg", chips=..., wavelengths=..., signal_error_pct=0.3, noise_floor_pct=0.1, max_termination_err_pct=1)` |

按监控工作表窗口的方式判定一面的每一层能否在光学监控下停切：膜层从基底向外沉积在监控片上，每片监控片从裸监控片玻璃开始自成一段短膜系，在空气中读取，每层厚度为其在工件上厚度的 `witnessRatio` / `witness_ratio` 倍。每行给出该层停切时在其监控片波长处的信号、层内的极值点、可供停切的摆幅，以及与监控自身信号误差大小相同的误差造成的厚度误差，超过该层厚度的 `maxTerminationErrPct` / `max_termination_err_pct` 时被标记。每一层都是一行，空层也一样。监控片方案即 `processSteps()` / `process_steps()` 的 `chips`：给 `processSteps()` / `process_steps()` 同样的 `chips`，就得到这些监控片上工艺导出器的光谱；它需要给出 `chips`，每片 3 层时为 `{}`，因为不给 `chips` 时它计算的是工件。这里给出的方案不影响窗口或报告。不使用设计的入射锥角。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `side` | `side` |  | `'front'` 或 `'back'`，即沉积的那一面。不给出时为正面，只在背面镀膜的设计则为背面；窗口只处理正面。 |
| `quantity` | `quantity` | `'T'` | `'T'` 或 `'R'`，即监控读取的量。 |
| `angle` | `angle` | `0` | 监控片上的入射角，单位为度，在空气中计，从 0 起，小于 90。 |
| `pol` | `pol` | `'avg'` | `'avg'`、`'s'` 或 `'p'`。 |
| `chips` | `chips` |  | **JavaScript**：监控片方案 `{ layersPerChip, plan, glass, witnessRatio }`，各项均可省略：`plan` 为该面从基底向外每一层的监控片编号，包括空层，代替每片 `layersPerChip` 层（两者都不给时为 3）；`glass` 为监控片玻璃，按 id 给出，不给出时为基底；`witnessRatio` 为监控片厚度与工件厚度之比，从 0.05 到 10，不给出时为 1。<br>**Python**：监控片方案，即含 layers_per_chip、plan、glass 和 witness_ratio 的 dict，各项均可省略：plan 为该面从基底向外每一层的监控片编号，包括空层，代替每片 layers_per_chip 层（两者都不给时为 3）；glass 为监控片玻璃，按 id 给出，不给出时为基底；witness_ratio 为监控片厚度与工件厚度之比，从 0.05 到 10，不给出时为 1。 |
| `wavelengths` | `wavelengths` |  | 监控波长，单位 nm：`'auto'`，即窗口的“自动 λ”按钮，每片监控片取参考波长，或参考波长 0.7 到 1.3 倍之间 25 个波长中的一个，取该片上最差一层停切最准的那个，取整到 nm；一个数，每片监控片都用该波长，与“全部设为”相同；或一个列表，该面从基底向外每层一个，包括空层，每片监控片按其第一层给出的波长读取。不给出时，每片监控片都用设计的参考波长。 |
| `signalErrorPct` | `signal_error_pct` | `0.3` | 监控的信号误差，以读数的百分比表示，从 0.001 到 50。 |
| `noiseFloorPct` | `noise_floor_pct` | `0.1` | 监控的噪声底，以满量程的百分比表示，从 0 到 10。 |
| `maxTerminationErrPct` | `max_termination_err_pct` | `1` | 停切厚度误差超过此值的层被标记，以该层厚度的百分比表示，从 0.01 到 100。 |

**返回**：**JavaScript**：一个对象：`mode`，沉积的那一面；`rows`，每层一行，按沉积顺序排列；`chips`，每片监控片一项，按其进入运行的顺序排列，每项为 `{ chip, wavelength, initialLevel, steps }`，即其波长（nm）、其裸片读数和其上的各步；以及 `runLength`，整炉在监控片上的光学厚度，以参考波长处的四分之一波长数计，即窗口曲线图的长度。每行为 `{ step, layer, chip, onChip, material, wavelength, thickness, signal, turningPoints, amplitude, swingIn, swingOut, cutoffRatio, terminationError, crystal, initialLevel, poor, strategy, curve }`：step 从 1 起；layer 为它在设计编辑器中的编号，从紧邻基底的 1 起，与 step 相同；chip 为它的监控片编号，onChip 为它在该片上的位置，从 1 起；material 按 id 给出；wavelength 为该片的波长，单位 nm；thickness 为监控片上的厚度，单位 nm；signal 为该层停切时的读数，以 1 的分数表示（窗口显示为 %）；turningPoints 为该层内的极值点个数；amplitude 为从停切所参照的读数（片上停切点处或之前的最后一个极值点，没有时为该片的裸片读数）到下一个极值点的摆幅，停切点之后没有极值点时为 null；swingIn 和 swingOut 为从该读数到该层起点和到停切点的摆幅，以 1 的分数表示；cutoffRatio 为 swingOut 除以 amplitude，或 null；terminationError 为与监控自身信号误差大小相同的误差留下的厚度误差，单位 nm，按时间停切的层为 null，信号没有可读取的斜率或反转时为 Infinity；crystal 为工件上的厚度，单位 nm，即石英晶控要走到的厚度（窗口显示为 kÅ）；initialLevel 为该片第一层上的裸片读数，其余各层为 null；poor 在该层停切点之后没有极值点或其停切厚度误差超出允差时为 true；strategy 为 `'turning'`、`'level'` 或 `'time'`，即该层的停切方式；curve 为 `{ thickness, signal }`，即读数对该层在监控片上自身厚度（nm）的曲线，从 0 起，到停切点之后该层的 1.35 个四分之一波长为止，有下一个极值点时越过它。<br>**Python**：一个 MonitorWorksheet，即具名元组：mode，沉积的那一面；rows，每层一个 WorksheetRow，按沉积顺序排列；chips，每片监控片一个 WorksheetChip，按其进入运行的顺序排列，含其 chip、其波长（nm）、其裸片读数 initial_level 和其上的各步 steps；以及 run_length，整炉在监控片上的光学厚度，以参考波长处的四分之一波长数计，即窗口曲线图的长度。WorksheetRow 含：step 从 1 起；layer 为它在设计编辑器中的编号，从紧邻基底的 1 起，与 step 相同；chip 为它的监控片编号，on_chip 为它在该片上的位置，从 1 起；material 按 id 给出；wavelength 为该片的波长，单位 nm；thickness 为监控片上的厚度，单位 nm；signal 为该层停切时的读数，以 1 的分数表示（窗口显示为 %）；turning_points 为该层内的极值点个数；amplitude 为从停切所参照的读数（片上停切点处或之前的最后一个极值点，没有时为该片的裸片读数）到下一个极值点的摆幅，停切点之后没有极值点时为 None；swing_in 和 swing_out 为从该读数到该层起点和到停切点的摆幅，以 1 的分数表示；cutoff_ratio 为 swing_out 除以 amplitude，或 None；termination_error 为与监控自身信号误差大小相同的误差留下的厚度误差，单位 nm，按时间停切的层为 None，信号没有可读取的斜率或反转时为 inf；crystal 为工件上的厚度，单位 nm，即石英晶控要走到的厚度（窗口显示为 kÅ）；initial_level 为该片第一层上的裸片读数，其余各层为 None；poor 在该层停切点之后没有极值点或其停切厚度误差超出允差时为 True；strategy 为 "turning"、"level" 或 "time"，即该层的停切方式；curve 为含 thickness 和 signal 的 WorksheetCurve，即读数对该层在监控片上自身厚度（nm）的曲线，从 0 起，到停切点之后该层的 1.35 个四分之一波长为止，有下一个极值点时越过它。

**拒绝**：

- 不接受的选项或选项不能取的值、长度不等于该面层数的监控片方案或波长列表、找不到对应材料的监控片玻璃、引用了找不到对应材料的设计，或在参考波长或某片监控片的波长处没有折射率的材料（按 id 给出）

```js
const design = tf.newDesign('AR');
design.stack('H L H L');
const sheet = design.monitorWorksheet({ chips: { layersPerChip: 2 }, wavelengths: 'auto' });
for (const r of sheet.rows) console.log('step', r.step, 'chip', r.chip, 'at', r.wavelength, 'nm: error', r.terminationError?.toFixed(2), 'nm', r.poor ? 'flagged' : '');
```

```python
design = tf.new_design("AR")
design.stack("H L H L")
sheet = design.monitor_worksheet(chips={"layers_per_chip": 2}, wavelengths="auto")
for r in sheet.rows:
    error = r.termination_error
    print("step", r.step, "chip", r.chip, "at", r.wavelength, "nm: error", error if error is None else round(error, 2), "nm", "flagged" if r.poor else "")
```

### importZemaxCoating / import_zemax_coating

| JavaScript | Python |
| ---------- | ------ |
| `design.importZemaxCoating(path, { coating, wavelength, side })` | `design.import_zemax_coating(path, coating=..., wavelength=550, side=...)` |

按 Zemax 镀膜窗口“导入 → 正面镀膜”把膜层放到正面的方式，把 Zemax OpticStudio COATING.DAT 文件中一条 COAT 记录的膜层放到设计的一个面上：相对厚度在 `wavelength` 处用文件给出的折射率换算。COAT 从入射介质开始列出膜层，因此放到背面时顺序反转。该面原有的膜层被替换；介质和基底保持设计原有的。每层的材料取应用中导入时给它的 id，位于该文件的材料目录中，设计携带其定义，因此计算和保存时都使用它：不向任何材料目录写入内容。在应用以前导入过该文件的计算机上，id 为该目录的 id，并使用目录中保存的材料，包括其编辑；否则每次导入都会像首次导入那样为目录 id 重新抽取一个随机部分。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `path` | `path` |  | **JavaScript**：文件，给出完整路径。相对路径按 `tf.openDesign()` 的方式解释。<br>**Python**：文件。相对路径按 tf.open_design() 的方式解释。 |
| `coating` | `coating` |  | **JavaScript**：COAT 记录，按其名称或其在文件各镀膜中的位置（从 0 开始）给出。不给出时为第一个膜层堆栈。<br>**Python**：COAT 记录，按其名称或其在文件各镀膜中的位置（从 0 开始）给出。不给出时为第一个膜层堆栈。 |
| `wavelength` | `wavelength` | `550` | **JavaScript**：λ₀，单位 nm；文件以波数给出的厚度在此波长处换算为 nm。<br>**Python**：波长，单位 nm；文件以波数给出的厚度在此波长处换算为 nm。 |
| `side` | `side` |  | **JavaScript**：`'front'` 或 `'back'`。不给出时为正面；仅背面镀膜的设计为背面。<br>**Python**："front" 或 "back"。不给出时为正面；仅背面镀膜的设计为背面。 |

**返回**：被略去的膜层，各附原因：文件没有定义的材料，或文件没有给出其材料折射率的相对厚度。

**拒绝**：

- **JavaScript**：无法读取的文件或既没有 MATE 记录也没有镀膜的文件、文件中没有的镀膜或不是膜层堆栈的镀膜、没有一层能换算的镀膜、设计编辑器不允许编辑的面、它不接受的选项，或选项不能取的值<br>**Python**：无法读取的文件或既没有 MATE 记录也没有镀膜的文件、文件中没有的镀膜或不是膜层堆栈的镀膜、没有一层能换算的镀膜、设计编辑器不允许编辑的面，或参数不能取的值

```js
const file = require('path').join(require('os').homedir(), `COATING-${Date.now()}.DAT`);
require('fs').writeFileSync(file, 'MATE TIO2\n0.4 2.35 0\n0.8 2.25 0\nMATE SIO2\n0.4 1.47 0\n0.8 1.45 0\nCOAT AR\nTIO2 0.25 0\nSIO2 0.25 0\n');
const design = tf.newDesign('AR');
console.log(design.importZemaxCoating(file));
for (const layer of design.layers) console.log(layer.material, layer.thickness.toFixed(2), 'nm');
```

```python
import time

name = "COATING-{}.DAT".format(time.time_ns())
with open(name, "w") as f:
    f.write("MATE TIO2\n0.4 2.35 0\n0.8 2.25 0\nMATE SIO2\n0.4 1.47 0\n0.8 1.45 0\nCOAT AR\nTIO2 0.25 0\nSIO2 0.25 0\n")
design = tf.new_design("AR")
print(design.import_zemax_coating(name))
for layer in design.layers:
    print(layer.material, round(layer.thickness, 2), "nm")
```

### importCodevCoating / import_codev_coating

| JavaScript | Python |
| ---------- | ------ |
| `design.importCodevCoating(path, { side })` | `design.import_codev_coating(path, side=...)` |

按 CODE V 镀膜窗口“导入 → 正面镀膜”和“导入 → 背面镀膜”的方式，把 CODE V 镀膜文件（.seq 或 .mul）中的膜层放到设计的一个面上：物理厚度单位 nm，代码为 100 的膜层锁定。文件从入射介质开始列出膜层，因此放到背面时顺序反转。该面原有的膜层被替换；介质和基底保持设计原有的，不采用文件中的 INC 和 SUB。材料以应用中导入时给出的 id 由设计携带，与 `importZemaxCoating()` / `import_zemax_coating()` 的方式相同。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `path` | `path` |  | **JavaScript**：文件，给出完整路径；名称以 .mul 结尾的按保存的 .mul 读取，其他按命令读取。相对路径按 `tf.openDesign()` 的方式解释。<br>**Python**：文件；名称以 .mul 结尾的按保存的 .mul 读取，其他按命令读取。相对路径按 tf.open_design() 的方式解释。 |
| `side` | `side` |  | **JavaScript**：`'front'` 或 `'back'`。不给出时为正面；仅背面镀膜的设计为背面。<br>**Python**："front" 或 "back"。不给出时为正面；仅背面镀膜的设计为背面。 |

**返回**：读取和换算时的提示，与 `tf.readCodevCoating()` / `tf.read_codev_coating()` 以及窗口的报告给出的相同。

**拒绝**：

- **JavaScript**：无法读取的文件，或没有输入读取器能读取的膜层堆栈的文件、设计编辑器不允许编辑的面、它不接受的选项，或选项不能取的值<br>**Python**：无法读取的文件，或没有输入读取器能读取的膜层堆栈的文件、设计编辑器不允许编辑的面，或参数不能取的值

```js
const file = require('path').join(require('os').homedir(), `ar-${Date.now()}.seq`);
require('fs').writeFileSync(file, "MUL\nMDA\nPHT Y\nTIT 'AR'\nWLG 400 700 50\nREF 550\nCOA 99.6 100 1.38\nCOA 59.8 0 2.3\nSUB 1.52\nEND\nMEX\n");
const design = tf.newDesign('AR');
console.log(design.importCodevCoating(file));
for (const layer of design.layers) console.log(layer.material, layer.thickness, 'nm', layer.locked ? 'locked' : '');
```

```python
import time

name = "ar-{}.seq".format(time.time_ns())
with open(name, "w") as f:
    f.write("MUL\nMDA\nPHT Y\nTIT 'AR'\nWLG 400 700 50\nREF 550\nCOA 99.6 100 1.38\nCOA 59.8 0 2.3\nSUB 1.52\nEND\nMEX\n")
design = tf.new_design("AR")
print(design.import_codev_coating(name))
for layer in design.layers:
    print(layer.material, layer.thickness, "nm", "locked" if layer.locked else "")
```

### inhomogeneities

| JavaScript | Python |
| ---------- | ------ |
| `design.inhomogeneities({ interlayers, start, end, step, angle, side })` | `design.inhomogeneities(interlayers=..., start=400, end=800, step=0.5, angle=0, side=...)` |

设计在其界面处带有渐变界面层时的光谱，与设计原样的光谱对比，计算方式与非均匀性窗口相同：每个界面层放在其界面处相接的两种材料之间，使镀膜增加其厚度，并被切成若干各有一个折射率的切片，第二种材料所占的比例沿其分布增加，n 和 k 按比例混合。计算对象由设计的 `sides` 和 `scoreOn` / `score_on` 决定，与光谱相同，除非给出 `side`；设有入射锥角的设计会在其锥角内取平均，与窗口相同。没有膜层的面没有界面，给出其裸表面的结果。

一个面的界面 k 是其第 k 层的顶面，膜层按 `layers` 的方式从基底起编号：0 为基底表面，有 N 层的面上 N 为与介质相接的表面。厚度为 0 nm 的层保留其编号和界面。正面的渐变从离基底较远的材料到较近的材料，背面从较近的到较远的，与窗口的渐变方式相同；线性或 S 形分布两个方向读起来相同。设计有规格时，`specification` 是放入界面层后对它的判定，与窗口图表下方的标记相同。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `interlayers` | `interlayers` | `[]` | **JavaScript**：每个界面层一行，每行为 `{ side, interface, thickness, profile, slices }`：`side` 为 `'front'` 或 `'back'`，默认为所计算的面，在只有一面镀膜的整个元件上为镀膜的那一面，在两面都镀膜的整个元件上每行都要给出；`interface` 从 0（基底表面）到该面的层数；`thickness` 单位 nm，不小于 0，不给出时为 5；`profile` 为 `'linear'`、`'parabolic'`、`'invParabolic'`、`'exponential'` 或 `'sigmoid'`，不给出时为 `'linear'`；`slices` 为整数，不小于 2，不给出时为 10。一个界面只能有一行。<br>**Python**：每个界面层一个 dict，含 side、interface、thickness、profile 和 slices：side 为 "front" 或 "back"，默认为所计算的面，在只有一面镀膜的整个元件上为镀膜的那一面，在两面都镀膜的整个元件上每行都要给出；interface 从 0（基底表面）到该面的层数；thickness 单位 nm，不小于 0，不给出时为 5；profile 为 "linear"、"parabolic"、"invParabolic"、"exponential" 或 "sigmoid"，不给出时为 "linear"；slices 为整数，不小于 2，不给出时为 10。一个界面只能有一行。不给出时，没有界面层。 |
| `start` | `start` | `400` | 起始波长，单位 nm。 |
| `end` | `end` | `800` | 终止波长，单位 nm，大于 `start`。 |
| `step` | `step` | `0.5` | 波长步长，单位 nm。 |
| `angle` | `angle` | `0` | 入射角，单位为度，在入射介质中计，从 0 起，小于 90。 |
| `side` | `side` |  | `'front'`、`'back'` 或 `'total'`（整个元件）。不给出时，使用设计的评价对象。 |

**返回**：一个 Inhomogeneities。

**拒绝**：

- 它不接受的选项、不构成范围的范围、0 到 90 以外的角度、它没有的面、超过一百万个波长、含它没有的字段的行、针对未计算的面的行，或在两面都镀膜的整个元件上未给出面的行、该面没有的界面或另一行已给出的界面、小于 0 的厚度、它没有的分布、不是不小于 2 的整数的切片数，或用到找不到对应材料的设计

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
const r = design.inhomogeneities({ interlayers: [{ interface: 4, thickness: 3, profile: 'sigmoid' }], start: 450, end: 650, step: 1 });
console.log(r.interlayers[0].materials.join(' to '), 'adds', r.addedThickness, 'nm; R at 550 nm', r.homogeneous.R.at(550).toFixed(5), 'becomes', r.graded.R.at(550).toFixed(5));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
r = design.inhomogeneities(interlayers=[{"interface": 4, "thickness": 3, "profile": "sigmoid"}],
                           start=450, end=650, step=1)
print(" to ".join(r.interlayers[0].materials), "adds", r.added_thickness, "nm; R at 550 nm",
      round(r.homogeneous.R.at(550), 5), "becomes", round(r.graded.R.at(550), 5))
```

### roughness

| JavaScript | Python |
| ---------- | ------ |
| `design.roughness({ sigma, range, interfaces, start, end, step, angle, side })` | `design.roughness(sigma=1, range="long", interfaces=..., start=400, end=800, step=0.5, angle=0, side=...)` |

设计带有粗糙界面时的镜面 R 与 T，与光滑设计对比，计算方式与粗糙度 / 散射窗口相同：每个粗糙界面变为一个厚 2σ 的过渡层，σ 为 RMS 粗糙度。小尺度是一个渐变层，其 n 和 k 从一种材料线性过渡到另一种材料，没有光损失；大尺度是一个单层，其消光系数代表散射出镜面光束的光，它针对正入射下的单个表面推导，因此在斜入射、入射锥角内或多层膜中只是估算。计算对象由设计的 `sides` 和 `scoreOn` / `score_on` 决定，与光谱相同，除非给出 `side`；设有入射锥角的设计会在其锥角内取平均，与窗口相同。

一个面的界面 k 是其第 k 层的顶面，膜层按 `layers` 的方式从基底起编号：0 为基底表面，有 N 层的面上 N 为与介质相接的表面。没有膜层时正面仍保留界面 0；没有膜层的背面没有界面。过渡层的厚度取自其界面下方的那一层，基底不被减薄；比 2σ 还薄的层被设为 0 nm，并列在 `thinned` 中。厚度为 0 nm 的层不在镀膜中：其顶面所设的 σ 不被使用，它下方的层与上方下一个存在的层在下方那一层的顶面界面相接。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `sigma` | `sigma` | `1` | 每个界面的 RMS 粗糙度，单位 nm，不小于 0。 |
| `range` | `range` | `'long'` | **JavaScript**：每个界面的粗糙度类型：`'short'`（小尺度）或 `'long'`（大尺度）。<br>**Python**：每个界面的粗糙度类型，"short"（小尺度）或 "long"（大尺度）。 |
| `interfaces` | `interfaces` | `[]` | **JavaScript**：与 `sigma` 和 `range` 不同的界面，每个一行，每行为 `{ side, interface, sigma, range }`，与逐界面编辑器的设置方式相同：`side` 为 `'front'` 或 `'back'`，默认为所计算的面，在只有一面镀膜的整个元件上为镀膜的那一面，在两面都镀膜的整个元件上每行都要给出；`interface` 从 0（基底表面）到该面的层数；`sigma` 和 `range` 同上，不给出时取调用本身的值。一个界面只能有一行。只让一个界面粗糙，就把 `sigma` 设为 0 并列出该界面。<br>**Python**：与 sigma 和 range 不同的界面，每个一个 dict，含 side、interface、sigma 和 range，与逐界面编辑器的设置方式相同：side 为 "front" 或 "back"，默认为所计算的面，在只有一面镀膜的整个元件上为镀膜的那一面，在两面都镀膜的整个元件上每行都要给出；interface 从 0（基底表面）到该面的层数；sigma 和 range 同上，不给出时取调用本身的值。一个界面只能有一行。只让一个界面粗糙，就设 sigma=0 并列出该界面。不给出时，没有这样的界面。 |
| `start` | `start` | `400` | 起始波长，单位 nm。 |
| `end` | `end` | `800` | 结束波长，单位 nm，大于 `start`。 |
| `step` | `step` | `0.5` | 波长步长，单位 nm。 |
| `angle` | `angle` | `0` | 入射角，单位为度，在入射介质中计，从 0 起，小于 90。 |
| `side` | `side` |  | `'front'`、`'back'` 或 `'total'`（整个元件）。不给出时，使用设计的评价对象。 |

**返回**：一个 Roughness。

**拒绝**：

- **JavaScript**：它不接受的选项、不构成范围的范围、0 到 90 以外的角度、它没有的面、超过一百万个波长、小于 0 的 σ 或不是 `'short'` 或 `'long'` 的类型、含它没有的字段的行、针对未计算的面的行，或在两面都镀膜的整个元件上未给出面的行、该面没有的界面或另一行已给出的界面，或用到找不到对应材料的设计<br>**Python**：它不接受的选项、不构成范围的范围、0 到 90 以外的角度、它没有的面、超过一百万个波长、小于 0 的 sigma 或不是 "short" 或 "long" 的 range、含它没有的字段的行、针对未计算的面的行，或在两面都镀膜的整个元件上未给出面的行、该面没有的界面或另一行已给出的界面，或用到找不到对应材料的设计

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
const r = design.roughness({ sigma: 0, interfaces: [{ interface: 9, sigma: 3 }], start: 400, end: 700, step: 1 });
console.log('R at 550 nm', r.smooth.R.at(550).toFixed(5), 'becomes', r.rough.R.at(550).toFixed(5), '; loss', (r.loss.at(550) * 1e6).toFixed(1), 'ppm');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
r = design.roughness(sigma=0, interfaces=[{"interface": 9, "sigma": 3}], start=400, end=700, step=1)
print("R at 550 nm", round(r.smooth.R.at(550), 5), "becomes", round(r.rough.R.at(550), 5), "; loss",
      round(r.loss.at(550) * 1e6, 1), "ppm")
```

### refine

| JavaScript | Python |
| ---------- | ------ |
| `await design.refine({ method, maxIter, nRestarts, perturbPct, seed, threads, progress, stop })` | `design.refine(method="dls", max_iter=..., n_restarts=..., perturb_pct=..., seed=..., threads=1, progress=..., stop=...)` |

按评价函数精炼膜层厚度，与精炼窗口的做法相同；不增加也不删除膜层。之后设计保存精炼后的膜层；运行被停止时，保留原来的膜层。被调整的膜层由设计的 `sides` 决定。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `method` | `method` | `'dls'` | 方法：API 参考中 refine 方法表里的一个 id，例如 `'dls'`、`'cg'` 或 `'de'`；`'all'` 表示依次运行每一个；或一个 id 列表，从同一起点逐个尝试，保留最好的结果。精炼窗口打开时使用 `'sqp'`，直到你在其中选择另一种方法。 |
| `maxIter` | `max_iter` |  | 单一方法运行最多可进行的迭代次数。不给出时，使用该方法自己的值。 |
| `nRestarts` | `n_restarts` | `20` | 多次启动方法的重启次数。 |
| `perturbPct` | `perturb_pct` | `30` | 多次启动方法在每次重启时对每个厚度的扰动幅度，单位 %。 |
| `seed` | `seed` |  | 使用随机抽样的方法所用的起始数，1 到 2^32 - 1 之间的整数；相同的种子、设计和设置会重复同样的运行。不给出时，使用一个新的种子，并在结果中给出。 |
| `threads` | `threads` | `1` | 多次启动和并行差分进化同时使用的工作线程数。 |
| `progress` | `progress` |  | **JavaScript**：一个函数，运行每次报告时以一个 Progress 调用它。它抛出的错误会结束运行，运行随即以该错误拒绝，设计保持原样。<br>**Python**：一个函数，运行每次报告时以一个 Progress 调用它。它引发的异常会停止运行，并继续向外传递。 |
| `stop` | `stop` |  | **JavaScript**：一个 AbortSignal；中止其 AbortController 会结束运行，设计保持原样。<br>**Python**：一个 tfstudio.Stop，调用其 stop() 会结束运行。 |

**返回**：**JavaScript**：一个 RunResult 的 promise。<br>**Python**：一个 RunResult。

**拒绝**：

- 没有评价函数的设计、运行不认识的方法或设置，或它无法接受的值
- Python 引发 `KeyboardInterrupt`：运行期间按下 Ctrl+C，在停止运行之后引发；设计保留原来的膜层

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
design.merit.add('RAV', 450, 650, { target: 0 });
const run = await design.refine({ method: 'dls', maxIter: 50, progress: p => console.log(p.iteration, p.merit) });
console.log(run.merit, run.stopReason);
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
design.merit.add("RAV", 450, 650, target=0)
run = design.refine(method="dls", max_iter=50, progress=lambda p: print(p.iteration, p.merit))
print(run.merit, run.stop_reason)
```

#### 方法

| 方法 | 名称 | 默认 `maxIter` | 接受 `seed` |
| --- | --- | ------------ | --------- |
| `sqp` | 序列二次规划 | 200 |  |
| `dls` | 阻尼最小二乘法 | 500 |  |
| `cg` | 共轭梯度法 | 600 |  |
| `newton` | 牛顿法 | 200 |  |
| `newton-cg` | 牛顿-CG 法 | 200 |  |
| `dls-multi` | DLS 多起点 | 500 | 是 |
| `de` | 差分进化 | 250 | 是 |
| `sa` | 模拟退火 | 400 | 是 |
| `all` | 依次运行 `cg`、`dls`、`newton`、`newton-cg`、`sqp`、`de`、`sa`、`dls-multi`，从同一起点开始，保留最好的结果 |  | 是 |

#### `run.stopReason` / `run.stop_reason`

结束的原因：`'target'`（评价函数低于 10^-6）、`'maxiter'`、`'stalled'`（评价函数不再下降）、`'best:<method>'`（方法列表，指出保留的那个方法）、`'restartsDone'`（DLS 多起点）、`'stopped'`、`'workerFailed'`、`'workerError'`、`'presampleFailed'`（无法对材料采样），或 `'invalidOperand'`（某行无法评估，带有 `message`）。

### synthesize

| JavaScript | Python |
| ---------- | ------ |
| `await design.synthesize(method, pool, { maxLayers, targetMF, refineIter, threads, seed, dMin, progress, stop })` | `design.synthesize(method, pool, max_layers=..., target_mf=..., refine_iter=..., threads=..., seed=..., d_min=..., progress=..., stop=...)` |

用一种合成方法按评价函数生长或重组设计，从材料池中插入材料，与该方法的窗口做法相同。之后设计保存运行的结果；运行被停止时，保留原来的膜层。每种方法的设置及其默认值列在 API 参考的 synthesize 下；未给出的设置取默认值。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `method` | `method` |  | `'needle'`、`'ge'`（渐进演化）或 `'structural'`。 |
| `pool` | `pool` |  | 运行可以插入的材料，按 id 指定，不得重复。 |
| `maxLayers` | `max_layers` |  | 设计最多可增长到的膜层数。 |
| `targetMF` | `target_mf` |  | 运行停止时的评价函数值。 |
| `refineIter` | `refine_iter` |  | 每次插入后的精炼步数。 |
| `threads` | `threads` |  | 作为一批一起精炼的候选数；结果与它有关。 |
| `seed` | `seed` |  | 结构优化：其随机抽样的起始数。 |
| `dMin` | `d_min` |  | 该方法的其他任何设置，例如 `dMin` / `d_min`。 |
| `progress` | `progress` |  | **JavaScript**：一个函数，运行每次报告时以一个 Progress 调用它。它抛出的错误会结束运行，运行随即以该错误拒绝，设计保持原样。<br>**Python**：一个函数，运行每次报告时以一个 Progress 调用它。它引发的异常会停止运行，并继续向外传递。 |
| `stop` | `stop` |  | **JavaScript**：一个 AbortSignal；中止其 AbortController 会结束运行，设计保持原样。<br>**Python**：一个 tfstudio.Stop，调用其 stop() 会结束运行。 |

**返回**：**JavaScript**：一个 RunResult 的 promise。<br>**Python**：一个 RunResult。

**拒绝**：

- 没有评价函数的设计、运行不认识的方法或设置、它无法接受的值，或材料池中找不到对应材料的材料 id
- Python 引发 `KeyboardInterrupt`：运行期间按下 Ctrl+C，在停止运行之后引发；设计保留原来的膜层

```js
const design = tf.newDesign('AR');
design.layers.append('SiO2', 100);
design.merit.add('RAV', 420, 680, { target: 0 });
const run = await design.synthesize('needle', ['TiO2', 'SiO2'], { maxLayers: 12 });
console.log(run.stopReason, design.layers.length, 'layers, merit', run.merit);
```

```python
design = tf.new_design("AR")
design.layers.append("SiO2", 100)
design.merit.add("RAV", 420, 680, target=0)
run = design.synthesize("needle", pool=["TiO2", "SiO2"], max_layers=12)
print(run.stop_reason, len(design.layers), "layers, merit", run.merit)
```

#### 方法

| 方法 | 窗口 | 页面 |
| --- | --- | --- |
| `needle` | 针法自动 | [针式变化](/zh/synthesis/needle/) |
| `ge` | 渐变演化 | [渐进演化（GE）](/zh/synthesis/gradual-evolution/) |
| `structural` | 结构优化器 | [结构优化器](/zh/synthesis/structural-optimizer/) |

#### `run.stopReason` / `run.stop_reason`

结束的原因。自然结束时：`'target'`（带有 `stopMF`，即达到目标时的评价函数）；`needle` 为 `'maxLayers'` 或 `'needleOptimal'`；`ge` 为 `'maxGeCycles'` 或 `'stuck'`（没有可走的步骤）；`structural` 为 `'maxIter'`、`'iterationCap'`、`'patience'`（带有 `patience`）、`'budget'`、`'layerCap'` 或 `'noMutation'`。否则为 `'stopped'`、`'workerError'`（带有 `message`），或运行无法开始的原因：`'workerFailed'`、`'noOperands'`、`'noMaterials'` 或 `'presampleFailed'`。

#### `needle` 的设置

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `maxLayers` | `max_layers` | `60` | 设计可增长到的最大层数。不小于 1 的整数。 |
| `targetMF` | `target_mf` | `0.0005` | 运行停止时的评价函数；Infinity 使运行在第一个被接受的代后停止。0 或更大的评价函数值，或 Infinity。 |
| `deltaNm` | `delta_nm` | `0.5` | 探测每个候选位置所用的厚度步长。大于 0 的厚度，单位 nm。 |
| `dMin` | `d_min` | `1` | 针式层插入时的最小厚度，也是精炼后的层被去掉的厚度阈值。大于 0 的厚度，单位 nm。 |
| `refineIter` | `refine_iter` | `60` | 每次插入后的精炼步数。不小于 1 的整数。 |
| `innerEngine` | `inner_engine` | `'trust-region'` | 每次插入后精炼堆栈所用的方法。cg、dls、newton、newton-cg、sqp、trust-region 之一。 |
| `candidateSearch` | `candidate_search` | `'balanced'` | 每一步在继续之前尝试多少个改进候选，在速度与质量之间权衡。fast、balanced、thorough 之一。 |
| `sensitivity` | `sensitivity` | `'off'` | 与同次扫描中最强的候选相比，候选可以弱到什么程度仍被尝试；off 尝试每一个。off、light、medium、aggressive 之一。 |
| `smartSeed` | `smart_seed` | `false` / `False` | 从设计以及用材料池构建的四分之一波长和半波长减反射设计中最好的一个开始，每个都先经过精炼。true 或 false。 |
| `threads` | `threads` |  | 一批一起精炼的候选数；结果取决于它。不给出时用应用为这台计算机推荐的线程数。不小于 1 的整数。 |

#### `ge` 的设置

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `maxLayers` | `max_layers` | `50` | 设计最多可以包含的层数；达到上限时运行会腾出一层，而不是停止。不小于 1 的整数。 |
| `maxGeCycles` | `max_ge_cycles` | `16` | 运行总共可以进行多少次强制步骤和腾出操作；deepSearch 取消这一限制。不小于 1 的整数。 |
| `targetMF` | `target_mf` | `0.0005` | 运行停止时的评价函数；Infinity 使运行在第一个被接受的步骤后停止。0 或更大的评价函数值，或 Infinity。 |
| `refineIter` | `refine_iter` | `30` | 每次候选插入所做的精炼，分两遍进行，第二遍的步数减半。不小于 1 的整数。 |
| `dMin` | `d_min` | `15` 或最严格的 `MNT` 行 | 层插入时的最小厚度，也是层被去掉的厚度阈值。大于 0 的厚度，单位 nm。 |
| `deepSearch` | `deep_search` | `false` / `False` | 没有可走的步骤时，从最佳设计出发、扰动其厚度后重新开始，直到达到目标评价函数或被停止。true 或 false。 |
| `innerEngine` | `inner_engine` | `'cg'` | 在步骤之间精炼堆栈所用的方法。cg、dls、newton、newton-cg、sqp、trust-region 之一。 |
| `candidateSearch` | `candidate_search` | `'balanced'` | 每一步在继续之前尝试多少个改进候选，在速度与质量之间权衡。fast、balanced、thorough 之一。 |
| `sensitivity` | `sensitivity` | `'off'` | 与同次扫描中最强的候选相比，候选可以弱到什么程度仍被尝试；off 尝试每一个。off、light、medium、aggressive 之一。 |
| `smartSeed` | `smart_seed` | `true` / `True` | 从设计以及用材料池构建的四分之一波长和半波长减反射设计中最好的一个开始，每个都先经过精炼。true 或 false。 |
| `seedMode` | `seed_mode` | `'preserve-bulk'` | 如何对待较厚的起始设计：`'refine'` 先精炼它，`'preserve-bulk'` 保留其主体结构，并在每次插入后温和地精炼。refine、preserve-bulk 之一。 |
| `consolidate` | `consolidate` | `true` / `True` | 结束时，去掉每个去掉后评价函数仍在 consolidateTol 范围内的层。true 或 false。 |
| `consolidateTol` | `consolidate_tol` | `0.05` | consolidate 去掉一层时评价函数允许上升的幅度，以评价函数自身的比例计。0 或更大的相对评价函数余量。 |
| `threads` | `threads` |  | 一批一起精炼的候选数；结果取决于它。不给出时用应用为这台计算机推荐的线程数。不小于 1 的整数。 |

#### `structural` 的设置

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `maxIter` | `max_iter` | `80` | 搜索运行的最多代数。不小于 1 的整数。 |
| `targetMF` | `target_mf` | `0.0005` | 搜索停止时的评价函数。0 或更大的评价函数值。 |
| `T0` | `t0` | `0.3` | 起始温度，以评价函数为单位；较高的值在初期接受更多上坡移动。0 或更大的温度。 |
| `jitterPct` | `jitter_pct` | `0.15` | `perturb` 变异移动一个厚度的幅度，以该厚度的比例计。0 或更大的比例。 |
| `refineIter` | `refine_iter` | `60` | 每个候选得到的精炼步数；0 表示按原样为每个候选评分。0 或更大的整数。 |
| `dMin` | `d_min` | `1` 或最严格的 `MNT` 行 | 层的最小厚度。大于 0 的厚度，单位 nm。 |
| `addMaxNm` | `add_max_nm` | `500` | 随机添加的层的最大起始厚度。大于 0 的厚度，单位 nm。 |
| `maxLayers` | `max_layers` | `80` | 设计可增长到的最大层数。不小于 1 的整数。 |
| `kinds` | `kinds` | `['add', 'remove', 'split', 'merge', 'perturb']` | 搜索可以使用的变异。由 add、remove、split、merge、perturb 中一个或多个组成的列表。 |
| `deepSearch` | `deep_search` | `false` / `False` | 一段时间内没有找到更好的设计时，从最佳设计重新开始，直到达到时间上限或被停止。true 或 false。 |
| `deepMaxMin` | `deep_max_min` | `0` | 开启 deepSearch 时，搜索在这段时间后结束。0 或更大的时间，单位分钟（0：不限）。 |
| `seed` | `seed` | `null` / `None` | 随机抽样开始所用的数值；相同的种子、设计、设置和 threads 会重复同一次运行。结果中会给出所用的种子。从 1 到 2^32 - 1 的整数，或 null 表示取一个新种子。 |
| `innerEngine` | `inner_engine` | `'cg'` | 精炼每个候选所用的方法。cg、dls、newton、newton-cg、sqp、trust-region 之一。 |
| `smartSeed` | `smart_seed` | `false` / `False` | 从设计以及用材料池构建的四分之一波长和半波长减反射设计中最好的一个开始，每个都先经过精炼。true 或 false。 |
| `threads` | `threads` |  | 每一代精炼的候选数；结果取决于它。不给出时用应用为这台计算机推荐的线程数。不小于 1 的整数。 |

### monteCarlo / monte_carlo

| JavaScript | Python |
| ---------- | ------ |
| `await design.monteCarlo(start, end, { runs, step, quantity, angle, polarization, thicknessRelPct, thicknessAbsNm, indexRe, indexIm, distribution, seed, progress, stop })` | `design.monte_carlo(start, end, runs=100, step=1, quantity="R", angle=0, polarization="avg", thickness_rel_pct=1, thickness_abs_nm=0, index_re=0, index_im=0, distribution="gaussian", seed=..., progress=..., stop=...)` |

对带有随机膜层误差的设计做蒙特卡洛试验，与蒙特卡洛窗口的做法相同：得到一个量在一段波长范围内的分散，计算对象由设计的 `sides` 和 `scoreOn` / `score_on` 决定。设计有规格时，还会统计满足规格的试验所占的比例。设计不会改变。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `start` | `start` |  | 起始波长，单位 nm。 |
| `end` | `end` |  | 结束波长，单位 nm，大于 `start`。 |
| `runs` | `runs` | `100` | 试验次数。 |
| `step` | `step` | `1` | 波长步长，单位 nm。 |
| `quantity` | `quantity` | `'R'` | `'R'`、`'T'` 或 `'A'`。 |
| `angle` | `angle` | `0` | 入射角，为入射介质中的度数。 |
| `polarization` | `polarization` | `'avg'` | `'avg'`、`'s'` 或 `'p'`。 |
| `thicknessRelPct` | `thickness_rel_pct` | `1` | 厚度误差，为每层厚度的百分比。 |
| `thicknessAbsNm` | `thickness_abs_nm` | `0` | 以 nm 计、加到每一层上的厚度误差。 |
| `indexRe` | `index_re` | `0` | n 的误差，为绝对量：使用 `'gaussian'` 时为一个标准差，使用 `'uniform'` 和 `'truncated'` 时为界限。 |
| `indexIm` | `index_im` | `0` | k 的误差，含义与 `indexRe` / `index_re` 对 n 的相同；k 不会小于 0。 |
| `distribution` | `distribution` | `'gaussian'` | `'gaussian'`、`'uniform'` 或 `'truncated'`（在三个标准差处截断）。 |
| `seed` | `seed` |  | 抽样的起始数，1 到 2^32 - 1 之间的整数；相同的种子和设置会重复同样的运行。不给出时，使用一个新的种子，并在结果中给出。 |
| `progress` | `progress` |  | **JavaScript**：一个函数，试验进行时以一个 Progress（`trial` 和 `total`）调用它。它抛出的错误会结束运行，运行随即以该错误拒绝。<br>**Python**：一个函数，试验进行时以一个 Progress（trial 和 total）调用它。它引发的异常会停止运行，并继续向外传递。 |
| `stop` | `stop` |  | **JavaScript**：一个 AbortSignal；中止其 AbortController 会结束运行，运行随即以已完成的试验返回结果。<br>**Python**：一个 tfstudio.Stop，调用其 stop() 会结束运行，运行随即以已完成的试验返回结果。 |

**返回**：**JavaScript**：一个 MonteCarlo 的 promise。<br>**Python**：一个 MonteCarlo。

**拒绝**：

- 在其评价面上没有可供试验改变的膜层的设计、它不接受的设置、超出范围的值，或用到找不到对应材料的设计
- Python 引发 `KeyboardInterrupt`：运行期间按下 Ctrl+C，在停止运行之后引发

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
const mc = await design.monteCarlo(400, 700, { runs: 50, step: 5, thicknessRelPct: 2, seed: 1 });
console.log('Largest spread of R:', Math.max(...mc.stdev));
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
mc = design.monte_carlo(400, 700, runs=50, step=5, thickness_rel_pct=2, seed=1)
print("Largest spread of R:", max(mc.stdev))
```

### layerSensitivity / layer_sensitivity

| JavaScript | Python |
| ---------- | ------ |
| `design.layerSensitivity({ step, deltaNm, relPct, includeLocked })` | `design.layer_sensitivity(step="nm", delta_nm=1, rel_pct=1, include_locked=False)` |

每层厚度偏离时评价函数值的变化量，与层灵敏度窗口对膜层的排序相同：每层分别加厚和减薄一个步长，评价函数值的平均变化就是它的得分。这里的评价函数不含 MNT 和 MXT 行。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `step` | `step` | `'nm'` | 步长的给法：`'nm'`，每层都用 `deltaNm` / `delta_nm`；或 `'percent'`，每层厚度的 `relPct` / `rel_pct` %。 |
| `deltaNm` | `delta_nm` | `1` | 步长，单位 nm，用于 step 为 `'nm'` 时。 |
| `relPct` | `rel_pct` | `1` | 步长，为每层厚度的百分比，用于 step 为 `'percent'` 时。 |
| `includeLocked` | `include_locked` | `false` / `False` | 为 `true` / `True` 时，锁定的膜层也参与评分。 |

**返回**：一个 LayerSensitivity。

**拒绝**：

- 没有评价函数的设计、`'nm'` 和 `'percent'` 以外的 step，或设置无法接受的值

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
design.merit.add('RAV', 450, 650, { target: 0 });
for (const row of design.layerSensitivity({ deltaNm: 2 }).rows) console.log(row.side, row.number, row.material, row.sensitivity);
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
design.merit.add("RAV", 450, 650, target=0)
for row in design.layer_sensitivity(delta_nm=2).rows:
    print(row.side, row.number, row.material, row.sensitivity)
```

### copy

| JavaScript | Python |
| ---------- | ------ |
| `design.copy()` | `design.copy()` |

设计的一份副本，与原设计各自独立变化。

**返回**：一个 Design。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
design.merit.add('RAV', 450, 650, { target: 0 });
const before = design.copy();
await design.refine({ method: 'dls', maxIter: 20 });
console.log('Merit', before.merit.value, 'before,', design.merit.value, 'after');
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
design.merit.add("RAV", 450, 650, target=0)
before = design.copy()
design.refine(method="dls", max_iter=20)
print("Merit", before.merit.value, "before,", design.merit.value, "after")
```

### save

| JavaScript | Python |
| ---------- | ------ |
| `design.save(path, { overwrite })` | `design.save(path, overwrite=False)` |

按 TFStudio 的保存方式把设计写入 .tfs 文件，设计用到的非内置材料一并保存在文件中。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `path` | `path` |  | **JavaScript**：要写入的文件，使用完整路径。相对路径以程序启动时所在的文件夹为基准：在脚本控制台中，是启动 TFStudio 时所在的文件夹，通常是其安装文件夹。<br>**Python**：要写入的文件。相对路径以程序的工作文件夹为基准：在脚本控制台中，是脚本所在的文件夹；未保存的脚本则是数据文件夹。 |
| `overwrite` | `overwrite` | `false` / `False` | 为 `true` / `True` 时，覆盖已存在的文件。 |

**拒绝**：

- **JavaScript**：已存在的文件（未给出 `overwrite: true` 时）<br>**Python**：已存在的文件（未给出 overwrite=True 时）

```js
const file = require('path').join(require('os').homedir(), `mirror-${Date.now()}.tfs`);
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
design.save(file);
console.log('Saved', file);
```

```python
import time

name = "mirror-{}.tfs".format(time.time_ns())
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
design.save(name)
print("Saved", name)
```

### push

| JavaScript | Python |
| ---------- | ------ |
| JavaScript 中没有：脚本结束时，控制台会应用 `tf.design`。 | `design.push()` |

把设计写回 TFStudio 应用中它被读取时的那个设计，作为应用可以撤销的一步。只有来自 tf.app.open_design() 的设计才有对应的设计；再次修改后可以再次 push。

**拒绝**：

- 不是从应用中读取的设计
- Python 引发 `AppError`：应用拒绝：设计在被读取或上次 push 之后已改变时，代码为 "edited"；它已不是打开的设计时为 "switched"；应用已关闭或没有为本程序等待连接时为 "off"

```python
import tfstudio

with tfstudio.TFStudio(live=True) as tf:
    design = tf.app.open_design()
    design.layers[1].thickness += 5
    design.push()
    print("Pushed", design.name)
```

## Substrate

设计的基底：其材料和厚度。设置其中任何一项都会改变设计。

```js
const design = tf.newDesign('Bare SiO2');
design.substrate.material = 'SiO2';
design.substrate.thickness = 3;
console.log(design.substrate.material, design.substrate.thickness, 'mm');
```

```python
design = tf.new_design("Bare SiO2")
design.substrate.material = "SiO2"
design.substrate.thickness = 3
print(design.substrate.material, design.substrate.thickness, "mm")
```

### material

| JavaScript | Python |
| ---------- | ------ |
| `design.substrate.material` | `design.substrate.material` |
| `design.substrate.material = value` | `design.substrate.material = value` |

基底的材料，按 id 指定。

**拒绝**：

- 找不到对应材料的材料 id

```js
const design = tf.newDesign('Bare SiO2');
design.substrate.material = 'SiO2';
console.log(design.substrate.material);
```

```python
design = tf.new_design("Bare SiO2")
design.substrate.material = "SiO2"
print(design.substrate.material)
```

### thickness

| JavaScript | Python |
| ---------- | ------ |
| `design.substrate.thickness` | `design.substrate.thickness` |
| `design.substrate.thickness = value` | `design.substrate.thickness = value` |

基底的厚度，单位 mm。

**拒绝**：

- 小于等于 0 的厚度

```js
const design = tf.newDesign('Bare BK7');
design.substrate.thickness = 3;
console.log(design.substrate.thickness, 'mm');
```

```python
design = tf.new_design("Bare BK7")
design.substrate.thickness = 3
print(design.substrate.thickness, "mm")
```

## Layers

**JavaScript**：设计某一面的膜层，编号方式与设计编辑器相同：1 紧邻基底。`layers[n]` 是第 n 层，`layers.length` 是层数，for...of 循环从第 1 层向外进行。这些方法会改变设计。

**Python**：设计某一面的膜层，编号方式与设计编辑器相同：1 紧邻基底。`layers[n]` 是第 n 层，`len(layers)` 是层数，for 循环从第 1 层向外进行。这些方法会改变设计。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
design.layers.append('MgF2', 95);
for (const layer of design.layers) console.log(layer.number, layer.material, layer.thickness);
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
design.layers.append("MgF2", 95)
for layer in design.layers:
    print(layer.number, layer.material, layer.thickness)
```

### length / len()

| JavaScript | Python |
| ---------- | ------ |
| `design.layers.length` | `len(design.layers)` |

这一面的膜层数。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
console.log(design.layers.length, 'layers on the front');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
print(len(design.layers), "layers on the front")
```

### for...of / for

| JavaScript | Python |
| ---------- | ------ |
| `for (const layer of design.layers)` | `for layer in design.layers:` |

从紧邻基底的第 1 层向外的各层，每个都是一个 Layer。循环开始时这一面有哪些膜层，就遍历哪些膜层。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
for (const layer of design.layers) console.log(layer.number, layer.material, layer.thickness);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
for layer in design.layers:
    print(layer.number, layer.material, layer.thickness)
```

### append

| JavaScript | Python |
| ---------- | ------ |
| `design.layers.append(material, thickness, { locked })` | `design.layers.append(material, thickness, locked=False)` |

在其他膜层外侧添加一层，成为新的最外层。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `material` | `material` |  | 该层的材料，按 id 指定。 |
| `thickness` | `thickness` |  | 该层的物理厚度，单位 nm。 |
| `locked` | `locked` | `false` / `False` | 为 `true` / `True` 时锁定该层，精炼和合成会保持它不变。 |

**拒绝**：

- 找不到对应材料的材料 id、小于等于 0 的厚度，或设计不允许编辑的一面，例如对称设计的背面

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
design.layers.append('MgF2', 95);
console.log(design.layers.length, 'layers, the outermost', design.layers[design.layers.length].material);
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
design.layers.append("MgF2", 95)
print(len(design.layers), "layers, the outermost", design.layers[len(design.layers)].material)
```

### insert

| JavaScript | Python |
| ---------- | ------ |
| `design.layers.insert(number, material, thickness, { locked })` | `design.layers.insert(number, material, thickness, locked=False)` |

添加一层，成为第 `number` 层；从该编号向外的各层依次向外移动一位。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `number` | `number` |  | 新层的编号，从紧邻基底的 1 到这一面层数加一，后者表示加在最外侧。 |
| `material` | `material` |  | 该层的材料，按 id 指定。 |
| `thickness` | `thickness` |  | 该层的物理厚度，单位 nm。 |
| `locked` | `locked` | `false` / `False` | 为 `true` / `True` 时锁定该层。 |

**拒绝**：

- 超出 1 到层数加一范围的编号、找不到对应材料的材料 id、小于等于 0 的厚度，或设计不允许编辑的一面

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
design.layers.insert(1, 'Al2O3', 20);
console.log(design.layers[1].material, 'is now on the substrate');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
design.layers.insert(1, "Al2O3", 20)
print(design.layers[1].material, "is now on the substrate")
```

### remove

| JavaScript | Python |
| ---------- | ------ |
| `design.layers.remove(number)` | `design.layers.remove(number)` |

删除第 `number` 层；它外侧的各层依次向内移动一位。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `number` | `number` |  | 该层的编号，1 紧邻基底。 |

**拒绝**：

- 这一面没有对应膜层的编号，或设计不允许编辑的一面

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
design.layers.remove(design.layers.length);
console.log(design.layers.length, 'layers');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
design.layers.remove(len(design.layers))
print(len(design.layers), "layers")
```

### flip

| JavaScript | Python |
| ---------- | ------ |
| `design.layers.flip()` | `design.layers.flip()` |

按设计编辑器中“反转”按钮的方式，把这一面的膜层顺序在基底上颠倒：第 1 层变为最外层。对称设计的背面跟随翻转后的正面。

**拒绝**：

- 设计不允许编辑的一面，例如对称设计的背面

```js
const design = tf.newDesign('Graded');
design.stack('H 2L M');
design.layers.flip();
console.log(design.layers[1].material, 'is now on the substrate');
```

```python
design = tf.new_design("Graded")
design.stack("H 2L M")
design.layers.flip()
print(design.layers[1].material, "is now on the substrate")
```

### [n]

| JavaScript | Python |
| ---------- | ------ |
| `design.layers[number]` | `design.layers[number]` |

第 `number` 层，一个 Layer：1 紧邻基底。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `number` | `number` |  | 该层的编号，从 1 到这一面的层数。 |

**返回**：一个 Layer。

**拒绝**：

- 这一面没有对应膜层的编号

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
console.log(design.layers[1], design.layers[design.layers.length]);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
print(design.layers[1], design.layers[len(design.layers)])
```

## Layer

设计中的一层，按它在其所在面的编号指定：1 紧邻基底。读取属性时读取的是设计当时的状态，设置属性会改变设计，与在设计编辑器中编辑相同。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
const layer = design.layers[1];
layer.thickness += 5;
console.log(layer.number, layer.material, layer.thickness, layer.locked);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
layer = design.layers[1]
layer.thickness += 5
print(layer.number, layer.material, layer.thickness, layer.locked)
```

### number

| JavaScript | Python |
| ---------- | ------ |
| `design.layers[n].number` | `design.layers[n].number` |

该层在其所在面的编号，1 紧邻基底。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
for (const layer of design.layers) console.log(layer.number, layer.material);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
for layer in design.layers:
    print(layer.number, layer.material)
```

### side

| JavaScript | Python |
| ---------- | ------ |
| `design.layers[n].side` | `design.layers[n].side` |

该层所在的面，`'front'` 或 `'back'`。

```js
const design = tf.newDesign('Two-sided AR');
design.sides = 'both';
design.backLayers.append('MgF2', 100);
console.log(design.backLayers[1].side);
```

```python
design = tf.new_design("Two-sided AR")
design.sides = "both"
design.back_layers.append("MgF2", 100)
print(design.back_layers[1].side)
```

### material

| JavaScript | Python |
| ---------- | ------ |
| `design.layers[n].material` | `design.layers[n].material` |
| `design.layers[n].material = value` | `design.layers[n].material = value` |

该层的材料，按 id 指定；设置它即可更换材料。

**拒绝**：

- 找不到对应材料的材料 id，或设计不允许编辑的一面

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
design.layers[1].material = 'Ta2O5';
console.log(design.layers[1].material);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
design.layers[1].material = "Ta2O5"
print(design.layers[1].material)
```

### thickness

| JavaScript | Python |
| ---------- | ------ |
| `design.layers[n].thickness` | `design.layers[n].thickness` |
| `design.layers[n].thickness = value` | `design.layers[n].thickness = value` |

该层的物理厚度，单位 nm；设置它即可改变厚度。

**拒绝**：

- 小于等于 0 的厚度，或设计不允许编辑的一面

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
design.layers[1].thickness = 12.5;
console.log(design.layers[1].thickness, 'nm');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
design.layers[1].thickness = 12.5
print(design.layers[1].thickness, "nm")
```

### qwot

| JavaScript | Python |
| ---------- | ------ |
| `design.layers[n].qwot` | `design.layers[n].qwot` |
| `design.layers[n].qwot = value` | `design.layers[n].qwot = value` |

该层的四分之一波长光学厚度 4 n d / λ0，其中 n 为其材料在设计参考波长 λ0 处的折射率，与设计编辑器 QW 列的显示相同；找不到其材料、或其材料在该处 n 小于等于 0 的膜层没有四分之一波，此时为 `null` / `None`。设置它即可改变厚度，按 QW 列换算输入数值的方式换算为 nm。锁定的膜层也会改变：锁定只在精炼和合成中保持膜层不变。

**拒绝**：

- 小于等于 0 的值、没有四分之一波的膜层，或设计不允许编辑的面

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
design.layers[1].qwot = 2;
console.log(design.layers[1].qwot, 'quarter waves,', design.layers[1].thickness, 'nm');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
design.layers[1].qwot = 2
print(design.layers[1].qwot, "quarter waves,", design.layers[1].thickness, "nm")
```

### locked

| JavaScript | Python |
| ---------- | ------ |
| `design.layers[n].locked` | `design.layers[n].locked` |
| `design.layers[n].locked = value` | `design.layers[n].locked = value` |

锁定的膜层为 `true` / `True`，精炼和合成会保持它不变；设置它即可锁定或解锁该层。

**拒绝**：

- `true` / `True` 和 `false` / `False` 以外的值，或设计不允许编辑的一面

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
design.layers[1].locked = true;
console.log(design.layers[1].locked);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
design.layers[1].locked = True
print(design.layers[1].locked)
```

## Merit

设计的评价函数，内容与评价函数编辑器相同：按顺序排列的行，每一行是操作数参考中的一个操作数，以及这些行合计得到的评价函数值。读取 `value`、`opticalValue` / `optical_value` 或 `rows` 时，按设计当时的状态计算。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
design.merit.add('RAV', 420, 680, { target: 0 });
design.merit.add('MNT', 1, design.layers.length, { target: 10 });
console.log(design.merit.value);
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
design.merit.add("RAV", 420, 680, target=0)
design.merit.add("MNT", 1, len(design.layers), target=10)
print(design.merit.value)
```

### add

| JavaScript | Python |
| ---------- | ------ |
| `design.merit.add(type, start, end, { target, weight, aoi, pol, targetEnd, cmp, flag, enabled, comment, id, refId, refId1, refId2 })` | `design.merit.add(type, start=..., end=..., target=..., weight=1, aoi=0, pol="avg", target_end=..., cmp=..., flag=..., enabled=True, comment=..., id=..., ref_id=..., ref_id1=..., ref_id2=...)` |

在评价函数末尾添加一行，做法与评价函数编辑器相同：未给出的字段取在编辑器中新加一行时的初始值。`start` 和 `end` 可以省略。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `type` | `type` |  | 操作数，例如 `'RAV'`、`'TAV'` 或 `'MNT'`；操作数参考说明每个操作数计算什么、读取哪些字段。 |
| `start` | `start` |  | 波长，或波段的起始波长，单位 nm；对 MNT 和 MXT 为起始层，从基底开始编号。 |
| `end` | `end` |  | 波段的结束波长，单位 nm；对 MNT 和 MXT 为结束层。两者都不给出时，MNT 和 MXT 覆盖第 1 到第 1000 层，因此合成新增的膜层也包括在内。 |
| `target` | `target` |  | 该行要趋近的值，或其界限：R、T 和 A 用 0 到 1 之间的小数表示（编辑器中显示为百分比），MNT 和 MXT 为以 nm 计的厚度。不给出时，使用编辑器为该操作数设定的值。 |
| `weight` | `weight` | `1` | 该行所占的分量，大于等于 0。 |
| `aoi` | `aoi` | `0` | 入射角，为入射介质中的度数。 |
| `pol` | `pol` | `'avg'` | `'avg'`、`'s'` 或 `'p'`。 |
| `targetEnd` | `target_end` |  | 倾斜目标在 `end` 处的目标值，该目标从 `start` 处的 `target` 开始倾斜；平直目标为 `null` / `None`。 |
| `cmp` | `cmp` |  | 用于 TT 和 STR 的比较方式：`'eq'`、`'le'` 或 `'ge'`。 |
| `flag` | `flag` |  | 编辑器中的 Flag 列，一个整数；操作数参考说明它在每种行上的作用。 |
| `enabled` | `enabled` | `true` / `True` | 为 `false` / `False` 时，该行不计入评价函数。 |
| `comment` | `comment` |  | BLNK 行的文本。 |
| `id` | `id` |  | 该行的名称，数学行在 `refId` / `ref_id`、`refId1` / `ref_id1` 或 `refId2` / `ref_id2` 中写出它来读取该行。不给出时，使用一个新的 id，与在编辑器中添加的行相同。 |
| `refId` | `ref_id` |  | 对读取一行的数学行，为那一行的 id。 |
| `refId1` | `ref_id1` |  | 对读取两行的数学行，为第一行的 id。 |
| `refId2` | `ref_id2` |  | 对读取两行的数学行，为第二行的 id。 |

**拒绝**：

- 此版本无法计算的类型、任何行都没有的字段、字段无法接受的值，或在读取波段或膜层范围的行上 `start` 大于 `end`
- **JavaScript**：选项对象之前除 `start` 和 `end` 外还有其他值，或在选项中给出行的类型、`start` 或 `end`<br>**Python**：在关键字参数中给出行的 `start` 或 `end`

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
design.merit.add('RAV', 450, 650, { target: 0 });
design.merit.add('TAV', 800, 900, { target: 0.95, weight: 2, aoi: 45, pol: 'p' });
design.merit.add('MNT', { target: 10 });
console.log(design.merit.length, 'rows, merit', design.merit.value);
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
design.merit.add("RAV", 450, 650, target=0)
design.merit.add("TAV", 800, 900, target=0.95, weight=2, aoi=45, pol="p")
design.merit.add("MNT", target=10)
print(len(design.merit), "rows, merit", design.merit.value)
```

此版本可计算的类型，按[操作数参考](/zh/design/operands/)的分组列出：

| 类别 | 类型 |
| --- | --- |
| 单波长 | `T`、`R`、`A`、`TDB` |
| 波段平均 | `TAV`、`RAV`、`AAV` |
| 光谱目标 | `TGT`、`RGT`、`AGT` |
| 曲线 | `MCURVE`、`PPEF` |
| 加权积分 | `TIW`、`RIW`、`AIW` |
| 波段内的最坏情况 | `TMN`、`RMN`、`AMN`、`TMX`、`RMX`、`AMX`、`TDBMN`、`TDBMX`、`RDBMX`、`ODMN` |
| 椭偏 | `PSI`、`DEL`、`TANPSI`、`COSDEL` |
| 相位与色散 | `PR`、`PT`、`DPR`、`DPT`、`GD`、`GDT`、`GDD`、`GDDT`、`TOD`、`TODT`、`GDFLAT`、`GDTFLAT`、`GDDFLAT`、`GDDTFLAT`、`TODFLAT`、`TODTFLAT` |
| 电场 | `EFMX` |
| 对其他行的数学运算 | `OPGT`、`OPLT`、`OPVA`、`ABSO`、`ABGT`、`ABLT`、`DIFF`、`SUMM`、`PROD` |
| 峰或谷的波长 | `MXWT`、`MXWR`、`MXWA`、`MNWT`、`MNWR`、`MNWA` |
| 厚度与应力 | `TT`、`STR`、`MNT`、`MXT` |
| 表格控制 | `BLNK` |

### clear

| JavaScript | Python |
| ---------- | ------ |
| `design.merit.clear()` | `design.merit.clear()` |

删除评价函数中的所有行。

```js
const design = tf.newDesign('Bare BK7');
design.merit.add('RAV', 450, 650, { target: 0 });
design.merit.clear();
console.log(design.merit.length, 'rows');
```

```python
design = tf.new_design("Bare BK7")
design.merit.add("RAV", 450, 650, target=0)
design.merit.clear()
print(len(design.merit), "rows")
```

### rows

| JavaScript | Python |
| ---------- | ------ |
| `design.merit.rows` | `design.merit.rows` |

各行，每一行都是一个 MeritRow，带有它对设计当前状态的值。

**拒绝**：

- 用到找不到对应材料的设计

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
design.merit.add('RAV', 450, 650, { target: 0 });
design.merit.add('MNT', { target: 10 });
for (const row of design.merit.rows) console.log(row.type, row.value);
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
design.merit.add("RAV", 450, 650, target=0)
design.merit.add("MNT", target=10)
for row in design.merit.rows:
    print(row.type, row.value)
```

### value

| JavaScript | Python |
| ---------- | ------ |
| `design.merit.value` | `design.merit.value` |

设计当前的评价函数值，与评价函数编辑器显示的相同；有行无法计算时为 `null` / `None`。

**拒绝**：

- 用到找不到对应材料的设计

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
design.merit.add('RAV', 450, 650, { target: 0 });
console.log(design.merit.value);
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
design.merit.add("RAV", 450, 650, target=0)
print(design.merit.value)
```

### opticalValue / optical_value

| JavaScript | Python |
| ---------- | ------ |
| `design.merit.opticalValue` | `design.merit.optical_value` |

不含制造相关行 MNT、MXT、TT 和 STR 的评价函数值；有行无法计算时为 `null` / `None`。

**拒绝**：

- 用到找不到对应材料的设计

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
design.merit.add('RAV', 450, 650, { target: 0 });
design.merit.add('MNT', { target: 100 });
console.log(design.merit.value, design.merit.opticalValue);
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
design.merit.add("RAV", 450, 650, target=0)
design.merit.add("MNT", target=100)
print(design.merit.value, design.merit.optical_value)
```

### length / len()

| JavaScript | Python |
| ---------- | ------ |
| `design.merit.length` | `len(design.merit)` |

评价函数的行数。

```js
const design = tf.newDesign('Bare BK7');
design.merit.add('RAV', 450, 650, { target: 0 });
console.log(design.merit.length, 'row');
```

```python
design = tf.new_design("Bare BK7")
design.merit.add("RAV", 450, 650, target=0)
print(len(design.merit), "row")
```

## MeritRow

设计评价函数中的一行，带有读取 design.merit.rows 时它对设计的值。该行不读取的字段为 `null` / `None`。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
design.merit.add('RAV', 450, 650, { target: 0 });
for (const row of design.merit.rows) console.log(row.type, row.start, row.end, row.value, row.target);
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
design.merit.add("RAV", 450, 650, target=0)
for row in design.merit.rows:
    print(row.type, row.start, row.end, row.value, row.target)
```

### type

| JavaScript | Python |
| ---------- | ------ |
| `row.type` | `row.type` |

操作数，例如 `'RAV'` 或 `'MNT'`。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
design.merit.add('RAV', 450, 650, { target: 0 });
console.log(design.merit.rows[0].type);
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
design.merit.add("RAV", 450, 650, target=0)
print(design.merit.rows[0].type)
```

### start

| JavaScript | Python |
| ---------- | ------ |
| `row.start` | `row.start` |

该行的波长，或其波段的起始波长，单位 nm；对 MNT 和 MXT 为起始层。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
design.merit.add('RAV', 450, 650, { target: 0 });
console.log(design.merit.rows[0].start);
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
design.merit.add("RAV", 450, 650, target=0)
print(design.merit.rows[0].start)
```

### end

| JavaScript | Python |
| ---------- | ------ |
| `row.end` | `row.end` |

该行波段的结束波长，单位 nm；对 MNT 和 MXT 为结束层。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
design.merit.add('RAV', 450, 650, { target: 0 });
console.log(design.merit.rows[0].end);
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
design.merit.add("RAV", 450, 650, target=0)
print(design.merit.rows[0].end)
```

### aoi

| JavaScript | Python |
| ---------- | ------ |
| `row.aoi` | `row.aoi` |

入射角，为入射介质中的度数。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
design.merit.add('RAV', 450, 650, { target: 0, aoi: 45 });
console.log(design.merit.rows[0].aoi);
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
design.merit.add("RAV", 450, 650, target=0, aoi=45)
print(design.merit.rows[0].aoi)
```

### pol

| JavaScript | Python |
| ---------- | ------ |
| `row.pol` | `row.pol` |

该行评价所用的偏振，`'avg'`、`'s'` 或 `'p'`；同时按两种偏振评价的行（例如 PSI）为 `null` / `None`。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
design.merit.add('RAV', 450, 650, { target: 0, aoi: 45, pol: 's' });
console.log(design.merit.rows[0].pol);
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
design.merit.add("RAV", 450, 650, target=0, aoi=45, pol="s")
print(design.merit.rows[0].pol)
```

### cmp

| JavaScript | Python |
| ---------- | ------ |
| `row.cmp` | `row.cmp` |

用于 TT 和 STR 的比较方式：`'eq'`、`'le'` 或 `'ge'`。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
design.merit.add('TT', { target: 2000, cmp: 'le' });
console.log(design.merit.rows[0].cmp);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
design.merit.add("TT", target=2000, cmp="le")
print(design.merit.rows[0].cmp)
```

### target

| JavaScript | Python |
| ---------- | ------ |
| `row.target` | `row.target` |

该行要趋近的值，或其界限：R、T 和 A 用 0 到 1 之间的小数表示，MNT 和 MXT 为以 nm 计的厚度。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
design.merit.add('RAV', 520, 580, { target: 0.99 });
console.log(design.merit.rows[0].target);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
design.merit.add("RAV", 520, 580, target=0.99)
print(design.merit.rows[0].target)
```

### weight

| JavaScript | Python |
| ---------- | ------ |
| `row.weight` | `row.weight` |

该行所占的分量。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
design.merit.add('RAV', 450, 650, { target: 0, weight: 2 });
console.log(design.merit.rows[0].weight);
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
design.merit.add("RAV", 450, 650, target=0, weight=2)
print(design.merit.rows[0].weight)
```

### enabled

| JavaScript | Python |
| ---------- | ------ |
| `row.enabled` | `row.enabled` |

不计入评价函数的行为 `false` / `False`。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
design.merit.add('RAV', 450, 650, { target: 0, enabled: false });
console.log(design.merit.rows[0].enabled);
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
design.merit.add("RAV", 450, 650, target=0, enabled=False)
print(design.merit.rows[0].enabled)
```

### value

| JavaScript | Python |
| ---------- | ------ |
| `row.value` | `row.value` |

该行对设计的值；无法计算的行为 NaN。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
design.merit.add('RAV', 450, 650, { target: 0 });
const row = design.merit.rows[0];
console.log(row.value - row.target);
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
design.merit.add("RAV", 450, 650, target=0)
row = design.merit.rows[0]
print(row.value - row.target)
```

### error

| JavaScript | Python |
| ---------- | ------ |
| `row.error` | `row.error` |

该行无法计算的原因，或 `null` / `None`。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
design.merit.add('RAV', 450, 650, { target: 0 });
for (const row of design.merit.rows) console.log(row.type, row.error ?? 'evaluated');
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
design.merit.add("RAV", 450, 650, target=0)
for row in design.merit.rows:
    print(row.type, row.error or "evaluated")
```

## Specification

设计的规格，内容与规格说明窗口相同：按顺序排列、判定通过或不通过的检查，每一项都是对设计的一个要求，例如某个波段上 R 不低于 0.99，或不超过 30 层。check() 按该窗口的方式判定设计是否满足它们，`estimateYield()` / `estimate_yield()` 统计满足它们的蒙特卡洛试验所占的比例。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^5 H');
design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.97 });
design.specification.add('LAYER_COUNT', { cmp: 'le', target: 15 });
const report = design.specification.check();
console.log(report.passed, report.rows.map(row => row.margin));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^5 H")
design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.97)
design.specification.add("LAYER_COUNT", cmp="le", target=15)
report = design.specification.check()
print(report.passed, [row.margin for row in report.rows])
```

### add

| JavaScript | Python |
| ---------- | ------ |
| `design.specification.add(kind, start, end, { cmp, target, tol, lo, hi, aoi, pol, channel, direction, level, edgeSide, flag, side, presetKey, presetLabel, source, detector, bandPoints, curveId, label, enabled })` | `design.specification.add(kind, start=..., end=..., cmp="ge", target=0.99, tol=..., lo=0.95, hi=1, aoi=0, pol="avg", channel="T", direction="max", level=0.5, edge_side=..., flag=..., side=..., preset_key="", preset_label="", source=..., detector=..., band_points=..., curve_id=..., label="", enabled=True)` |

在规格末尾添加一项检查，做法与规格说明窗口添加一行相同：未给出的字段取在窗口中新加一行时的初始值，未给出面的厚度预算或层数累加设计所镀的面。波长随种类而定：单波长检查取一个，`start`；波段检查取 `start` 和 `end`；THICKNESS_BUDGET、LAYER_COUNT 和 PPEF 不取波长。给出预设的 INTEGRAL 检查从预设取得波段，因此可以省略其 `start` 和 `end`。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `kind` | `kind` |  | 检查的内容：`'T_AT'`、`'R_AT'` 或 `'A_AT'`，在单个波长处；`'T_AVG'`、`'R_AVG'` 或 `'A_AVG'`，波段上的平均值；`'MIN_MAX'`，波段上的最小值或最大值；`'INTEGRAL'`，加权平均值，例如 Tvis；`'CENTRAL_LAMBDA'`，波段中峰或谷的波长；`'FWHM'`，峰在 `level` 处的宽度；`'EDGE_LAMBDA'`，曲线穿过峰值的 `level` 处的波长；`'THICKNESS_BUDGET'`，总厚度；`'LAYER_COUNT'`，层数；`'PPEF'`，相对实测曲线的峰峰误差。 |
| `start` | `start` |  | 单波长检查的波长，或波段的起始波长，单位 nm。不给出时，单波长为 550 nm，波段为 400 nm。 |
| `end` | `end` |  | 波段的结束波长，单位 nm，不小于 `start`。不给出时为 700 nm。 |
| `cmp` | `cmp` | `'ge'` | 比较方式：`'ge'` 或 `'le'`，与 `target` 比较；`'eq'`，在 `target` 加减 `tol` 之内；或 `'between'`，在 `lo` 到 `hi` 之间。 |
| `target` | `target` | `0.99` | 界限，使用该检查的单位：T、R 和 A 用 0 到 1 之间的小数表示（窗口中显示为百分比）；波长、宽度和厚度单位为 nm；层数为计数；PPEF 单位为 dB。 |
| `tol` | `tol` |  | `'eq'` 的容差，使用该检查的单位；小于等于 0 时数值必须等于目标值本身。不给出时，T、R 和 A 为 0.01，中心或边缘为 1 nm，宽度为 2 nm，厚度为 10 nm，层数为 0，PPEF 为 0.05 dB。 |
| `lo` | `lo` | `0.95` | `'between'` 的最小值，使用该检查的单位。 |
| `hi` | `hi` | `1` | `'between'` 的最大值，不小于 `lo`。 |
| `aoi` | `aoi` | `0` | 入射角，为入射介质中的度数。 |
| `pol` | `pol` | `'avg'` | `'avg'`、`'s'` 或 `'p'`。 |
| `channel` | `channel` | `'T'` | MIN_MAX、INTEGRAL、CENTRAL_LAMBDA、FWHM 和 EDGE_LAMBDA 读取的量：`'T'`、`'R'` 或 `'A'`。 |
| `direction` | `direction` | `'max'` | 用于 MIN_MAX、CENTRAL_LAMBDA、FWHM 和 EDGE_LAMBDA：`'max'`，最大值或峰；`'min'`，最小值或谷。 |
| `level` | `level` | `0.5` | 用于 FWHM 和 EDGE_LAMBDA，曲线穿越的电平，0 到 1：direction 为 `'max'` 时为波段内最大值的该比例，为 `'min'` 时为从波段内最小值到 1 之间该比例处的值。小于 0.001 或大于 0.999 的电平按 0.001 或 0.999 计。 |
| `edgeSide` | `edge_side` |  | 用于 EDGE_LAMBDA：`'right'` 表示峰以上的交点；否则取峰以下的交点，峰以下没有交点时取峰以上的交点。 |
| `flag` | `flag` |  | 窗口中的步长，`null` / `None` 表示默认值：对 T_AVG、R_AVG、A_AVG 和 INTEGRAL 为 1 到 4，网格步长不大于 1、0.1、0.01 或 0.001 nm，默认按设计的干涉条纹取网格；对 FWHM 和 EDGE_LAMBDA，以及取 T 或 A 最大值或 R 最小值的 MIN_MAX 和 CENTRAL_LAMBDA 为 2 到 4，以 0.1、0.01 或 0.001 nm 搜索，默认为 1 nm。单波长检查、取 T 或 A 最小值或 R 最大值的 MIN_MAX 和 CENTRAL_LAMBDA、总厚度检查、层数检查和 PPEF 没有步长，只接受 `null` / `None`。 |
| `side` | `side` |  | 用于 THICKNESS_BUDGET 和 LAYER_COUNT，累加的膜层：`'front'`、`'back'` 或 `'both'`。不给出时，为设计所镀的面。 |
| `presetKey` | `preset_key` | `''` | 用于 INTEGRAL，积分预设 Tvis、Rvis、Avis、Tsol、Rsol、Asol、TUV、RUV、TNIR 和 RNIR 之一，它会像在窗口中选择它一样设置通道、波段、光源、探测器和 `presetLabel` / `preset_label`；`''` 表示不用预设。 |
| `presetLabel` | `preset_label` | `''` | 用于 INTEGRAL，窗口中显示的预设名称。 |
| `source` | `source` | `{ id: 'D65' }` | **JavaScript**：用于不带预设的 INTEGRAL，光源：`{ id }`，id 为 D65、D50、A、AM1.5G、E、blackbody（带 `T`，单位 K）或 custom（带 `table`，各行为 [nm, value]）之一。<br>**Python**：用于不带预设的 INTEGRAL，光源：{"id": ...}，id 为 D65、D50、A、AM1.5G、E、blackbody（带 "T"，单位 K）或 custom（带 "table"，各行为 [nm, value]）之一。不给出时为 {"id": "D65"}。 |
| `detector` | `detector` | `{ id: 'photopic' }` | **JavaScript**：用于不带预设的 INTEGRAL，探测器：`{ id }`，id 为 photopic、flat 或 custom（带 `table`）。<br>**Python**：用于不带预设的 INTEGRAL，探测器：{"id": ...}，id 为 photopic、flat 或 custom（带 "table"）。不给出时为 {"id": "photopic"}。 |
| `bandPoints` | `band_points` |  | 用于 INTEGRAL、FWHM 和 EDGE_LAMBDA，代替默认值的波段采样点数，不小于 2 的整数；宽度或边缘扫描至少取 11 个点。 |
| `curveId` | `curve_id` |  | 用于 PPEF，设计中某条实测曲线的 id。 |
| `label` | `label` | `''` | 该检查的标签。 |
| `enabled` | `enabled` | `true` / `True` | 为 `false` / `False` 时，该检查不计入判定。 |

**拒绝**：

- 此版本无法计算的种类、任何检查都没有的字段、字段无法接受的值、结束波长小于起始波长的波段，或小于 `lo` 的 `hi`
- **JavaScript**：该种类不读取的波长、选项对象之前除 `start` 和 `end` 外还有其他值，或在选项中给出检查的种类、波长或 id<br>**Python**：该种类不读取的波长，或在关键字参数中给出检查的波长或 id
- 窗口不提供的预设、检查给出的值与其预设设置的不同的字段、曲线不是设计中实测曲线之一的 PPEF 检查，或在没有步长的检查上给出的 flag

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^5 H');
design.specification.add('R_AT', 550, { cmp: 'ge', target: 0.99 });
design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.97, aoi: 45, pol: 's' });
design.specification.add('LAYER_COUNT', { cmp: 'le', target: 15 });
console.log(design.specification.length, 'checks, the layer count on the', design.specification.rows[2].side);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^5 H")
design.specification.add("R_AT", 550, cmp="ge", target=0.99)
design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.97, aoi=45, pol="s")
design.specification.add("LAYER_COUNT", cmp="le", target=15)
print(len(design.specification), "checks, the layer count on the", design.specification.rows[2].side)
```

### remove

| JavaScript | Python |
| ---------- | ------ |
| `design.specification.remove(index)` | `design.specification.remove(index)` |

删除第 `index` 项检查；其后的检查依次前移一位。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `index` | `index` |  | 该检查在规格中的位置，从 0 开始，与 `rows` 中相同。 |

**拒绝**：

- 规格中没有对应检查的位置

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^5 H');
design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.97 });
design.specification.add('LAYER_COUNT', { cmp: 'le', target: 15 });
design.specification.remove(0);
console.log(design.specification.length, 'check:', design.specification.rows[0].kind);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^5 H")
design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.97)
design.specification.add("LAYER_COUNT", cmp="le", target=15)
design.specification.remove(0)
print(len(design.specification), "check:", design.specification.rows[0].kind)
```

### clear

| JavaScript | Python |
| ---------- | ------ |
| `design.specification.clear()` | `design.specification.clear()` |

删除规格中的所有检查。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^5 H');
design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.97 });
design.specification.clear();
console.log(design.specification.length, 'checks');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^5 H")
design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.97)
design.specification.clear()
print(len(design.specification), "checks")
```

### rows

| JavaScript | Python |
| ---------- | ------ |
| `design.specification.rows` | `design.specification.rows` |

各项检查，按顺序排列，每一项都是一个 SpecCheck。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^5 H');
design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.97 });
design.specification.add('LAYER_COUNT', { cmp: 'le', target: 15 });
for (const check of design.specification.rows) console.log(check.kind, check.cmp, check.target);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^5 H")
design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.97)
design.specification.add("LAYER_COUNT", cmp="le", target=15)
for check in design.specification.rows:
    print(check.kind, check.cmp, check.target)
```

### length / len()

| JavaScript | Python |
| ---------- | ------ |
| `design.specification.length` | `len(design.specification)` |

规格中的检查数。

```js
const design = tf.newDesign('Mirror');
design.specification.add('LAYER_COUNT', { cmp: 'le', target: 15 });
console.log(design.specification.length, 'check');
```

```python
design = tf.new_design("Mirror")
design.specification.add("LAYER_COUNT", cmp="le", target=15)
print(len(design.specification), "check")
```

### check

| JavaScript | Python |
| ---------- | ------ |
| `design.specification.check()` | `design.specification.check()` |

按规格说明窗口的方式，判定设计当前状态是否满足其规格：每项检查按其自身的步长读取；设计有入射锥角时，按锥角取平均。

**返回**：一个 SpecReport。

**拒绝**：

- 没有检查的设计
- 用到找不到对应材料的设计

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^5 H');
design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.97 });
design.specification.add('LAYER_COUNT', { cmp: 'le', target: 9 });
const report = design.specification.check();
for (const row of report.rows) console.log(row.kind, row.value, row.unit, row.passed, 'margin', row.margin);
console.log('Passes:', report.passed);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^5 H")
design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.97)
design.specification.add("LAYER_COUNT", cmp="le", target=9)
report = design.specification.check()
for row in report.rows:
    print(row.kind, row.value, row.unit, row.passed, "margin", row.margin)
print("Passes:", report.passed)
```

### estimateYield / estimate_yield

| JavaScript | Python |
| ---------- | ------ |
| `await design.specification.estimateYield(runs, { thicknessRelPct, thicknessAbsNm, indexRe, indexIm, distribution, seed, progress, stop })` | `design.specification.estimate_yield(runs, thickness_rel_pct=1, thickness_abs_nm=0, index_re=0, index_im=0, distribution="gaussian", seed=..., progress=..., stop=...)` |

带有随机膜层误差的蒙特卡洛试验中满足规格的比例，与蒙特卡洛窗口统计良率的方式相同：每次试验由每一项启用的检查按其自身的步长判定，计算对象由设计的 `sides` 和 `scoreOn` / `score_on` 决定。在种子和设置相同时，这些试验抽取的误差与 `design.monteCarlo()` / `design.monte_carlo()` 相同，因此良率就是其 `spec`；不计算分散。设计不会改变。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `runs` | `runs` |  | 试验次数，不小于 1 的整数。 |
| `thicknessRelPct` | `thickness_rel_pct` | `1` | 厚度误差，为每层厚度的百分比。 |
| `thicknessAbsNm` | `thickness_abs_nm` | `0` | 以 nm 计、加到每一层上的厚度误差。 |
| `indexRe` | `index_re` | `0` | n 的误差，为绝对量：使用 `'gaussian'` 时为一个标准差，使用 `'uniform'` 和 `'truncated'` 时为界限。 |
| `indexIm` | `index_im` | `0` | k 的误差，含义与 `indexRe` / `index_re` 对 n 的相同；k 不会小于 0。 |
| `distribution` | `distribution` | `'gaussian'` | `'gaussian'`、`'uniform'` 或 `'truncated'`（在三个标准差处截断）。 |
| `seed` | `seed` |  | 抽样的起始数，1 到 2^32 - 1 之间的整数；相同的种子和设置会重复同样的运行。不给出时，使用一个新的种子，并在结果中给出。 |
| `progress` | `progress` |  | **JavaScript**：一个函数，试验进行时以一个 Progress（`trial` 和 `total`）调用它。它抛出的错误会结束运行，运行随即以该错误拒绝。<br>**Python**：一个函数，试验进行时以一个 Progress（trial 和 total）调用它。它引发的异常会停止运行，并继续向外传递。 |
| `stop` | `stop` |  | **JavaScript**：一个 AbortSignal；中止其 AbortController 会结束运行，运行随即以已完成的试验返回结果。<br>**Python**：一个 tfstudio.Stop，调用其 stop() 会结束运行，运行随即以已完成的试验返回结果。 |

**返回**：**JavaScript**：一个 Yield 的 promise。<br>**Python**：一个 Yield。

**拒绝**：

- 没有启用的检查的设计，或在其评价面上没有可供试验改变的膜层的设计
- 它不接受的设置、超出范围的值，或用到找不到对应材料的设计
- Python 引发 `KeyboardInterrupt`：运行期间按下 Ctrl+C，在停止运行之后引发

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^5 H');
design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.97 });
const y = await design.specification.estimateYield(100, { thicknessRelPct: 2, seed: 1 });
console.log('Yield', y.value, 'of', y.runs, 'trials; fails:', y.checks.map(check => check.failRate));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^5 H")
design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.97)
y = design.specification.estimate_yield(100, thickness_rel_pct=2, seed=1)
print("Yield", y.value, "of", y.runs, "trials; fails:", [check.fail_rate for check in y.checks])
```

## SpecCheck

设计规格中的一项检查，为读取 design.specification.rows 时的状态。每个属性给出设计中保存的该检查的字段，设计中没有的字段为 `null` / `None`；该检查的种类不读取的字段，保存的是给出的值，或在规格说明窗口中新加一项检查时的初始值。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^5 H');
design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.9 });
for (const check of design.specification.rows) console.log(check.kind, check.start, check.end, check.cmp, check.target);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^5 H")
design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.9)
for check in design.specification.rows:
    print(check.kind, check.start, check.end, check.cmp, check.target)
```

### kind

| JavaScript | Python |
| ---------- | ------ |
| `check.kind` | `check.kind` |

检查的内容，例如 `'R_AVG'` 或 `'LAYER_COUNT'`；specification.add() 列出了各个种类。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^5 H');
design.specification.add('LAYER_COUNT', { cmp: 'le', target: 15 });
console.log(design.specification.rows[0].kind);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^5 H")
design.specification.add("LAYER_COUNT", cmp="le", target=15)
print(design.specification.rows[0].kind)
```

### label

| JavaScript | Python |
| ---------- | ------ |
| `check.label` | `check.label` |

该检查的标签，没有标签时为 `''`。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^5 H');
design.specification.add('R_AVG', 520, 580, { label: 'Stop band' });
console.log(design.specification.rows[0].label);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^5 H")
design.specification.add("R_AVG", 520, 580, label="Stop band")
print(design.specification.rows[0].label)
```

### enabled

| JavaScript | Python |
| ---------- | ------ |
| `check.enabled` | `check.enabled` |

不计入判定的检查为 `false` / `False`。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^5 H');
design.specification.add('R_AVG', 520, 580, { enabled: false });
console.log(design.specification.rows[0].enabled);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^5 H")
design.specification.add("R_AVG", 520, 580, enabled=False)
print(design.specification.rows[0].enabled)
```

### cmp

| JavaScript | Python |
| ---------- | ------ |
| `check.cmp` | `check.cmp` |

比较方式：`'ge'`、`'le'`、`'eq'` 或 `'between'`。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^5 H');
design.specification.add('LAYER_COUNT', { cmp: 'le', target: 15 });
console.log(design.specification.rows[0].cmp);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^5 H")
design.specification.add("LAYER_COUNT", cmp="le", target=15)
print(design.specification.rows[0].cmp)
```

### target

| JavaScript | Python |
| ---------- | ------ |
| `check.target` | `check.target` |

`'ge'` 和 `'le'` 的界限，以及 `'eq'` 所要求的值，使用该检查的单位：T、R 和 A 用 0 到 1 之间的小数表示，波长、宽度和厚度单位为 nm，层数为计数，PPEF 单位为 dB。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^5 H');
design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.9 });
console.log(design.specification.rows[0].target);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^5 H")
design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.9)
print(design.specification.rows[0].target)
```

### tol

| JavaScript | Python |
| ---------- | ------ |
| `check.tol` | `check.tol` |

`'eq'` 的容差，使用该检查的单位。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^5 H');
design.specification.add('CENTRAL_LAMBDA', 500, 600, { cmp: 'eq', target: 550 });
console.log(design.specification.rows[0].tol, 'nm');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^5 H")
design.specification.add("CENTRAL_LAMBDA", 500, 600, cmp="eq", target=550)
print(design.specification.rows[0].tol, "nm")
```

### lo

| JavaScript | Python |
| ---------- | ------ |
| `check.lo` | `check.lo` |

`'between'` 的最小值，使用该检查的单位。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^5 H');
design.specification.add('R_AT', 550, { cmp: 'between', lo: 0.95, hi: 1 });
console.log(design.specification.rows[0].lo);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^5 H")
design.specification.add("R_AT", 550, cmp="between", lo=0.95, hi=1)
print(design.specification.rows[0].lo)
```

### hi

| JavaScript | Python |
| ---------- | ------ |
| `check.hi` | `check.hi` |

`'between'` 的最大值，使用该检查的单位。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^5 H');
design.specification.add('R_AT', 550, { cmp: 'between', lo: 0.95, hi: 1 });
console.log(design.specification.rows[0].hi);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^5 H")
design.specification.add("R_AT", 550, cmp="between", lo=0.95, hi=1)
print(design.specification.rows[0].hi)
```

### wavelength

| JavaScript | Python |
| ---------- | ------ |
| `check.wavelength` | `check.wavelength` |

单波长检查（T_AT、R_AT 或 A_AT）的波长，单位 nm。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^5 H');
design.specification.add('R_AT', 550, { cmp: 'ge', target: 0.99 });
console.log(design.specification.rows[0].wavelength, 'nm');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^5 H")
design.specification.add("R_AT", 550, cmp="ge", target=0.99)
print(design.specification.rows[0].wavelength, "nm")
```

### start

| JavaScript | Python |
| ---------- | ------ |
| `check.start` | `check.start` |

波段检查所读取波段的起始波长，单位 nm。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^5 H');
design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.9 });
console.log(design.specification.rows[0].start, 'nm');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^5 H")
design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.9)
print(design.specification.rows[0].start, "nm")
```

### end

| JavaScript | Python |
| ---------- | ------ |
| `check.end` | `check.end` |

波段的结束波长，单位 nm。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^5 H');
design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.9 });
console.log(design.specification.rows[0].end, 'nm');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^5 H")
design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.9)
print(design.specification.rows[0].end, "nm")
```

### aoi

| JavaScript | Python |
| ---------- | ------ |
| `check.aoi` | `check.aoi` |

入射角，为入射介质中的度数。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^5 H');
design.specification.add('R_AVG', 520, 580, { aoi: 45, pol: 's' });
console.log(design.specification.rows[0].aoi);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^5 H")
design.specification.add("R_AVG", 520, 580, aoi=45, pol="s")
print(design.specification.rows[0].aoi)
```

### pol

| JavaScript | Python |
| ---------- | ------ |
| `check.pol` | `check.pol` |

偏振，`'avg'`、`'s'` 或 `'p'`。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^5 H');
design.specification.add('R_AVG', 520, 580, { aoi: 45, pol: 's' });
console.log(design.specification.rows[0].pol);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^5 H")
design.specification.add("R_AVG", 520, 580, aoi=45, pol="s")
print(design.specification.rows[0].pol)
```

### channel

| JavaScript | Python |
| ---------- | ------ |
| `check.channel` | `check.channel` |

MIN_MAX、INTEGRAL、CENTRAL_LAMBDA、FWHM 和 EDGE_LAMBDA 读取的量：`'T'`、`'R'` 或 `'A'`。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^5 H');
design.specification.add('MIN_MAX', 520, 580, { channel: 'R', direction: 'min', cmp: 'ge', target: 0.9 });
console.log(design.specification.rows[0].channel);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^5 H")
design.specification.add("MIN_MAX", 520, 580, channel="R", direction="min", cmp="ge", target=0.9)
print(design.specification.rows[0].channel)
```

### direction

| JavaScript | Python |
| ---------- | ------ |
| `check.direction` | `check.direction` |

用于 MIN_MAX、CENTRAL_LAMBDA、FWHM 和 EDGE_LAMBDA：`'max'`，最大值或峰；`'min'`，最小值或谷。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^5 H');
design.specification.add('MIN_MAX', 520, 580, { channel: 'R', direction: 'min', cmp: 'ge', target: 0.9 });
console.log(design.specification.rows[0].direction);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^5 H")
design.specification.add("MIN_MAX", 520, 580, channel="R", direction="min", cmp="ge", target=0.9)
print(design.specification.rows[0].direction)
```

### level

| JavaScript | Python |
| ---------- | ------ |
| `check.level` | `check.level` |

用于 FWHM 和 EDGE_LAMBDA，曲线穿越的电平，0 到 1：direction 为 `'max'` 时为波段内最大值的该比例，为 `'min'` 时为从波段内最小值到 1 之间该比例处的值。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^5 H');
design.specification.add('FWHM', 400, 800, { channel: 'R', level: 0.5, cmp: 'ge', target: 100 });
console.log(design.specification.rows[0].level);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^5 H")
design.specification.add("FWHM", 400, 800, channel="R", level=0.5, cmp="ge", target=100)
print(design.specification.rows[0].level)
```

### edgeSide / edge_side

| JavaScript | Python |
| ---------- | ------ |
| `check.edgeSide` | `check.edge_side` |

用于 EDGE_LAMBDA，`'left'` 或 `'right'`，峰以下或峰以上的交点；`null` / `None` 表示峰以下的交点，峰以下没有交点时为峰以上的交点。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^5 H');
design.specification.add('EDGE_LAMBDA', 400, 800, { channel: 'R', edgeSide: 'right', cmp: 'ge', target: 600 });
console.log(design.specification.rows[0].edgeSide);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^5 H")
design.specification.add("EDGE_LAMBDA", 400, 800, channel="R", edge_side="right", cmp="ge", target=600)
print(design.specification.rows[0].edge_side)
```

### flag

| JavaScript | Python |
| ---------- | ------ |
| `check.flag` | `check.flag` |

窗口中的步长，`null` / `None` 表示默认值；specification.add() 说明它在每个种类上的含义。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^5 H');
design.specification.add('R_AVG', 520, 580, { flag: 2 });
console.log(design.specification.rows[0].flag);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^5 H")
design.specification.add("R_AVG", 520, 580, flag=2)
print(design.specification.rows[0].flag)
```

### side

| JavaScript | Python |
| ---------- | ------ |
| `check.side` | `check.side` |

用于 THICKNESS_BUDGET 和 LAYER_COUNT，累加的膜层：`'front'`、`'back'` 或 `'both'`。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^5 H');
design.specification.add('THICKNESS_BUDGET', { cmp: 'le', target: 2000 });
console.log(design.specification.rows[0].side);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^5 H")
design.specification.add("THICKNESS_BUDGET", cmp="le", target=2000)
print(design.specification.rows[0].side)
```

### presetKey / preset_key

| JavaScript | Python |
| ---------- | ------ |
| `check.presetKey` | `check.preset_key` |

用于 INTEGRAL，设置其通道、波段、光源和探测器的积分预设，例如 `'Tvis'`；没有预设时为 `''`。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
design.specification.add('INTEGRAL', { presetKey: 'Rvis', cmp: 'le', target: 0.01 });
console.log(design.specification.rows[0].presetKey);
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
design.specification.add("INTEGRAL", preset_key="Rvis", cmp="le", target=0.01)
print(design.specification.rows[0].preset_key)
```

### presetLabel / preset_label

| JavaScript | Python |
| ---------- | ------ |
| `check.presetLabel` | `check.preset_label` |

用于 INTEGRAL，窗口中显示的预设名称。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
design.specification.add('INTEGRAL', { presetKey: 'Rvis', cmp: 'le', target: 0.01 });
console.log(design.specification.rows[0].presetLabel);
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
design.specification.add("INTEGRAL", preset_key="Rvis", cmp="le", target=0.01)
print(design.specification.rows[0].preset_label)
```

### source

| JavaScript | Python |
| ---------- | ------ |
| `check.source` | `check.source` |

**JavaScript**：用于 INTEGRAL，对波段加权的光源，例如 `{ id: 'D65' }`。

**Python**：用于 INTEGRAL，对波段加权的光源，例如 {"id": "D65"}。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
design.specification.add('INTEGRAL', { presetKey: 'Rvis', cmp: 'le', target: 0.01 });
console.log(design.specification.rows[0].source);
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
design.specification.add("INTEGRAL", preset_key="Rvis", cmp="le", target=0.01)
print(design.specification.rows[0].source)
```

### detector

| JavaScript | Python |
| ---------- | ------ |
| `check.detector` | `check.detector` |

**JavaScript**：用于 INTEGRAL，对波段加权的探测器，例如 `{ id: 'photopic' }`。

**Python**：用于 INTEGRAL，对波段加权的探测器，例如 {"id": "photopic"}。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
design.specification.add('INTEGRAL', { presetKey: 'Rvis', cmp: 'le', target: 0.01 });
console.log(design.specification.rows[0].detector);
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
design.specification.add("INTEGRAL", preset_key="Rvis", cmp="le", target=0.01)
print(design.specification.rows[0].detector)
```

### bandPoints / band_points

| JavaScript | Python |
| ---------- | ------ |
| `check.bandPoints` | `check.band_points` |

用于 INTEGRAL、FWHM 和 EDGE_LAMBDA，波段的采样点数；`null` / `None` 表示默认值。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^5 H');
design.specification.add('FWHM', 400, 800, { channel: 'R', bandPoints: 801, cmp: 'ge', target: 100 });
console.log(design.specification.rows[0].bandPoints);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^5 H")
design.specification.add("FWHM", 400, 800, channel="R", band_points=801, cmp="ge", target=100)
print(design.specification.rows[0].band_points)
```

### curveId / curve_id

| JavaScript | Python |
| ---------- | ------ |
| `check.curveId` | `check.curve_id` |

用于 PPEF，计算误差所相对的实测曲线的 id；其他种类的检查为 `null` / `None`，如下例中的层数检查。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^5 H');
design.specification.add('LAYER_COUNT', { cmp: 'le', target: 15 });
const check = design.specification.rows[0];
console.log(check.kind, 'is taken against no curve:', check.curveId);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^5 H")
design.specification.add("LAYER_COUNT", cmp="le", target=15)
check = design.specification.rows[0]
print(check.kind, "is taken against no curve:", check.curve_id)
```

## SpecReport

设计相对其规格的判定，与 specification.check() 的判定和规格说明窗口的显示相同：每项检查一个 CheckResult。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^5 H');
design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.9 });
design.specification.add('LAYER_COUNT', { cmp: 'le', target: 9 });
const report = design.specification.check();
console.log(report.passing, 'of', report.total, 'checks pass');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^5 H")
design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.9)
design.specification.add("LAYER_COUNT", cmp="le", target=9)
report = design.specification.check()
print(report.passing, "of", report.total, "checks pass")
```

### rows

| JavaScript | Python |
| ---------- | ------ |
| `report.rows` | `report.rows` |

每项检查一个 CheckResult，按规格中的顺序排列。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^5 H');
design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.9 });
for (const row of design.specification.check().rows) console.log(row.kind, row.passed);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^5 H")
design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.9)
for row in design.specification.check().rows:
    print(row.kind, row.passed)
```

### passed

| JavaScript | Python |
| ---------- | ------ |
| `report.passed` | `report.passed` |

每一项启用的检查都通过、且至少有一项时为 `true` / `True`。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^5 H');
design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.9 });
console.log(design.specification.check().passed);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^5 H")
design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.9)
print(design.specification.check().passed)
```

### passing

| JavaScript | Python |
| ---------- | ------ |
| `report.passing` | `report.passing` |

通过的启用检查数。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^5 H');
design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.9 });
design.specification.add('LAYER_COUNT', { cmp: 'le', target: 9 });
console.log(design.specification.check().passing);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^5 H")
design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.9)
design.specification.add("LAYER_COUNT", cmp="le", target=9)
print(design.specification.check().passing)
```

### total

| JavaScript | Python |
| ---------- | ------ |
| `report.total` | `report.total` |

启用的检查数。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^5 H');
design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.9 });
design.specification.add('LAYER_COUNT', { cmp: 'le', target: 9, enabled: false });
console.log(design.specification.check().total);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^5 H")
design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.9)
design.specification.add("LAYER_COUNT", cmp="le", target=9, enabled=False)
print(design.specification.check().total)
```

### mode

| JavaScript | Python |
| ---------- | ------ |
| `report.mode` | `report.mode` |

检查的计算对象：`'front'` 或 `'back'`，仅镀膜面；`'total'`，整个元件；由设计的 `sides` 和 `scoreOn` / `score_on` 决定。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^5 H');
design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.9 });
design.scoreOn = 'whole part';
console.log(design.specification.check().mode);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^5 H")
design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.9)
design.score_on = "whole part"
print(design.specification.check().mode)
```

## CheckResult

设计规格中的一项检查经 specification.check() 判定的结果，与规格说明窗口中该行的显示相同。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^5 H');
design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.9 });
for (const row of design.specification.check().rows) console.log(row.kind, row.value, row.passed, row.margin);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^5 H")
design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.9)
for row in design.specification.check().rows:
    print(row.kind, row.value, row.passed, row.margin)
```

### kind

| JavaScript | Python |
| ---------- | ------ |
| `row.kind` | `row.kind` |

该检查的种类，例如 `'R_AVG'`。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^5 H');
design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.9 });
console.log(design.specification.check().rows[0].kind);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^5 H")
design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.9)
print(design.specification.check().rows[0].kind)
```

### label

| JavaScript | Python |
| ---------- | ------ |
| `row.label` | `row.label` |

该检查的标签，没有标签时为 `''`。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^5 H');
design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.9, label: 'Stop band' });
console.log(design.specification.check().rows[0].label);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^5 H")
design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.9, label="Stop band")
print(design.specification.check().rows[0].label)
```

### value

| JavaScript | Python |
| ---------- | ------ |
| `row.value` | `row.value` |

该检查的数值：T、R 和 A 用 0 到 1 之间的小数表示，波长、宽度和厚度单位为 nm，PPEF 单位为 dB，层数为计数；没有数值时为 `null` / `None`，例如不计入判定的检查。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^5 H');
design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.9 });
console.log(design.specification.check().rows[0].value);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^5 H")
design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.9)
print(design.specification.check().rows[0].value)
```

### unit

| JavaScript | Python |
| ---------- | ------ |
| `row.unit` | `row.unit` |

数值的单位：`'fraction'`、`'nm'` 或 `'dB'`；层数和不计入判定的检查为 `''`。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^5 H');
design.specification.add('THICKNESS_BUDGET', { cmp: 'le', target: 2000 });
const row = design.specification.check().rows[0];
console.log(row.value, row.unit);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^5 H")
design.specification.add("THICKNESS_BUDGET", cmp="le", target=2000)
row = design.specification.check().rows[0]
print(row.value, row.unit)
```

### passed

| JavaScript | Python |
| ---------- | ------ |
| `row.passed` | `row.passed` |

数值是否满足阈值，与窗口中的标记相同：没有数值时为 `false` / `False`，不计入判定的检查为 `null` / `None`。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^5 H');
design.specification.add('LAYER_COUNT', { cmp: 'le', target: 9 });
console.log(design.specification.check().rows[0].passed);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^5 H")
design.specification.add("LAYER_COUNT", cmp="le", target=9)
print(design.specification.check().rows[0].passed)
```

### margin

| JavaScript | Python |
| ---------- | ------ |
| `row.margin` | `row.margin` |

数值离最近界限的距离，使用数值的单位：为正时表示剩余的余量，为负时表示超出的量，因此 `passed` 恰好在它大于等于 0 时为 `true` / `True`；没有数值时为 `null` / `None`。界限比给定值向外放宽窗口所显示末位数字的一半，因此窗口显示在界限上的数值算作通过：分数放宽 0.000005，0.005 nm，0.0005 dB，层数不放宽。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^5 H');
design.specification.add('R_AT', 550, { cmp: 'between', lo: 0.95, hi: 1 });
console.log(design.specification.check().rows[0].margin);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^5 H")
design.specification.add("R_AT", 550, cmp="between", lo=0.95, hi=1)
print(design.specification.check().rows[0].margin)
```

### threshold

| JavaScript | Python |
| ---------- | ------ |
| `row.threshold` | `row.threshold` |

**JavaScript**：数值所依据的比较，与检查中保存的相同：一个对象 `{ cmp, target, tol, lo, hi }`。

**Python**：数值所依据的比较，与检查中保存的相同：一个具名元组 (cmp, target, tol, lo, hi)。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^5 H');
design.specification.add('R_AT', 550, { cmp: 'eq', target: 0.98, tol: 0.01 });
const { cmp, target, tol } = design.specification.check().rows[0].threshold;
console.log(cmp, target, tol);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^5 H")
design.specification.add("R_AT", 550, cmp="eq", target=0.98, tol=0.01)
held = design.specification.check().rows[0].threshold
print(held.cmp, held.target, held.tol)
```

### reason

| JavaScript | Python |
| ---------- | ------ |
| `row.reason` | `row.reason` |

没有数值的原因，或 `null` / `None`：`'disabled'`，不计入判定的检查；`'notComputable'`，算出的值不是数；`'noCurve'`，设计中没有其曲线的 PPEF 检查；`'fwhmNotBracketed'` 或 `'edgeNotCrossed'`，交点不在波段内的宽度或边缘；`'unknownKind'`。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^5 H');
design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.9, enabled: false });
console.log(design.specification.check().rows[0].reason);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^5 H")
design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.9, enabled=False)
print(design.specification.check().rows[0].reason)
```

## Yield

带有随机膜层误差的蒙特卡洛试验相对设计规格的良率，与蒙特卡洛窗口的统计方式相同：满足每一项启用检查的试验所占的比例，每项检查按其自身的步长读取。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^5 H');
design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.97 });
const y = await design.specification.estimateYield(50, { thicknessRelPct: 2, seed: 1 });
console.log('yield', y.value, 'from', y.interval[0], 'to', y.interval[1]);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^5 H")
design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.97)
y = design.specification.estimate_yield(50, thickness_rel_pct=2, seed=1)
print("yield", y.value, "from", y.interval[0], "to", y.interval[1])
```

### value

| JavaScript | Python |
| ---------- | ------ |
| `y.value` | `y.value` |

良率：经过检查的试验中满足每一项启用检查的比例，0 到 1；没有试验经过检查时为 `null` / `None`。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^5 H');
design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.97 });
console.log((await design.specification.estimateYield(20, { seed: 1 })).value);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^5 H")
design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.97)
print(design.specification.estimate_yield(20, seed=1).value)
```

### passCount / pass_count

| JavaScript | Python |
| ---------- | ------ |
| `y.passCount` | `y.pass_count` |

满足每一项启用检查的试验数。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^5 H');
design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.97 });
const y = await design.specification.estimateYield(20, { seed: 1 });
console.log(y.passCount, 'of', y.evaluated);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^5 H")
design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.97)
y = design.specification.estimate_yield(20, seed=1)
print(y.pass_count, "of", y.evaluated)
```

### evaluated

| JavaScript | Python |
| ---------- | ------ |
| `y.evaluated` | `y.evaluated` |

经过检查的试验数：已运行的试验，减去其检查无法计算的试验。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^5 H');
design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.97 });
console.log((await design.specification.estimateYield(20, { seed: 1 })).evaluated);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^5 H")
design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.97)
print(design.specification.estimate_yield(20, seed=1).evaluated)
```

### interval

| JavaScript | Python |
| ---------- | ------ |
| `y.interval` | `y.interval` |

良率的 95 % 区间，`[low, high]`，0 到 1；没有试验经过检查时为 `null` / `None`。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^5 H');
design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.97 });
const [low, high] = (await design.specification.estimateYield(20, { seed: 1 })).interval;
console.log(low, high);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^5 H")
design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.97)
low, high = design.specification.estimate_yield(20, seed=1).interval
print(low, high)
```

### checks

| JavaScript | Python |
| ---------- | ------ |
| `y.checks` | `y.checks` |

**JavaScript**：规格中每项检查一个对象，按其顺序排列：`{ label, failRate }`，即该检查的标签（没有标签时为其种类），以及在全部已运行试验中该检查未通过的比例。不计入判定的检查在任何试验中都不算未通过。

**Python**：规格中每项检查一个具名元组 (label, fail_rate)，按其顺序排列：该检查的标签（没有标签时为其种类），以及在全部已运行试验中该检查未通过的比例。不计入判定的检查在任何试验中都不算未通过。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^5 H');
design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.97 });
design.specification.add('R_AT', 550, { cmp: 'ge', target: 0.99 });
const y = await design.specification.estimateYield(20, { thicknessRelPct: 2, seed: 1 });
for (const check of y.checks) console.log(check.label, check.failRate);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^5 H")
design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.97)
design.specification.add("R_AT", 550, cmp="ge", target=0.99)
y = design.specification.estimate_yield(20, thickness_rel_pct=2, seed=1)
for check in y.checks:
    print(check.label, check.fail_rate)
```

### runs

| JavaScript | Python |
| ---------- | ------ |
| `y.runs` | `y.runs` |

已运行的试验数：与要求的相同；运行被停止时会更少。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^5 H');
design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.97 });
console.log((await design.specification.estimateYield(20, { seed: 1 })).runs);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^5 H")
design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.97)
print(design.specification.estimate_yield(20, seed=1).runs)
```

### seed

| JavaScript | Python |
| ---------- | ------ |
| `y.seed` | `y.seed` |

抽样所用的起始种子：相同的种子、设计和设置会重复同样的试验。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^5 H');
design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.97 });
const y = await design.specification.estimateYield(20);
const again = await design.specification.estimateYield(20, { seed: y.seed });
console.log(y.seed, y.value === again.value);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^5 H")
design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.97)
y = design.specification.estimate_yield(20)
again = design.specification.estimate_yield(20, seed=y.seed)
print(y.seed, y.value == again.value)
```

### mode

| JavaScript | Python |
| ---------- | ------ |
| `y.mode` | `y.mode` |

试验的评价对象：`'front'` 或 `'back'`，仅镀膜面；`'total'`，整个元件；由设计的 `sides` 和 `scoreOn` / `score_on` 决定。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^5 H');
design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.97 });
console.log((await design.specification.estimateYield(20, { seed: 1 })).mode);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^5 H")
design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.97)
print(design.specification.estimate_yield(20, seed=1).mode)
```

## Spectrum

设计在一段波长范围内、一个或多个入射角下的 R、T 和 A，由 design.spectrum() 计算。`s.R` 及其他量都是所要求的第一个角度下的值；`s.angle(45)` 是另一个角度下的光谱。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
const s = design.spectrum(400, 800, { step: 1, angles: [0, 45] });
console.log(s.mode, Math.max(...s.R), Math.min(...s.angle(45).Tp));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
s = design.spectrum(400, 800, step=1, angles=[0, 45])
print(s.mode, max(s.R), min(s.angle(45).Tp))
```

### mode

| JavaScript | Python |
| ---------- | ------ |
| `s.mode` | `s.mode` |

光谱的计算对象，由设计的 `sides` 和 `scoreOn` / `score_on` 决定：`'front'` 或 `'back'`，仅镀膜面；`'total'`，整个元件。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
console.log(design.spectrum(400, 700).mode);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
print(design.spectrum(400, 700).mode)
```

### wavelength

| JavaScript | Python |
| ---------- | ------ |
| `s.wavelength` | `s.wavelength` |

各波长，单位 nm。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
const s = design.spectrum(400, 700, { step: 50 });
console.log(s.wavelength.join(', '));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
print(design.spectrum(400, 700, step=50).wavelength)
```

### angles

| JavaScript | Python |
| ---------- | ------ |
| `s.angles` | `s.angles` |

入射角，为入射介质中的度数，顺序与要求时相同。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
const s = design.spectrum(400, 700, { angles: [0, 45] });
for (const a of s.angles) console.log(a, Math.max(...s.angle(a).R));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
s = design.spectrum(400, 700, angles=[0, 45])
for a in s.angles:
    print(a, max(s.angle(a).R))
```

### outOfRange / out_of_range

| JavaScript | Python |
| ---------- | ------ |
| `s.outOfRange` | `s.out_of_range` |

**JavaScript**：数据在该范围内中断的材料，一个由 `{ id, name, rangeNm, heldFlat }` 组成的数组：在 `rangeNm`（以 nm 计的 `[first, last]`）之外，它们的 n 和 k 保持在最后的值（`heldFlat` 为 true）或外推得到。每种材料都覆盖该范围时为空。

**Python**：数据在该范围内中断的材料，一个由 dict { id, name, rangeNm, heldFlat } 组成的 list：在 rangeNm（以 nm 计的 [first, last]）之外，它们的 n 和 k 保持在最后的值（heldFlat 为 True）或外推得到。每种材料都覆盖该范围时为空。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
const s = design.spectrum(200, 2500, { step: 10 });
for (const m of s.outOfRange) console.log(m.id, 'has data from', m.rangeNm);
console.log(s.outOfRange.length, 'materials stop inside the range');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
s = design.spectrum(200, 2500, step=10)
for m in s.out_of_range:
    print(m["id"], "has data from", m["rangeNm"])
print(len(s.out_of_range), "materials stop inside the range")
```

### R

| JavaScript | Python |
| ---------- | ------ |
| `s.R` | `s.R` |

第一个角度下非偏振光的反射率，一个 Curve，每个波长一个 0 到 1 之间的小数。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
console.log(Math.max(...design.spectrum(400, 700).R));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
print(max(design.spectrum(400, 700).R))
```

### T

| JavaScript | Python |
| ---------- | ------ |
| `s.T` | `s.T` |

第一个角度下非偏振光的透射率，一个 Curve，每个波长一个 0 到 1 之间的小数。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
console.log(Math.min(...design.spectrum(400, 700).T));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
print(min(design.spectrum(400, 700).T))
```

### A

| JavaScript | Python |
| ---------- | ------ |
| `s.A` | `s.A` |

第一个角度下非偏振光的吸收率，一个 Curve，每个波长一个 0 到 1 之间的小数。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
console.log(Math.max(...design.spectrum(400, 700).A));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
print(max(design.spectrum(400, 700).A))
```

### Rs

| JavaScript | Python |
| ---------- | ------ |
| `s.Rs` | `s.Rs` |

第一个角度下 s 偏振光的反射率，一个 Curve，每个波长一个 0 到 1 之间的小数。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
console.log(Math.max(...design.spectrum(400, 700, { angles: [45] }).Rs));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
print(max(design.spectrum(400, 700, angles=[45]).Rs))
```

### Rp

| JavaScript | Python |
| ---------- | ------ |
| `s.Rp` | `s.Rp` |

第一个角度下 p 偏振光的反射率，一个 Curve，每个波长一个 0 到 1 之间的小数。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
console.log(Math.max(...design.spectrum(400, 700, { angles: [45] }).Rp));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
print(max(design.spectrum(400, 700, angles=[45]).Rp))
```

### Ts

| JavaScript | Python |
| ---------- | ------ |
| `s.Ts` | `s.Ts` |

第一个角度下 s 偏振光的透射率，一个 Curve，每个波长一个 0 到 1 之间的小数。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
console.log(Math.min(...design.spectrum(400, 700, { angles: [45] }).Ts));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
print(min(design.spectrum(400, 700, angles=[45]).Ts))
```

### Tp

| JavaScript | Python |
| ---------- | ------ |
| `s.Tp` | `s.Tp` |

第一个角度下 p 偏振光的透射率，一个 Curve，每个波长一个 0 到 1 之间的小数。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
console.log(Math.min(...design.spectrum(400, 700, { angles: [45] }).Tp));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
print(min(design.spectrum(400, 700, angles=[45]).Tp))
```

### As

| JavaScript | Python |
| ---------- | ------ |
| `s.As` | `s.As` |

第一个角度下 s 偏振光的吸收率，一个 Curve，每个波长一个 0 到 1 之间的小数。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
console.log(Math.max(...design.spectrum(400, 700, { angles: [45] }).As));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
print(max(design.spectrum(400, 700, angles=[45]).As))
```

### Ap

| JavaScript | Python |
| ---------- | ------ |
| `s.Ap` | `s.Ap` |

第一个角度下 p 偏振光的吸收率，一个 Curve，每个波长一个 0 到 1 之间的小数。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
console.log(Math.max(...design.spectrum(400, 700, { angles: [45] }).Ap));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
print(max(design.spectrum(400, 700, angles=[45]).Ap))
```

### angle

| JavaScript | Python |
| ---------- | ------ |
| `s.angle(angle)` | `s.angle(angle)` |

计算时所用的某一个角度下的光谱。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `angle` | `angle` |  | 入射角，为入射介质中的度数。 |

**返回**：只含该角度的一个 Spectrum。

**拒绝**：

- 光谱计算时未包含的角度

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
const s = design.spectrum(400, 700, { angles: [0, 45] });
console.log(Math.min(...s.angle(45).Tp));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
s = design.spectrum(400, 700, angles=[0, 45])
print(min(s.angle(45).Tp))
```

### saveCsv / save_csv

| JavaScript | Python |
| ---------- | ------ |
| `s.saveCsv(path)` | `s.save_csv(path)` |

把光谱写入 CSV 文件：先以 # 行写出条件，写法与实测光谱窗口的导出相同，其导入会读回这些条件（设计的名称；光谱只有一个角度时的入射角，以及光射入的面：仅以背面评价的设计为背面，其他为正面；以及“Polarization: per column”），然后是一列波长和每个角度下的 R、T、A、Rs、Rp、Ts、Tp、As 和 Ap，用 0 到 1 之间的小数表示，每列的标题注明其物理量和角度。已存在的文件会被覆盖。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `path` | `path` |  | **JavaScript**：要写入的文件，使用完整路径。相对路径以程序启动时所在的文件夹为基准：在脚本控制台中，是启动 TFStudio 时所在的文件夹，通常是其安装文件夹。<br>**Python**：要写入的文件。相对路径以程序的工作文件夹为基准：在脚本控制台中，是脚本所在的文件夹；未保存的脚本则是数据文件夹。 |

```js
const file = require('path').join(require('os').homedir(), `spectrum-${Date.now()}.csv`);
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
design.spectrum(400, 700, { step: 10, angles: [0, 45] }).saveCsv(file);
console.log('Wrote', file);
```

```python
import time

name = "spectrum-{}.csv".format(time.time_ns())
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
design.spectrum(400, 700, step=10, angles=[0, 45]).save_csv(name)
print("Wrote", name)
```

### saveJcamp / save_jcamp

| JavaScript | Python |
| ---------- | ------ |
| `s.saveJcamp(path)` | `s.save_jcamp(path)` |

**JavaScript**：把光谱写入 JCAMP-DX 文件，与实测光谱窗口的导出选项卡在勾选 T、R、A 和“包含 s 和 p”时写出设计光谱的方式相同：每个角度下非偏振光的 T、R 和 A 以及 Ts、Rs、Tp 和 Rp 各一个光谱，用 0 到 1 之间的小数表示，每个光谱的标题为设计名称、物理量，多个角度时还有其角度。实测光谱窗口的导入会把每个光谱读回为一条曲线。已存在的文件会被覆盖。

**Python**：把光谱写入 JCAMP-DX 文件，与实测光谱窗口的导出选项卡在勾选 T、R、A 和“包含 s 和 p”时写出设计光谱的方式相同：每个角度下非偏振光的 T、R 和 A 以及 Ts、Rs、Tp 和 Rp 各一个光谱，用 0 到 1 之间的小数表示，每个光谱的标题为设计名称、物理量，多个角度时还有其角度。文件与窗口写出的逐字节相同，实测光谱窗口的导入会把每个光谱读回为一条曲线。已存在的文件会被覆盖。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `path` | `path` |  | **JavaScript**：要写入的文件，使用完整路径。相对路径以程序启动时所在的文件夹为基准：在脚本控制台中，是启动 TFStudio 时所在的文件夹，通常是其安装文件夹。<br>**Python**：要写入的文件。相对路径以程序的工作文件夹为基准：在脚本控制台中，是脚本所在的文件夹；未保存的脚本则是数据文件夹。 |

```js
const file = require('path').join(require('os').homedir(), `spectrum-${Date.now()}.dx`);
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
design.spectrum(400, 700, { step: 10, angles: [0, 45] }).saveJcamp(file);
console.log('Wrote', file);
```

```python
import time

name = "spectrum-{}.dx".format(time.time_ns())
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
design.spectrum(400, 700, step=10, angles=[0, 45]).save_jcamp(name)
print("Wrote", name)
```

## Curve

**JavaScript**：每个波长一个值：一个数字数组，因此 `Math.max(...curve)`、for 循环和数组方法都能像处理任何数组一样处理它；map()、filter() 等生成新数组的方法生成的是普通数组。

**Python**：每个波长一个值：一个由 float 组成的 list，因此 `max(curve)`、`sum(curve)` 和绘图库都能像处理任何 list 一样处理它。

mean()、min() 和 max() 在一个波段上对它做统计，`wavelength` 给出每个值对应的波长，单位 nm。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
const s = design.spectrum(400, 700);
console.log(Math.max(...s.R), s.R.mean(450, 650));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
s = design.spectrum(400, 700)
print(max(s.R), s.R.mean(450, 650))
```

### wavelength

| JavaScript | Python |
| ---------- | ------ |
| `s.R.wavelength` | `s.R.wavelength` |

每个值对应的波长，单位 nm。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
const s = design.spectrum(400, 700, { step: 50 });
console.log(s.R.wavelength.join(', '));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
s = design.spectrum(400, 700, step=50)
print(s.R.wavelength)
```

### mean

| JavaScript | Python |
| ---------- | ------ |
| `s.R.mean(start, end)` | `s.R.mean(start=..., end=...)` |

波长从 `start` 到 `end`（两端都包含）的各值的平均值。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `start` | `start` |  | 波段的起始波长，单位 nm。不给出时，为曲线的第一个波长。 |
| `end` | `end` |  | 波段的结束波长，单位 nm。不给出时，为曲线的最后一个波长。 |

**返回**：平均值；波段内有值为 NaN 时为 NaN。

**拒绝**：

- 不包含曲线任何波长的波段

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
const s = design.spectrum(400, 700);
console.log('Mean R from 450 to 650 nm:', s.R.mean(450, 650));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
s = design.spectrum(400, 700)
print("Mean R from 450 to 650 nm:", s.R.mean(450, 650))
```

### min

| JavaScript | Python |
| ---------- | ------ |
| `s.R.min(start, end)` | `s.R.min(start=..., end=...)` |

波长从 `start` 到 `end`（两端都包含）的各值中的最小值，不计 NaN。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `start` | `start` |  | 波段的起始波长，单位 nm。不给出时，为曲线的第一个波长。 |
| `end` | `end` |  | 波段的结束波长，单位 nm。不给出时，为曲线的最后一个波长。 |

**返回**：最小值；波段内所有值都为 NaN 时为 `Infinity` / `inf`。

**拒绝**：

- 不包含曲线任何波长的波段

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
const s = design.spectrum(400, 700);
console.log('Lowest T from 450 to 650 nm:', s.T.min(450, 650));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
s = design.spectrum(400, 700)
print("Lowest T from 450 to 650 nm:", s.T.min(450, 650))
```

### max

| JavaScript | Python |
| ---------- | ------ |
| `s.R.max(start, end)` | `s.R.max(start=..., end=...)` |

波长从 `start` 到 `end`（两端都包含）的各值中的最大值，不计 NaN。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `start` | `start` |  | 波段的起始波长，单位 nm。不给出时，为曲线的第一个波长。 |
| `end` | `end` |  | 波段的结束波长，单位 nm。不给出时，为曲线的最后一个波长。 |

**返回**：最大值；波段内所有值都为 NaN 时为 `-Infinity` / `-inf`。

**拒绝**：

- 不包含曲线任何波长的波段

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
const s = design.spectrum(400, 700);
console.log('Highest R from 450 to 650 nm:', s.R.max(450, 650));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
s = design.spectrum(400, 700)
print("Highest R from 450 to 650 nm:", s.R.max(450, 650))
```

### ripple

| JavaScript | Python |
| ---------- | ------ |
| `s.R.ripple(start, end, { unit })` | `s.R.ripple(start=..., end=..., unit="fraction")` |

**JavaScript**：一个波段内的波动：波长从 `start` 到 `end`（两端都包含）的各值中的最大值减去最小值，不计 NaN，即 `max(start, end) - min(start, end)`；用 `unit: 'dB'` 时，给出两者之比的分贝值 10·log10(max/min)，适用于各值大于 0 的曲线。

**Python**：一个波段内的波动：波长从 `start` 到 `end`（两端都包含）的各值中的最大值减去最小值，不计 NaN，即 max(start, end) - min(start, end)；用 unit="dB" 时，给出两者之比的分贝值 10·log10(max/min)，适用于各值大于 0 的曲线。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `start` | `start` |  | 波段的起始波长，单位 nm。不给出时，为曲线的第一个波长。 |
| `end` | `end` |  | 波段的结束波长，单位 nm。不给出时，为曲线的最后一个波长。 |
| `unit` | `unit` | `'fraction'` | `'fraction'`，即以曲线自身单位表示的差值，对 R、T 和 A 为 0 到 1 之间的小数；或 `'dB'`。 |

**返回**：波动值；波段内各值都为 NaN 时为 NaN。

**拒绝**：

- 曲线没有任何波长落在其中的波段，或它没有的单位

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
const s = design.spectrum(400, 800);
console.log('T ripple from 650 to 750 nm:', s.T.ripple(650, 750), 'or', s.T.ripple(650, 750, { unit: 'dB' }), 'dB');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
s = design.spectrum(400, 800)
print("T ripple from 650 to 750 nm:", s.T.ripple(650, 750), "or", s.T.ripple(650, 750, unit="dB"), "dB")
```

### at

| JavaScript | Python |
| ---------- | ------ |
| `s.R.at(wavelength)` | `s.R.at(wavelength)` |

某一波长处的值，取自其两侧两个采样点之间的直线，与绘图画出曲线的方式相同；在采样点上即为该采样点的值。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `wavelength` | `wavelength` |  | 波长，单位 nm，从曲线的第一个波长到最后一个波长。 |

**返回**：该值；读取所用的采样点为 NaN 时为 NaN。

**拒绝**：

- 曲线范围以外的波长，或不是数字的波长

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
const s = design.spectrum(400, 700, { step: 5 });
console.log('R at 532.1 nm:', s.R.at(532.1));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
s = design.spectrum(400, 700, step=5)
print("R at 532.1 nm:", s.R.at(532.1))
```

### density

| JavaScript | Python |
| ---------- | ------ |
| `s.R.density()` | `s.R.density()` |

每个波长处的光密度 −log10 T，一个 Curve，与 ODMN 评价函数行的读法相同：低于 1e-15 的 T 读作光密度 15。光谱的 T、Ts 和 Tp 有光密度；其他曲线没有。

**返回**：在相同波长上的光密度组成的 Curve。

**拒绝**：

- 不是光谱的 T、Ts 或 Tp 的曲线

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^8 H');
const s = design.spectrum(400, 700);
console.log('Highest optical density from 500 to 600 nm:', s.T.density().max(500, 600));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^8 H")
s = design.spectrum(400, 700)
print("Highest optical density from 500 to 600 nm:", s.T.density().max(500, 600))
```

### edge

| JavaScript | Python |
| ---------- | ------ |
| `s.R.edge(start, end, { level, edgeSide, direction, step })` | `s.R.edge(start=..., end=..., level=0.5, edge_side=..., direction="max", step=1)` |

**JavaScript**：曲线在波段的峰旁穿越某一电平的位置，按规格窗口的 EDGE_LAMBDA 检查的方法求出：在计算该光谱的设计上、以曲线的入射角计算，因此交点是精确的，而不是从采样点读出的。电平是波段峰值的比例，因此在峰值为 T = 0.90 的波段上，`level: 0.5` 在 T = 0.45 处穿越。光谱的曲线有此方法；其他曲线没有。

**Python**：曲线在波段的峰旁穿越某一电平的位置，按规格窗口的 EDGE_LAMBDA 检查的方法求出：在计算该光谱的设计上、以曲线的入射角计算，因此交点是精确的，而不是从采样点读出的。电平是波段峰值的比例，因此在峰值为 T = 0.90 的波段上，level=0.5 在 T = 0.45 处穿越。光谱的曲线有此方法；其他曲线没有。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `start` | `start` |  | 波段的起始波长，单位 nm，在曲线范围以内。不给出时，为曲线的第一个波长。 |
| `end` | `end` |  | 波段的结束波长，单位 nm，在曲线范围以内。不给出时，为曲线的最后一个波长。 |
| `level` | `level` | `0.5` | 穿越的电平，0 到 1 之间的比例；小于 0.001 或大于 0.999 时按 0.001 或 0.999 计。 |
| `edgeSide` | `edge_side` |  | **JavaScript**：`'right'` 表示峰以上的交点；否则取峰以下的交点，峰以下没有交点时取峰以上的交点。<br>**Python**："right" 表示峰以上的交点。不给出时，取峰以下的交点，峰以下没有交点时取峰以上的交点。 |
| `direction` | `direction` | `'max'` | `'max'`，电平为波段内最大值的该比例；或 `'min'`，电平为从波段内最小值到 1 之间该比例处的值。 |
| `step` | `step` | `1` | 搜索峰所用的步长，单位 nm：1、0.1、0.01 或 0.001。交点在不粗于该步长、且至少 301 个采样点的波段扫描上确定。 |

**返回**：**JavaScript**：一个对象：`edge`，交点，单位 nm，曲线在波段内不穿越该电平时为 null；`reason`，此时为 `'edgeNotCrossed'`，否则为 null；`peak`，波段峰的波长，单位 nm，`peakValue`，曲线在该处的值；`level`，所用的电平，0.001 到 0.999，`levelValue`，曲线在交点处的值；以及 `feature`、`mode`、`quantity`、`angle`、`direction` 和 `step`。<br>**Python**：一个 Edge，即命名元组：edge，交点，单位 nm，曲线在波段内不穿越该电平时为 None；reason，此时为 "edgeNotCrossed"，否则为 None；peak，波段峰的波长，单位 nm，peak_value，曲线在该处的值；level，所用的电平，0.001 到 0.999，level_value，曲线在交点处的值；以及 feature、mode、quantity、angle、direction 和 step。

**拒绝**：

- 不是光谱曲线的曲线、不在曲线范围以内的波段，或不接受的选项、选项不能取的值

```js
const design = tf.newDesign('Long-wave pass');
design.stack('(0.5H L 0.5H)^8');
const s = design.spectrum(600, 760);
const e = s.T.edge(600, 760, { level: 0.5 });
console.log('T crosses', e.levelValue.toFixed(3), 'at', e.edge.toFixed(2), 'nm');
```

```python
design = tf.new_design("Long-wave pass")
design.stack("(0.5H L 0.5H)^8")
s = design.spectrum(600, 760)
e = s.T.edge(600, 760, level=0.5)
print("T crosses", round(e.level_value, 3), "at", round(e.edge, 2), "nm")
```

### fwhm

| JavaScript | Python |
| ---------- | ------ |
| `s.R.fwhm(start, end, { level, direction, step })` | `s.R.fwhm(start=..., end=..., level=0.5, direction="max", step=1)` |

波段的峰在曲线穿越某一电平处的全宽，默认为峰值的一半，按规格窗口的 FWHM 检查的方法求出，并给出两个交点、它们的中点和峰：在计算该光谱的设计上、以曲线的入射角计算，因此交点是精确的，而不是从采样点读出的。光谱的曲线有此方法；其他曲线没有。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `start` | `start` |  | 波段的起始波长，单位 nm，在曲线范围以内。不给出时，为曲线的第一个波长。 |
| `end` | `end` |  | 波段的结束波长，单位 nm，在曲线范围以内。不给出时，为曲线的最后一个波长。 |
| `level` | `level` | `0.5` | 穿越的电平，峰值的比例，0 到 1；小于 0.001 或大于 0.999 时按 0.001 或 0.999 计。 |
| `direction` | `direction` | `'max'` | `'max'`，峰的宽度；或 `'min'`，谷的宽度，电平为从最小值到 1 之间该比例处的值。 |
| `step` | `step` | `1` | 搜索峰所用的步长，单位 nm：1、0.1、0.01 或 0.001。两个交点在不粗于该步长、且至少 301 个采样点的波段扫描上确定。 |

**返回**：**JavaScript**：一个对象：`width`，`right` − `left`，单位 nm，即 FWHM 检查的值；`left` 和 `right`，峰以下和峰以上的交点，单位 nm；`centre`，二者的中点，单位 nm；有交点不在波段内时它们都为 null；`reason`，此时为 `'fwhmNotBracketed'`，否则为 null；`peak`、`peakValue`、`level` 和 `levelValue`，与 edge() 给出的相同；以及 `feature`、`mode`、`quantity`、`angle`、`direction` 和 `step`。<br>**Python**：一个 Width，即命名元组：width，right - left，单位 nm，即 FWHM 检查的值；left 和 right，峰以下和峰以上的交点，单位 nm；centre，二者的中点，单位 nm；有交点不在波段内时它们都为 None；reason，此时为 "fwhmNotBracketed"，否则为 None；peak、peak_value、level 和 level_value，与 edge() 给出的相同；以及 feature、mode、quantity、angle、direction 和 step。

**拒绝**：

- 不是光谱曲线的曲线、不在曲线范围以内的波段，或不接受的选项、选项不能取的值

```js
const design = tf.newDesign('Bandpass');
design.stack('(HL)^4 HH (LH)^4');
const s = design.spectrum(500, 600);
const band = s.T.fwhm(500, 600);
console.log('FWHM', band.width.toFixed(2), 'nm, centred at', band.centre.toFixed(2), 'nm, peak T', band.peakValue.toFixed(4));
```

```python
design = tf.new_design("Bandpass")
design.stack("(HL)^4 HH (LH)^4")
s = design.spectrum(500, 600)
band = s.T.fwhm(500, 600)
print("FWHM", round(band.width, 2), "nm, centred at", round(band.centre, 2), "nm, peak T", round(band.peak_value, 4))
```

### peak

| JavaScript | Python |
| ---------- | ------ |
| `s.R.peak(start, end, { direction, step })` | `s.R.peak(start=..., end=..., direction="max", step=1)` |

波段的峰或谷的波长，按规格窗口的中心 λ 检查的方法求出：在计算该光谱的设计上、以曲线的入射角搜索，而不是从采样点读出的。光谱的曲线有此方法；其他曲线没有。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `start` | `start` |  | 波段的起始波长，单位 nm，在曲线范围以内。不给出时，为曲线的第一个波长。 |
| `end` | `end` |  | 波段的结束波长，单位 nm，在曲线范围以内。不给出时，为曲线的最后一个波长。 |
| `direction` | `direction` | `'max'` | `'max'`，最大值；或 `'min'`，最小值。 |
| `step` | `step` | `1` | 搜索峰所用的步长，单位 nm：1、0.1、0.01 或 0.001。R 的峰以及 T 或 A 的谷不用步长求出，因此只能为 1。 |

**返回**：**JavaScript**：一个对象：`peak`，波长，单位 nm，`peakValue`，曲线在该处的值；以及 `feature`、`mode`、`quantity`、`angle`、`direction` 和 `step`。<br>**Python**：一个 Peak，即命名元组：peak，波长，单位 nm，peak_value，曲线在该处的值；以及 feature、mode、quantity、angle、direction 和 step。

**拒绝**：

- 不是光谱曲线的曲线、不在曲线范围以内的波段，或不接受的选项、选项不能取的值

```js
const design = tf.newDesign('Bandpass');
design.stack('(HL)^4 HH (LH)^4');
const s = design.spectrum(500, 600);
const top = s.T.peak(500, 600, { step: 0.01 });
console.log('Peak T', top.peakValue.toFixed(4), 'at', top.peak.toFixed(3), 'nm');
```

```python
design = tf.new_design("Bandpass")
design.stack("(HL)^4 HH (LH)^4")
s = design.spectrum(500, 600)
top = s.T.peak(500, 600, step=0.01)
print("Peak T", round(top.peak_value, 4), "at", round(top.peak, 3), "nm")
```

## IndexProfile

设计各膜层在某一波长处的折射率，按深度排列，由 `design.indexProfile()` / `design.index_profile()` 读出，与折射率分布窗口的显示相同。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
const profile = design.indexProfile({ wavelength: 633 });
for (const l of profile.layers) console.log(l.number, l.material, l.n, l.start, l.end);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
profile = design.index_profile(wavelength=633)
for l in profile.layers:
    print(l.number, l.material, l.n, l.start, l.end)
```

### mode

| JavaScript | Python |
| ---------- | ------ |
| `profile.mode` | `profile.mode` |

排列的对象：`'front'` 或 `'back'`，仅该面；`'total'`，整个元件。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
console.log(design.indexProfile().mode);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
print(design.index_profile().mode)
```

### wavelength

| JavaScript | Python |
| ---------- | ------ |
| `profile.wavelength` | `profile.wavelength` |

读取 n 和 k 所用的波长，单位 nm。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
console.log(design.indexProfile().wavelength, 'nm');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
print(design.index_profile().wavelength, "nm")
```

### incident

| JavaScript | Python |
| ---------- | ------ |
| `profile.incident` | `profile.incident` |

**JavaScript**：光射来的介质 `{ material, n, k }`：正面为入射介质，背面为出射介质；整个元件时为 null，其分布从正面的最外层开始。

**Python**：光射来的介质，一个具名元组 (material, n, k)：正面为入射介质，背面为出射介质；整个元件时为 None，其分布从正面的最外层开始。

```js
const design = tf.newDesign('Prism coating');
design.stack('(HL)^2');
design.incidentMedium = 'BK7';
const { incident } = design.indexProfile();
console.log(incident.material, incident.n);
```

```python
design = tf.new_design("Prism coating")
design.stack("(HL)^2")
design.incident_medium = "BK7"
incident = design.index_profile().incident
print(incident.material, incident.n)
```

### substrate

| JavaScript | Python |
| ---------- | ------ |
| `profile.substrate` | `profile.substrate` |

**JavaScript**：基底 `{ material, n, k }`；整个元件时还有 `thickness`，单位 mm，设计没有给出基底厚度时为 null。

**Python**：基底，一个具名元组 (material, n, k, thickness)，thickness 在整个元件时以 mm 为单位，在一面时为 None；整个元件时若设计没有给出基底厚度，则为 None。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
const { substrate } = design.indexProfile({ side: 'total' });
console.log(substrate.material, substrate.n, substrate.thickness, 'mm');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
substrate = design.index_profile(side="total").substrate
print(substrate.material, substrate.n, substrate.thickness, "mm")
```

### layers

| JavaScript | Python |
| ---------- | ------ |
| `profile.layers` | `profile.layers` |

**JavaScript**：每个有厚度的膜层一个对象 `{ number, material, n, k, thickness, start, end }`：number 与 design.layers 和 design.backLayers 的编号相同，1 紧邻基底；material 为材料 id；thickness、start 和 end 单位为 nm，start 和 end 是该层距其所在面外表面的深度。对于一面，膜层从外表面向内排列。对于整个元件，每层还有 `side`；先列正面的膜层，从其外表面向内，再列背面的膜层，从基底向外，start 和 end 从基底算起。

**Python**：每个有厚度的膜层一个具名元组 (side, number, material, n, k, thickness, start, end)：side 为该层所在的面；number 与 design.layers 和 design.back_layers 的编号相同，1 紧邻基底；material 为材料 id；thickness、start 和 end 单位为 nm，start 和 end 是该层距其所在面外表面的深度。对于一面，膜层从外表面向内排列。对于整个元件，先列正面的膜层，从其外表面向内，再列背面的膜层，从基底向外，start 和 end 从基底算起。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
for (const l of design.indexProfile().layers) console.log(l.number, l.material, l.n, l.k, l.start, l.end);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
for l in design.index_profile().layers:
    print(l.number, l.material, l.n, l.k, l.start, l.end)
```

### thickness

| JavaScript | Python |
| ---------- | ------ |
| `profile.thickness` | `profile.thickness` |

各膜层的物理厚度，单位 nm。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
console.log(design.indexProfile().thickness, 'nm');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
print(design.index_profile().thickness, "nm")
```

### opticalThickness / optical_thickness

| JavaScript | Python |
| ---------- | ------ |
| `profile.opticalThickness` | `profile.optical_thickness` |

各膜层的光学厚度，即该波长处 n 与厚度之积的总和，单位 nm。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
console.log(design.indexProfile({ wavelength: 550 }).opticalThickness, 'nm');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
print(design.index_profile(wavelength=550).optical_thickness, "nm")
```

### outOfRange / out_of_range

| JavaScript | Python |
| ---------- | ------ |
| `profile.outOfRange` | `profile.out_of_range` |

**JavaScript**：数据达不到该波长的材料，一个由 `{ id, name, rangeNm, heldFlat }` 组成的数组：它们在该处的 n 和 k 保持在最后的值（`heldFlat` 为 true）或外推得到。每种材料都覆盖该波长时为空。

**Python**：数据达不到该波长的材料，一个由 dict（id、name、rangeNm 和 heldFlat）组成的 list：它们在该处的 n 和 k 保持在最后的值（heldFlat 为 True）或外推得到。每种材料都覆盖该波长时为空。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
console.log(design.indexProfile({ wavelength: 5000 }).outOfRange.map(m => m.id));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
print([m["id"] for m in design.index_profile(wavelength=5000).out_of_range])
```

### saveCsv / save_csv

| JavaScript | Python |
| ---------- | ------ |
| `profile.saveCsv(path)` | `profile.save_csv(path)` |

把分布写入 CSV 文件，内容为窗口导出的表格，去掉窗口在两端画出的介质和基底段：n 和 k 的每一级台阶一行，带有它开始处的深度 `z (nm)`，从外表面到基底，最后一行给出基底。对于整个元件，各列为 `region`、`z`、`n` 和 `k`，每部分的深度从该部分的起点算起，基底的以 mm 为单位。已存在的文件会被覆盖。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `path` | `path` |  | **JavaScript**：要写入的文件，给出完整路径。相对路径以程序启动时所在的文件夹为基准：在脚本控制台中，是启动 TFStudio 时所在的文件夹，通常是其安装文件夹。<br>**Python**：要写入的文件。相对路径以程序的工作文件夹为基准：在脚本控制台中，是脚本所在的文件夹；未保存的脚本则是数据文件夹。 |

```js
const file = require('path').join(require('os').homedir(), `profile-${Date.now()}.csv`);
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
design.indexProfile({ wavelength: 633 }).saveCsv(file);
console.log('Wrote', file);
```

```python
import time

name = "profile-{}.csv".format(time.time_ns())
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
design.index_profile(wavelength=633).save_csv(name)
print("Wrote", name)
```

## LayerThicknesses

每层的物理厚度和光学厚度，由 `design.layerThicknesses()` / `design.layer_thicknesses()` 列出，与膜层厚度窗口的显示相同。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
for (const row of design.layerThicknesses().rows) console.log(row.number, row.material, row.thickness, row.qwot);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
for row in design.layer_thicknesses().rows:
    print(row.number, row.material, row.thickness, row.qwot)
```

### mode

| JavaScript | Python |
| ---------- | ------ |
| `thicknesses.mode` | `thicknesses.mode` |

列出的对象：`'front'` 或 `'back'`，该面的膜层；`'total'`，两面。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
console.log(design.layerThicknesses().mode);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
print(design.layer_thicknesses().mode)
```

### wavelength

| JavaScript | Python |
| ---------- | ------ |
| `thicknesses.wavelength` | `thicknesses.wavelength` |

计算光学厚度所用的波长 λ0，单位 nm。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
console.log(design.layerThicknesses().wavelength, 'nm');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
print(design.layer_thicknesses().wavelength, "nm")
```

### rows

| JavaScript | Python |
| ---------- | ------ |
| `thicknesses.rows` | `thicknesses.rows` |

**JavaScript**：每层一个对象，从紧邻基底的第 1 层向外：`{ number, material, thickness, opticalThickness, qwot, fwot }`：number 与 design.layers 和 design.backLayers 的编号相同；material 为材料 id；thickness 单位 nm；opticalThickness 为 n 与厚度之积，单位 nm；qwot 为 4 n d / λ0，fwot 为 n d / λ0，其中 n 为材料在该波长处的折射率。没有材料的膜层，这三个光学值为 null。两面时每行还有 `side`，正面的行在前。

**Python**：每层一个具名元组 (side, number, material, thickness, optical_thickness, qwot, fwot)，从紧邻基底的第 1 层向外：side 为该层所在的面；number 与 design.layers 和 design.back_layers 的编号相同；material 为材料 id；thickness 单位 nm；optical_thickness 为 n 与厚度之积，单位 nm；qwot 为 4 n d / λ0，fwot 为 n d / λ0，其中 n 为材料在该波长处的折射率。没有材料的膜层，这三个光学值为 None。两面时正面的行在前。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
for (const row of design.layerThicknesses({ wavelength: 600 }).rows) console.log(row.number, row.opticalThickness, row.qwot, row.fwot);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
for row in design.layer_thicknesses(wavelength=600).rows:
    print(row.number, row.optical_thickness, row.qwot, row.fwot)
```

### outOfRange / out_of_range

| JavaScript | Python |
| ---------- | ------ |
| `thicknesses.outOfRange` | `thicknesses.out_of_range` |

**JavaScript**：数据达不到该波长的材料，一个由 `{ id, name, rangeNm, heldFlat }` 组成的数组，与 IndexProfile 的相同。

**Python**：数据达不到该波长的材料，一个由 dict（id、name、rangeNm 和 heldFlat）组成的 list，与 IndexProfile 的相同。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
console.log(design.layerThicknesses({ wavelength: 5000 }).outOfRange.length, 'materials stop short of 5000 nm');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
print(len(design.layer_thicknesses(wavelength=5000).out_of_range), "materials stop short of 5000 nm")
```

## Admittance

**JavaScript**：一个镀膜面在某一波长处的 s 和 p 导纳轨迹，由 design.admittance() 计算，与导纳图窗口绘出的相同。复数值为 `{ re, im }`，采用 Macleod 的符号，即窗口所用的符号：吸收材料的导纳虚部为负。

**Python**：一个镀膜面在某一波长处的 s 和 p 导纳轨迹，由 design.admittance() 计算，与导纳图窗口绘出的相同。复数值为 Python 的 complex，采用 Macleod 的符号，即窗口所用的符号：吸收材料的导纳虚部为负。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
const locus = design.admittance(550).s;
for (const b of locus.boundaries) console.log(b.layer, b.name, b.Y.re.toFixed(4), b.Y.im.toFixed(4));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
locus = design.admittance(550).s
for b in locus.boundaries:
    print(b.layer, b.name, b.Y)
```

### mode

| JavaScript | Python |
| ---------- | ------ |
| `locus.mode` | `locus.mode` |

计算所在的面：`'front'` 或 `'back'`。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
console.log(design.admittance(550).mode);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
print(design.admittance(550).mode)
```

### wavelength

| JavaScript | Python |
| ---------- | ------ |
| `locus.wavelength` | `locus.wavelength` |

波长，单位 nm。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
console.log(design.admittance().wavelength, 'nm');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
print(design.admittance().wavelength, "nm")
```

### angle

| JavaScript | Python |
| ---------- | ------ |
| `locus.angle` | `locus.angle` |

入射角，单位为度，在光射来的介质中计。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
console.log(design.admittance(550, { angle: 30 }).angle, 'degrees');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
print(design.admittance(550, angle=30).angle, "degrees")
```

### plane

| JavaScript | Python |
| ---------- | ------ |
| `locus.plane` | `locus.plane` |

圆弧所在的平面：`'admittance'` 为 Y 平面，`'reflection'` 为反射系数 Γ 的平面。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
console.log(design.admittance(550, { plane: 'reflection' }).plane);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
print(design.admittance(550, plane="reflection").plane)
```

### incident

| JavaScript | Python |
| ---------- | ------ |
| `locus.incident` | `locus.incident` |

**JavaScript**：光射来的介质 `{ material, name }`：正面为入射介质，背面为出射介质。

**Python**：光射来的介质，一个具名元组 (material, name)：正面为入射介质，背面为出射介质。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
console.log(design.admittance(550).incident);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
print(design.admittance(550).incident)
```

### substrate

| JavaScript | Python |
| ---------- | ------ |
| `locus.substrate` | `locus.substrate` |

**JavaScript**：基底 `{ material, name }`。

**Python**：基底，一个具名元组 (material, name)。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
console.log(design.admittance(550).substrate.name);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
print(design.admittance(550).substrate.name)
```

### s

| JavaScript | Python |
| ---------- | ------ |
| `locus.s` | `locus.s` |

**JavaScript**：s 导纳轨迹 `{ eta0, etaSubstrate, boundaries, arcs }`：eta0 和 etaSubstrate 为介质和基底的导纳；boundaries 即窗口的表格，从基底向外每个界面一个 `{ layer, material, name, Y, gamma }`，layer 0 为裸基底，之后是每个有厚度的膜层，编号与 design.layers 相同，Y 为其外表面处的导纳，gamma 为该处的反射系数，最后一个位于镀膜的外表面；arcs 为每个有厚度的膜层一个 `{ layer, material, re, im }`，从基底向外，re 和 im 是窗口绘制该圆弧所经过的点，位于所选的平面中。

**Python**：s 导纳轨迹，一个具名元组 (eta0, eta_substrate, boundaries, arcs)：eta0 和 eta_substrate 为介质和基底的导纳；boundaries 即窗口的表格，从基底向外每个界面一个具名元组 (layer, material, name, Y, gamma)，layer 0 为裸基底，之后是每个有厚度的膜层，编号与 design.layers 相同，Y 为其外表面处的导纳，gamma 为该处的反射系数，最后一个位于镀膜的外表面；arcs 为每个有厚度的膜层一个具名元组 (layer, material, re, im)，从基底向外，re 和 im 是窗口绘制该圆弧所经过的点的 list，位于所选的平面中。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
const { gamma } = design.admittance(550, { angle: 45 }).s.boundaries.at(-1);
console.log('Rs', gamma.re ** 2 + gamma.im ** 2);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
gamma = design.admittance(550, angle=45).s.boundaries[-1].gamma
print("Rs", abs(gamma) ** 2)
```

### p

| JavaScript | Python |
| ---------- | ------ |
| `locus.p` | `locus.p` |

p 导纳轨迹，与 `s` 相同。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
const { Y } = design.admittance(550, { angle: 45 }).p.boundaries.at(-1);
console.log('Y at the front surface, p:', Y.re, Y.im);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
print("Y at the front surface, p:", design.admittance(550, angle=45).p.boundaries[-1].Y)
```

### outOfRange / out_of_range

| JavaScript | Python |
| ---------- | ------ |
| `locus.outOfRange` | `locus.out_of_range` |

**JavaScript**：所计算的面上数据达不到该波长的材料，一个由 `{ id, name, rangeNm, heldFlat }` 组成的数组：它们在该处的 n 和 k 保持在最后的值（`heldFlat` 为 true）或外推得到。每种材料都覆盖该波长时为空。

**Python**：所计算的面上数据达不到该波长的材料，一个由 dict（id、name、rangeNm 和 heldFlat）组成的 list：它们在该处的 n 和 k 保持在最后的值（heldFlat 为 True）或外推得到。每种材料都覆盖该波长时为空。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
console.log(design.admittance(5000).outOfRange.map(m => m.id));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
print([m["id"] for m in design.admittance(5000).out_of_range])
```

### saveCsv / save_csv

| JavaScript | Python |
| ---------- | ------ |
| `locus.saveCsv(path)` | `locus.save_csv(path)` |

**JavaScript**：把导纳轨迹写入 CSV 文件，与窗口在显示两种偏振时以“复制 CSV”写出其表格的方式相同：先 s 后 p，基底一行，从基底向外每层一行，光射来的介质一行，各行给出 Re(Y)、Im(Y)、Re(Γ) 和 Im(Γ)。已存在的文件会被覆盖。

**Python**：把导纳轨迹写入 CSV 文件，与窗口在显示两种偏振时以“复制 CSV”写出其表格的方式相同：先 s 后 p，基底一行，从基底向外每层一行，光射来的介质一行，各行给出 Re(Y)、Im(Y)、Re(Γ) 和 Im(Γ)。数值与窗口的相同，以 Python 的浮点数写法写出。已存在的文件会被覆盖。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `path` | `path` |  | **JavaScript**：要写入的文件，给出完整路径。相对路径以程序启动时所在的文件夹为基准：在脚本控制台中，是启动 TFStudio 时所在的文件夹，通常是其安装文件夹。<br>**Python**：要写入的文件。相对路径以程序的工作文件夹为基准：在脚本控制台中，是脚本所在的文件夹；未保存的脚本则是数据文件夹。 |

```js
const file = require('path').join(require('os').homedir(), `admittance-${Date.now()}.csv`);
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
design.admittance(550, { angle: 45 }).saveCsv(file);
console.log('Wrote', file);
```

```python
import time

name = "admittance-{}.csv".format(time.time_ns())
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
design.admittance(550, angle=45).save_csv(name)
print("Wrote", name)
```

## ElectricField

一个镀膜面在某一波长处 s、p 和非偏振光的电场，由 `design.electricField()` / `design.electric_field()` 计算，与电场窗口绘出的相同。

```js
const design = tf.newDesign('Mirror', { reference: 1064 });
design.stack('(HL)^4 H');
const field = design.electricField(1064);
console.log('peak |E|², s:', Math.max(...field.s.e2), 'over', field.z.length, 'samples');
```

```python
design = tf.new_design("Mirror", reference=1064)
design.stack("(HL)^4 H")
field = design.electric_field(1064)
print("peak |E|², s:", max(field.s.e2), "over", len(field.z), "samples")
```

### mode

| JavaScript | Python |
| ---------- | ------ |
| `field.mode` | `field.mode` |

计算所在的面：`'front'` 或 `'back'`。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
console.log(design.electricField(550).mode);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
print(design.electric_field(550).mode)
```

### wavelength

| JavaScript | Python |
| ---------- | ------ |
| `field.wavelength` | `field.wavelength` |

计算电场所用的波长，单位 nm。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
console.log(design.electricField().wavelength, 'nm');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
print(design.electric_field().wavelength, "nm")
```

### angle

| JavaScript | Python |
| ---------- | ------ |
| `field.angle` | `field.angle` |

入射角，单位为度，在光射来的介质中计。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
console.log(design.electricField(550, { angle: 30 }).angle, 'degrees');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
print(design.electric_field(550, angle=30).angle, "degrees")
```

### reference

| JavaScript | Python |
| ---------- | ------ |
| `field.reference` | `field.reference` |

读取深度所用的波长 λ0，单位 nm。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
console.log(design.electricField(633, { depthUnit: 'QWOT' }).reference, 'nm');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
print(design.electric_field(633, depth_unit="QWOT").reference, "nm")
```

### depthUnit / depth_unit

| JavaScript | Python |
| ---------- | ------ |
| `field.depthUnit` | `field.depth_unit` |

`depth` 的单位：`'nm'`、`'OT'`、`'QWOT'` 或 `'FWOT'`；要求光学单位而某种材料在参考波长处没有折射率时为 `'nm'`。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
console.log(design.electricField(550, { depthUnit: 'FWOT' }).depthUnit);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
print(design.electric_field(550, depth_unit="FWOT").depth_unit)
```

### pointsPerLayer / points_per_layer

| JavaScript | Python |
| ---------- | ------ |
| `field.pointsPerLayer` | `field.points_per_layer` |

每层取的采样点数。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
console.log(design.electricField(550, { pointsPerLayer: 200 }).pointsPerLayer);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
print(design.electric_field(550, points_per_layer=200).points_per_layer)
```

### z

| JavaScript | Python |
| ---------- | ------ |
| `field.z` | `field.z` |

**JavaScript**：每个采样点距外表面的深度，单位 nm，一个数组：第一个位于外表面，最后一个位于基底。

**Python**：每个采样点距外表面的深度，单位 nm，一个 list：第一个位于外表面，最后一个位于基底。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
const { z } = design.electricField(550);
console.log(z.length, 'samples down to', z.at(-1), 'nm');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
z = design.electric_field(550).z
print(len(z), "samples down to", z[-1], "nm")
```

### depth

| JavaScript | Python |
| ---------- | ------ |
| `field.depth` | `field.depth` |

**JavaScript**：每个采样点以 `depthUnit` 计的深度，一个数组。

**Python**：每个采样点以 depth_unit 计的深度，一个 list。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
console.log(design.electricField(550, { depthUnit: 'QWOT' }).depth.at(-1), 'quarter waves');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
print(design.electric_field(550, depth_unit="QWOT").depth[-1], "quarter waves")
```

### layers

| JavaScript | Python |
| ---------- | ------ |
| `field.layers` | `field.layers` |

**JavaScript**：每个有厚度的膜层一个对象，按光遇到它们的顺序排列，`{ number, material, start, end, depthStart, depthEnd }`：number 与 design.layers 和 design.backLayers 的编号相同；material 为材料 id；start 和 end 为其距外表面的深度，单位 nm，depthStart 和 depthEnd 以 `depthUnit` 计。

**Python**：每个有厚度的膜层一个具名元组 (number, material, start, end, depth_start, depth_end)，按光遇到它们的顺序排列：number 与 design.layers 和 design.back_layers 的编号相同；material 为材料 id；start 和 end 为其距外表面的深度，单位 nm，depth_start 和 depth_end 以 depth_unit 计。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
for (const l of design.electricField(550).layers) console.log(l.number, l.material, l.start.toFixed(1), 'to', l.end.toFixed(1), 'nm');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
for l in design.electric_field(550).layers:
    print(l.number, l.material, round(l.start, 1), "to", round(l.end, 1), "nm")
```

### s

| JavaScript | Python |
| ---------- | ------ |
| `field.s` | `field.s` |

**JavaScript**：s 电场 `{ e2, e2Tangential, e2Normal, amplitude }`，每个采样点一个值：总场及其沿膜层方向和垂直于膜层的分量的 |E|²，为入射 |E|² 的比例；以及总场的幅值，单位 V/m，对应 1 W/m² 的入射光。

**Python**：s 电场，一个由 list 组成的具名元组 (e2, e2_tangential, e2_normal, amplitude)，每个采样点一个值：总场及其沿膜层方向和垂直于膜层的分量的 |E|²，为入射 |E|² 的比例；以及总场的幅值，单位 V/m，对应 1 W/m² 的入射光。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
console.log('peak |E|², s:', Math.max(...design.electricField(550).s.e2));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
print("peak |E|², s:", max(design.electric_field(550).s.e2))
```

### p

| JavaScript | Python |
| ---------- | ------ |
| `field.p` | `field.p` |

p 电场，与 `s` 相同。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
const { p } = design.electricField(550, { angle: 45 });
console.log('peak normal component, p:', Math.max(...p.e2Normal));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
print("peak normal component, p:", max(design.electric_field(550, angle=45).p.e2_normal))
```

### avg

| JavaScript | Python |
| ---------- | ------ |
| `field.avg` | `field.avg` |

非偏振电场，即逐个采样点取 s 和 p 电场的平均，与 `s` 相同。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
console.log('peak amplitude, avg:', Math.max(...design.electricField(550, { angle: 45 }).avg.amplitude), 'V/m');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
print("peak amplitude, avg:", max(design.electric_field(550, angle=45).avg.amplitude), "V/m")
```

### incidentAmplitude / incident_amplitude

| JavaScript | Python |
| ---------- | ------ |
| `field.incidentAmplitude` | `field.incident_amplitude` |

入射光束的幅值，单位 V/m，对应 1 W/m²，由光射来的介质的折射率得出：|E|² 为 1 时读出的就是这个幅值。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
console.log(design.electricField(550).incidentAmplitude, 'V/m');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
print(design.electric_field(550).incident_amplitude, "V/m")
```

### outOfRange / out_of_range

| JavaScript | Python |
| ---------- | ------ |
| `field.outOfRange` | `field.out_of_range` |

**JavaScript**：所计算的面上数据达不到该波长的材料，一个由 `{ id, name, rangeNm, heldFlat }` 组成的数组，与 Admittance 的相同。

**Python**：所计算的面上数据达不到该波长的材料，一个由 dict（id、name、rangeNm 和 heldFlat）组成的 list，与 Admittance 的相同。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
console.log(design.electricField(5000).outOfRange.length, 'materials stop short of 5000 nm');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
print(len(design.electric_field(5000).out_of_range), "materials stop short of 5000 nm")
```

### saveCsv / save_csv

| JavaScript | Python |
| ---------- | ------ |
| `field.saveCsv(path)` | `field.save_csv(path)` |

**JavaScript**：把电场写入 CSV 文件，与窗口在出厂显示设置下以“复制 CSV”写出其表格的方式相同：每个采样点一行，给出以 `depthUnit` 计的深度，以及 avg、s 和 p 的总场幅值，单位 V/m，对应 1 W/m²。已存在的文件会被覆盖。

**Python**：把电场写入 CSV 文件，与窗口在出厂显示设置下以“复制 CSV”写出其表格的方式相同：每个采样点一行，给出以 depth_unit 计的深度，以及 avg、s 和 p 的总场幅值，单位 V/m，对应 1 W/m²。数值与窗口的相同，以 Python 的浮点数写法写出。已存在的文件会被覆盖。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `path` | `path` |  | **JavaScript**：要写入的文件，给出完整路径。相对路径以程序启动时所在的文件夹为基准：在脚本控制台中，是启动 TFStudio 时所在的文件夹，通常是其安装文件夹。<br>**Python**：要写入的文件。相对路径以程序的工作文件夹为基准：在脚本控制台中，是脚本所在的文件夹；未保存的脚本则是数据文件夹。 |

```js
const file = require('path').join(require('os').homedir(), `field-${Date.now()}.csv`);
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
design.electricField(550).saveCsv(file);
console.log('Wrote', file);
```

```python
import time

design = tf.new_design("Laser mirror", reference=1064)
design.stack("(HL)^5 H")
field = design.electric_field(1064, depth_unit="QWOT")
name = "field-{}.csv".format(time.time_ns())
field.save_csv(name)
print("Wrote", len(field.z), "rows to", name)
```

## Color

设计的反射率或透射率的 CIE 颜色，与 design.color() 的计算和颜色评估窗口的显示相同：在一种光源下 380-780 nm 波段上的三刺激值、各颜色空间、主波长、相关色温和 sRGB 色块。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
const c = design.color({ illuminant: 'D50' });
console.log(c.mode, c.x.toFixed(4), c.y.toFixed(4), c.lab);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
c = design.color(illuminant="D50")
print(c.mode, round(c.x, 4), round(c.y, 4), c.lab)
```

### mode

| JavaScript | Python |
| ---------- | ------ |
| `c.mode` | `c.mode` |

所计算的对象：`'front'`、`'back'` 或 `'total'`（整个元件）。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
console.log(design.color().mode);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
print(design.color().mode)
```

### quantity

| JavaScript | Python |
| ---------- | ------ |
| `c.quantity` | `c.quantity` |

计算颜色的量：`'R'` 或 `'T'`。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
console.log(design.color({ quantity: 'T' }).quantity);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
print(design.color(quantity="T").quantity)
```

### angle

| JavaScript | Python |
| ---------- | ------ |
| `c.angle` | `c.angle` |

入射角，单位为度，在入射介质中计。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
console.log(design.color({ angle: 30 }).angle, 'degrees');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
print(design.color(angle=30).angle, "degrees")
```

### pol

| JavaScript | Python |
| ---------- | ------ |
| `c.pol` | `c.pol` |

偏振：`'avg'`、`'s'` 或 `'p'`。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
console.log(design.color({ angle: 45, pol: 's' }).pol);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
print(design.color(angle=45, pol="s").pol)
```

### observer

| JavaScript | Python |
| ---------- | ------ |
| `c.observer` | `c.observer` |

CIE 标准观察者，按其视场角度给出：`2` 或 `10`。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
console.log(design.color({ observer: 10 }).observer);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
print(design.color(observer=10).observer)
```

### illuminant

| JavaScript | Python |
| ---------- | ------ |
| `c.illuminant` | `c.illuminant` |

CIE 光源：`'D65'`、`'D50'`、`'A'` 或 `'E'`。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
console.log(design.color({ illuminant: 'A' }).illuminant);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
print(design.color(illuminant="A").illuminant)
```

### step

| JavaScript | Python |
| ---------- | ------ |
| `c.step` | `c.step` |

用于积分颜色的光谱的波长步长，单位 nm。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
console.log(design.color({ step: 1 }).step, 'nm');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
print(design.color(step=1).step, "nm")
```

### X

| JavaScript | Python |
| ---------- | ------ |
| `c.X` | `c.X` |

三刺激值 X，以白色的 Y 为 100 计。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
console.log(design.color().X);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
print(design.color().X)
```

### Y

| JavaScript | Python |
| ---------- | ------ |
| `c.Y` | `c.Y` |

三刺激值 Y：光度反射率或透射率，单位 %。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
console.log('luminous R', design.color().Y.toFixed(2), '%');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
print("luminous R", round(design.color().Y, 2), "%")
```

### Z

| JavaScript | Python |
| ---------- | ------ |
| `c.Z` | `c.Z` |

三刺激值 Z，以白色的 Y 为 100 计。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
console.log(design.color().Z);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
print(design.color().Z)
```

### x

| JavaScript | Python |
| ---------- | ------ |
| `c.x` | `c.x` |

色度坐标 x。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
console.log(design.color().x.toFixed(4));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
print(round(design.color().x, 4))
```

### y

| JavaScript | Python |
| ---------- | ------ |
| `c.y` | `c.y` |

色度坐标 y。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
console.log(design.color().y.toFixed(4));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
print(round(design.color().y, 4))
```

### white

| JavaScript | Python |
| ---------- | ------ |
| `c.white` | `c.white` |

**JavaScript**：光源的白色，`{ X, Y, Z }`，Y 为 100：即 R 或 T 为 1 时在同一网格上积分的结果。

**Python**：光源的白色，一个具名元组 (X, Y, Z)，Y 为 100：即 R 或 T 为 1 时在同一网格上积分的结果。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
console.log(design.color({ illuminant: 'D50' }).white);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
print(design.color(illuminant="D50").white)
```

### whiteXy / white_xy

| JavaScript | Python |
| ---------- | ------ |
| `c.whiteXy` | `c.white_xy` |

**JavaScript**：白色的色度坐标，`{ x, y }`。

**Python**：白色的色度坐标，一个具名元组 (x, y)。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
console.log(design.color().whiteXy);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
print(design.color().white_xy)
```

### lab

| JavaScript | Python |
| ---------- | ------ |
| `c.lab` | `c.lab` |

**JavaScript**：CIE L*a*b*，`{ L, a, b, C, h }`，色相角 h 以度计。

**Python**：CIE L*a*b*，一个具名元组 (L, a, b, C, h)，色相角 h 以度计。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
const { L, a, b } = design.color().lab;
console.log(L.toFixed(2), a.toFixed(2), b.toFixed(2));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
lab = design.color().lab
print(round(lab.L, 2), round(lab.a, 2), round(lab.b, 2))
```

### luv

| JavaScript | Python |
| ---------- | ------ |
| `c.luv` | `c.luv` |

**JavaScript**：CIE L*u*v*，`{ L, u, v, C, h, s }`，色相角 h 以度计，s 为饱和度。

**Python**：CIE L*u*v*，一个具名元组 (L, u, v, C, h, s)，色相角 h 以度计，s 为饱和度。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
console.log(design.color().luv);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
print(design.color().luv)
```

### uv1976

| JavaScript | Python |
| ---------- | ------ |
| `c.uv1976` | `c.uv1976` |

**JavaScript**：CIE 1976 UCS 色度坐标，`{ u, v }`：即 u′ 和 v′。

**Python**：CIE 1976 UCS 色度坐标，一个具名元组 (u, v)：即 u′ 和 v′。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
console.log(design.color().uv1976);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
print(design.color().uv1976)
```

### uv1960

| JavaScript | Python |
| ---------- | ------ |
| `c.uv1960` | `c.uv1960` |

**JavaScript**：CIE 1960 UCS 色度坐标，`{ u, v }`。

**Python**：CIE 1960 UCS 色度坐标，一个具名元组 (u, v)。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
console.log(design.color().uv1960);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
print(design.color().uv1960)
```

### hunterLab / hunter_lab

| JavaScript | Python |
| ---------- | ------ |
| `c.hunterLab` | `c.hunter_lab` |

**JavaScript**：Hunter Lab，`{ L, a, b }`。

**Python**：Hunter Lab，一个具名元组 (L, a, b)。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
console.log(design.color().hunterLab);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
print(design.color().hunter_lab)
```

### dominant

| JavaScript | Python |
| ---------- | ------ |
| `c.dominant` | `c.dominant` |

**JavaScript**：`{ wavelength, complementary, purity }`：主波长，单位 nm；紫色则主波长为 null，并给出其补色波长，单位 nm；purity 为兴奋纯度，以 1 的分数计，紫色的纯度量到紫线。对白色本身，两个波长都为 null。

**Python**：一个具名元组 (wavelength, complementary, purity)：主波长，单位 nm；紫色则主波长为 None，并给出其补色波长，单位 nm；purity 为兴奋纯度，以 1 的分数计，紫色的纯度量到紫线。对白色本身，两个波长都为 None。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
const { wavelength, complementary, purity } = design.color().dominant;
console.log(wavelength ?? `complementary ${complementary}`, 'nm, purity', purity.toFixed(3));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
d = design.color().dominant
print(d.wavelength if d.wavelength is not None else "complementary {}".format(d.complementary),
      "nm, purity", round(d.purity, 3))
```

### cct

| JavaScript | Python |
| ---------- | ------ |
| `c.cct` | `c.cct` |

**JavaScript**：相关色温，单位 K，由 McCamy 公式在 2 度色度坐标上求得，与观察者无关；超出该公式覆盖的 1000 K 到 1e6 K，或离普朗克轨迹超过 0.05 时为 NaN。

**Python**：相关色温，单位 K，由 McCamy 公式在 2 度色度坐标上求得，与观察者无关；超出该公式覆盖的 1000 K 到 1e6 K，或离普朗克轨迹超过 0.05 时为 nan。

```js
const design = tf.newDesign('AR');
design.stack('HL');
console.log(design.color({ quantity: 'T' }).cct.toFixed(0), 'K');
```

```python
design = tf.new_design("AR")
design.stack("HL")
print(round(design.color(quantity="T").cct), "K")
```

### duv

| JavaScript | Python |
| ---------- | ------ |
| `c.duv` | `c.duv` |

**JavaScript**：到普朗克轨迹的距离，在 CIE 1960 u, v 中计，在轨迹上方为正；超出 McCamy 公式覆盖的范围时为 NaN。

**Python**：到普朗克轨迹的距离，在 CIE 1960 u, v 中计，在轨迹上方为正；超出 McCamy 公式覆盖的范围时为 nan。

```js
const design = tf.newDesign('AR');
design.stack('HL');
console.log(design.color({ quantity: 'T' }).duv.toFixed(4));
```

```python
design = tf.new_design("AR")
design.stack("HL")
print(round(design.color(quantity="T").duv, 4))
```

### srgb

| JavaScript | Python |
| ---------- | ------ |
| `c.srgb` | `c.srgb` |

**JavaScript**：窗口的色块，`{ r, g, b }`，各为 0 到 255：曝光为 1 时的 sRGB，从光源的白色适配到 D65。

**Python**：窗口的色块，一个具名元组 (r, g, b)，各为 0 到 255：曝光为 1 时的 sRGB，从光源的白色适配到 D65。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
const { r, g, b } = design.color().srgb;
console.log(`rgb(${r}, ${g}, ${b})`);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
print("rgb{}".format(tuple(design.color().srgb)))
```

### outOfRange / out_of_range

| JavaScript | Python |
| ---------- | ------ |
| `c.outOfRange` | `c.out_of_range` |

**JavaScript**：所计算对象上数据在 380-780 nm 内中断的材料，一个由 `{ id, name, rangeNm, heldFlat }` 组成的数组：在 `rangeNm` 之外，它们的 n 和 k 保持在最后的值（`heldFlat` 为 true）或外推得到。每种材料都覆盖该波段时为空。

**Python**：所计算对象上数据在 380-780 nm 内中断的材料，一个由 dict { id, name, rangeNm, heldFlat } 组成的 list：在 rangeNm 之外，它们的 n 和 k 保持在最后的值（heldFlat 为 True）或外推得到。每种材料都覆盖该波段时为空。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
console.log(design.color().outOfRange.map(m => m.id));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
print([m["id"] for m in design.color().out_of_range])
```

## Integrals

**JavaScript**：设计的 T、R 和 A 的加权平均，与 design.integrals() 的计算和积分值窗口的列表相同：先是内置的行，从 Tvis 到 RNIR，然后是你自己的行，每行用 get() 按其 key 读取。

**Python**：设计的 T、R 和 A 的加权平均，与 design.integrals() 的计算和积分值窗口的列表相同：先是内置的行，从 Tvis 到 RNIR，然后是你自己的行，每行用 [] 按其 key 读取。

```js
const design = tf.newDesign('AR');
design.stack('HL');
const iv = design.integrals();
console.log(iv.mode, 'Tvis', iv.get('Tvis').value.toFixed(4), 'Rsol', iv.get('Rsol').value.toFixed(4));
```

```python
design = tf.new_design("AR")
design.stack("HL")
iv = design.integrals()
print(iv.mode, "Tvis", round(iv["Tvis"].value, 4), "Rsol", round(iv["Rsol"].value, 4))
```

### mode

| JavaScript | Python |
| ---------- | ------ |
| `iv.mode` | `iv.mode` |

所计算的对象：`'front'`、`'back'` 或 `'total'`（整个元件）。

```js
const design = tf.newDesign('AR');
design.stack('HL');
console.log(design.integrals().mode);
```

```python
design = tf.new_design("AR")
design.stack("HL")
print(design.integrals().mode)
```

### start

| JavaScript | Python |
| ---------- | ------ |
| `iv.start` | `iv.start` |

光谱的起始波长，单位 nm。

```js
const design = tf.newDesign('AR');
design.stack('HL');
console.log(design.integrals({ start: 350 }).start, 'nm');
```

```python
design = tf.new_design("AR")
design.stack("HL")
print(design.integrals(start=350).start, "nm")
```

### end

| JavaScript | Python |
| ---------- | ------ |
| `iv.end` | `iv.end` |

光谱的终止波长，单位 nm。

```js
const design = tf.newDesign('AR');
design.stack('HL');
console.log(design.integrals({ end: 1200 }).end, 'nm');
```

```python
design = tf.new_design("AR")
design.stack("HL")
print(design.integrals(end=1200).end, "nm")
```

### step

| JavaScript | Python |
| ---------- | ------ |
| `iv.step` | `iv.step` |

波长步长，单位 nm。

```js
const design = tf.newDesign('AR');
design.stack('HL');
console.log(design.integrals({ step: 1 }).step, 'nm');
```

```python
design = tf.new_design("AR")
design.stack("HL")
print(design.integrals(step=1).step, "nm")
```

### angle

| JavaScript | Python |
| ---------- | ------ |
| `iv.angle` | `iv.angle` |

入射角，单位为度，在入射介质中计。

```js
const design = tf.newDesign('AR');
design.stack('HL');
console.log(design.integrals({ angle: 30 }).angle, 'degrees');
```

```python
design = tf.new_design("AR")
design.stack("HL")
print(design.integrals(angle=30).angle, "degrees")
```

### pol

| JavaScript | Python |
| ---------- | ------ |
| `iv.pol` | `iv.pol` |

偏振：`'avg'`、`'s'` 或 `'p'`。

```js
const design = tf.newDesign('AR');
design.stack('HL');
console.log(design.integrals({ angle: 45, pol: 'p' }).pol);
```

```python
design = tf.new_design("AR")
design.stack("HL")
print(design.integrals(angle=45, pol="p").pol)
```

### rows

| JavaScript | Python |
| ---------- | ------ |
| `iv.rows` | `iv.rows` |

**JavaScript**：各行，先是窗口所列的内置行，再是你的行，每行为 `{ key, quantity, value, min, minAt, max, maxAt, band, covered, spectrumSpan }`：`quantity` 为 `'T'`、`'R'` 或 `'A'`；`value` 为加权平均，`min` 和 `max` 为该波段上的最低值和最高值，以 1 的分数计；`minAt` 和 `maxAt` 为它们所在的波长，单位 nm；`band` 为所积分的波段，以 nm 计的 `[start, end]`；`covered` 表示光谱是否覆盖该波段，不覆盖时或权重在整个波段上为 0 时，各个数为 NaN；`spectrumSpan` 为光谱的首末波长，单位 nm。

**Python**：各行，先是窗口所列的内置行，再是你的行，每行是一个具名元组 (key, quantity, value, min, min_at, max, max_at, band, covered, spectrum_span)：quantity 为 "T"、"R" 或 "A"；value 为加权平均，min 和 max 为该波段上的最低值和最高值，以 1 的分数计；min_at 和 max_at 为它们所在的波长，单位 nm；band 为所积分的波段，以 nm 计的 (start, end)；covered 表示光谱是否覆盖该波段，不覆盖时或权重在整个波段上为 0 时，各个数为 nan；spectrum_span 为光谱的首末波长，单位 nm。

```js
const design = tf.newDesign('AR');
design.stack('HL');
for (const row of design.integrals().rows) console.log(row.key, row.covered ? row.value.toFixed(4) : 'no value');
```

```python
design = tf.new_design("AR")
design.stack("HL")
for row in design.integrals().rows:
    print(row.key, round(row.value, 4) if row.covered else "no value")
```

### get / []

| JavaScript | Python |
| ---------- | ------ |
| `iv.get(key)` | `iv[key]` |

名为 `key` 的积分所在的行，与 `rows` 给出的相同。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `key` | `key` |  | 行的 key：Tvis、Rvis、Avis、Tsol、Rsol、Asol、TUV、RUV、TNIR、RNIR，或你自己某一行的 key。 |

**返回**：该行。

**拒绝**：

- 没有任何行使用的 key

```js
const design = tf.newDesign('AR');
design.stack('HL');
const { value, min, minAt } = design.integrals().get('Rvis');
console.log('Rvis', value.toFixed(4), 'lowest', min.toFixed(4), 'at', minAt, 'nm');
```

```python
design = tf.new_design("AR")
design.stack("HL")
row = design.integrals()["Rvis"]
print("Rvis", round(row.value, 4), "lowest", round(row.min, 4), "at", row.min_at, "nm")
```

### outOfRange / out_of_range

| JavaScript | Python |
| ---------- | ------ |
| `iv.outOfRange` | `iv.out_of_range` |

**JavaScript**：所计算对象上数据在该范围内中断的材料，一个由 `{ id, name, rangeNm, heldFlat }` 组成的数组：在 `rangeNm` 之外，它们的 n 和 k 保持在最后的值（`heldFlat` 为 true）或外推得到。每种材料都覆盖该范围时为空。

**Python**：所计算对象上数据在该范围内中断的材料，一个由 dict { id, name, rangeNm, heldFlat } 组成的 list：在 rangeNm 之外，它们的 n 和 k 保持在最后的值（heldFlat 为 True）或外推得到。每种材料都覆盖该范围时为空。

```js
const design = tf.newDesign('AR');
design.stack('HL');
console.log(design.integrals().outOfRange.map(m => m.id));
```

```python
design = tf.new_design("AR")
design.stack("HL")
print([m["id"] for m in design.integrals().out_of_range])
```

### saveCsv / save_csv

| JavaScript | Python |
| ---------- | ------ |
| `iv.saveCsv(path)` | `iv.save_csv(path)` |

**JavaScript**：把各行写入 CSV 文件，与窗口的英文导出写出其表格的方式相同：Integral、Value、%、Min、Min λ (nm)、Max、Max λ (nm) 和 Band 各列，每行以其 key 命名（内置行的 key 即窗口自己的名称），没有数值的行留空单元格。已存在的文件会被覆盖。

**Python**：把各行写入 CSV 文件，与窗口的英文导出写出其表格的方式相同：Integral、Value、%、Min、Min λ (nm)、Max、Max λ (nm) 和 Band 各列，每行以其 key 命名（内置行的 key 即窗口自己的名称），没有数值的行留空单元格。数值与窗口的相同，以 Python 的浮点数写法写出。已存在的文件会被覆盖。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `path` | `path` |  | **JavaScript**：要写入的文件，给出完整路径。相对路径以程序启动时所在的文件夹为基准：在脚本控制台中，是启动 TFStudio 时所在的文件夹，通常是其安装文件夹。<br>**Python**：要写入的文件。相对路径以程序的工作文件夹为基准：在脚本控制台中，是脚本所在的文件夹；未保存的脚本则是数据文件夹。 |

```js
const file = require('path').join(require('os').homedir(), `integrals-${Date.now()}.csv`);
const design = tf.newDesign('AR');
design.stack('HL');
design.integrals().saveCsv(file);
console.log('Wrote', file);
```

```python
import time

name = "integrals-{}.csv".format(time.time_ns())
design = tf.new_design("AR")
design.stack("HL")
design.integrals().save_csv(name)
print("Wrote", name)
```

## Ellipsometry

一个镀膜面的 Ψ 和 Δ：design.ellipsometry() 在一个或多个入射角下随波长计算它们，`design.ellipsometryVsAngle()` / `design.ellipsometry_vs_angle()` 在一个波长处随角度计算它们。随波长计算时，`e.psi` 和 `e.delta` 是第一个所要求角度下的 Curve，`e.angle(70)` 是另一个角度下的扫描；随角度计算时，它们是 AngleCurve。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
const e = design.ellipsometry(400, 800, { angles: [65, 70] });
console.log(e.mode, Math.min(...e.psi), Math.max(...e.angle(70).delta));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
e = design.ellipsometry(400, 800, angles=[65, 70])
print(e.mode, min(e.psi), max(e.angle(70).delta))
```

### mode

| JavaScript | Python |
| ---------- | ------ |
| `e.mode` | `e.mode` |

计算所在的面：`'front'` 或 `'back'`。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
console.log(design.ellipsometry().mode);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
print(design.ellipsometry().mode)
```

### wavelength

| JavaScript | Python |
| ---------- | ------ |
| `e.wavelength` | `e.wavelength` |

随波长计算时，为各波长，单位 nm；随角度计算时，为那一个波长，单位 nm。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
console.log(design.ellipsometry(400, 800, { step: 100 }).wavelength.join(', '), design.ellipsometryVsAngle(633).wavelength);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
print(design.ellipsometry(400, 800, step=100).wavelength, design.ellipsometry_vs_angle(633).wavelength)
```

### angles

| JavaScript | Python |
| ---------- | ------ |
| `e.angles` | `e.angles` |

入射角，单位为度，在光射来的介质中计：随波长计算时，为所要求的角度，顺序与要求时相同；随角度计算时，为扫描的各角度。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
const e = design.ellipsometry(400, 800, { angles: [55, 70] });
for (const a of e.angles) console.log(a, Math.min(...e.angle(a).psi));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
e = design.ellipsometry(400, 800, angles=[55, 70])
for a in e.angles:
    print(a, min(e.angle(a).psi))
```

### deltaConvention / delta_convention

| JavaScript | Python |
| ---------- | ------ |
| `e.deltaConvention` | `e.delta_convention` |

Δ 的符号：`'azzam'` 为椭偏仪记录的 Azzam-Bashara 符号，`'reversed'` 为 360 度减去该值。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
console.log(design.ellipsometry(400, 800, { deltaConvention: 'reversed' }).deltaConvention);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
print(design.ellipsometry(400, 800, delta_convention="reversed").delta_convention)
```

### psi

| JavaScript | Python |
| ---------- | ------ |
| `e.psi` | `e.psi` |

Ψ，单位为度，从 0 到 90，其中 tan Ψ 为 |r_p| / |r_s|：随波长计算时为第一个角度下的 Curve，随角度计算时为 AngleCurve。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
console.log(design.ellipsometry().psi.mean(500, 600));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
print(design.ellipsometry().psi.mean(500, 600))
```

### delta

| JavaScript | Python |
| ---------- | ------ |
| `e.delta` | `e.delta` |

Δ，单位为度，从 0 起，小于 360，即 r_p / r_s 的相位，采用 `deltaConvention` / `delta_convention` 所指的符号约定：随波长计算时为第一个角度下的 Curve，随角度计算时为 AngleCurve。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
console.log(Math.max(...design.ellipsometryVsAngle(633).delta));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
print(max(design.ellipsometry_vs_angle(633).delta))
```

### outOfRange / out_of_range

| JavaScript | Python |
| ---------- | ------ |
| `e.outOfRange` | `e.out_of_range` |

**JavaScript**：所计算的面上数据在范围内中断的材料，对随角度的扫描则是数据达不到那一个波长的材料，一个由 `{ id, name, rangeNm, heldFlat }` 组成的数组：在 `rangeNm` 之外，它们的 n 和 k 保持在最后的值（`heldFlat` 为 true）或外推得到。每种材料都覆盖时为空。

**Python**：所计算的面上数据在范围内中断的材料，对随角度的扫描则是数据达不到那一个波长的材料，一个由 dict（id、name、rangeNm 和 heldFlat）组成的 list：在 rangeNm 之外，它们的 n 和 k 保持在最后的值（heldFlat 为 True）或外推得到。每种材料都覆盖时为空。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
console.log(design.ellipsometry(200, 2500, { step: 10 }).outOfRange.map(m => m.id));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
print([m["id"] for m in design.ellipsometry(200, 2500, step=10).out_of_range])
```

### angle

| JavaScript | Python |
| ---------- | ------ |
| `e.angle(angle)` | `e.angle(angle)` |

随波长的扫描在计算时所用的某一个角度下的结果。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `angle` | `angle` |  | 入射角，单位为度。 |

**返回**：只含该角度的一个 Ellipsometry。

**拒绝**：

- 扫描计算时未包含的角度，或随角度的扫描

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
const e = design.ellipsometry(400, 800, { angles: [55, 70] });
console.log(Math.min(...e.angle(70).psi));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
e = design.ellipsometry(400, 800, angles=[55, 70])
print(min(e.angle(70).psi))
```

### saveCsv / save_csv

| JavaScript | Python |
| ---------- | ------ |
| `e.saveCsv(path)` | `e.save_csv(path)` |

**JavaScript**：把 Ψ 和 Δ 写入 CSV 文件，与窗口的导出写出其表格的方式相同：一列波长 λ (nm) 或一列角度 AOI (°)，然后是 Ψ (°) 和 Δ (°)。随波长计算且有多个角度时，依次给出每个角度的 Ψ 和 Δ，各列标题注明其角度。随波长计算且只有一个角度时，先写两行 #，与实测椭偏窗口导出设计 Ψ/Δ 的写法相同：设计的名称，然后是入射角和面，其导入会读回这些内容。已存在的文件会被覆盖。

**Python**：把 Ψ 和 Δ 写入 CSV 文件，与窗口的导出写出其表格的方式相同：一列波长 λ (nm) 或一列角度 AOI (°)，然后是 Ψ (°) 和 Δ (°)。随波长计算且有多个角度时，依次给出每个角度的 Ψ 和 Δ，各列标题注明其角度。随波长计算且只有一个角度时，先写两行 #，与实测椭偏窗口导出设计 Psi/Delta 的写法相同：设计的名称，然后是入射角和面，其导入会读回这些内容。数值与窗口的相同，以 Python 的浮点数写法写出。已存在的文件会被覆盖。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `path` | `path` |  | **JavaScript**：要写入的文件，给出完整路径。相对路径以程序启动时所在的文件夹为基准：在脚本控制台中，是启动 TFStudio 时所在的文件夹，通常是其安装文件夹。<br>**Python**：要写入的文件。相对路径以程序的工作文件夹为基准：在脚本控制台中，是脚本所在的文件夹；未保存的脚本则是数据文件夹。 |

```js
const file = require('path').join(require('os').homedir(), `ellipsometry-${Date.now()}.csv`);
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
design.ellipsometry(400, 800, { step: 5 }).saveCsv(file);
console.log('Wrote', file);
```

```python
import time

name = "ellipsometry-{}.csv".format(time.time_ns())
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
design.ellipsometry(400, 800, step=5).save_csv(name)
print("Wrote", name)
```

## AngleCurve

**JavaScript**：每个入射角一个值：一个数字数组，因此 `Math.max(...curve)`、for 循环和数组方法都能像处理任何数组一样处理它；map()、filter() 等生成新数组的方法生成的是普通数组。

**Python**：每个入射角一个值：一个由 float 组成的 list，因此 `max(curve)`、`sum(curve)` 和绘图库都能像处理任何 list 一样处理它。

mean()、min() 和 max() 在一段角度范围上对它做统计，`angle` 给出每个值对应的角度，单位为度，在光射来的介质中计。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
const e = design.ellipsometryVsAngle(633, 45, 80);
console.log(Math.min(...e.psi), e.psi.mean(60, 70));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
e = design.ellipsometry_vs_angle(633, 45, 80)
print(min(e.psi), e.psi.mean(60, 70))
```

### mean

| JavaScript | Python |
| ---------- | ------ |
| `e.psi.mean(start, end)` | `e.psi.mean(start=..., end=...)` |

角度从 `start` 到 `end`（两端都包含）的各值的平均值。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `start` | `start` |  | 范围的起始角度，单位为度。不给出时，为曲线的第一个角度。 |
| `end` | `end` |  | 范围的结束角度，单位为度。不给出时，为曲线的最后一个角度。 |

**返回**：平均值；范围内有值为 NaN 时为 NaN。

**拒绝**：

- 不包含曲线任何角度的范围

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
const e = design.ellipsometryVsAngle(633, 45, 80);
console.log('Mean Psi from 60 to 70 degrees:', e.psi.mean(60, 70));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
e = design.ellipsometry_vs_angle(633, 45, 80)
print("Mean Psi from 60 to 70 degrees:", e.psi.mean(60, 70))
```

### min

| JavaScript | Python |
| ---------- | ------ |
| `e.psi.min(start, end)` | `e.psi.min(start=..., end=...)` |

角度从 `start` 到 `end`（两端都包含）的各值中的最小值，不计 NaN。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `start` | `start` |  | 范围的起始角度，单位为度。不给出时，为曲线的第一个角度。 |
| `end` | `end` |  | 范围的结束角度，单位为度。不给出时，为曲线的最后一个角度。 |

**返回**：最小值；范围内所有值都为 NaN 时为 `Infinity` / `inf`。

**拒绝**：

- 不包含曲线任何角度的范围

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
const e = design.ellipsometryVsAngle(633, 45, 80);
console.log('Lowest Psi from 60 to 70 degrees:', e.psi.min(60, 70));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
e = design.ellipsometry_vs_angle(633, 45, 80)
print("Lowest Psi from 60 to 70 degrees:", e.psi.min(60, 70))
```

### max

| JavaScript | Python |
| ---------- | ------ |
| `e.psi.max(start, end)` | `e.psi.max(start=..., end=...)` |

角度从 `start` 到 `end`（两端都包含）的各值中的最大值，不计 NaN。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `start` | `start` |  | 范围的起始角度，单位为度。不给出时，为曲线的第一个角度。 |
| `end` | `end` |  | 范围的结束角度，单位为度。不给出时，为曲线的最后一个角度。 |

**返回**：最大值；范围内所有值都为 NaN 时为 `-Infinity` / `-inf`。

**拒绝**：

- 不包含曲线任何角度的范围

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
const e = design.ellipsometryVsAngle(633, 45, 80);
console.log('Highest Delta from 60 to 70 degrees:', e.delta.max(60, 70));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
e = design.ellipsometry_vs_angle(633, 45, 80)
print("Highest Delta from 60 to 70 degrees:", e.delta.max(60, 70))
```

### angle

| JavaScript | Python |
| ---------- | ------ |
| `e.psi.angle` | `e.psi.angle` |

每个值对应的入射角，单位为度。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^3 H');
const e = design.ellipsometryVsAngle(633, 45, 80, { step: 5 });
console.log(e.psi.angle.join(', '));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^3 H")
e = design.ellipsometry_vs_angle(633, 45, 80, step=5)
print(e.psi.angle)
```

## GroupDelay

设计的反射光或透射光的相位、群延迟、GDD、TOD 和 CDC 随波长的变化，由 `design.groupDelay()` / `design.group_delay()` 计算，与群延迟 / GDD 窗口的显示相同。`g.phase`、`g.gd`、`g.gdd`、`g.tod` 和 `g.cdc` 都是 Curve。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^8 H');
const g = design.groupDelay(500, 600, { step: 1 });
console.log(g.mode, 'mean GD from 540 to 560 nm', g.gd.mean(540, 560).toFixed(3), 'fs');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^8 H")
g = design.group_delay(500, 600, step=1)
print(g.mode, "mean GD from 540 to 560 nm", round(g.gd.mean(540, 560), 3), "fs")
```

### mode

| JavaScript | Python |
| ---------- | ------ |
| `g.mode` | `g.mode` |

所计算的对象：`'front'` 或 `'back'`，一个镀膜面；`'total'`，透射时的整个元件。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^8 H');
console.log(design.groupDelay().mode, design.groupDelay(400, 800, { response: 'T', side: 'total' }).mode);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^8 H")
print(design.group_delay().mode, design.group_delay(400, 800, response="T", side="total").mode)
```

### response

| JavaScript | Python |
| ---------- | ------ |
| `g.response` | `g.response` |

取其相位的光：`'R'` 为反射光，`'T'` 为透射光。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^8 H');
console.log(design.groupDelay(400, 800, { response: 'T' }).response);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^8 H")
print(design.group_delay(400, 800, response="T").response)
```

### angle

| JavaScript | Python |
| ---------- | ------ |
| `g.angle` | `g.angle` |

入射角，单位为度，在光射来的介质中计。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^8 H');
console.log(design.groupDelay(400, 800, { angle: 45 }).angle, 'degrees');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^8 H")
print(design.group_delay(400, 800, angle=45).angle, "degrees")
```

### pol

| JavaScript | Python |
| ---------- | ------ |
| `g.pol` | `g.pol` |

偏振：`'avg'`、`'s'` 或 `'p'`。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^8 H');
console.log(design.groupDelay(400, 800, { angle: 45, pol: 'p' }).pol);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^8 H")
print(design.group_delay(400, 800, angle=45, pol="p").pol)
```

### step

| JavaScript | Python |
| ---------- | ------ |
| `g.step` | `g.step` |

波长步长，单位 nm；或 `'auto'`，即窗口自己的网格。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^8 H');
console.log(design.groupDelay(400, 800, { step: 'auto' }).step);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^8 H")
print(design.group_delay(400, 800, step="auto").step)
```

### reference

| JavaScript | Python |
| ---------- | ------ |
| `g.reference` | `g.reference` |

相位在该处平移为 0 的波长，单位 nm；相位为绝对值时为 `null` / `None`：未给出参考，或离参考最近的采样点没有数值时。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^8 H');
console.log(design.groupDelay(400, 800, { reference: 550 }).reference, 'nm');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^8 H")
print(design.group_delay(400, 800, reference=550).reference, "nm")
```

### wavelength

| JavaScript | Python |
| ---------- | ------ |
| `g.wavelength` | `g.wavelength` |

各波长，单位 nm。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^8 H');
console.log(design.groupDelay(400, 800, { step: 100 }).wavelength.join(', '));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^8 H")
print(design.group_delay(400, 800, step=100).wavelength)
```

### phase

| JavaScript | Python |
| ---------- | ------ |
| `g.phase` | `g.phase` |

相位 φ，单位为度，一个 Curve：沿网格解缠，为绝对值；给出参考时，在离参考最近的采样点处为 0。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^8 H');
const g = design.groupDelay(500, 600, { reference: 550 });
console.log('phase from 500 to 600 nm:', g.phase.min().toFixed(1), 'to', g.phase.max().toFixed(1), 'degrees');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^8 H")
g = design.group_delay(500, 600, reference=550)
print("phase from 500 to 600 nm:", round(g.phase.min(), 1), "to", round(g.phase.max(), 1), "degrees")
```

### gd

| JavaScript | Python |
| ---------- | ------ |
| `g.gd` | `g.gd` |

群延迟，单位 fs，一个 Curve。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^8 H');
console.log('mean GD from 520 to 580 nm:', design.groupDelay().gd.mean(520, 580).toFixed(3), 'fs');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^8 H")
print("mean GD from 520 to 580 nm:", round(design.group_delay().gd.mean(520, 580), 3), "fs")
```

### gdd

| JavaScript | Python |
| ---------- | ------ |
| `g.gdd` | `g.gdd` |

GDD，单位 fs²，一个 Curve。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^8 H');
const g = design.groupDelay();
console.log('GDD from 520 to 580 nm:', g.gdd.min(520, 580).toFixed(3), 'to', g.gdd.max(520, 580).toFixed(3), 'fs²');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^8 H")
g = design.group_delay()
print("GDD from 520 to 580 nm:", round(g.gdd.min(520, 580), 3), "to", round(g.gdd.max(520, 580), 3), "fs²")
```

### tod

| JavaScript | Python |
| ---------- | ------ |
| `g.tod` | `g.tod` |

TOD，单位 fs³，一个 Curve。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^8 H');
console.log('mean TOD from 520 to 580 nm:', design.groupDelay().tod.mean(520, 580).toFixed(3), 'fs³');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^8 H")
print("mean TOD from 520 to 580 nm:", round(design.group_delay().tod.mean(520, 580), 3), "fs³")
```

### cdc

| JavaScript | Python |
| ---------- | ------ |
| `g.cdc` | `g.cdc` |

CDC，即 GDD·2πc/λ²，单位 fs/nm，一个 Curve：与 Essential Macleod 给出的色散系数相同，符号与 GDD 相同。群延迟对波长的斜率 dGD/dλ 等于 −CDC。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^8 H');
console.log('mean CDC from 520 to 580 nm:', design.groupDelay().cdc.mean(520, 580).toFixed(5), 'fs/nm');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^8 H")
print("mean CDC from 520 to 580 nm:", round(design.group_delay().cdc.mean(520, 580), 5), "fs/nm")
```

### outside

| JavaScript | Python |
| ---------- | ------ |
| `g.outside` | `g.outside` |

对每个波长，其数值取自哪种材料的数据范围之外，给出该材料的名称；否则为 `null` / `None`。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^8 H');
const g = design.groupDelay(200, 2500, { step: 10 });
console.log(g.wavelength.filter((_, i) => g.outside[i]).length, 'wavelengths outside a material\'s data');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^8 H")
g = design.group_delay(200, 2500, step=10)
print(sum(1 for name in g.outside if name), "wavelengths outside a material's data")
```

### knots

| JavaScript | Python |
| ---------- | ------ |
| `g.knots` | `g.knots` |

**JavaScript**：恰好落在网格波长上的表格节点，一个由 `{ wavelength, gd, gdd, tod, cdc }` 组成的数组，每个量是它在节点两侧的数值组成的一对 `[left, right]`；曲线在该波长处的值读取的是节点两侧平均后的材料。在均匀网格上，若范围内的节点相对网格过密，即每 8 个点多于一个节点，则不取任何节点；`side: 'total'` 时也不取任何节点。

**Python**：恰好落在网格波长上的表格节点，一个由 dict（wavelength、gd、gdd、tod 和 cdc）组成的 list，每个量是它在节点两侧的数值组成的一对 [left, right]；曲线在该波长处的值读取的是节点两侧平均后的材料。在均匀网格上，若范围内的节点相对网格过密，即每 8 个点多于一个节点，则不取任何节点；side="total" 时也不取任何节点。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^8 H');
for (const knot of design.groupDelay().knots.slice(0, 3)) console.log(knot.wavelength, 'nm: GDD', knot.gdd[0].toFixed(3), 'and', knot.gdd[1].toFixed(3), 'fs²');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^8 H")
for knot in design.group_delay().knots[:3]:
    print(knot["wavelength"], "nm: GDD", round(knot["gdd"][0], 3), "and", round(knot["gdd"][1], 3), "fs²")
```

### invalid

| JavaScript | Python |
| ---------- | ------ |
| `g.invalid` | `g.invalid` |

**JavaScript**：没有数值的波长，一个由 `{ wavelength, reason }` 组成的数组；曲线在这些波长处为 NaN。每个波长都有数值时为空。

**Python**：没有数值的波长，一个由 dict（wavelength 和 reason）组成的 list；曲线在这些波长处为 NaN。每个波长都有数值时为空。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^8 H');
console.log(design.groupDelay().invalid.length, 'wavelengths with no value');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^8 H")
print(len(design.group_delay().invalid), "wavelengths with no value")
```

### models

| JavaScript | Python |
| ---------- | ------ |
| `g.models` | `g.models` |

数值所依据的材料模型，每个为 `'name: model'`。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^8 H');
console.log(design.groupDelay().models.join('\n'));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^8 H")
print("\n".join(design.group_delay().models))
```

### outOfRange / out_of_range

| JavaScript | Python |
| ---------- | ------ |
| `g.outOfRange` | `g.out_of_range` |

**JavaScript**：所计算对象上数据在该范围内中断的材料，一个由 `{ id, name, rangeNm, heldFlat }` 组成的数组：在 `rangeNm` 之外，它们的 n 和 k 保持在最后的值（`heldFlat` 为 true）或外推得到。每种材料都覆盖该范围时为空。

**Python**：所计算对象上数据在该范围内中断的材料，一个由 dict（id、name、rangeNm 和 heldFlat）组成的 list：在 rangeNm 之外，它们的 n 和 k 保持在最后的值（heldFlat 为 True）或外推得到。每种材料都覆盖该范围时为空。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^8 H');
console.log(design.groupDelay(200, 2500, { step: 10 }).outOfRange.map(m => m.id));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^8 H")
print([m["id"] for m in design.group_delay(200, 2500, step=10).out_of_range])
```

### saveCsv / save_csv

| JavaScript | Python |
| ---------- | ------ |
| `g.saveCsv(path)` | `g.save_csv(path)` |

**JavaScript**：把曲线写入 CSV 文件，与窗口以“复制 CSV”写出其表格的方式相同：先是 λ (nm)；有采样的表格节点时接着是 Knot 列，节点两侧各一行，即 λ− 和 λ+；有数值取自材料数据之外时接着是 Outside data 列；然后是 Group Delay (fs)、GDD (fs²)、CDC (fs/nm)、Phase φ (°) 和 TOD (fs³)。相位即 `phase` 所含的相位。已存在的文件会被覆盖。

**Python**：把曲线写入 CSV 文件，与窗口以“复制 CSV”写出其表格的方式相同：先是 λ (nm)；有采样的表格节点时接着是 Knot 列，节点两侧各一行，即 λ− 和 λ+；有数值取自材料数据之外时接着是 Outside data 列；然后是 Group Delay (fs)、GDD (fs²)、CDC (fs/nm)、Phase φ (°) 和 TOD (fs³)。相位即 phase 所含的相位。数值与窗口的相同，以 Python 的浮点数写法写出。已存在的文件会被覆盖。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `path` | `path` |  | **JavaScript**：要写入的文件，给出完整路径。相对路径以程序启动时所在的文件夹为基准：在脚本控制台中，是启动 TFStudio 时所在的文件夹，通常是其安装文件夹。<br>**Python**：要写入的文件。相对路径以程序的工作文件夹为基准：在脚本控制台中，是脚本所在的文件夹；未保存的脚本则是数据文件夹。 |

```js
const file = require('path').join(require('os').homedir(), `group-delay-${Date.now()}.csv`);
const design = tf.newDesign('Mirror');
design.stack('(HL)^8 H');
design.groupDelay(400, 800, { step: 1 }).saveCsv(file);
console.log('Wrote', file);
```

```python
import time

name = "group-delay-{}.csv".format(time.time_ns())
design = tf.new_design("Mirror")
design.stack("(HL)^8 H")
design.group_delay(400, 800, step=1).save_csv(name)
print("Wrote", name)
```

## Pulse

脉冲经过设计后在时间和光谱上的变化，由 design.pulse() 计算，与脉冲分析窗口的显示相同：其各项数值、窗口的结果表以及其曲线。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^8 H');
const p = design.pulse({ centre: 550, duration: 20 });
console.log(p.mode, 'output FWHM', p.metrics.outputFwhm.toFixed(2), 'fs, delay', p.metrics.delay.toFixed(2), 'fs');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^8 H")
p = design.pulse(centre=550, duration=20)
print(p.mode, "output FWHM", round(p.metrics.output_fwhm, 2), "fs, delay", round(p.metrics.delay, 2), "fs")
```

### mode

| JavaScript | Python |
| ---------- | ------ |
| `p.mode` | `p.mode` |

所计算的对象：`'front'` 或 `'back'`，一个镀膜面；`'total'`，透射时的整个元件。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^8 H');
console.log(design.pulse({ centre: 550 }).mode, design.pulse({ centre: 550, response: 'T', side: 'total' }).mode);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^8 H")
print(design.pulse(centre=550).mode, design.pulse(centre=550, response="T", side="total").mode)
```

### response

| JavaScript | Python |
| ---------- | ------ |
| `p.response` | `p.response` |

所取的脉冲：`'R'` 为反射脉冲，`'T'` 为透射脉冲。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^8 H');
console.log(design.pulse({ centre: 550, response: 'T' }).response);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^8 H")
print(design.pulse(centre=550, response="T").response)
```

### pol

| JavaScript | Python |
| ---------- | ------ |
| `p.pol` | `p.pol` |

偏振：`'avg'`、`'s'` 或 `'p'`。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^8 H');
console.log(design.pulse({ centre: 550, angle: 45, pol: 'p' }).pol);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^8 H")
print(design.pulse(centre=550, angle=45, pol="p").pol)
```

### angle

| JavaScript | Python |
| ---------- | ------ |
| `p.angle` | `p.angle` |

入射角，单位为度，在光射来的介质中计。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^8 H');
console.log(design.pulse({ centre: 550, angle: 30 }).angle, 'degrees');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^8 H")
print(design.pulse(centre=550, angle=30).angle, "degrees")
```

### passes

| JavaScript | Python |
| ---------- | ------ |
| `p.passes` | `p.passes` |

在膜层上反射或穿过膜层的次数。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^8 H');
console.log(design.pulse({ centre: 550, passes: 4 }).passes, 'bounces');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^8 H")
print(design.pulse(centre=550, passes=4).passes, "bounces")
```

### source

| JavaScript | Python |
| ---------- | ------ |
| `p.source` | `p.source` |

光谱的来源：`'model'`，即形状；`'design'`，即设计保存的光谱。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^8 H');
console.log(design.pulse({ centre: 550 }).source);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^8 H")
print(design.pulse(centre=550).source)
```

### centre

| JavaScript | Python |
| ---------- | ------ |
| `p.centre` | `p.centre` |

中心波长，单位 nm：给出的值、800 nm，或使用设计的光谱时为其重心。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^8 H');
console.log(design.pulse().centre, 'nm');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^8 H")
print(design.pulse().centre, "nm")
```

### converged

| JavaScript | Python |
| ---------- | ------ |
| `p.converged` | `p.converged` |

时间窗口已扩大到最大、输出仍未完全容纳其中时为 `false` / `False`，此时输出的一部分可能从窗口一端卷绕到另一端，曲线和数值不可靠；否则为 `true` / `True`。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^8 H');
console.log(design.pulse({ centre: 550 }).converged);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^8 H")
print(design.pulse(centre=550).converged)
```

### chirped

| JavaScript | Python |
| ---------- | ------ |
| `p.chirped` | `p.chirped` |

输入自身的啁啾是否在某处使其形状的改变超过傅里叶变换极限峰值的 1e-4；只有这时，窗口的表格才列出输入的半高全宽。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^8 H');
console.log(design.pulse({ centre: 550 }).chirped, design.pulse({ centre: 550, gdd: 50 }).chirped);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^8 H")
print(design.pulse(centre=550).chirped, design.pulse(centre=550, gdd=50).chirped)
```

### metrics

| JavaScript | Python |
| ---------- | ------ |
| `p.metrics` | `p.metrics` |

**JavaScript**：窗口的结果表：`flpFwhm`、`inputFwhm` 和 `outputFwhm`，即傅里叶变换极限脉冲、输入和输出的强度半高全宽，单位 fs；`outputRms`，输出的均方根宽度，单位 fs；`peakVsFlp`，输出峰值与傅里叶变换极限脉冲峰值之比，`transformLimitedRatio`，输出峰值与输出光谱在相位平坦时所能达到的峰值之比，均以 1 的分数表示；`energyRatio`，输出能量与输入能量之比；`delay`，输出相对输入的延迟，单位 fs；`residualGdd` 和 `residualTod`，输出在其光谱上平均的 GDD（单位 fs²）和 TOD（单位 fs³）；`inputBandwidth` 和 `outputBandwidth`，光谱强度半高全宽，单位 nm；`timeBandwidth`，输出的时间带宽积。

**Python**：窗口的结果表，一个 PulseMetrics 具名元组：flp_fwhm、input_fwhm 和 output_fwhm，即傅里叶变换极限脉冲、输入和输出的强度半高全宽，单位 fs；output_rms，输出的均方根宽度，单位 fs；peak_vs_flp，输出峰值与傅里叶变换极限脉冲峰值之比，transform_limited_ratio，输出峰值与输出光谱在相位平坦时所能达到的峰值之比，均以 1 的分数表示；energy_ratio，输出能量与输入能量之比；delay，输出相对输入的延迟，单位 fs；residual_gdd 和 residual_tod，输出在其光谱上平均的 GDD（单位 fs²）和 TOD（单位 fs³）；input_bandwidth 和 output_bandwidth，光谱强度半高全宽，单位 nm；time_bandwidth，输出的时间带宽积。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^8 H');
const m = design.pulse({ centre: 550, duration: 20 }).metrics;
console.log('FLP', m.flpFwhm.toFixed(2), 'fs, out', m.outputFwhm.toFixed(2), 'fs, residual GDD', m.residualGdd.toFixed(2), 'fs²');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^8 H")
m = design.pulse(centre=550, duration=20).metrics
print("FLP", round(m.flp_fwhm, 2), "fs, out", round(m.output_fwhm, 2), "fs, residual GDD", round(m.residual_gdd, 2), "fs²")
```

### time

| JavaScript | Python |
| ---------- | ------ |
| `p.time` | `p.time` |

**JavaScript**：时间曲线 `flp`、`input` 和 `output`，每条为 `{ t, intensity }`：t 单位为 fs，强度以傅里叶变换极限脉冲峰值为 1 计。它们包含变换中从第一个到最后一个高于该峰值 1e-4 的采样点；超过 4000 个采样点时，依次取每段中的最低点和最高点，因此每条曲线有其自己的 t。输出位于其绝对延迟处；窗口的“去除延迟”视图把它移回 `metrics.delay`。

**Python**：时间曲线，一个 PulseTime 具名元组，包含 flp、input 和 output，每条为 TimeCurve，含 t（单位 fs）和 intensity，强度以傅里叶变换极限脉冲峰值为 1 计。它们包含变换中从第一个到最后一个高于该峰值 1e-4 的采样点；超过 4000 个采样点时，依次取每段中的最低点和最高点，因此每条曲线有其自己的 t。输出位于其绝对延迟处；窗口的“去除延迟”视图把它移回 metrics.delay。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^8 H');
const { output } = design.pulse({ centre: 550 }).time;
console.log(output.t.length, 'samples, peak', Math.max(...output.intensity).toFixed(4));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^8 H")
output = design.pulse(centre=550).time.output
print(len(output.t), "samples, peak", round(max(output.intensity), 4))
```

### spectrum

| JavaScript | Python |
| ---------- | ------ |
| `p.spectrum` | `p.spectrum` |

**JavaScript**：光谱曲线，每条为 `{ wavelength, values }`，波长单位 nm，按升序：`input` 和 `output`，光谱强度，以输入峰值为 1 计；`coatingGdd`，响应的 GDD 乘以通过次数，单位 fs²，`pol: 'avg'` 时为 s 和 p 的平均；`compensatingGdd`，抵消输入自身啁啾所需的 GDD，单位 fs²。它们包含输入高于其峰值 1e-3 处的变换采样点；变换的采样点较少时，则在该波段上重新计算至少 600 个点。超过 4000 个采样点时，每条曲线依次取其自身数值每段中的最低点和最高点，因此每条曲线这时有其自己的波长。`band` 为 `[low, high]`，单位 nm，即曲线覆盖的波段。

**Python**：光谱曲线，一个 PulseSpectrum 具名元组，每条曲线为 SpectrumCurve，含 wavelength（单位 nm，按升序）和 values：input 和 output，光谱强度，以输入峰值为 1 计；coating_gdd，响应的 GDD 乘以通过次数，单位 fs²，pol="avg" 时为 s 和 p 的平均；compensating_gdd，抵消输入自身啁啾所需的 GDD，单位 fs²。它们包含输入高于其峰值 1e-3 处的变换采样点；变换的采样点较少时，则在该波段上重新计算至少 600 个点。超过 4000 个采样点时，每条曲线依次取其自身数值每段中的最低点和最高点，因此每条曲线这时有其自己的波长。band 为 [low, high]，单位 nm，即曲线覆盖的波段。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^8 H');
const s = design.pulse({ centre: 550 }).spectrum;
console.log('from', s.band[0].toFixed(1), 'to', s.band[1].toFixed(1), 'nm,', s.coatingGdd.wavelength.length, 'points');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^8 H")
s = design.pulse(centre=550).spectrum
print("from", round(s.band[0], 1), "to", round(s.band[1], 1), "nm,", len(s.coating_gdd.wavelength), "points")
```

### echoDelay / echo_delay

| JavaScript | Python |
| ---------- | ------ |
| `p.echoDelay` | `p.echo_delay` |

对整个元件，从此脉冲到在基底内部反射的第一个回波的时间，单位 fs，即基底在中心波长处往返的群延迟；对一个面为 `null` / `None`。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^8 H');
console.log(design.pulse({ centre: 550, response: 'T', side: 'total' }).echoDelay.toFixed(0), 'fs');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^8 H")
print(round(design.pulse(centre=550, response="T", side="total").echo_delay), "fs")
```

### outOfRange / out_of_range

| JavaScript | Python |
| ---------- | ------ |
| `p.outOfRange` | `p.out_of_range` |

**JavaScript**：所计算对象上数据在光谱波段内中断的材料，一个由 `{ id, name, rangeNm, heldFlat }` 组成的数组：在 `rangeNm` 之外，它们的 n 和 k 保持在最后的值（`heldFlat` 为 true）或外推得到。每种材料都覆盖该波段时为空。

**Python**：所计算对象上数据在光谱波段内中断的材料，一个由 dict（id、name、rangeNm 和 heldFlat）组成的 list：在 rangeNm 之外，它们的 n 和 k 保持在最后的值（heldFlat 为 True）或外推得到。每种材料都覆盖该波段时为空。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^8 H');
console.log(design.pulse({ centre: 550 }).outOfRange.map(m => m.id));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^8 H")
print([m["id"] for m in design.pulse(centre=550).out_of_range])
```

### saveCsv / save_csv

| JavaScript | Python |
| ---------- | ------ |
| `p.saveCsv(path)` | `p.save_csv(path)` |

**JavaScript**：把各项数值写入 CSV 文件，与窗口以“复制 CSV”写出其结果表的方式相同：Quantity、Value 和 Unit 三列，每项数值一行，用窗口的措辞，峰值和能量以百分数表示；只有输入带啁啾时才有输入的半高全宽一行。已存在的文件会被覆盖。

**Python**：把各项数值写入 CSV 文件，与窗口以“复制 CSV”写出其结果表的方式相同：Quantity、Value 和 Unit 三列，每项数值一行，用窗口的措辞，峰值和能量以百分数表示；只有输入带啁啾时才有输入的半高全宽一行。数值与窗口的相同，以 Python 的浮点数写法写出。已存在的文件会被覆盖。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `path` | `path` |  | **JavaScript**：要写入的文件，给出完整路径。相对路径以程序启动时所在的文件夹为基准：在脚本控制台中，是启动 TFStudio 时所在的文件夹，通常是其安装文件夹。<br>**Python**：要写入的文件。相对路径以程序的工作文件夹为基准：在脚本控制台中，是脚本所在的文件夹；未保存的脚本则是数据文件夹。 |

```js
const file = require('path').join(require('os').homedir(), `pulse-${Date.now()}.csv`);
const design = tf.newDesign('Mirror');
design.stack('(HL)^8 H');
design.pulse({ centre: 550 }).saveCsv(file);
console.log('Wrote', file);
```

```python
import time

name = "pulse-{}.csv".format(time.time_ns())
design = tf.new_design("Mirror")
design.stack("(HL)^8 H")
design.pulse(centre=550).save_csv(name)
print("Wrote", name)
```

## Inhomogeneities

设计在其界面处带有渐变界面层时的光谱，与设计原样的光谱对比，由 design.inhomogeneities() 计算，与非均匀性窗口的显示相同。`r.homogeneous` 和 `r.graded` 包含各条曲线，每条为一个 Curve。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
const r = design.inhomogeneities({ interlayers: [{ interface: 4, thickness: 3 }] });
console.log(r.mode, 'mean R from 500 to 600 nm', r.homogeneous.R.mean(500, 600).toFixed(5), 'becomes', r.graded.R.mean(500, 600).toFixed(5));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
r = design.inhomogeneities(interlayers=[{"interface": 4, "thickness": 3}])
print(r.mode, "mean R from 500 to 600 nm", round(r.homogeneous.R.mean(500, 600), 5), "becomes",
      round(r.graded.R.mean(500, 600), 5))
```

### mode

| JavaScript | Python |
| ---------- | ------ |
| `r.mode` | `r.mode` |

所计算的对象：`'front'`、`'back'` 或 `'total'`（整个元件）。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
console.log(design.inhomogeneities().mode, design.inhomogeneities({ side: 'total' }).mode);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
print(design.inhomogeneities().mode, design.inhomogeneities(side="total").mode)
```

### angle

| JavaScript | Python |
| ---------- | ------ |
| `r.angle` | `r.angle` |

入射角，为入射介质中的度数。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
console.log(design.inhomogeneities({ angle: 30 }).angle, 'degrees');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
print(design.inhomogeneities(angle=30).angle, "degrees")
```

### wavelength

| JavaScript | Python |
| ---------- | ------ |
| `r.wavelength` | `r.wavelength` |

各波长，单位 nm。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
console.log(design.inhomogeneities({ step: 100 }).wavelength.join(', '));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
print(design.inhomogeneities(step=100).wavelength)
```

### homogeneous

| JavaScript | Python |
| ---------- | ------ |
| `r.homogeneous` | `r.homogeneous` |

**JavaScript**：设计原样的结果：非偏振光的 `R`、`T` 和 `A`，以及 s 和 p 偏振的 `Rs`、`Rp`、`Ts`、`Tp`、`As` 和 `Ap`，每条为一个 Curve，以 1 的分数表示。

**Python**：设计原样的结果，一个由 Curve 组成的具名元组，以 1 的分数表示：非偏振光的 R、T 和 A，以及 s 和 p 偏振的 Rs、Rp、Ts、Tp、As 和 Ap。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
console.log('peak R', design.inhomogeneities().homogeneous.R.max().toFixed(5));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
print("peak R", round(design.inhomogeneities().homogeneous.R.max(), 5))
```

### graded

| JavaScript | Python |
| ---------- | ------ |
| `r.graded` | `r.graded` |

放入界面层后的设计，曲线与 `homogeneous` 相同。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
const r = design.inhomogeneities({ interlayers: [{ interface: 4, thickness: 3 }, { interface: 5, thickness: 3 }] });
console.log('peak R', r.graded.R.max().toFixed(5), 'against', r.homogeneous.R.max().toFixed(5));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
r = design.inhomogeneities(interlayers=[{"interface": 4, "thickness": 3}, {"interface": 5, "thickness": 3}])
print("peak R", round(r.graded.R.max(), 5), "against", round(r.homogeneous.R.max(), 5))
```

### interlayers

| JavaScript | Python |
| ---------- | ------ |
| `r.interlayers` | `r.interlayers` |

**JavaScript**：各界面层，按给出的顺序，并填入其默认值，一个由 `{ side, interface, thickness, profile, slices, materials }` 组成的数组：`materials` 为在该处相接的两种材料的 id，按界面层从一种渐变到另一种的顺序。

**Python**：各界面层，按给出的顺序，并填入其默认值，每个为一个具名元组（side、interface、thickness、profile、slices、materials）：materials 为在该处相接的两种材料的 id，按界面层从一种渐变到另一种的顺序。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
for (const row of design.inhomogeneities({ interlayers: [{ interface: 0 }, { interface: 9 }] }).interlayers) {
    console.log(row.side, row.interface, row.thickness, 'nm', row.profile, row.slices, 'slices:', row.materials.join(' to '));
}
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
for row in design.inhomogeneities(interlayers=[{"interface": 0}, {"interface": 9}]).interlayers:
    print(row.side, row.interface, row.thickness, "nm", row.profile, row.slices, "slices:", " to ".join(row.materials))
```

### addedThickness / added_thickness

| JavaScript | Python |
| ---------- | ------ |
| `r.addedThickness` | `r.added_thickness` |

界面层使镀膜增加的厚度，单位 nm：即窗口的 Σ。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
console.log(design.inhomogeneities({ interlayers: [{ interface: 1, thickness: 2 }, { interface: 2 }] }).addedThickness, 'nm');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
print(design.inhomogeneities(interlayers=[{"interface": 1, "thickness": 2}, {"interface": 2}]).added_thickness, "nm")
```

### specification

| JavaScript | Python |
| ---------- | ------ |
| `r.specification` | `r.specification` |

放入界面层后对设计的判定，一个 SpecReport，与 specification.check() 给出的相同，每项检查按其自身的步长读取，与窗口图表下方的标记相同；设计没有规格时为 `null` / `None`。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.98 });
const report = design.inhomogeneities({ interlayers: [{ interface: 4, thickness: 10 }] }).specification;
console.log(report.passed, report.rows[0].value.toFixed(5));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.98)
report = design.inhomogeneities(interlayers=[{"interface": 4, "thickness": 10}]).specification
print(report.passed, round(report.rows[0].value, 5))
```

### outOfRange / out_of_range

| JavaScript | Python |
| ---------- | ------ |
| `r.outOfRange` | `r.out_of_range` |

**JavaScript**：所计算对象上数据在该范围内中断的材料，一个由 `{ id, name, rangeNm, heldFlat }` 组成的数组：在 `rangeNm` 之外，它们的 n 和 k 保持在最后的值（`heldFlat` 为 true）或外推得到。每种材料都覆盖该范围时为空。

**Python**：所计算对象上数据在该范围内中断的材料，一个由 dict { id, name, rangeNm, heldFlat } 组成的 list：在 rangeNm 之外，它们的 n 和 k 保持在最后的值（heldFlat 为 True）或外推得到。每种材料都覆盖该范围时为空。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
console.log(design.inhomogeneities({ start: 200, end: 2500, step: 10 }).outOfRange.map(m => m.id));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
print([m["id"] for m in design.inhomogeneities(start=200, end=2500, step=10).out_of_range])
```

### saveCsv / save_csv

| JavaScript | Python |
| ---------- | ------ |
| `r.saveCsv(path)` | `r.save_csv(path)` |

**JavaScript**：把曲线写入 CSV 文件，与窗口以“复制 CSV”写出所有曲线都打开时的表格的方式相同：先是 λ (nm)，然后依次为 T、Ts、Tp、R、Rs、Rp、A、As 和 Ap 的均匀值和渐变值，以 1 的分数表示。已存在的文件会被覆盖。

**Python**：把曲线写入 CSV 文件，与窗口以“复制 CSV”写出所有曲线都打开时的表格的方式相同：先是 λ (nm)，然后依次为 T、Ts、Tp、R、Rs、Rp、A、As 和 Ap 的均匀值和渐变值，以 1 的分数表示。数值与窗口的相同，以 Python 的浮点数写法写出。已存在的文件会被覆盖。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `path` | `path` |  | **JavaScript**：要写入的文件，使用完整路径。相对路径以程序启动时所在的文件夹为基准：在脚本控制台中，是启动 TFStudio 时所在的文件夹，通常是其安装文件夹。<br>**Python**：要写入的文件。相对路径以程序的工作文件夹为基准：在脚本控制台中，是脚本所在的文件夹；未保存的脚本则是数据文件夹。 |

```js
const file = require('path').join(require('os').homedir(), `interlayers-${Date.now()}.csv`);
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
design.inhomogeneities({ interlayers: [{ interface: 4 }] }).saveCsv(file);
console.log('Wrote', file);
```

```python
import time

name = "interlayers-{}.csv".format(time.time_ns())
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
design.inhomogeneities(interlayers=[{"interface": 4}]).save_csv(name)
print("Wrote", name)
```

## Roughness

设计带有粗糙界面时的镜面 R 与 T，与光滑设计对比，由 design.roughness() 计算，与粗糙度 / 散射窗口的显示相同。`r.smooth` 和 `r.rough` 包含各条曲线，`r.loss` 包含镜面光束中损失的光，每条为一个 Curve。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
const r = design.roughness({ sigma: 2 });
console.log(r.mode, 'mean R from 500 to 600 nm', r.smooth.R.mean(500, 600).toFixed(5), 'becomes', r.rough.R.mean(500, 600).toFixed(5));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
r = design.roughness(sigma=2)
print(r.mode, "mean R from 500 to 600 nm", round(r.smooth.R.mean(500, 600), 5), "becomes",
      round(r.rough.R.mean(500, 600), 5))
```

### mode

| JavaScript | Python |
| ---------- | ------ |
| `r.mode` | `r.mode` |

所计算的对象：`'front'`、`'back'` 或 `'total'`（整个元件）。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
console.log(design.roughness().mode, design.roughness({ side: 'total' }).mode);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
print(design.roughness().mode, design.roughness(side="total").mode)
```

### angle

| JavaScript | Python |
| ---------- | ------ |
| `r.angle` | `r.angle` |

入射角，为入射介质中的度数。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
console.log(design.roughness({ angle: 30 }).angle, 'degrees');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
print(design.roughness(angle=30).angle, "degrees")
```

### wavelength

| JavaScript | Python |
| ---------- | ------ |
| `r.wavelength` | `r.wavelength` |

各波长，单位 nm。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
console.log(design.roughness({ step: 100 }).wavelength.join(', '));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
print(design.roughness(step=100).wavelength)
```

### smooth

| JavaScript | Python |
| ---------- | ------ |
| `r.smooth` | `r.smooth` |

**JavaScript**：设计原样的结果：非偏振光的 `R` 和 `T`，以及 s 和 p 偏振的 `Rs`、`Rp`、`Ts` 和 `Tp`，每条为一个 Curve，以 1 的分数表示。

**Python**：设计原样的结果，一个由 Curve 组成的具名元组，以 1 的分数表示：非偏振光的 R 和 T，以及 s 和 p 偏振的 Rs、Rp、Ts 和 Tp。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
console.log('peak R', design.roughness().smooth.R.max().toFixed(5));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
print("peak R", round(design.roughness().smooth.R.max(), 5))
```

### rough

| JavaScript | Python |
| ---------- | ------ |
| `r.rough` | `r.rough` |

带有粗糙界面的设计，曲线与 `smooth` 相同。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
const r = design.roughness({ sigma: 3, range: 'short' });
console.log('peak R', r.rough.R.max().toFixed(5), 'against', r.smooth.R.max().toFixed(5));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
r = design.roughness(sigma=3, range="short")
print("peak R", round(r.rough.R.max(), 5), "against", round(r.smooth.R.max(), 5))
```

### loss

| JavaScript | Python |
| ---------- | ------ |
| `r.loss` | `r.loss` |

镜面光束中损失的光，即非偏振光下光滑的 R + T 减去粗糙的 R + T，一个以 1 的分数表示的 Curve。在吸收设计中它也包含吸收的变化；当过渡层替换了吸收层的一部分时，它可能低于 0。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
const loss = design.roughness({ sigma: 2 }).loss;
console.log('largest loss', (loss.max() * 1e6).toFixed(1), 'ppm');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
loss = design.roughness(sigma=2).loss
print("largest loss", round(loss.max() * 1e6, 1), "ppm")
```

### thinned

| JavaScript | Python |
| ---------- | ------ |
| `r.thinned` | `r.thinned` |

**JavaScript**：因过渡层扣除的厚度超过其自身厚度而被设为 0 nm 的层，一个由 `{ side, number }` 组成的数组，按设计编辑器的方式编号。每层都比 2σ 厚时为空。

**Python**：因过渡层扣除的厚度超过其自身厚度而被设为 0 nm 的层，每个为一个具名元组（side、number），按设计编辑器的方式编号。每层都比 2σ 厚时为空。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
design.layers[1].thickness = 3;
console.log(design.roughness({ sigma: 2 }).thinned);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
design.layers[1].thickness = 3
print(design.roughness(sigma=2).thinned)
```

### longRange / long_range

| JavaScript | Python |
| ---------- | ------ |
| `r.longRange` | `r.long_range` |

有 σ 大于 0 的大尺度界面时为 `true` / `True`。大尺度层针对正入射下的单个表面推导，因此在斜入射、入射锥角内或多层膜中只是估算。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
console.log(design.roughness().longRange, design.roughness({ range: 'short' }).longRange);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
print(design.roughness().long_range, design.roughness(range="short").long_range)
```

### outOfRange / out_of_range

| JavaScript | Python |
| ---------- | ------ |
| `r.outOfRange` | `r.out_of_range` |

**JavaScript**：所计算对象上数据在该范围内中断的材料，一个由 `{ id, name, rangeNm, heldFlat }` 组成的数组：在 `rangeNm` 之外，它们的 n 和 k 保持在最后的值（`heldFlat` 为 true）或外推得到。每种材料都覆盖该范围时为空。

**Python**：所计算对象上数据在该范围内中断的材料，一个由 dict { id, name, rangeNm, heldFlat } 组成的 list：在 rangeNm 之外，它们的 n 和 k 保持在最后的值（heldFlat 为 True）或外推得到。每种材料都覆盖该范围时为空。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
console.log(design.roughness({ start: 200, end: 2500, step: 10 }).outOfRange.map(m => m.id));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
print([m["id"] for m in design.roughness(start=200, end=2500, step=10).out_of_range])
```

### saveCsv / save_csv

| JavaScript | Python |
| ---------- | ------ |
| `r.saveCsv(path)` | `r.save_csv(path)` |

**JavaScript**：把曲线写入 CSV 文件，与窗口以“复制 CSV”写出所有曲线都打开时的表格的方式相同：先是 λ (nm)，然后依次为 T、Ts、Tp、R、Rs 和 Rp 的光滑值和粗糙值，最后是损耗。窗口的表头写的是 % 和 ppm，而它的“复制 CSV”以 1 的分数写出数值，这里也一样。已存在的文件会被覆盖。

**Python**：把曲线写入 CSV 文件，与窗口以“复制 CSV”写出所有曲线都打开时的表格的方式相同：先是 λ (nm)，然后依次为 T、Ts、Tp、R、Rs 和 Rp 的光滑值和粗糙值，最后是损耗。窗口的表头写的是 % 和 ppm，而它的“复制 CSV”以 1 的分数写出数值，这里也一样。数值与窗口的相同，以 Python 的浮点数写法写出。已存在的文件会被覆盖。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `path` | `path` |  | **JavaScript**：要写入的文件，使用完整路径。相对路径以程序启动时所在的文件夹为基准：在脚本控制台中，是启动 TFStudio 时所在的文件夹，通常是其安装文件夹。<br>**Python**：要写入的文件。相对路径以程序的工作文件夹为基准：在脚本控制台中，是脚本所在的文件夹；未保存的脚本则是数据文件夹。 |

```js
const file = require('path').join(require('os').homedir(), `roughness-${Date.now()}.csv`);
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
design.roughness({ sigma: 2 }).saveCsv(file);
console.log('Wrote', file);
```

```python
import time

name = "roughness-{}.csv".format(time.time_ns())
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
design.roughness(sigma=2).save_csv(name)
print("Wrote", name)
```

## RunResult

一次精炼或合成如何结束。运行已经把结果留在了它所处理的设计中：正常结束时是新的膜层，被停止时是原来的膜层。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
design.merit.add('RAV', 450, 650, { target: 0 });
const run = await design.refine({ method: 'dls', maxIter: 20 });
console.log(run.merit, run.stopReason);
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
design.merit.add("RAV", 450, 650, target=0)
run = design.refine(method="dls", max_iter=20)
print(run.merit, run.stop_reason)
```

### completed

| JavaScript | Python |
| ---------- | ------ |
| `run.completed` | `run.completed` |

运行自行结束时为 `true` / `True`，被停止或无法运行时为 `false` / `False`。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
design.merit.add('RAV', 450, 650, { target: 0 });
const run = await design.refine({ maxIter: 20 });
console.log(run.completed ? 'ended on its own' : `ended: ${run.stopReason}`);
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
design.merit.add("RAV", 450, 650, target=0)
run = design.refine(max_iter=20)
print("ended on its own" if run.completed else "ended: " + run.stop_reason)
```

### stopReason / stop_reason

| JavaScript | Python |
| ---------- | ------ |
| `run.stopReason` | `run.stop_reason` |

运行结束的原因：精炼如 `'target'`、`'maxiter'`、`'stalled'` 或 `'stopped'`，针法如 `'maxLayers'` 或 `'needleOptimal'`。API 参考在 refine 和 synthesize 下列出了全部原因。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
design.merit.add('RAV', 450, 650, { target: 0 });
console.log((await design.refine({ maxIter: 20 })).stopReason);
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
design.merit.add("RAV", 450, 650, target=0)
print(design.refine(max_iter=20).stop_reason)
```

### merit

| JavaScript | Python |
| ---------- | ------ |
| `run.merit` | `run.merit` |

结束时的评价函数值，与该运行的窗口显示的相同；运行没有结果时为 `null` / `None`。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
design.merit.add('RAV', 450, 650, { target: 0 });
console.log((await design.refine({ maxIter: 20 })).merit);
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
design.merit.add("RAV", 450, 650, target=0)
print(design.refine(max_iter=20).merit)
```

### opticalMerit / optical_merit

| JavaScript | Python |
| ---------- | ------ |
| `run.opticalMerit` | `run.optical_merit` |

结束时不含制造相关行 MNT、MXT、TT 和 STR 的评价函数值；运行不报告该值时为 `null` / `None`。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
design.merit.add('RAV', 450, 650, { target: 0 });
design.merit.add('MNT', { target: 10 });
const run = await design.refine({ maxIter: 20 });
console.log(run.merit, run.opticalMerit);
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
design.merit.add("RAV", 450, 650, target=0)
design.merit.add("MNT", target=10)
run = design.refine(max_iter=20)
print(run.merit, run.optical_merit)
```

### initialMerit / initial_merit

| JavaScript | Python |
| ---------- | ------ |
| `run.initialMerit` | `run.initial_merit` |

开始时的评价函数值：适用于精炼；其他情况为 `null` / `None`。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
design.merit.add('RAV', 450, 650, { target: 0 });
const run = await design.refine({ maxIter: 20 });
console.log(run.initialMerit, '->', run.merit);
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
design.merit.add("RAV", 450, 650, target=0)
run = design.refine(max_iter=20)
print(run.initial_merit, "->", run.merit)
```

### iterations

| JavaScript | Python |
| ---------- | ------ |
| `run.iterations` | `run.iterations` |

精炼进行的迭代次数，或结构优化运行的代数；其他运行为 `null` / `None`。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
design.merit.add('RAV', 450, 650, { target: 0 });
console.log((await design.refine({ maxIter: 20 })).iterations);
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
design.merit.add("RAV", 450, 650, target=0)
print(design.refine(max_iter=20).iterations)
```

### seed

| JavaScript | Python |
| ---------- | ------ |
| `run.seed` | `run.seed` |

运行随机抽样所用的起始种子：相同的种子、设计和设置会重复同样的运行。不做随机抽样的运行为 `null` / `None`。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
design.merit.add('RAV', 450, 650, { target: 0 });
const before = design.copy();
const run = await design.refine({ method: 'sa', maxIter: 20 });
const again = await before.refine({ method: 'sa', maxIter: 20, seed: run.seed });
console.log(run.seed, run.merit === again.merit);
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
design.merit.add("RAV", 450, 650, target=0)
before = design.copy()
run = design.refine(method="sa", max_iter=20)
again = before.refine(method="sa", max_iter=20, seed=run.seed)
print(run.seed, run.merit == again.merit)
```

### mode

| JavaScript | Python |
| ---------- | ------ |
| `run.mode` | `run.mode` |

运行的评价对象：`'front'` 或 `'back'`，仅镀膜面；`'total'`，整个元件；由设计的 `sides` 和 `scoreOn` / `score_on` 决定。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
design.merit.add('RAV', 450, 650, { target: 0 });
design.scoreOn = 'whole part';
console.log((await design.refine({ maxIter: 20 })).mode);
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
design.merit.add("RAV", 450, 650, target=0)
design.score_on = "whole part"
print(design.refine(max_iter=20).mode)
```

### reported

| JavaScript | Python |
| ---------- | ------ |
| `run.reported` | `run.reported` |

运行返回的全部内容，按名称列出，例如 `geSteps`，渐进演化运行的强制步数；或 `reheats`，结构优化深度搜索的重启次数。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
design.merit.add('RAV', 450, 650, { target: 0 });
const run = await design.refine({ maxIter: 20 });
console.log(Object.keys(run.reported).join(', '));
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
design.merit.add("RAV", 450, 650, target=0)
run = design.refine(max_iter=20)
print(", ".join(run.reported))
```

## Progress

运行到目前为止报告的内容，运行每次报告时都会传给作为 `progress` 传入的函数。运行尚未报告或不报告的属性为 `null` / `None`。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
design.merit.add('RAV', 450, 650, { target: 0 });
await design.refine({ method: 'dls', maxIter: 5, progress: p => console.log(p.iteration, p.merit) });
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
design.merit.add("RAV", 450, 650, target=0)
design.refine(method="dls", max_iter=5, progress=lambda p: print(p.iteration, p.merit))
```

### merit

| JavaScript | Python |
| ---------- | ------ |
| `p.merit` | `p.merit` |

运行当前报告的评价函数值：精炼时为当前膜层的值，合成时为它接下来所依据的设计的值。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
design.merit.add('RAV', 450, 650, { target: 0 });
await design.refine({ maxIter: 5, progress: p => console.log(p.merit) });
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
design.merit.add("RAV", 450, 650, target=0)
design.refine(max_iter=5, progress=lambda p: print(p.merit))
```

### bestMerit / best_merit

| JavaScript | Python |
| ---------- | ------ |
| `p.bestMerit` | `p.best_merit` |

到目前为止最好的评价函数值，在运行报告它时给出。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
design.merit.add('RAV', 450, 650, { target: 0 });
await design.refine({ maxIter: 5, progress: p => console.log(p.bestMerit) });
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
design.merit.add("RAV", 450, 650, target=0)
design.refine(max_iter=5, progress=lambda p: print(p.best_merit))
```

### opticalMerit / optical_merit

| JavaScript | Python |
| ---------- | ------ |
| `p.opticalMerit` | `p.optical_merit` |

不含制造相关行 MNT、MXT、TT 和 STR 的评价函数值，在运行报告它时给出。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
design.merit.add('RAV', 450, 650, { target: 0 });
design.merit.add('MNT', { target: 10 });
await design.refine({ maxIter: 5, progress: p => console.log(p.merit, p.opticalMerit) });
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
design.merit.add("RAV", 450, 650, target=0)
design.merit.add("MNT", target=10)
design.refine(max_iter=5, progress=lambda p: print(p.merit, p.optical_merit))
```

### iteration

| JavaScript | Python |
| ---------- | ------ |
| `p.iteration` | `p.iteration` |

正在进行的迭代：适用于精炼和结构优化。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
design.merit.add('RAV', 450, 650, { target: 0 });
await design.refine({ maxIter: 5, progress: p => console.log(p.iteration) });
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
design.merit.add("RAV", 450, 650, target=0)
design.refine(max_iter=5, progress=lambda p: print(p.iteration))
```

### generation

| JavaScript | Python |
| ---------- | ------ |
| `p.generation` | `p.generation` |

运行最近接受的一代：适用于针法、渐进演化和结构优化。

```js
const design = tf.newDesign('AR');
design.layers.append('SiO2', 100);
design.merit.add('RAV', 420, 680, { target: 0 });
await design.synthesize('needle', ['TiO2', 'SiO2'], { maxLayers: 8, progress: p => console.log(p.generation, p.layerCount) });
```

```python
design = tf.new_design("AR")
design.layers.append("SiO2", 100)
design.merit.add("RAV", 420, 680, target=0)
design.synthesize("needle", pool=["TiO2", "SiO2"], max_layers=8,
                  progress=lambda p: print(p.generation, p.layer_count))
```

### layerCount / layer_count

| JavaScript | Python |
| ---------- | ------ |
| `p.layerCount` | `p.layer_count` |

运行接下来所依据的设计的膜层数：适用于合成。

```js
const design = tf.newDesign('AR');
design.layers.append('SiO2', 100);
design.merit.add('RAV', 420, 680, { target: 0 });
await design.synthesize('needle', ['TiO2', 'SiO2'], { maxLayers: 8, progress: p => console.log(p.layerCount) });
```

```python
design = tf.new_design("AR")
design.layers.append("SiO2", 100)
design.merit.add("RAV", 420, 680, target=0)
design.synthesize("needle", pool=["TiO2", "SiO2"], max_layers=8, progress=lambda p: print(p.layer_count))
```

### method

| JavaScript | Python |
| ---------- | ------ |
| `p.method` | `p.method` |

正在运行的精炼方法，例如 `'dls'`，用于尝试多种方法的精炼。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
design.merit.add('RAV', 450, 650, { target: 0 });
await design.refine({ method: ['dls', 'cg'], progress: p => console.log(p.method) });
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
design.merit.add("RAV", 450, 650, target=0)
design.refine(method=["dls", "cg"], progress=lambda p: print(p.method))
```

### seed

| JavaScript | Python |
| ---------- | ------ |
| `p.seed` | `p.seed` |

运行开始后，其随机抽样所用的起始种子；不做随机抽样的运行为 `null` / `None`。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
design.merit.add('RAV', 450, 650, { target: 0 });
await design.refine({ method: 'sa', maxIter: 5, progress: p => console.log(p.seed) });
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
design.merit.add("RAV", 450, 650, target=0)
design.refine(method="sa", max_iter=5, progress=lambda p: print(p.seed))
```

### trial

| JavaScript | Python |
| ---------- | ------ |
| `p.trial` | `p.trial` |

到目前为止完成的试验数：适用于蒙特卡洛。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
await design.monteCarlo(400, 700, { step: 10, runs: 20, progress: p => console.log(p.trial, 'of', p.total) });
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
design.monte_carlo(400, 700, step=10, runs=20, progress=lambda p: print(p.trial, "of", p.total))
```

### total

| JavaScript | Python |
| ---------- | ------ |
| `p.total` | `p.total` |

运行要进行的试验数：适用于蒙特卡洛。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
await design.monteCarlo(400, 700, { step: 10, runs: 20, progress: p => console.log(p.trial / p.total) });
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
design.monte_carlo(400, 700, step=10, runs=20, progress=lambda p: print(p.trial / p.total))
```

### activity

| JavaScript | Python |
| ---------- | ------ |
| `p.activity` | `p.activity` |

**JavaScript**：合成正在做什么，一个对象，例如 `{ id: 'scanning' }`，或 null。

**Python**：合成正在做什么，一个 dict，例如 {"id": "scanning"}，或 None。

```js
const design = tf.newDesign('AR');
design.layers.append('SiO2', 100);
design.merit.add('RAV', 420, 680, { target: 0 });
await design.synthesize('needle', ['TiO2', 'SiO2'], { maxLayers: 8, progress: p => console.log(p.activity) });
```

```python
design = tf.new_design("AR")
design.layers.append("SiO2", 100)
design.merit.add("RAV", 420, 680, target=0)
design.synthesize("needle", pool=["TiO2", "SiO2"], max_layers=8, progress=lambda p: print(p.activity))
```

### reported

| JavaScript | Python |
| ---------- | ------ |
| `p.reported` | `p.reported` |

运行到目前为止报告的全部内容，按名称列出，例如 `design`，运行当前所处理的膜层。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
design.merit.add('RAV', 450, 650, { target: 0 });
await design.refine({ maxIter: 5, progress: p => console.log(Object.keys(p.reported).sort().join(', ')) });
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
design.merit.add("RAV", 450, 650, target=0)
design.refine(max_iter=5, progress=lambda p: print(", ".join(sorted(p.reported))))
```

## MonteCarlo

对带有随机膜层误差的设计做的蒙特卡洛试验，由 `design.monteCarlo()` / `design.monte_carlo()` 运行：一个量在一段波长范围内的分散。每种分散都是一个 Curve，值为 0 到 1 之间的小数。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
const mc = await design.monteCarlo(400, 700, { step: 10, runs: 20, seed: 1 });
console.log(mc.runs, 'trials, largest spread:', Math.max(...mc.stdev));
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
mc = design.monte_carlo(400, 700, step=10, runs=20, seed=1)
print(mc.runs, "trials, largest spread:", max(mc.stdev))
```

### wavelength

| JavaScript | Python |
| ---------- | ------ |
| `mc.wavelength` | `mc.wavelength` |

各波长，单位 nm。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
const mc = await design.monteCarlo(400, 700, { step: 50, runs: 5 });
console.log(mc.wavelength.join(', '));
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
print(design.monte_carlo(400, 700, step=50, runs=5).wavelength)
```

### theory

| JavaScript | Python |
| ---------- | ------ |
| `mc.theory` | `mc.theory` |

无误差设计的该量，一个 Curve。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
const mc = await design.monteCarlo(400, 700, { step: 10, runs: 5 });
console.log(Math.max(...mc.theory));
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
print(max(design.monte_carlo(400, 700, step=10, runs=5).theory))
```

### mean

| JavaScript | Python |
| ---------- | ------ |
| `mc.mean` | `mc.mean` |

各次试验的平均值，一个 Curve。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
const mc = await design.monteCarlo(400, 700, { step: 10, runs: 5 });
console.log(mc.mean.mean(450, 650));
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
print(design.monte_carlo(400, 700, step=10, runs=5).mean.mean(450, 650))
```

### stdev

| JavaScript | Python |
| ---------- | ------ |
| `mc.stdev` | `mc.stdev` |

各次试验的标准差，一个 Curve。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
const mc = await design.monteCarlo(400, 700, { step: 10, runs: 5 });
console.log(Math.max(...mc.stdev));
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
print(max(design.monte_carlo(400, 700, step=10, runs=5).stdev))
```

### lower

| JavaScript | Python |
| ---------- | ------ |
| `mc.lower` | `mc.lower` |

平均值减一个标准差，最小为 0，一个 Curve。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
const mc = await design.monteCarlo(400, 700, { step: 10, runs: 5 });
console.log(Math.min(...mc.lower));
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
print(min(design.monte_carlo(400, 700, step=10, runs=5).lower))
```

### upper

| JavaScript | Python |
| ---------- | ------ |
| `mc.upper` | `mc.upper` |

平均值加一个标准差，最大为 1，一个 Curve。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
const mc = await design.monteCarlo(400, 700, { step: 10, runs: 5 });
console.log(Math.max(...mc.upper));
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
print(max(design.monte_carlo(400, 700, step=10, runs=5).upper))
```

### lowest

| JavaScript | Python |
| ---------- | ------ |
| `mc.lowest` | `mc.lowest` |

各次试验中的最小值，一个 Curve。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
const mc = await design.monteCarlo(400, 700, { step: 10, runs: 5 });
console.log(Math.min(...mc.lowest));
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
print(min(design.monte_carlo(400, 700, step=10, runs=5).lowest))
```

### highest

| JavaScript | Python |
| ---------- | ------ |
| `mc.highest` | `mc.highest` |

各次试验中的最大值，一个 Curve。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
const mc = await design.monteCarlo(400, 700, { step: 10, runs: 5 });
console.log(Math.max(...mc.highest));
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
print(max(design.monte_carlo(400, 700, step=10, runs=5).highest))
```

### runs

| JavaScript | Python |
| ---------- | ------ |
| `mc.runs` | `mc.runs` |

完成的试验数：与要求的相同；运行被停止时会更少。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
console.log((await design.monteCarlo(400, 700, { step: 10, runs: 5 })).runs);
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
print(design.monte_carlo(400, 700, step=10, runs=5).runs)
```

### quantity

| JavaScript | Python |
| ---------- | ------ |
| `mc.quantity` | `mc.quantity` |

物理量，`'R'`、`'T'` 或 `'A'`。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
console.log((await design.monteCarlo(400, 700, { step: 10, runs: 5, quantity: 'T' })).quantity);
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
print(design.monte_carlo(400, 700, step=10, runs=5, quantity="T").quantity)
```

### seed

| JavaScript | Python |
| ---------- | ------ |
| `mc.seed` | `mc.seed` |

抽样所用的起始种子：相同的种子和设置会重复同样的运行。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
console.log((await design.monteCarlo(400, 700, { step: 10, runs: 5 })).seed);
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
print(design.monte_carlo(400, 700, step=10, runs=5).seed)
```

### spec

| JavaScript | Python |
| ---------- | ------ |
| `mc.spec` | `mc.spec` |

设计有规格时，满足规格的试验所占的比例，一个 Yield，与 `specification.estimateYield()` / `specification.estimate_yield()` 的统计相同；没有规格的设计为 `null` / `None`。

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^5 H');
design.specification.add('R_AVG', 520, 580, { cmp: 'ge', target: 0.97 });
const mc = await design.monteCarlo(400, 700, { step: 10, runs: 20, seed: 1 });
console.log('yield', mc.spec.value, 'of', mc.spec.runs, 'trials');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^5 H")
design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.97)
mc = design.monte_carlo(400, 700, step=10, runs=20, seed=1)
print("yield", mc.spec.value, "of", mc.spec.runs, "trials")
```

### mode

| JavaScript | Python |
| ---------- | ------ |
| `mc.mode` | `mc.mode` |

试验的评价对象：`'front'` 或 `'back'`，仅镀膜面；`'total'`，整个元件；由设计的 `sides` 和 `scoreOn` / `score_on` 决定。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
console.log((await design.monteCarlo(400, 700, { step: 10, runs: 5 })).mode);
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
print(design.monte_carlo(400, 700, step=10, runs=5).mode)
```

## LayerSensitivity

每层厚度偏离时评价函数值的变化量，由 `design.layerSensitivity()` / `design.layer_sensitivity()` 对膜层排序。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
design.merit.add('RAV', 450, 650, { target: 0 });
const ls = design.layerSensitivity();
const worst = ls.rows.reduce((a, b) => (b.sensitivity > a.sensitivity ? b : a));
console.log('most sensitive: layer', worst.number, worst.material);
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
design.merit.add("RAV", 450, 650, target=0)
ls = design.layer_sensitivity()
worst = max(ls.rows, key=lambda row: row.sensitivity)
print("most sensitive: layer", worst.number, worst.material)
```

### rows

| JavaScript | Python |
| ---------- | ------ |
| `ls.rows` | `ls.rows` |

每个参与评分的膜层一个 SensitivityRow，正面的在前。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
design.merit.add('RAV', 450, 650, { target: 0 });
for (const row of design.layerSensitivity().rows) console.log(row.number, row.sensitivity);
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
design.merit.add("RAV", 450, 650, target=0)
for row in design.layer_sensitivity().rows:
    print(row.number, row.sensitivity)
```

### merit

| JavaScript | Python |
| ---------- | ------ |
| `ls.merit` | `ls.merit` |

设计当前的评价函数值，不含 MNT 和 MXT 行。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
design.merit.add('RAV', 450, 650, { target: 0 });
console.log(design.layerSensitivity().merit);
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
design.merit.add("RAV", 450, 650, target=0)
print(design.layer_sensitivity().merit)
```

### mode

| JavaScript | Python |
| ---------- | ------ |
| `ls.mode` | `ls.mode` |

评分的对象：`'front'` 或 `'back'`，仅镀膜面；`'total'`，整个元件；由设计的 `sides` 和 `scoreOn` / `score_on` 决定。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
design.merit.add('RAV', 450, 650, { target: 0 });
console.log(design.layerSensitivity().mode);
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
design.merit.add("RAV", 450, 650, target=0)
print(design.layer_sensitivity().mode)
```

## SensitivityRow

层灵敏度排序中的一层。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
design.merit.add('RAV', 450, 650, { target: 0 });
for (const row of design.layerSensitivity().rows) console.log(row.side, row.number, row.material, row.sensitivity);
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
design.merit.add("RAV", 450, 650, target=0)
for row in design.layer_sensitivity().rows:
    print(row.side, row.number, row.material, row.sensitivity)
```

### side

| JavaScript | Python |
| ---------- | ------ |
| `row.side` | `row.side` |

该层所在的面，`'front'` 或 `'back'`。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
design.merit.add('RAV', 450, 650, { target: 0 });
console.log(design.layerSensitivity().rows[0].side);
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
design.merit.add("RAV", 450, 650, target=0)
print(design.layer_sensitivity().rows[0].side)
```

### number

| JavaScript | Python |
| ---------- | ------ |
| `row.number` | `row.number` |

该层在其所在面的编号，1 紧邻基底，与 design.layers 和 `design.backLayers` / `design.back_layers` 的编号相同。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
design.merit.add('RAV', 450, 650, { target: 0 });
const row = design.layerSensitivity().rows[0];
console.log(row.number, design.layers[row.number].material);
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
design.merit.add("RAV", 450, 650, target=0)
row = design.layer_sensitivity().rows[0]
print(row.number, design.layers[row.number].material)
```

### material

| JavaScript | Python |
| ---------- | ------ |
| `row.material` | `row.material` |

该层的材料，按 id 指定。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
design.merit.add('RAV', 450, 650, { target: 0 });
console.log(design.layerSensitivity().rows[0].material);
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
design.merit.add("RAV", 450, 650, target=0)
print(design.layer_sensitivity().rows[0].material)
```

### thickness

| JavaScript | Python |
| ---------- | ------ |
| `row.thickness` | `row.thickness` |

该层的厚度，单位 nm。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
design.merit.add('RAV', 450, 650, { target: 0 });
console.log(design.layerSensitivity().rows[0].thickness);
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
design.merit.add("RAV", 450, 650, target=0)
print(design.layer_sensitivity().rows[0].thickness)
```

### step

| JavaScript | Python |
| ---------- | ------ |
| `row.step` | `row.step` |

该层加厚和减薄所用的厚度步长，单位 nm。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
design.merit.add('RAV', 450, 650, { target: 0 });
console.log(design.layerSensitivity({ step: 'percent', relPct: 2 }).rows[0].step);
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
design.merit.add("RAV", 450, 650, target=0)
print(design.layer_sensitivity(step="percent", rel_pct=2).rows[0].step)
```

### meritChange / merit_change

| JavaScript | Python |
| ---------- | ------ |
| `row.meritChange` | `row.merit_change` |

两个步长下评价函数值的平均变化。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
design.merit.add('RAV', 450, 650, { target: 0 });
console.log(design.layerSensitivity().rows[0].meritChange);
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
design.merit.add("RAV", 450, 650, target=0)
print(design.layer_sensitivity().rows[0].merit_change)
```

### signedMeritChange / signed_merit_change

| JavaScript | Python |
| ---------- | ------ |
| `row.signedMeritChange` | `row.signed_merit_change` |

同一变化，加厚代价更大时为正，减薄代价更大时为负。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
design.merit.add('RAV', 450, 650, { target: 0 });
const row = design.layerSensitivity().rows[0];
console.log(row.signedMeritChange > 0 ? 'thicker costs more' : 'thinner costs more');
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
design.merit.add("RAV", 450, 650, target=0)
row = design.layer_sensitivity().rows[0]
print("thicker costs more" if row.signed_merit_change > 0 else "thinner costs more")
```

### sensitivity

| JavaScript | Python |
| ---------- | ------ |
| `row.sensitivity` | `row.sensitivity` |

该层的得分相对于最高得分的比例，0 到 100。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
design.merit.add('RAV', 450, 650, { target: 0 });
console.log(design.layerSensitivity().rows[0].sensitivity);
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
design.merit.add("RAV", 450, 650, target=0)
print(design.layer_sensitivity().rows[0].sensitivity)
```

### locked

| JavaScript | Python |
| ---------- | ------ |
| `row.locked` | `row.locked` |

锁定的膜层为 `true` / `True`。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
design.merit.add('RAV', 450, 650, { target: 0 });
design.layers[1].locked = true;
for (const row of design.layerSensitivity({ includeLocked: true }).rows) console.log(row.number, row.locked);
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
design.merit.add("RAV", 450, 650, target=0)
design.layers[1].locked = True
for row in design.layer_sensitivity(include_locked=True).rows:
    print(row.number, row.locked)
```

## CleanReport

design.clean() 对设计所做的操作，与设计清理器窗口列出的操作相同：移除的膜层，以及合并到相邻层中的膜层。

```js
const design = tf.newDesign('Stack with a thin layer');
design.stack('(HL)^2 0.03H L');
const report = design.clean();
console.log(report.removed, 'taken out,', report.merged, 'merged');
```

```python
design = tf.new_design("Stack with a thin layer")
design.stack("(HL)^2 0.03H L")
report = design.clean()
print(report.removed, "taken out,", report.merged, "merged")
```

### removed

| JavaScript | Python |
| ---------- | ------ |
| `report.removed` | `report.removed` |

移除的膜层数。

```js
const design = tf.newDesign('Stack with a thin layer');
design.stack('(HL)^2 0.03H L');
console.log(design.clean().removed);
```

```python
design = tf.new_design("Stack with a thin layer")
design.stack("(HL)^2 0.03H L")
print(design.clean().removed)
```

### merged

| JavaScript | Python |
| ---------- | ------ |
| `report.merged` | `report.merged` |

合并到相邻层中的膜层数。

```js
const design = tf.newDesign('Stack with a thin layer');
design.stack('(HL)^2 0.03H L');
console.log(design.clean().merged);
```

```python
design = tf.new_design("Stack with a thin layer")
design.stack("(HL)^2 0.03H L")
print(design.clean().merged)
```

### operations

| JavaScript | Python |
| ---------- | ------ |
| `report.operations` | `report.operations` |

**JavaScript**：每个操作一个对象，按执行顺序排列，正面的在前：`{ side, kind, number, material, thickness, mergedInto }`。kind 为 `'remove'` 或 `'merge'`；number 为该层在清理前其所在面的编号，1 紧邻基底，与当时 design.layers 和 design.backLayers 的编号相同；material 为其材料 id；thickness 单位 nm，对被移除的膜层是它被移除时的厚度，包括此前合并进它的膜层，对合并操作是它加到被合并进的那一层上的厚度；mergedInto 对合并操作是那一层的编号，编号方式与 number 相同，对被移除的膜层为 null。

**Python**：每个操作一个具名元组 (side, kind, number, material, thickness, merged_into)，按执行顺序排列，正面的在前。kind 为 "remove" 或 "merge"；number 为该层在清理前其所在面的编号，1 紧邻基底，与当时 design.layers 和 design.back_layers 的编号相同；material 为其材料 id；thickness 单位 nm，对被移除的膜层是它被移除时的厚度，包括此前合并进它的膜层，对合并操作是它加到被合并进的那一层上的厚度；merged_into 对合并操作是那一层的编号，编号方式与 number 相同，对被移除的膜层为 None。

```js
const design = tf.newDesign('Stack with a thin layer');
design.stack('(HL)^2 0.03H L');
for (const op of design.clean().operations) console.log(op.kind, op.side, op.number, op.material, op.thickness, op.mergedInto);
```

```python
design = tf.new_design("Stack with a thin layer")
design.stack("(HL)^2 0.03H L")
for op in design.clean().operations:
    print(op.kind, op.side, op.number, op.material, op.thickness, op.merged_into)
```

## Materials

TFStudio 材料目录中的材料：内置材料，以及数据文件夹中各材料目录里的材料。

```js
const [n, k] = tf.materials.get('TiO2').nk(550);
console.log(n, k, tf.materials.find('SiO2').length);
```

```python
n, k = tf.materials["TiO2"].nk(550)
print(n, k, len(tf.materials.find("SiO2")))
```

### get / []

| JavaScript | Python |
| ---------- | ------ |
| `tf.materials.get(idOrName)` | `tf.materials[id_or_name]` |

具有该 id 的材料，或者具有该名称的材料。内置材料的 id 可以写成 `builtin:TiO2`，与膜层材料中可能出现的写法相同。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `idOrName` | `id_or_name` |  | 材料的 id 或名称。 |

**返回**：一个 Material。

**拒绝**：

- 没有材料具有该 id 或名称，或多个材料具有该名称而没有材料具有该 id

```js
console.log(tf.materials.get('TiO2'));
```

```python
print(tf.materials["TiO2"])
```

### find

| JavaScript | Python |
| ---------- | ------ |
| `tf.materials.find(text)` | `tf.materials.find(text="")` |

id 或名称中含有 `text` 的材料，不区分大小写。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `text` | `text` | `''` | 要查找的文本；为空时找出所有材料。 |

**返回**：找到的材料，每个都是一个 Material。

```js
for (const m of tf.materials.find('TiO2')) console.log(m.id, m.catalog);
```

```python
for m in tf.materials.find("TiO2"):
    print(m.id, m.catalog)
```

## Material

TFStudio 材料目录中的一种材料，由 tf.materials 给出。

```js
const tio2 = tf.materials.get('TiO2');
console.log(tio2.id, tio2.name, tio2.catalog, tio2.nk(550));
```

```python
tio2 = tf.materials["TiO2"]
print(tio2.id, tio2.name, tio2.catalog, tio2.nk(550))
```

### id

| JavaScript | Python |
| ---------- | ------ |
| `material.id` | `material.id` |

设计用来指称该材料的 id：内置材料的短 id，例如 `TiO2`，它可能与名称不同，例如 `TiO2 (anatase)`；其他材料目录中的材料为 `catalog:key`。设计中的内置材料也可能写成 `builtin:TiO2`，这是设计编辑器和 stack() 写入的形式，tf.materials 同样接受。

```js
const design = tf.newDesign('AR');
design.layers.append(tf.materials.get('MgF2').id, 95);
console.log(design.layers[1].material);
```

```python
design = tf.new_design("AR")
design.layers.append(tf.materials["MgF2"].id, 95)
print(design.layers[1].material)
```

### name

| JavaScript | Python |
| ---------- | ------ |
| `material.name` | `material.name` |

应用中显示的名称。

```js
console.log(tf.materials.get('TiO2').name);
```

```python
print(tf.materials["TiO2"].name)
```

### catalog

| JavaScript | Python |
| ---------- | ------ |
| `material.catalog` | `material.catalog` |

材料所在的材料目录，内置材料为 `'builtin'`。

```js
console.log(tf.materials.get('TiO2').catalog);
```

```python
print(tf.materials["TiO2"].catalog)
```

### nk

| JavaScript | Python |
| ---------- | ------ |
| `material.nk(wavelengths)` | `material.nk(wavelengths)` |

材料的 n 和 k，与材料色散窗口显示的相同；在其数据覆盖范围之外，保持在边界值或外推得到。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `wavelengths` | `wavelengths` |  | 一个波长（单位 nm），或多个波长。 |

**返回**：**JavaScript**：一个波长时为 `[n, k]`；多个波长时为 `[ns, ks]`，即一个 n 数组和一个 k 数组，每个波长各一个值。<br>**Python**：一个波长时为 (n, k)；多个波长时为 (ns, ks)，即一个 n 的 list 和一个 k 的 list，每个波长各一个值。

**拒绝**：

- 小于等于 0 的波长

```js
const [n, k] = tf.materials.get('TiO2').nk(550);
const [ns, ks] = tf.materials.get('TiO2').nk([400, 550, 700]);
console.log(n, k, ns, ks);
```

```python
n, k = tf.materials["TiO2"].nk(550)
ns, ks = tf.materials["TiO2"].nk([400, 550, 700])
print(n, k, ns, ks)
```

### range

| JavaScript | Python |
| ---------- | ------ |
| `material.range` | `material.range` |

材料数据覆盖的波长范围，`[first, last]`，单位 nm；材料未声明范围时为 `null` / `None`，例如未注明范围的公式。

```js
console.log('TiO2 has data from', tf.materials.get('TiO2').range);
```

```python
print("TiO2 has data from", tf.materials["TiO2"].range)
```

### dispersion

| JavaScript | Python |
| ---------- | ------ |
| `material.dispersion(start, end, { thickness })` | `material.dispersion(start=400, end=1100, thickness=1)` |

光穿过该材料平板时的相位、群延迟、GDD、CDC 和 TOD，以及材料的群折射率，随波长的变化，与材料色散窗口的计算相同：厚度为 d 的平板的 φ = −(d/c)·ω·n 及其对 ω 的导数，取自材料的公式或按应用程序的读法读取的表格，因此每个波长处的数值都是解析值，相位为绝对值。波长取窗口的网格：在范围内分 2000 步，步长不小于 0.2 nm，并在范围内每个表格节点处加一个采样点。平板吸收使光学深度超过 50 的波长没有数值。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `start` | `start` | `400` | 起始波长，单位 nm。 |
| `end` | `end` | `1100` | 结束波长，单位 nm，大于 `start`。 |
| `thickness` | `thickness` | `1` | 平板的厚度，单位 mm，从 1e-9（1 pm）到 100000（100 m）。 |

**返回**：一个 MaterialDispersion。

**拒绝**：

- **JavaScript**：它不接受的选项、不构成范围的波长范围，或 1e-9 到 100000 mm 以外的厚度<br>**Python**：不构成范围的波长范围，或 1e-9 到 100000 mm 以外的厚度

```js
const d = tf.materials.get('BK7').dispersion(700, 900, { thickness: 2 });
console.log('2 mm of BK7: GDD from', d.gdd.min().toFixed(1), 'to', d.gdd.max().toFixed(1), 'fs²');
```

```python
d = tf.materials["BK7"].dispersion(700, 900, thickness=2)
print("2 mm of BK7: GDD from", round(d.gdd.min(), 1), "to", round(d.gdd.max(), 1), "fs²")
```

## MaterialDispersion

光穿过一种材料的平板时的相位、群延迟、GDD、CDC 和 TOD，以及材料的群折射率，随波长的变化，由 material.dispersion() 计算，与材料色散窗口的显示相同。`d.phase`、`d.gd`、`d.gdd`、`d.cdc`、`d.tod` 和 `d.groupIndex` / `d.group_index` 都是 Curve。

```js
const d = tf.materials.get('BK7').dispersion(700, 900, { thickness: 2 });
console.log('mean GDD of 2 mm of BK7 from 780 to 820 nm:', d.gdd.mean(780, 820).toFixed(1), 'fs²');
```

```python
d = tf.materials["BK7"].dispersion(700, 900, thickness=2)
print("mean GDD of 2 mm of BK7 from 780 to 820 nm:", round(d.gdd.mean(780, 820), 1), "fs²")
```

### thickness

| JavaScript | Python |
| ---------- | ------ |
| `d.thickness` | `d.thickness` |

平板的厚度，单位 mm。

```js
console.log(tf.materials.get('BK7').dispersion().thickness, 'mm');
```

```python
print(tf.materials["BK7"].dispersion().thickness, "mm")
```

### wavelength

| JavaScript | Python |
| ---------- | ------ |
| `d.wavelength` | `d.wavelength` |

各波长，单位 nm：窗口的网格，并在范围内每个表格节点处有一个采样点。

```js
console.log(tf.materials.get('BK7').dispersion(700, 900).wavelength.length, 'wavelengths');
```

```python
print(len(tf.materials["BK7"].dispersion(700, 900).wavelength), "wavelengths")
```

### phase

| JavaScript | Python |
| ---------- | ------ |
| `d.phase` | `d.phase` |

相位 φ = −(d/c)·ω·n，单位为度，一个 Curve。

```js
const d = tf.materials.get('BK7').dispersion(700, 900);
console.log('phase from', d.phase.min().toFixed(0), 'to', d.phase.max().toFixed(0), 'degrees');
```

```python
d = tf.materials["BK7"].dispersion(700, 900)
print("phase from", round(d.phase.min()), "to", round(d.phase.max()), "degrees")
```

### gd

| JavaScript | Python |
| ---------- | ------ |
| `d.gd` | `d.gd` |

群延迟，单位 fs，一个 Curve。

```js
const d = tf.materials.get('BK7').dispersion(700, 900);
console.log('GD of 1 mm of BK7 at 800 nm:', d.gd[d.wavelength.indexOf(800)].toFixed(1), 'fs');
```

```python
d = tf.materials["BK7"].dispersion(700, 900)
print("GD of 1 mm of BK7 at 800 nm:", round(d.gd[d.wavelength.index(800)], 1), "fs")
```

### gdd

| JavaScript | Python |
| ---------- | ------ |
| `d.gdd` | `d.gdd` |

GDD，单位 fs²，一个 Curve。

```js
const d = tf.materials.get('BK7').dispersion(700, 900);
console.log('GDD of 1 mm of BK7 at 800 nm:', d.gdd[d.wavelength.indexOf(800)].toFixed(2), 'fs²');
```

```python
d = tf.materials["BK7"].dispersion(700, 900)
print("GDD of 1 mm of BK7 at 800 nm:", round(d.gdd[d.wavelength.index(800)], 2), "fs²")
```

### cdc

| JavaScript | Python |
| ---------- | ------ |
| `d.cdc` | `d.cdc` |

CDC，即 GDD·2πc/λ²，单位 fs/nm，一个 Curve，符号与 GDD 相同；群延迟对波长的斜率 dGD/dλ 等于 −CDC。

```js
const d = tf.materials.get('BK7').dispersion(700, 900);
console.log('CDC of 1 mm of BK7 at 800 nm:', d.cdc[d.wavelength.indexOf(800)].toFixed(4), 'fs/nm');
```

```python
d = tf.materials["BK7"].dispersion(700, 900)
print("CDC of 1 mm of BK7 at 800 nm:", round(d.cdc[d.wavelength.index(800)], 4), "fs/nm")
```

### tod

| JavaScript | Python |
| ---------- | ------ |
| `d.tod` | `d.tod` |

TOD，单位 fs³，一个 Curve。

```js
const d = tf.materials.get('BK7').dispersion(700, 900);
console.log('TOD of 1 mm of BK7 at 800 nm:', d.tod[d.wavelength.indexOf(800)].toFixed(2), 'fs³');
```

```python
d = tf.materials["BK7"].dispersion(700, 900)
print("TOD of 1 mm of BK7 at 800 nm:", round(d.tod[d.wavelength.index(800)], 2), "fs³")
```

### groupIndex / group_index

| JavaScript | Python |
| ---------- | ------ |
| `d.groupIndex` | `d.group_index` |

群折射率 n − λ·dn/dλ，一个 Curve。

```js
const d = tf.materials.get('BK7').dispersion(700, 900);
console.log('group index of BK7 at 800 nm:', d.groupIndex[d.wavelength.indexOf(800)].toFixed(5));
```

```python
d = tf.materials["BK7"].dispersion(700, 900)
print("group index of BK7 at 800 nm:", round(d.group_index[d.wavelength.index(800)], 5))
```

### outside

| JavaScript | Python |
| ---------- | ------ |
| `d.outside` | `d.outside` |

对每个波长，若其数值取自材料数据之外（保持在边界值或外推得到），给出材料的名称；否则为 `null` / `None`。

```js
const d = tf.materials.get('TiO2').dispersion(300, 1100);
console.log(d.outside.filter(Boolean).length, 'wavelengths outside the data');
```

```python
d = tf.materials["TiO2"].dispersion(300, 1100)
print(sum(1 for name in d.outside if name), "wavelengths outside the data")
```

### masked

| JavaScript | Python |
| ---------- | ------ |
| `d.masked` | `d.masked` |

**JavaScript**：没有数值的波长，一个由 `{ wavelength, reason, maximumThickness }` 组成的数组。`reason` 说明原因：最常见的是平板在该处的吸收使光学深度超过 50，此时 `maximumThickness` 是平板在该处仍有数值的最大厚度，单位 mm；没有任何厚度能给出数值时为 `null`，例如材料模型在该处没有三阶导数。曲线在这些波长处为 NaN。每个波长都有数值时为空。

**Python**：没有数值的波长，一个由 dict（wavelength、reason 和 maximumThickness）组成的 list。reason 说明原因：最常见的是平板在该处的吸收使光学深度超过 50，此时 maximumThickness 是平板在该处仍有数值的最大厚度，单位 mm；没有任何厚度能给出数值时为 None，例如材料模型在该处没有三阶导数。曲线在这些波长处为 NaN。每个波长都有数值时为空。

```js
const d = tf.materials.get('Si').dispersion(400, 1100, { thickness: 1 });
console.log(d.masked.length, 'wavelengths with no value; the first', d.masked[0]);
```

```python
d = tf.materials["Si"].dispersion(400, 1100, thickness=1)
print(len(d.masked), "wavelengths with no value; the first", d.masked[0])
```

### knots

| JavaScript | Python |
| ---------- | ------ |
| `d.knots` | `d.knots` |

**JavaScript**：落在网格波长上的表格节点，一个由 `{ wavelength, gd, gdd, tod, cdc }` 组成的数组，每个量是它在节点两侧的数值组成的一对 `[left, right]`；曲线在该波长处的值读取的是节点两侧平均后的材料。若节点相对网格过密，即每 8 个点多于一个节点，则不取任何节点。

**Python**：落在网格波长上的表格节点，一个由 dict（wavelength、gd、gdd、tod 和 cdc）组成的 list，每个量是它在节点两侧的数值组成的一对 [left, right]；曲线在该波长处的值读取的是节点两侧平均后的材料。若节点相对网格过密，即每 8 个点多于一个节点，则不取任何节点。

```js
for (const knot of tf.materials.get('TiO2').dispersion().knots.slice(0, 3)) console.log(knot.wavelength, 'nm: GDD', knot.gdd[0].toFixed(3), 'and', knot.gdd[1].toFixed(3), 'fs²');
```

```python
for knot in tf.materials["TiO2"].dispersion().knots[:3]:
    print(knot["wavelength"], "nm: GDD", round(knot["gdd"][0], 3), "and", round(knot["gdd"][1], 3), "fs²")
```

### model

| JavaScript | Python |
| ---------- | ------ |
| `d.model` | `d.model` |

材料的 n 和 k 所用的模型，名称与窗口中的相同。

```js
console.log(tf.materials.get('BK7').dispersion().model);
```

```python
print(tf.materials["BK7"].dispersion().model)
```

### saveCsv / save_csv

| JavaScript | Python |
| ---------- | ------ |
| `d.saveCsv(path)` | `d.save_csv(path)` |

**JavaScript**：把曲线写入 CSV 文件，与窗口以“复制 CSV”写出其表格的方式相同：先是 λ (nm)；有数值取自材料数据之外时接着是 Outside data 列；然后是 Phase φ (°)、Group Delay (fs)、GDD (fs²)、CDC (fs/nm)、TOD (fs³) 和群折射率 nᵧ。已存在的文件会被覆盖。

**Python**：把曲线写入 CSV 文件，与窗口以“复制 CSV”写出其表格的方式相同：先是 λ (nm)；有数值取自材料数据之外时接着是 Outside data 列；然后是 Phase φ (°)、Group Delay (fs)、GDD (fs²)、CDC (fs/nm)、TOD (fs³) 和群折射率 nᵧ。数值与窗口的相同，以 Python 的浮点数写法写出。已存在的文件会被覆盖。

| JavaScript | Python | 默认值 | 含义 |
| ---------- | ------ | --- | --- |
| `path` | `path` |  | **JavaScript**：要写入的文件，使用完整路径。相对路径以程序启动时所在的文件夹为基准：在脚本控制台中，是启动 TFStudio 时所在的文件夹，通常是其安装文件夹。<br>**Python**：要写入的文件。相对路径以程序的工作文件夹为基准：在脚本控制台中，是脚本所在的文件夹；未保存的脚本则是数据文件夹。 |

```js
const file = require('path').join(require('os').homedir(), `bk7-dispersion-${Date.now()}.csv`);
tf.materials.get('BK7').dispersion(700, 900).saveCsv(file);
console.log('Wrote', file);
```

```python
import time

name = "bk7-dispersion-{}.csv".format(time.time_ns())
tf.materials["BK7"].dispersion(700, 900).save_csv(name)
print("Wrote", name)
```

## Stop

运行的停止按钮。把它作为 `stop=` 交给运行，`stop()` 会在下一步结束运行，与该运行窗口中的停止按钮相同：精炼或合成随后保持设计原样，蒙特卡洛运行则以已完成的试验返回结果。

一个 Stop 可以交给多个运行，无论它们在同一个还是多个 TFStudio() 上，stop() 会结束所有这些运行。stop() 可以在任何线程中调用，可以在运行的 progress 函数中调用，也可以在运行开始之前调用，此时运行一开始就会结束。Stop 一旦停止就保持停止状态：下一次运行请新建一个。

JavaScript 中没有 Stop：运行用 AbortController 停止。把它的 `signal` 作为运行的 `stop` 选项传入，调用它的 `abort()` 就会在下一步结束运行，与 Python 中的 `stop()` 相同。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
design.merit.add('RAV', 450, 650, { target: 0 });
const controller = new AbortController();
const run = await design.refine({
    method: 'dls',
    stop: controller.signal,
    progress: p => { if (p.iteration >= 10) controller.abort(); },
});
console.log('Ended:', run.stopReason);
```

```python
import time
import tfstudio

design = tf.new_design("AR")
design.layers.append("SiO2", 100)
design.merit.add("RAV", 420, 680, target=0)
stop = tfstudio.Stop()
started = time.monotonic()

def watch(p):
    if time.monotonic() - started > 60:
        stop.stop()

run = design.synthesize("needle", pool=["TiO2", "SiO2"], max_layers=12, progress=watch, stop=stop)
print(run.stop_reason, len(design.layers), "layers")
```

### stopped

| Python |
| ------ |
| `stop.stopped` |

调用过 stop() 之后为 True。

```python
import tfstudio

stop = tfstudio.Stop()
print(stop.stopped)
stop.stop()
print(stop.stopped)
```

### stop

| Python |
| ------ |
| `stop.stop()` |

在下一步结束交给这个 Stop 的各个运行，之后交给它的运行会立即结束。

```python
import tfstudio

design = tf.new_design("AR")
design.stack("(HL)^2")
design.merit.add("RAV", 450, 650, target=0)
stop = tfstudio.Stop()

def watch(p):
    if p.iteration is not None and p.iteration >= 10:
        stop.stop()

run = design.refine(method="dls", progress=watch, stop=stop)
print("Ended:", run.stop_reason)
```

## App

打开的 TFStudio 应用，用于以 live=True 启动的 TFStudio()，前提是应用正在等待程序连接：先在应用的“优化”选项卡上点击“交互”。之后应用窗口会一直为该程序保持等待，直到在那里点击“终止”，并以本 Python 的可执行文件名称称呼它，在 Windows 上为 python.exe。“终止”会放开该程序：此后即使应用仍在等待程序连接，也会以 "off" 拒绝它，直到再次点击“交互”。在这里读取的设计与其他设计一样可以修改，design.push() 把它写回，作为应用可以撤销的一步。

JavaScript 中没有：脚本控制台中的脚本直接处理打开的设计 `tf.design`，脚本结束时由控制台应用它。

```python
import tfstudio

with tfstudio.TFStudio(live=True) as tf:
    design = tf.app.open_design()
    design.layers[1].thickness += 5
    design.push()
    print("Layer 1 of", design.name, "is now", design.layers[1].thickness, "nm")
```

### designs

| Python |
| ------ |
| `tf.app.designs()` |

应用中的各个设计。

**返回**：一个由 AppDesign 组成的 list。

**拒绝**：

- 未以 live=True 启动的 TFStudio()
- Python 引发 `AppError`：无法连接到应用：应用已关闭或没有为本程序等待连接时，代码为 "off"；在应用中为本程序点击了“拒绝”时为 "denied"

```python
import tfstudio

with tfstudio.TFStudio(live=True) as tf:
    for d in tf.app.designs():
        print(d.name, "(open)" if d.active else "")
```

### open_design

| Python |
| ------ |
| `tf.app.open_design(design=...)` |

应用中某个设计的副本，可以修改后用 push() 写回。

| Python | 默认值 | 含义 |
| ------ | --- | --- |
| `design` |  | 设计的 id 或名称，或 designs() 给出的一个 AppDesign。不给出时，为应用中打开的设计。 |

**返回**：一个 Design。

**拒绝**：

- 未以 live=True 启动的 TFStudio()、应用中没有对应设计的 id 或名称，或多个设计共用的名称
- Python 引发 `AppError`：无法连接到应用，或应用中没有设计

```python
import tfstudio

with tfstudio.TFStudio(live=True) as tf:
    design = tf.app.open_design()
    print("The open design:", design.name, len(design.layers), "layers")
    last = tf.app.open_design(tf.app.designs()[-1].name)
    print("By name:", last.name)
```

## AppDesign

TFStudio 应用中打开的一个设计，由 tf.app.designs() 列出。

JavaScript 中没有：它们由 tf.app 列出，而脚本控制台中的脚本只有打开的设计。

```python
import tfstudio

with tfstudio.TFStudio(live=True) as tf:
    for d in tf.app.designs():
        print(d.id, d.name, d.active)
```

### id

| Python |
| ------ |
| `d.id` |

设计在应用中的 id，tf.app.open_design() 接受它。

```python
import tfstudio

with tfstudio.TFStudio(live=True) as tf:
    first = tf.app.designs()[0]
    print(first.id, tf.app.open_design(first.id).name)
```

### name

| Python |
| ------ |
| `d.name` |

设计的名称。

```python
import tfstudio

with tfstudio.TFStudio(live=True) as tf:
    print([d.name for d in tf.app.designs()])
```

### folder

| Python |
| ------ |
| `d.folder` |

设计所在的项目文件夹，与项目资源管理器显示的相同，或 None。

```python
import tfstudio

with tfstudio.TFStudio(live=True) as tf:
    for d in tf.app.designs():
        print(d.name, d.folder)
```

### active

| Python |
| ------ |
| `d.active` |

应用中当前打开的设计为 True，它是 push() 唯一可以写入的设计。

```python
import tfstudio

with tfstudio.TFStudio(live=True) as tf:
    print([d.name for d in tf.app.designs() if d.active])
```

### unsaved

| Python |
| ------ |
| `d.unsaved` |

设计有未保存到文件的修改时为 True。

```python
import tfstudio

with tfstudio.TFStudio(live=True) as tf:
    print([d.name for d in tf.app.designs() if d.unsaved])
```

### layer_count

| Python |
| ------ |
| `d.layer_count` |

设计正面的膜层数。

```python
import tfstudio

with tfstudio.TFStudio(live=True) as tf:
    for d in tf.app.designs():
        print(d.name, d.layer_count)
```

### back_layer_count

| Python |
| ------ |
| `d.back_layer_count` |

设计背面的膜层数。

```python
import tfstudio

with tfstudio.TFStudio(live=True) as tf:
    for d in tf.app.designs():
        print(d.name, d.back_layer_count)
```

## 错误

在 JavaScript 中，拒绝会抛出一个 Error，其信息说明被拒绝的内容，并以方法名开头；用 try 和 catch 捕获它。Python 引发下面的错误之一。

```js
const design = tf.newDesign('Bare BK7');
try {
    design.layers.append('SiO2', -5);
} catch (err) {
    console.log(err.message);
}
```

### TFStudioError

被 TFStudio 拒绝的调用，附有用包中名称说明原因的信息：信息以所调用方法的名称开头，例如 "refine: "；对被设置的属性，则写出该属性的名称。不属于某个调用的拒绝（例如找不到对应材料的材料 id）只说明哪里出错。

```python
import tfstudio

design = tf.new_design("Bare BK7")
try:
    design.layers.append("SiO2", -5)
except tfstudio.TFStudioError as err:
    print(err)
```

### AppError

被拒绝的对应用（tf.app）的调用，`code` 说明原因：'off'、'timeout'、'protocol'、'denied'、'edited'、'switched'、'optimizing'、'noDesign'、'unknown' 或 'invalid'。

```python
import tfstudio

try:
    with tfstudio.TFStudio(live=True) as tf:
        print(tf.app.open_design().name)
except tfstudio.AppError as err:
    print(err.code, err)
```

### ServerError

找不到或无法启动 TFStudio，或为调用服务的 TFStudio 已结束或被关闭。它自行结束时，信息末尾附有它写入日志的最后几行。

```python
import tfstudio

try:
    tfstudio.TFStudio("no TFStudio here")
except tfstudio.ServerError as err:
    print(err)
```
