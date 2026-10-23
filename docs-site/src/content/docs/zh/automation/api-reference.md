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

每个结果都在其 `mode` 中说明它的计算对象：[Spectrum](#spectrum-1)、[RunResult](#runresult)、[MonteCarlo](#montecarlo)和[LayerSensitivity](#layersensitivity)。

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

改变设计的方法会直接修改该设计：stack()、各项膜层编辑、refine() 和 synthesize()。copy() 可以先保留一份副本。

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
| `innerEngine` | `inner_engine` | `'cg'` | 每次插入后精炼堆栈所用的方法。cg、dls、newton、newton-cg、sqp、trust-region 之一。 |
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
- **JavaScript**：选项对象之前除 `start` 和 `end` 外还有其他值

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

把光谱写入 CSV 文件：一列波长，然后是每个角度下的 R、T、A、Rs、Rp、Ts、Tp、As 和 Ap，用 0 到 1 之间的小数表示，每列的标题注明其物理量和角度。已存在的文件会被覆盖。

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

**JavaScript**：设计有规格时，满足规格的试验所占的比例：一个对象 `{ yield, passCount, evaluated, yieldInterval }`，其中 `yieldInterval` 是该比例的 95 % 区间；没有规格的设计为 null。

**Python**：设计有规格时，满足规格的试验所占的比例：一个 dict { yield, passCount, evaluated, yieldInterval }，其中 yieldInterval 是该比例的 95 % 区间；没有规格的设计为 None。

```js
const design = tf.newDesign('AR');
design.stack('(HL)^2');
const mc = await design.monteCarlo(400, 700, { step: 10, runs: 5 });
console.log(mc.spec ? `yield ${mc.spec.yield}` : 'no specification');
```

```python
design = tf.new_design("AR")
design.stack("(HL)^2")
mc = design.monte_carlo(400, 700, step=10, runs=5)
print("yield {}".format(mc.spec["yield"]) if mc.spec else "no specification")
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
