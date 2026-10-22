---
title: 脚本控制台
description: 用 TFStudio API 在打开的设计上运行 JavaScript 脚本，并把脚本留下的设计作为一个撤销步骤保留。
ribbonIcon: script-console
---

**脚本控制台**窗口在打开的设计上运行用 JavaScript 编写的脚本。脚本可以使用 TFStudio API 的全部调用：构建膜层堆栈、计算光谱和评价函数、运行精炼与合成、写入文件，并打印它得到的结果。该窗口从**优化**选项卡的**脚本**组打开。它的按钮排在编辑器上方的一行中，脚本打印的内容显示在编辑器下方；拖动两者之间的分隔条，可以按需分配窗口空间。

脚本以你运行的任何程序所具有的权限运行：它可以读取、写入和删除你的文件，也可以启动其他程序。只运行你信任的脚本。

## 运行脚本

在编辑器中编写脚本，然后按**运行**，或在编辑器中按 Ctrl+Enter。运行期间，该行显示已运行的时间；结束后，显示它如何结束以及用了多少秒。脚本本身不显示进度：想跟踪什么，就把它打印出来。**停止**会立即结束脚本，不做任何更改；脚本在停止前最后四分之一秒内打印的内容可能不会显示。隐藏或关闭窗口也会停止脚本，把窗口移到另一个组或将其拖出为独立窗口同样如此；此时输出会说明脚本已停止。

输出区保留脚本最新打印的行。打印的内容超过输出区能保留的量时，第一行会说明前面有多少行未显示；过长的一行会被截断，并注明有多少内容未显示。

脚本因错误而停止时，输出会显示错误信息以及出错的脚本行号。

编辑器获得焦点时，Ctrl+Z 和 Ctrl+Y 撤销和重做的是你的输入，而不是对设计的更改；Ctrl+S、Ctrl+O 和 Ctrl+N 不起作用。

## 打开和保存

**打开…**把一个 `.js` 文件读入编辑器。打开文件从不会运行它；只有按下**运行**时才会运行。编辑器中的脚本若未保存到文件，或保存后又有更改，**打开…**会先询问，再替换它。**保存…**把编辑器中的文本写入 `.js` 文件。

无论是否已保存，关闭窗口或退出 TFStudio 后编辑器都会保留你的脚本：窗口打开时编辑器若为空，会取回上一个脚本。取回的脚本不会运行。

## 脚本可以使用什么

脚本是一个 async 函数的函数体，因此可以在任何位置使用 `await`。它得到三个名称：

- `tf`：TFStudio API，其中 `tf.design` 是打开的设计，没有打开设计时为 `null`。
- `console`：`console.log`、`info`、`warn`、`error` 和 `debug` 打印到输出区。
- `require`：Node 的 `require`，用于 `fs`、`path` 等 Node 自带模块，以及已保存脚本旁边的文件。不能使用 `import()`。

用 `require` 加载的文件打印到应用日志，而不是输出区，除非脚本把自己的 `console` 交给它，例如作为参数传入。`fs` 调用、`tf.openDesign` 和 `tf.saveDesign` 中的相对路径以启动 TFStudio 时所在的文件夹为基准，而不是脚本所在的文件夹，因此请使用完整路径。

`tf` 上的调用：

| 类别 | 调用 |
| ---- | ---- |
| 设计 | `openDesign`、`saveDesign`、`newDesign`、`setDesignSetup` |
| 膜层堆栈 | `insertLayer`、`deleteLayer`、`setLayer`、`stackFromFormula` |
| 材料 | `findMaterials`、`materialNK` |
| 分析 | `spectrum`、`summarize`、`layerSensitivity`、`monteCarlo` |
| 评价函数 | `setMerit`、`merit` |
| 运行 | `refine`、`synthesize`、`runHooks` |

它们与各窗口使用同一套计算代码，因此给出的数值与应用显示的一致。可用的材料包括内置材料、数据文件夹中你的材料目录里的材料，以及设计自带的材料副本。

每个调用接受什么、返回什么、拒绝什么，见 [API 参考](/zh/automation/api-reference/)。

## 设计会怎样

