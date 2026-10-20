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

它们与各窗口使用同一套计算代码，因此给出的数值与应用显示的一致。波长和膜层厚度单位为 nm，角度为入射介质中的度数，基底厚度单位为 mm，R、T 和 A 为 1 的分数。改变设计的调用会返回一个新设计，传入的设计保持不变。可用的材料包括内置材料、数据文件夹中你的材料目录里的材料，以及设计自带的材料副本。

## 设计会怎样

脚本结束时，它留在 `tf.design` 中的设计（无论是被某个调用替换，还是被脚本直接修改）会作为一个步骤应用到打开的设计上：撤销 (Ctrl+Z) 会把设计恢复到运行之前的样子。设计保留它的名称。如果脚本没有改动 `tf.design`，就不会有任何更改。

设计只应用到脚本开始时的那个设计上，并且只在该设计仍保持开始时的样子时才应用。如果在脚本运行期间你编辑了它、撤销或重做了某一步、选择了另一个设计，或者在脚本结束时另一个窗口（例如精炼）中的运行仍在进行，输出会说明未应用及其原因。无论发生什么都想保留结果，请在脚本中用 `tf.saveDesign` 保存它。

## 示例

打开的设计在 450 到 650 nm 之间的反射率：

```js
const s = tf.spectrum(tf.design, { from: 450, to: 650, step: 5 });
const [band] = tf.summarize(s)[0];
console.log(`R from ${band.R.min} to ${band.R.max}, mean ${band.R.mean}`);
```

按评价函数精炼打开的设计，保留结果，并把它的透射率写入你主文件夹中的 CSV 文件：

```js
const { result, design } = await tf.refine(tf.design, { method: 'dls', maxIter: 200 });
console.log('Merit function after refinement:', result.mf);
tf.design = design;

const s = tf.spectrum(design, { from: 400, to: 800, step: 2 });
const rows = s.lambda.map((nm, i) => `${nm},${s.angles[0].T[i]}`);
const file = require('path').join(require('os').homedir(), 'refined-T.csv');
require('fs').writeFileSync(file, 'nm,T\n' + rows.join('\n'));
console.log('Wrote', file);
```

`refine` 需要设计有评价函数：在[评价函数编辑器](/zh/design/merit-function-editor/)中设置，或在脚本中用 `tf.setMerit` 设置。
