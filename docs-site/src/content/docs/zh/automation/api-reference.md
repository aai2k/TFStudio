---
title: API 参考
description: "脚本控制台中 TFStudio API 的每一个调用：接受什么、返回什么、拒绝什么。"
---

[脚本控制台](/zh/automation/script-console/)中 `tf` 上的每一个调用：它接受什么、返回什么、拒绝什么。改变设计的调用返回一个新设计，传入的设计保持不变；把 `tf.design` 设为新设计即可保留它。波长和膜层厚度单位为 nm，角度为入射介质中的度数，基底厚度单位为 mm，R、T 和 A 用 0 到 1 之间的小数表示，评价函数目标值也是如此。

调用会拒绝它不认识的选项和无法使用的值，并给出说明它接受什么的错误信息，因此不会用你无意给出的值运行。每个示例都在打开的设计上运行；以设置 `tf.design` 结尾的示例会改变它，作为一个撤销步骤。

## 设计

### openDesign

`tf.openDesign(filePath)`

从 .tfs 文件读取设计，读取方式与应用中的“打开”相同，带有同样的检查和修复。没有自己名称的设计以文件名为名称。

| 参数 | 默认值 | 含义 |
| --- | --- | --- |
| `filePath` | 必填 | .tfs 文件，用完整路径给出。 |

**返回**：设计：`newDesign` 返回的字段，以及文件中另外保存的内容，例如 `meritOperands` 中的评价函数。

**拒绝**：

- 无法读取或不含可用设计的文件

```js
const file = require('path').join(require('os').homedir(), `example-${Date.now()}.tfs`);
tf.saveDesign(tf.design, file);
const design = tf.openDesign(file);
console.log(design.name, design.frontLayers.length, 'layers, from', file);
```

### saveDesign

`tf.saveDesign(design, filePath, options)`

按应用保存的方式把设计写入 .tfs 文件，设计所用的非内置材料一并写入文件。

| 参数 | 默认值 | 含义 |
| --- | --- | --- |
| `design` | 必填 | 设计。 |
| `filePath` | 必填 | 要写入的文件，用完整路径给出。 |
| `options.overwrite` | `false` | 覆盖已存在的文件。 |

**拒绝**：

- 已存在的文件，未给出 `overwrite` 时

```js
const file = require('path').join(require('os').homedir(), 'saved.tfs');
try {
    tf.saveDesign(tf.design, file);
    console.log('Saved', file);
} catch (err) {
    console.log(err.message);
}
```

### newDesign

`tf.newDesign(options)`

按应用新建设计的方式创建一个新设计：没有膜层的裸基底，并可修改下列任意设置。

| 参数 | 默认值 | 含义 |
| --- | --- | --- |
| `options.name` | `'New Design'` | 设计的名称。 |
| `options.incidentMedium` | `'Air'` | 光入射一侧的介质，用材料 id 给出。 |
| `options.exitMedium` | `'Air'` | 基底后面的介质，用材料 id 给出。 |
| `options.substrate` | `'BK7'` | 基底材料，用 id 给出。 |
| `options.substrateThicknessMm` | `1` | 基底厚度，单位 mm。 |
| `options.surfaceMode` | `'front_only'` | 哪些面带有膜层：`'front_only'`、`'back_only'`、`'both_independent'`，或 `'symmetric'`（背面是正面的镜像）。[表面与评估模式](/zh/design/evaluation-modes/)页面对它们有说明。 |
| `options.mfEvalMode` | `'side'` | 单面设计如何评估：`'side'` 只评估镀膜的一面，`'total'` 评估整个元件。 |
| `options.referenceWavelength` | `550` | 参考波长，单位 nm，堆栈公式在此波长计算四分之一波。 |

**返回**：设计。

| 字段 | 含义 |
| --- | --- |
| `id` | 设计自己的 id。 |
| `name` | 设计的名称。 |
| `incidentMedium` | 光入射一侧的介质，用材料 id 表示。 |
| `exitMedium` | 基底后面的介质，用材料 id 表示。 |
| `substrate` | `{ material, thickness }`，厚度单位为 mm。 |
| `surfaceMode` | 哪些面带有膜层。 |
| `mfEvalMode` | 单面设计如何评估。 |
| `referenceWavelength` | 参考波长，单位 nm。 |
| `frontLayers` | 正面的膜层，最外层在前，每层为 `{ id, material, thickness, locked }`，厚度单位为 nm。 |
| `backLayers` | 背面的膜层，紧贴基底的一层在前。 |
| `notes` | 设计的备注，文本。 |

**拒绝**：

- 找不到对应材料的材料 id，并给出最接近的几个 id

```js
const design = tf.newDesign({ name: 'AR', substrate: 'SiO2', referenceWavelength: 600 });
console.log(design.name, 'on', design.substrate.material, design.substrate.thickness, 'mm');
```

### setDesignSetup

`tf.setDesignSetup(design, options)`

修改了 `newDesign` 所接受的任意设置的设计。新的参考波长会重新缩放每一层，保持其四分之一波数不变，与在设计编辑器中修改 λ₀ 时一样；改为对称的设计以正面的镜像作为背面。

| 参数 | 默认值 | 含义 |
| --- | --- | --- |
| `design` | 必填 | 设计。 |
| `options` | 必填 | `newDesign` 的任意选项。 |

**返回**：修改后的设计。

**拒绝**：

