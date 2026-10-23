---
title: 脚本控制台
description: 在打开的设计上运行 JavaScript 或 Python 脚本，并把脚本留下的设计作为一个撤销步骤保留。
ribbonIcon: script-console
---

**脚本控制台**窗口在打开的设计上运行用 JavaScript 或 Python 编写的脚本。脚本以对象的形式处理 TFStudio 的设计：它可以构建和清理膜层堆栈、读取其折射率分布、膜层厚度和总厚度、计算光谱和评价函数、判定设计是否满足其规格并统计其良率、运行精炼与合成、写入文件，并打印它得到的结果。该窗口从**优化**选项卡的**脚本**组打开。它的按钮排在编辑器上方的一行中，脚本打印的内容显示在编辑器下方；拖动两者之间的分隔条，可以按需分配窗口空间。

脚本以你运行的任何程序所具有的权限运行：它可以读取、写入和删除你的文件，也可以启动其他程序。只运行你信任的脚本。

## 编辑器

编辑器按脚本的语言为其着色，为各行编号，并标出与光标处括号配对的括号。Ctrl+F 打开搜索，Ctrl+G 跳到下一个匹配。Tab 缩进当前行；要改为移到下一个控件，先按 Escape，再按 Tab。脚本因错误而停止时，编辑器会标出出错的那一行并滚动到那里。

该行中的**语言**选择器设置脚本的语言，JavaScript 或 Python。**打开…**把一个 `.js` 或 `.py` 文件读入编辑器，并按扩展名设置语言。打开文件从不会运行它；只有按下**运行**时才会运行。编辑器中的脚本若未保存到文件，或保存后又有更改，**打开…**会先询问，再替换它。**保存…**按语言把编辑器中的文本写入 `.js` 或 `.py` 文件。

无论是否已保存，关闭窗口或退出 TFStudio 后编辑器都会保留你的脚本：窗口打开时编辑器若为空，会取回上一个脚本。取回的脚本不会运行。

## 运行脚本

按**运行**，或在编辑器中按 Ctrl+Enter。运行期间，该行显示已运行的时间；结束后，显示它如何结束以及用了多少秒。脚本本身不显示进度：想跟踪什么，就把它打印出来。**停止**会立即结束脚本，不做任何更改；脚本在停止前最后四分之一秒内打印的内容可能不会显示。隐藏或关闭窗口也会停止脚本，把窗口移到另一个组或将其拖出为独立窗口同样如此；此时输出会说明脚本已停止。

输出区保留脚本最新打印的行。打印的内容超过输出区能保留的量时，第一行会说明前面有多少行未显示；过长的一行会被截断，并注明有多少内容未显示。脚本因错误而停止时，输出会显示错误信息以及出错的脚本行号。

编辑器中的按键：

| 按键 | 作用 |
| ---- | ---- |
| Ctrl+Enter | 运行脚本。 |
| Ctrl+Z、Ctrl+Y 或 Ctrl+Shift+Z | 撤销和重做你的输入，而不是对设计的更改。 |
| Ctrl+F、Ctrl+G | 在脚本中搜索，并跳到下一个匹配。 |
| Tab | 缩进当前行；先按 Escape 再按 Tab 则离开编辑器。 |
| Ctrl+S、Ctrl+O、Ctrl+N | 编辑器获得焦点时不起作用。 |

## Python 脚本

Python 脚本在你自己的 Python（3.8 或更高版本）中运行；TFStudio 不附带 Python。它使用首选项“自动化”中**脚本使用的 Python** 所设置的 Python；未设置时，依次使用 Windows 上的 `py` 启动器、PATH 中的 `python3` 或 `python`。找不到时，选择 Python 会说明这一点，以及在哪里设置路径。TFStudio 会把自带的 `tfstudio` 包交给脚本，因此在控制台中无需安装任何东西；[Python](/zh/automation/python/) 页面说明如何在你自己的程序中使用同一个包。