脚本结束时，它留在 `tf.design` 中的设计（无论是被某个调用替换，还是被脚本直接修改）会作为一个步骤应用到打开的设计上：撤销 (Ctrl+Z) 会把设计恢复到运行之前的样子。设计保留它的名称。如果脚本没有改动 `tf.design`，就不会有任何更改。

设计只应用到脚本开始时的那个设计上，并且只在该设计仍保持开始时的样子时才应用。如果在脚本运行期间你编辑了它、撤销或重做了某一步、选择了另一个设计，或者在脚本结束时另一个窗口（例如精炼）中的运行仍在进行，输出会说明未应用及其原因。无论发生什么都想保留结果，请在脚本中用 `tf.saveDesign` 保存它。

## 示例

### 用公式构建膜层堆栈

在设计的参考波长处用 `(HL)^4 H` 构建四分之一波长反射镜，并计算它在 400 到 700 nm 之间的反射率：

```js
const design = tf.stackFromFormula(tf.design, { formula: '(HL)^4 H', symbols: { H: 'TiO2', L: 'SiO2' } });
const s = tf.spectrum(design, { from: 400, to: 700, step: 5 });
const [band] = tf.summarize(s)[0];
console.log(`R from ${band.R.min.toFixed(4)} to ${band.R.max.toFixed(4)}, highest at ${band.R.maxAt} nm`);
tf.design = design;
```

### 设置评价函数并精炼

在 450 到 650 nm 之间设置减反射目标，并要求每层不薄于 10 nm，然后用 SQP 精炼：

```js
const design = tf.setMerit(tf.design, [
    { type: 'RAV', lambdaStart: 450, lambdaEnd: 650, target: 0, weight: 1 },
    { type: 'MNT', target: 10, weight: 1 },
]);
console.log('Merit before:', tf.merit(design).total);
const { result, design: refined } = await tf.refine(design, { method: 'sqp' });
console.log('Merit after:', tf.merit(refined).total, `(${result.stopReason})`);
tf.design = refined;
```

### 用针法合成

针法用 TiO2 和 SiO2 按 420 到 680 nm 的减反射目标生长设计，最多 12 层：

```js
const design = tf.setMerit(tf.design, [{ type: 'RAV', lambdaStart: 420, lambdaEnd: 680, target: 0, weight: 1 }]);
const { result, design: grown } = await tf.synthesize(design, {
    method: 'needle', pool: ['TiO2', 'SiO2'], settings: { maxLayers: 12 },
});
console.log(result.stopReason, 'merit', result.mf, grown.frontLayers.length, 'layers');
tf.design = grown;
```

### 扫描入射角

在 550 nm 处从 0 到 80 度扫描 Rs 和 Rp。`spectrum` 接受一个波长范围，因此扫描取 550 到 551 nm，并读取第一个波长：

```js
const angles = [0, 10, 20, 30, 40, 50, 60, 70, 80];
const s = tf.spectrum(tf.design, { from: 550, to: 551, angles });
for (const a of angles) console.log(`${a}°: Rs ${s.angles[a].Rs[0].toFixed(4)}, Rp ${s.angles[a].Rp[0].toFixed(4)}`);
```

### 把 s 和 p 的 R、T、A 写入文件

在你的主文件夹中写入一个新的 CSV 文件，文件名带有时间，因此不会覆盖任何文件；入射角 45 度，每个波长一行：

```js
const s = tf.spectrum(tf.design, { from: 400, to: 800, step: 2, angles: [45] });
const q = s.angles[45];
const rows = s.lambda.map((nm, i) => [nm, q.Rs[i], q.Rp[i], q.Ts[i], q.Tp[i], q.As[i], q.Ap[i]].join(','));
const file = require('path').join(require('os').homedir(), `spectrum-45deg-${Date.now()}.csv`);
require('fs').writeFileSync(file, 'nm,Rs,Rp,Ts,Tp,As,Ap\n' + rows.join('\n'));
console.log('Wrote', file);
```

`refine` 和 `synthesize` 按设计的评价函数运行：在[评价函数编辑器](/zh/design/merit-function-editor/)中设置，或像上面那样在脚本中用 `tf.setMerit` 设置。