- 找不到对应材料的材料 id，并给出最接近的几个 id

```js
tf.design = tf.setDesignSetup(tf.design, { substrateThicknessMm: 3, mfEvalMode: 'total' });
console.log(tf.design.substrate.thickness, 'mm,', tf.design.mfEvalMode);
```

## 膜层堆栈

### insertLayer

`tf.insertLayer(design, options)`

在一面上新增一层后的设计。

| 参数 | 默认值 | 含义 |
| --- | --- | --- |
| `design` | 必填 | 设计。 |
| `options.side` | `'front'` | `'front'` 或 `'back'`。 |
| `options.index` |  | 新层的位置，从 0 计数：在正面，0 是最外层，紧邻入射介质；在背面，0 是紧贴基底的一层。不给出时放在最后一层之后：在正面紧邻基底，在背面为最外层。 |
| `options.material` | 必填 | 该层的材料，用 id 给出。 |
| `options.thickness` | 必填 | 该层的物理厚度，单位 nm。 |
| `options.locked` | `false` | 锁定该层，使精炼和合成不改变它。 |

**返回**：加入该层后的设计。

**拒绝**：

- 设计编辑器不允许编辑的一面：对称设计的背面（它是正面的镜像），或只评估镀膜一面的单面设计所不评估的那一面
- 超出该面膜层范围的序号
- 找不到对应材料的材料 id，并给出最接近的几个 id

```js
tf.design = tf.insertLayer(tf.design, { material: 'SiO2', thickness: 95, index: 0 });
console.log(tf.design.frontLayers.map(l => `${l.material} ${l.thickness}`).join(', '));
```

### deleteLayer

`tf.deleteLayer(design, options)`

删除其中一层后的设计。

| 参数 | 默认值 | 含义 |
| --- | --- | --- |
| `design` | 必填 | 设计。 |
| `options.side` | `'front'` | `'front'` 或 `'back'`。 |
| `options.index` | 必填 | 该层在其所在面上的序号，计数方式与 `insertLayer` 相同。 |

**返回**：删除该层后的设计。

**拒绝**：

- 设计编辑器不允许编辑的一面，与 `insertLayer` 相同
- 超出该面膜层范围的序号

```js
tf.design = tf.deleteLayer(tf.design, { index: 0 });
console.log(tf.design.frontLayers.length, 'layers on the front');
```

### setLayer

`tf.setLayer(design, options)`

修改了某一层的材料、厚度或锁定状态的设计。

| 参数 | 默认值 | 含义 |
| --- | --- | --- |
| `design` | 必填 | 设计。 |
| `options.side` | `'front'` | `'front'` 或 `'back'`。 |
| `options.index` | 必填 | 该层在其所在面上的序号，计数方式与 `insertLayer` 相同。 |
| `options.material` |  | 新的材料，用 id 给出。 |
| `options.thickness` |  | 新的物理厚度，单位 nm。 |
| `options.locked` |  | `true` 锁定该层，`false` 解锁。 |

**返回**：修改该层后的设计。

**拒绝**：

- 设计编辑器不允许编辑的一面，与 `insertLayer` 相同
- 超出该面膜层范围的序号
- 找不到对应材料的材料 id，并给出最接近的几个 id

```js
tf.design = tf.setLayer(tf.design, { index: 0, thickness: 100, locked: true });
console.log(tf.design.frontLayers[0]);
```

### stackFromFormula

`tf.stackFromFormula(design, options)`

把一面的膜层替换为[堆栈公式](/zh/design/stack-formula/)所生成膜层的设计，生成方式与堆栈公式对话框中的“替换”相同。每个字母是参考波长处的一个四分之一波，因此 `'(HL)^5 H'` 是 11 个四分之一波层。填充单面设计不评估的那一面会使设计变为双面，与该对话框的做法相同。

| 参数 | 默认值 | 含义 |
| --- | --- | --- |
| `design` | 必填 | 设计。 |
| `options.formula` | 必填 | 只写膜层，例如 `'(HL)^5 H'`；介质保持设计原有的。 |
| `options.side` | `'front'` | `'front'` 或 `'back'`；对称设计取正面。 |
| `options.symbols` |  | 每个字母对应的材料，用 id 给出，例如 `{ H: 'Ta2O5', L: 'SiO2' }`。未给出的字母为：H 是 TiO2，L 是 SiO2，M 是 Al2O3。 |
| `options.referenceWavelength` |  | 计算四分之一波所用的波长，单位 nm，设计随后保留这一波长。不给出时用设计自己的参考波长。 |
| `options.startFromSubstrate` | `true` | 公式的第一个字母是紧贴基底的一层；为 false 时它是紧邻入射介质的一层。 |

**返回**：带有新膜层的设计。

**拒绝**：

- 无法解析的公式，并指出解析停止的位置
- 写出了介质的公式，例如 `'Air | H L | BK7'`；介质由 `setDesignSetup` 设置
- `symbols` 中公式未用到的字母
- 对称设计的背面
- 找不到对应材料的材料 id，并给出最接近的几个 id

```js
tf.design = tf.stackFromFormula(tf.design, { formula: '(HL)^3 H', symbols: { H: 'Ta2O5', L: 'SiO2' } });
console.log(tf.design.frontLayers.length, 'layers');
```

## 材料

### findMaterials

`tf.findMaterials(query)`