Python 脚本在其文件所在的文件夹中运行，因此它的相对路径和导入能找到旁边的文件；未保存到文件的脚本在数据文件夹中运行。已保存的脚本所在的文件夹若已不存在，脚本不会运行。

## 脚本可以使用什么

两种语言都给脚本提供 `tf`，其中包含 TFStudio 的设计和材料，以及 `tf.design`，即打开的设计；没有打开设计时，在 JavaScript 中为 `null`，在 Python 中为 `None`。`tf` 和设计在两种语言中提供什么，见 [API 参考](/zh/automation/api-reference/)。设计与各窗口使用同一套计算代码，因此给出的数值与应用显示的一致。可用的材料包括内置材料、数据文件夹中你的材料目录里的材料，以及设计自带的材料副本。

在 JavaScript 中，脚本是一个 async 函数的函数体，因此可以在任何位置使用 `await`。除 `tf` 外，它还得到两个名称：

- `console`：`console.log`、`info`、`warn`、`error` 和 `debug` 打印到输出区。
- `require`：Node 的 `require`，用于 `fs`、`path` 等 Node 自带模块，以及已保存脚本旁边的文件。不能使用 `import()`。

用 `require` 加载的文件打印到应用日志，而不是输出区，除非脚本把自己的 `console` 交给它，例如作为参数传入。`fs` 调用、`tf.openDesign` 和 `save` 中的相对路径以启动 TFStudio 时所在的文件夹为基准，而不是脚本所在的文件夹，因此请使用完整路径。

在 Python 中，脚本打印的内容，以及它的错误和警告，都显示在输出区。它不从输入读取任何内容。`import tfstudio` 可以得到包中的其他名称，例如 `tfstudio.Stop` 和 `tfstudio.TFStudioError`。

## 设计会怎样

脚本结束时，它留在 `tf.design` 中的设计（无论是脚本直接修改了它，还是放入了另一个设计）会作为一个步骤应用到打开的设计上：撤销 (Ctrl+Z) 会把设计恢复到运行之前的样子。设计保留它的名称。如果脚本没有改动 `tf.design`，就不会有任何更改。

设计只应用到脚本开始时的那个设计上，并且只在该设计仍保持开始时的样子时才应用。如果在脚本运行期间你编辑了它、撤销或重做了某一步、选择了另一个设计，或者在脚本结束时另一个窗口（例如精炼）中的运行仍在进行，输出会说明未应用及其原因。无论发生什么都想保留结果，请在脚本中用 `save` 保存它。

## 示例

每个示例都自己构建要处理的设计，因此无论打开的是哪个设计都能运行。每个示例先给出 JavaScript 写法，再给出 Python 写法。

### 反射镜在其高反射带内的反射率

在 550 nm 处用 `(HL)^8 H` 构建四分之一波长反射镜，并找出其反射率不低于 99 % 的范围：

```js
const design = tf.newDesign('Mirror 550');
design.stack('(HL)^8 H');
const s = design.spectrum(400, 800, { step: 2 });
const high = s.wavelength.filter((nm, i) => s.R[i] >= 0.99);
console.log(`R is 99 % or more from ${high[0]} to ${high[high.length - 1]} nm`);
console.log('Lowest R from 500 to 600 nm:', s.R.min(500, 600).toFixed(4));
```

```python
design = tf.new_design("Mirror 550")
design.stack("(HL)^8 H")
s = design.spectrum(400, 800, step=2)
high = [nm for nm, r in zip(s.wavelength, s.R) if r >= 0.99]
print("R is 99 % or more from", high[0], "to", high[-1], "nm")
print("Lowest R from 500 to 600 nm:", round(s.R.min(500, 600), 4))
```

### 精炼减反射膜

四层交替膜层，在 450 到 650 nm 之间设置减反射目标，并要求每层不薄于 10 nm，然后用只调整厚度的 SQP 精炼。脚本把结果放入 `tf.design`，因此它会应用到打开的设计上：