id 或名称中包含所给文本（不区分大小写）的材料：内置材料，以及数据文件夹中各材料目录里的材料。

| 参数 | 默认值 | 含义 |
| --- | --- | --- |
| `query` | `''` | 要查找的文本；为空时找出所有材料。 |

**返回**：找到的材料，一个列表，每项包含下列字段。

| 字段 | 含义 |
| --- | --- |
| `id` | 设计和调用用来指代该材料的 id：内置材料为其自身名称，其他目录的材料为 `catalog:key`，其中 `key` 是目录存放该材料所用的键，不一定是它的名称；请使用本调用返回的 id。 |
| `name` | 应用中显示的名称。 |
| `catalog` | 材料所在的目录，内置材料为 `'builtin'`。 |

```js
for (const m of tf.findMaterials('TiO2')) console.log(m.id, m.name, m.catalog);
```

### materialNK

`tf.materialNK(id, wavelengths, design)`

材料在所给波长处的 n 和 k，与[材料色散](/zh/analysis/material-dispersion/)窗口显示的相同。

| 参数 | 默认值 | 含义 |
| --- | --- | --- |
| `id` | 必填 | 材料，用 id 给出。 |
| `wavelengths` | 必填 | 波长列表，单位 nm。 |
| `design` | `null` | 一个设计，使它自带的材料副本像该设计计算时一样起作用：先用材料目录；只有没有目录包含该材料，或副本来自另一个目录且 n、k 不同时，才用设计中的副本。 |

**返回**：该材料的 n 和 k。

| 字段 | 含义 |
| --- | --- |
| `id` | 材料的 id。 |
| `rangeNm` | 其数据覆盖的范围，`[first, last]`，单位 nm；材料未给出范围时为 null。 |
| `nk` | 每个波长一项，`{ wavelength, n, k }`；波长在 `rangeNm` 之外时带有 `outside: true`，此时 n 和 k 保持边界值或由外推得到。 |

**拒绝**：

- 找不到对应材料的材料 id，并给出最接近的几个 id

```js
const { rangeNm, nk } = tf.materialNK('TiO2', [400, 550, 700]);
console.log('Data from', rangeNm);
for (const p of nk) console.log(p.wavelength, 'nm: n', p.n.toFixed(4), 'k', p.k);
```

## 分析

### spectrum

`tf.spectrum(design, options)`

设计在一段波长范围内的 R、T 和 A，包括非偏振光以及 s 和 p 偏振，计算方式与[光学评估](/zh/analysis/optical-evaluation/)窗口相同。评估哪些面遵循设计的[表面与评估模式](/zh/design/evaluation-modes/)，处于入射角锥中的设计在其角锥上取平均。

| 参数 | 默认值 | 含义 |
| --- | --- | --- |
| `design` | 必填 | 设计。 |
| `options.from` | 必填 | 第一个波长，单位 nm。 |
| `options.to` | 必填 | 最后一个波长，单位 nm，大于 `from`。 |
| `options.step` | `1` | 波长步长，单位 nm。 |
| `options.angles` | `[0]` | 入射角列表，单位为入射介质中的度数，每个都从 0 起、小于 90。 |

**返回**：光谱。

| 字段 | 含义 |
| --- | --- |
| `evalMode` | 设计的评估方式：`'front'`、`'back'` 或 `'total'`。 |
| `lambda` | 波长，单位 nm。 |
| `angles` | 按所要求的每个角度的值给出：非偏振光的列表 `R`、`T` 和 `A`，以及 s 和 p 的 `Rs`、`Rp`、`Ts`、`Tp`、`As` 和 `Ap`，每个波长一个值，用 0 到 1 之间的小数表示。 |
| `outOfRange` | 数据在该范围内就结束的材料，每项为 `{ id, name, rangeNm, heldFlat }`：在 `rangeNm` 之外，它们的 n 和 k 保持最后一个值（`heldFlat` 为 `true`）或由外推得到。 |

**拒绝**：

- 设计中含有找不到对应材料的材料
- 点数（波长数乘以角度数）超过一次调用能计算的数量；拒绝信息会给出上限

```js
const s = tf.spectrum(tf.design, { from: 400, to: 700, step: 10, angles: [0, 45] });
console.log(s.lambda.length, 'wavelengths');
console.log('At 400 nm, 45 degrees: Rs', s.angles[45].Rs[0], 'Rp', s.angles[45].Rp[0]);
```

### summarize

`tf.summarize(result, options)`

光谱中每个量的均值、最低值和最高值，以及每个极值所在的波长，在整个范围上和所给的每个波段上分别计算。

| 参数 | 默认值 | 含义 |
| --- | --- | --- |
| `result` | 必填 | 光谱，即 `spectrum` 的返回值。 |
| `options.bands` | `[]` | 波段列表，每个为 `{ from, to }`，单位 nm。 |

**返回**：按光谱的每个角度的值给出一个列表：先是整个范围，然后按所给顺序是每个波段，每项包含下列字段。

| 字段 | 含义 |
| --- | --- |
| `from` | 波段的第一个波长，单位 nm。 |
| `to` | 波段的最后一个波长，单位 nm。 |
| `R` | 对于 `R`，以及同样对于 `T`、`A`、`Rs`、`Rp`、`Ts`、`Tp`、`As` 和 `Ap`：`{ mean, min, minAt, max, maxAt }`，其中 `minAt` 和 `maxAt` 单位为 nm；光谱中没有波长落在该波段内时为 null。 |

```js
const s = tf.spectrum(tf.design, { from: 400, to: 700, step: 5 });
const [whole, band] = tf.summarize(s, { bands: [{ from: 450, to: 650 }] })[0];
console.log('Mean R from 400 to 700 nm:', whole.R.mean);
console.log('Highest R from 450 to 650 nm:', band.R.max, 'at', band.R.maxAt, 'nm');
```

### monteCarlo

`await tf.monteCarlo(design, options, hooks)`

对设计做带随机膜层误差的蒙特卡洛试验，方式与[蒙特卡洛](/zh/analysis/error-analysis/)窗口相同：得到一个量在一段波长范围内的分散程度。设计带有[规格说明](/zh/design/specification/)时，还会统计满足规格的试验所占的比例。

| 参数 | 默认值 | 含义 |
| --- | --- | --- |
| `design` | 必填 | 设计。 |
| `options.from` | 必填 | 第一个波长，单位 nm。 |
| `options.to` | 必填 | 最后一个波长，单位 nm，大于 `from`。 |
| `options.step` | `1` | 波长步长，单位 nm。 |
| `options.quantity` | `'R'` | `'R'`、`'T'` 或 `'A'`。 |
| `options.angle` | `0` | 入射角，单位为入射介质中的度数，从 0 起、小于 90。 |
| `options.polarization` | `'avg'` | `'avg'`、`'s'` 或 `'p'`。 |
| `options.runs` | `100` | 试验次数，不小于 1 的整数。 |
| `options.thicknessRelPct` | `1` | 厚度误差，以每层厚度的 % 计。 |
| `options.thicknessAbsNm` | `0` | 以 nm 计的厚度误差，加到每一层的厚度误差上。 |
| `options.indexRe` | `0` | n 的误差，一个绝对量：每层的 n 在所有波长上都移动同一个抽样值。用 `'gaussian'` 时它是一个标准差，用 `'uniform'` 和 `'truncated'` 时它是边界。 |
| `options.indexIm` | `0` | k 的误差，含义与 `indexRe` 对 n 的相同；k 不会小于 0，因此在 k = 0 的层上，该误差只会增加吸收。 |
| `options.distribution` | `'gaussian'` | 误差的抽样方式：`'gaussian'`，每个误差值是一个标准差；`'uniform'`，硬性边界，边界内每个值的可能性相同；`'truncated'`，在三个标准差处的硬性边界。 |
| `options.seed` |  | 抽样开始所用的数值，从 1 到 2^32 - 1 的整数；相同的种子和选项会重复同一次运行。不给出或为 null 时取一个新种子，结果中会给出它。 |
| `hooks.signal` |  | 一个 AbortSignal，在两次试验之间检查；停止的运行返回已完成的试验。 |
| `hooks.onProgress` |  | 每次试验后调用，参数为 `{ trial, total }`。 |

**返回**：结果的 Promise。

| 字段 | 含义 |
| --- | --- |
| `lambda` | 波长，单位 nm。 |
| `theory` | 设计无误差时的该量。 |
| `mean` | 所有试验的均值。 |
| `stdev` | 所有试验的标准差。 |
| `lower` | 均值减一个标准差，最小为 0。 |
| `upper` | 均值加一个标准差，最大为 1。 |
| `envLower` | 所有试验中的最低值。 |
| `envUpper` | 所有试验中的最高值。 |
| `nTrials` | 已运行的试验次数。 |
| `char` | 所研究的量，`'R'`、`'T'` 或 `'A'`。 |
| `seed` | 抽样开始所用的种子。 |
| `settings` | 运行所用的误差值、分布、角度和偏振。 |
| `spec` | 带有规格说明时为 `{ yield, passCount, evaluated, yieldInterval }`：满足规格的试验比例、满足的次数、检查的次数，以及该比例的 95% 区间；没有规格说明时为 null。 |
| `trials` | `null`：不保留各次试验本身。 |

**拒绝**：

- 在其评估的一面上没有可供试验改变的膜层的设计
- 设计中含有找不到对应材料的材料

```js
const mc = await tf.monteCarlo(tf.design, { from: 400, to: 700, step: 5, runs: 50, seed: 1 });
console.log(mc.nTrials, 'trials, largest spread of R:', Math.max(...mc.stdev));
```

### layerSensitivity

`tf.layerSensitivity(design, options)`

每层厚度出现偏差时评价函数变化多少，排序方式与[层灵敏度](/zh/analysis/layer-sensitivity/)窗口相同：每层分别加厚和减薄一个步长，评价函数变化的平均值就是它的得分。这里的评价函数不计入 MNT 和 MXT 行。

| 参数 | 默认值 | 含义 |
| --- | --- | --- |
| `design` | 必填 | 设计；它需要有评价函数。 |
| `options.mode` | `'absolute'` | `'absolute'`，步长为 `deltaNm`；或 `'relative'`，步长为每层厚度的 `relPct` %。 |
| `options.deltaNm` | `1` | 步长，单位 nm，用于 `'absolute'` 模式。 |
| `options.relPct` | `1` | 步长，以每层厚度的 % 计，用于 `'relative'` 模式。 |
| `options.includeLocked` | `false` | 也为锁定的层评分。 |

**返回**：排序结果。