```js
const design = tf.newDesign('AR 450-650');
design.stack('(HL)^2');
design.merit.add('RAV', 450, 650, { target: 0 });
design.merit.add('MNT', { target: 10 });
console.log('Merit before:', design.merit.value);
const run = await design.refine({ method: 'sqp' });
console.log('Merit after:', design.merit.value, `(${run.stopReason})`);
for (const layer of design.layers) console.log(layer.number, layer.material, layer.thickness.toFixed(1), 'nm');
tf.design = design;
```

```python
design = tf.new_design("AR 450-650")
design.stack("(HL)^2")
design.merit.add("RAV", 450, 650, target=0)
design.merit.add("MNT", target=10)
print("Merit before:", design.merit.value)
run = design.refine(method="sqp")
print("Merit after:", design.merit.value, "(" + run.stop_reason + ")")
for layer in design.layers:
    print(layer.number, layer.material, round(layer.thickness, 1), "nm")
tf.design = design
```

### 用针法生长设计

针法从一层 SiO2 开始，用 TiO2 和 SiO2 按 420 到 680 nm 的减反射目标生长设计，最多 12 层：

```js
const design = tf.newDesign('AR 420-680');
design.layers.append('SiO2', 100);
design.merit.add('RAV', 420, 680, { target: 0 });
const run = await design.synthesize('needle', ['TiO2', 'SiO2'], { maxLayers: 12 });
console.log(run.stopReason, design.layers.length, 'layers, merit', run.merit);
```

```python
design = tf.new_design("AR 420-680")
design.layers.append("SiO2", 100)
design.merit.add("RAV", 420, 680, target=0)
run = design.synthesize("needle", pool=["TiO2", "SiO2"], max_layers=12)
print(run.stop_reason, len(design.layers), "layers, merit", run.merit)
```

### 扫描入射角

在 550 nm 处从 0 到 80 度扫描该反射镜的 Rs 和 Rp。光谱接受一个波长范围，因此扫描取 550 到 551 nm，并读取第一个波长：

```js
const design = tf.newDesign('Mirror 550');
design.stack('(HL)^8 H');
const angles = [0, 10, 20, 30, 40, 50, 60, 70, 80];
const s = design.spectrum(550, 551, { angles });
for (const a of angles) console.log(`${a} deg: Rs ${s.angle(a).Rs[0].toFixed(4)}, Rp ${s.angle(a).Rp[0].toFixed(4)}`);
```

```python
design = tf.new_design("Mirror 550")
design.stack("(HL)^8 H")
angles = [0, 10, 20, 30, 40, 50, 60, 70, 80]
s = design.spectrum(550, 551, angles=angles)
for a in angles:
    at = s.angle(a)
    print(a, "deg: Rs", round(at.Rs[0], 4), "Rp", round(at.Rp[0], 4))
```

### 把 s 和 p 的 R、T、A 写入文件

把该反射镜在 45 度时的光谱写入你主文件夹中的 CSV 文件，每个波长一行，文件名带有时间，因此不会覆盖任何文件：

```js
const design = tf.newDesign('Mirror 550');
design.stack('(HL)^8 H');
const file = require('path').join(require('os').homedir(), `mirror-45deg-${Date.now()}.csv`);
design.spectrum(400, 800, { step: 2, angles: [45] }).saveCsv(file);
console.log('Wrote', file);
```

```python
import os
import time

design = tf.new_design("Mirror 550")
design.stack("(HL)^8 H")
name = os.path.join(os.path.expanduser("~"), "mirror-45deg-{}.csv".format(time.time_ns()))
design.spectrum(400, 800, step=2, angles=[45]).save_csv(name)
print("Wrote", name)
```

`refine` 和 `synthesize` 按设计的评价函数运行：在[评价函数编辑器](/zh/design/merit-function-editor/)中设置，或像上面那样在脚本中用 `merit.add` 设置。