| 字段 | 含义 |
| --- | --- |
| `rows` | 每个被评分的层一项，正面在前。 |
| `rows[].index` | 该层在评分的层中的位置，从 0 计数。 |
| `rows[].side` | `'front'` 或 `'back'`。 |
| `rows[].layerIndex` | 该层在其所在面上的序号。 |
| `rows[].materialId` | 该层的材料。 |
| `rows[].thickness` | 该层的厚度，单位 nm。 |
| `rows[].deltaNm` | 所用的步长，单位 nm。 |
| `rows[].deltaMFAbs` | 两个步长下评价函数变化的平均值。 |
| `rows[].deltaMF` | 同一个值，加厚的代价更大时为正，减薄的代价更大时为负。 |
| `rows[].sensitivity` | 得分占最高得分的比例，0 到 100。 |
| `rows[].locked` | 锁定的层为 `true`。 |
| `mf0` | 设计当前的评价函数。 |
| `surfaceMode` | 设计的表面模式。 |

**拒绝**：

- 没有评价函数的设计，或含有找不到对应材料的材料的设计

```js
const { rows } = tf.layerSensitivity(tf.design, { deltaNm: 1 });
for (const row of rows) console.log(row.side, row.layerIndex, row.materialId, row.sensitivity.toFixed(1));
```

## 评价函数

### setMerit

`tf.setMerit(design, rows)`

评价函数被替换为所给各行的设计，各行的保存方式与[评价函数编辑器](/zh/design/merit-function-editor/)中相同。每一行是[操作数参考](/zh/design/operands/)中的一个操作数，该页面说明每个操作数计算什么、读取哪些字段。一行未给出的字段取在编辑器中新加一行时的初始值；MNT 或 MXT 行覆盖第 1 到 1000 层，从基底起计数。

| 参数 | 默认值 | 含义 |
| --- | --- | --- |
| `design` | 必填 | 设计。 |
| `rows` | 必填 | 按顺序排列的各行，每行是至少带有 `type` 的对象。 |
| `rows[].type` | 必填 | 操作数，例如 `'RAV'` 或 `'MNT'`。 |
| `rows[].lambdaStart` |  | 波长，或波段的第一个波长，单位 nm；MNT 和 MXT 为第一层。 |
| `rows[].lambdaEnd` |  | 波段的最后一个波长，单位 nm；MNT 和 MXT 为最后一层。 |
| `rows[].aoi` |  | 入射角，单位为入射介质中的度数。 |
| `rows[].pol` |  | `'avg'`、`'s'` 或 `'p'`。 |
| `rows[].target` |  | 该行趋近的值或其边界，用该行的单位：R、T 和 A 用 0 到 1 之间的小数表示（编辑器中显示为百分比）；MNT 和 MXT 为以 nm 计的厚度。 |
| `rows[].targetEnd` |  | 倾斜的光谱目标在 `lambdaEnd` 处的目标值；平坦目标为 null。 |
| `rows[].weight` |  | 该行的权重，0 或更大。 |
| `rows[].cmp` |  | 用于 TT 和 STR 的比较：`'eq'`、`'le'` 或 `'ge'`。 |
| `rows[].flag` |  | 编辑器的标志列，一个整数；操作数参考说明它在每种行上的作用。 |
| `rows[].enabled` | `true` | 为 `false` 时该行不计入评价函数。 |
| `rows[].id` |  | 该行的名称，数学行在 `refId`、`refId1` 或 `refId2` 中给出它来读取该行。 |
| `rows[].refId` |  | 读取一行的数学行中，所读行的 `id`；读取两行的数学行用 `refId1` 和 `refId2`。 |
| `rows[].comment` |  | BLNK 行的文本。 |

**返回**：带有该评价函数的设计，评价函数保存在 `meritOperands` 中。

**拒绝**：

- 此版本不能评估的类型
- 任何行都没有的字段（例如拼写错误），或字段不能取的值
- 读取波段或层范围的行中 `lambdaStart` 大于 `lambdaEnd`

```js
tf.design = tf.setMerit(tf.design, [
    { type: 'RAV', lambdaStart: 450, lambdaEnd: 650, target: 0, weight: 1 },
    { type: 'MNT', target: 10, weight: 1 },
]);
console.log('Merit:', tf.merit(tf.design).total);
```

### merit

`tf.merit(design)`

设计按其评价函数计算的值：总值和每一行，与评价函数编辑器中显示的相同。

| 参数 | 默认值 | 含义 |
| --- | --- | --- |
| `design` | 必填 | 设计。 |

**返回**：评价函数。

| 字段 | 含义 |
| --- | --- |
| `total` | 评价函数；有行无法评估时为 null。 |
| `optical` | 不含 MNT、MXT、TT 和 STR 约束行的评价函数（OMF）；与 `total` 一样可能为 null。 |
| `rows` | 评价函数的每一行一项，按顺序排列。 |
| `rows[].type` | 操作数。 |
| `rows[].lambdaStart` | 该行的波长，或其波段的第一个波长，单位 nm；MNT 和 MXT 为第一层。不读取波长的行没有此字段。 |
| `rows[].lambdaEnd` | 读取波段的行中波段的最后一个波长，单位 nm；MNT 和 MXT 为最后一层。 |
| `rows[].aoi` | 入射角，用于读取入射角的行。 |
| `rows[].pol` | 该行评估所用的偏振；同时在两种偏振上评估的行（例如 PSI 或 DPR）没有此字段。 |
| `rows[].cmp` | 用于 TT 和 STR 的比较。 |
| `rows[].value` | 设计当前状态下该行的值。 |
| `rows[].target` | 该行的目标值。 |
| `rows[].weight` | 该行的权重。 |
| `rows[].enabled` | 不计入评价函数的行为 `false`。 |
| `rows[].error` | 该行无法评估的原因，或 null。 |

**拒绝**：

- 设计中含有找不到对应材料的材料

```js
const m = tf.merit(tf.design);
console.log('Merit:', m.total);
for (const row of m.rows) console.log(row.type, row.value, row.target);
```

## 运行

### refine

`await tf.refine(design, settings, hooks)`

按设计的评价函数精炼其膜层厚度，方式与[精炼](/zh/synthesis/refinement/)窗口相同；不增加也不删除任何层。运行在脚本自己的线程上计算，因此脚本会等待它完成。

| 参数 | 默认值 | 含义 |
| --- | --- | --- |
| `design` | 必填 | 设计；它需要有评价函数。 |
| `settings.method` | 必填 | 方法：下面方法表中的一个 id，`'all'` 表示依次运行每个方法，或一个 id 列表，从同一起点逐个尝试，保留最好的结果。 |
| `settings.seed` |  | 会抽取随机数的方法从这个数值开始抽取，从 1 到 2^32 - 1 的整数；相同的种子、设计和设置会重复同一次运行。不给出时取一个新种子，结果中会给出它。 |
| `settings.maxIter` |  | 单方法运行的最大迭代次数；评价函数不再下降时运行仍会提前停止。不给出时用该方法自己的预算；方法列表不接受此设置，每个方法按自己的预算运行。不小于 1 的整数。 |
| `settings.nRestarts` | `20` | DLS 多起点运行的扰动起点数。不小于 1 的整数。 |
| `settings.perturbPct` | `30` | 多起点每次重启时，每个未锁定层厚度的扰动幅度，以 ± % 计。0 或更大的数。 |
| `hooks.signal` |  | 一个 AbortSignal；中止它会停止运行，运行随即以 `'stopped'` 结束，设计保持原样。运行在各项任务之间检查它。 |
| `hooks.onStart` |  | 运行开始后调用，参数为 `{ seed }`；不抽取随机数的运行中 seed 为 null。 |
| `hooks.onMethodStart` |  | 运行中每个方法开始时调用，参数为 `(method, index)`。 |
| `hooks.onProgress` |  | 运行过程中调用，参数为发生变化的读数：`iter`、`mf`、`mfBest`、`omf`、`omfBest`、`mfInitial`、`omfInitial`、`mfHistory` 和 `restartIdx`，以及 `design`（当前的膜层）和 `best`（迄今最佳的设计）。 |
| `hooks.onRecord` |  | 某个方法运行到自然结束时调用，参数为 `{ method, iter, mf, omf, frontLayers, backLayers, layerSide, mfHistory }`；有 `restarts` 和 `seed` 的方法还会给出它们。 |

**返回**：`{ result, design }` 的 Promise。

| 字段 | 含义 |
| --- | --- |
| `result.completed` | 运行自然结束时为 `true`。 |
| `result.stopReason` | 结束的原因：`'target'`（评价函数低于 10^-6）、`'maxiter'`、`'stalled'`（评价函数不再下降）、`'best:<method>'`（方法列表，指出保留的那个方法）、`'restartsDone'`（DLS 多起点）、`'stopped'`、`'workerFailed'`、`'workerError'`、`'presampleFailed'`（无法对材料采样），或 `'invalidOperand'`（某行无法评估，带有 `message`）。 |
| `result.mf` | 结束时的评价函数，在运行自己的波长网格上计算，与精炼窗口中显示的相同；对结果调用 `tf.merit` 会按评价函数编辑器的方式计算，两者的最后几位可能不同。 |
| `result.omf` | 结束时不含 MNT、MXT、TT 和 STR 约束行的评价函数（OMF）。 |
| `result.mfInitial` | 开始时的评价函数。 |
| `result.omfInitial` | 开始时不含约束行的评价函数（OMF）。 |
| `result.iter` | 运行所用的迭代次数。 |
| `result.frontLayers` | 精炼后的正面膜层；运行未完成时为 null。 |
| `result.backLayers` | 精炼后的背面膜层，或 null。 |
| `result.seed` | 随机抽样开始所用的种子，或 null。 |
| `design` | 运行完成时为带有精炼后膜层的设计，否则为原样的设计。 |

**拒绝**：

- 没有评价函数的设计，或含有找不到对应材料的材料的设计
- 运行不认识的方法或设置，或它不能接受的值

```js
const { result, design } = await tf.refine(tf.design, { method: 'dls', maxIter: 100 });
console.log(result.stopReason, 'merit', result.mf);
tf.design = design;
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

### synthesize

`await tf.synthesize(design, request, hooks)`

用一种合成方法，按设计的评价函数生长或重构设计，从材料池中插入材料，方式与该方法的窗口相同。运行在脚本自己的线程上计算，因此脚本会等待它完成。

| 参数 | 默认值 | 含义 |
| --- | --- | --- |
| `design` | 必填 | 设计；它需要有评价函数。 |
| `request.method` | 必填 | 方法，取自下面的方法表。 |
| `request.pool` | 必填 | 运行可以插入的材料，用 id 给出：一个或多个，不能重复。 |
| `request.settings` | `{}` | 该方法的设置，见下文；未给出的设置取其默认值。 |
| `hooks.signal` |  | 一个 AbortSignal；中止它会停止运行，运行随即返回原样的设计。 |
| `hooks.onStart` |  | 运行开始后调用。 |
| `hooks.onProgress` |  | 运行过程中调用，参数为发生变化的内容，例如 `mf`、`layerCount`、`design`（运行接着使用的膜层）和 `activity`（它正在做什么）。 |
| `hooks.onGeneration` |  | `needle`：每接受一代时调用，参数为代号 `genNum`、`mf`、`omf`、变化量 `dMF`、`layerCount`、插入的材料 `insertMat` 和 `layers`。 |
| `hooks.onRow` |  | `ge` 和 `structural`：运行历史每增加一行时调用，参数为 `genNum`、该行的 `type`（`ge`）或变异种类 `kind`（`structural`）、`mf`、`omf`、`dMF`、`layerCount`、`insertMat` 和 `layers`。 |

**返回**：`{ result, design }` 的 Promise。

| 字段 | 含义 |
| --- | --- |
| `result.completed` | 运行自然结束时为 `true`。 |
| `result.stopReason` | 结束的原因。自然结束时：`'target'`（带有 `stopMF`，即达到目标时的评价函数）；`needle` 为 `'maxLayers'` 或 `'needleOptimal'`；`ge` 为 `'maxGeCycles'` 或 `'stuck'`（没有可走的步骤）；`structural` 为 `'maxIter'`、`'iterationCap'`、`'patience'`（带有 `patience`）、`'budget'`、`'layerCap'` 或 `'noMutation'`。否则为 `'stopped'`、`'workerError'`（带有 `message`），或运行无法开始的原因：`'workerFailed'`、`'noOperands'`、`'noMaterials'` 或 `'presampleFailed'`。 |
| `result.mf` | 结果设计的评价函数；没有结果时为 null。 |
| `result.omf` | `needle` 和 `structural`：不含 MNT、MXT、TT 和 STR 约束行的同一评价函数（OMF）。 |
| `result.frontLayers` | 结果的正面膜层，或 null。 |
| `result.backLayers` | 结果的背面膜层，或 null。 |
| `result.seed` | `structural`：随机抽样开始所用的种子。 |
| `result.geSteps` | `ge`：所走的强制步骤。 |
| `result.iters` | `structural`：运行的代数。 |
| `result.reheats` | `structural`：deepSearch 重新开始的次数。 |
| `design` | 有结果时为带有结果的设计，否则为原样的设计；对称设计的背面是正面的镜像。 |

**拒绝**：

- 没有评价函数的设计，或含有找不到对应材料的材料的设计
- 运行不认识的方法或设置，或它不能接受的值
- 找不到对应材料的材料池 id，以及放在设置中给出的材料池
- 该方法不会调用的钩子

```js
const { result, design } = await tf.synthesize(tf.design, {
    method: 'ge', pool: ['TiO2', 'SiO2'], settings: { maxLayers: 10, maxGeCycles: 2 },
});
console.log(result.stopReason, 'merit', result.mf, design.frontLayers.length, 'layers');
tf.design = design;
```

#### 方法

| 方法 | 窗口 | 页面 | 钩子 |
| --- | --- | --- | --- |
| `needle` | 针法自动 | [针式变化](/zh/synthesis/needle/) | `signal`、`onStart`、`onProgress`、`onGeneration` |
| `ge` | 渐变演化 | [渐进演化（GE）](/zh/synthesis/gradual-evolution/) | `signal`、`onStart`、`onProgress`、`onRow` |
| `structural` | 结构优化器 | [结构优化器](/zh/synthesis/structural-optimizer/) | `signal`、`onStart`、`onProgress`、`onRow` |

#### `needle` 的设置

| 设置 | 默认值 | 含义 |
| --- | --- | --- |
| `maxLayers` | `60` | 设计可增长到的最大层数。不小于 1 的整数。 |
| `targetMF` | `0.0005` | 运行停止时的评价函数；Infinity 使运行在第一个被接受的代后停止。0 或更大的评价函数值，或 Infinity。 |
| `deltaNm` | `0.5` | 探测每个候选位置所用的厚度步长。大于 0 的厚度，单位 nm。 |
| `dMin` | `1` | 针式层插入时的最小厚度，也是精炼后的层被去掉的厚度阈值。大于 0 的厚度，单位 nm。 |
| `refineIter` | `60` | 每次插入后的精炼步数。不小于 1 的整数。 |
| `innerEngine` | `'cg'` | 每次插入后精炼堆栈所用的方法。cg、dls、newton、newton-cg、sqp、trust-region 之一。 |
| `candidateSearch` | `'balanced'` | 每一步在继续之前尝试多少个改进候选，在速度与质量之间权衡。fast、balanced、thorough 之一。 |
| `sensitivity` | `'off'` | 与同次扫描中最强的候选相比，候选可以弱到什么程度仍被尝试；off 尝试每一个。off、light、medium、aggressive 之一。 |
| `smartSeed` | `false` | 从设计以及用材料池构建的四分之一波长和半波长减反射设计中最好的一个开始，每个都先经过精炼。true 或 false。 |
| `threads` |  | 一批一起精炼的候选数；结果取决于它。不给出时用应用为这台计算机推荐的线程数。不小于 1 的整数。 |

#### `ge` 的设置

| 设置 | 默认值 | 含义 |
| --- | --- | --- |
| `maxLayers` | `50` | 设计最多可以包含的层数；达到上限时运行会腾出一层，而不是停止。不小于 1 的整数。 |
| `maxGeCycles` | `16` | 运行总共可以进行多少次强制步骤和腾出操作；deepSearch 取消这一限制。不小于 1 的整数。 |
| `targetMF` | `0.0005` | 运行停止时的评价函数；Infinity 使运行在第一个被接受的步骤后停止。0 或更大的评价函数值，或 Infinity。 |
| `refineIter` | `30` | 每次候选插入所做的精炼，分两遍进行，第二遍的步数减半。不小于 1 的整数。 |
| `dMin` | `15` 或最严格的 `MNT` 行 | 层插入时的最小厚度，也是层被去掉的厚度阈值。大于 0 的厚度，单位 nm。 |
| `deepSearch` | `false` | 没有可走的步骤时，从最佳设计出发、扰动其厚度后重新开始，直到达到目标评价函数或被停止。true 或 false。 |
| `innerEngine` | `'cg'` | 在步骤之间精炼堆栈所用的方法。cg、dls、newton、newton-cg、sqp、trust-region 之一。 |
| `candidateSearch` | `'balanced'` | 每一步在继续之前尝试多少个改进候选，在速度与质量之间权衡。fast、balanced、thorough 之一。 |
| `sensitivity` | `'off'` | 与同次扫描中最强的候选相比，候选可以弱到什么程度仍被尝试；off 尝试每一个。off、light、medium、aggressive 之一。 |
| `smartSeed` | `true` | 从设计以及用材料池构建的四分之一波长和半波长减反射设计中最好的一个开始，每个都先经过精炼。true 或 false。 |
| `seedMode` | `'preserve-bulk'` | 如何对待较厚的起始设计：`'refine'` 先精炼它，`'preserve-bulk'` 保留其主体结构，并在每次插入后温和地精炼。refine、preserve-bulk 之一。 |
| `consolidate` | `true` | 结束时，去掉每个去掉后评价函数仍在 consolidateTol 范围内的层。true 或 false。 |
| `consolidateTol` | `0.05` | consolidate 去掉一层时评价函数允许上升的幅度，以评价函数自身的比例计。0 或更大的相对评价函数余量。 |
| `threads` |  | 一批一起精炼的候选数；结果取决于它。不给出时用应用为这台计算机推荐的线程数。不小于 1 的整数。 |

#### `structural` 的设置

| 设置 | 默认值 | 含义 |
| --- | --- | --- |
| `maxIter` | `80` | 搜索运行的最多代数。不小于 1 的整数。 |
| `targetMF` | `0.0005` | 搜索停止时的评价函数。0 或更大的评价函数值。 |
| `T0` | `0.3` | 起始温度，以评价函数为单位；较高的值在初期接受更多上坡移动。0 或更大的温度。 |
| `jitterPct` | `0.15` | `perturb` 变异移动一个厚度的幅度，以该厚度的比例计。0 或更大的比例。 |
| `refineIter` | `60` | 每个候选得到的精炼步数；0 表示按原样为每个候选评分。0 或更大的整数。 |
| `dMin` | `1` 或最严格的 `MNT` 行 | 层的最小厚度。大于 0 的厚度，单位 nm。 |
| `addMaxNm` | `500` | 随机添加的层的最大起始厚度。大于 0 的厚度，单位 nm。 |
| `maxLayers` | `80` | 设计可增长到的最大层数。不小于 1 的整数。 |
| `kinds` | `['add', 'remove', 'split', 'merge', 'perturb']` | 搜索可以使用的变异。由 add、remove、split、merge、perturb 中一个或多个组成的列表。 |
| `deepSearch` | `false` | 一段时间内没有找到更好的设计时，从最佳设计重新开始，直到达到时间上限或被停止。true 或 false。 |
| `deepMaxMin` | `0` | 开启 deepSearch 时，搜索在这段时间后结束。0 或更大的时间，单位分钟（0：不限）。 |
| `seed` |  | 随机抽样开始所用的数值；相同的种子、设计、设置和 threads 会重复同一次运行。结果中会给出所用的种子。从 1 到 2^32 - 1 的整数，或 null 表示取一个新种子。 |
| `innerEngine` | `'cg'` | 精炼每个候选所用的方法。cg、dls、newton、newton-cg、sqp、trust-region 之一。 |
| `smartSeed` | `false` | 从设计以及用材料池构建的四分之一波长和半波长减反射设计中最好的一个开始，每个都先经过精炼。true 或 false。 |
| `threads` |  | 每一代精炼的候选数；结果取决于它。不给出时用应用为这台计算机推荐的线程数。不小于 1 的整数。 |

### runHooks

`tf.runHooks(method)`

一个运行接受的钩子名称。运行不会调用的钩子会被拒绝，因此脚本可以在传入钩子之前先在这里查看。

| 参数 | 默认值 | 含义 |
| --- | --- | --- |
| `method` | 必填 | `'refine'`，或 `synthesize` 接受的一种合成方法。 |

**返回**：钩子名称列表；名称不是运行时返回空列表。

```js
console.log('refine:', tf.runHooks('refine').join(', '));
console.log('needle:', tf.runHooks('needle').join(', '));
```
