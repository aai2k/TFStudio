---
title: API Reference
description: "Every call of the TFStudio API in the Script Console: what it takes, what it returns and what it refuses."
---

Every call on `tf` in the [Script Console](/automation/script-console/), with what it takes, what it returns and what it refuses. A call that changes a design returns a new one and leaves the one it was given as it was; set `tf.design` to the new one to keep it. Wavelengths and layer thicknesses are in nm, angles in degrees in the incident medium, the substrate thickness in mm, and R, T and A are fractions of 1, in merit targets too.

A call refuses an option it does not know and a value it cannot use, with an error that says what it takes, so nothing runs on a value you did not mean. Each example runs on the open design; one that ends by setting `tf.design` changes it, as one undo step.

## Designs

### openDesign

`tf.openDesign(filePath)`

Reads a design from a .tfs file as File > Open reads it, with the same checks and repairs. A design with no name of its own takes its file's name.

| Argument | Default | Meaning |
| -------- | ------- | ------- |
| `filePath` | required | The .tfs file, by its full path. |

**Returns**: The design: the fields `newDesign` returns, and what the file holds besides, such as its merit function in `meritOperands`.

**Refuses**:

- a file that cannot be read or does not hold a usable design

```js
const file = require('path').join(require('os').homedir(), `example-${Date.now()}.tfs`);
tf.saveDesign(tf.design, file);
const design = tf.openDesign(file);
console.log(design.name, design.frontLayers.length, 'layers, from', file);
```

### saveDesign

`tf.saveDesign(design, filePath, options)`

Writes a design to a .tfs file as the app saves it, with the materials it uses that are not built in carried inside the file.

| Argument | Default | Meaning |
| -------- | ------- | ------- |
| `design` | required | The design. |
| `filePath` | required | The file to write, by its full path. |
| `options.overwrite` | `false` | Write over a file that is already there. |

**Refuses**:

- a file that is already there, without `overwrite`

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

A new design as the app makes one, a bare substrate with no layers, with any of these settings changed.

| Argument | Default | Meaning |
| -------- | ------- | ------- |
| `options.name` | `'New Design'` | The design's name. |
| `options.incidentMedium` | `'Air'` | The medium the light comes from, by material id. |
| `options.exitMedium` | `'Air'` | The medium behind the substrate, by material id. |
| `options.substrate` | `'BK7'` | The substrate material, by id. |
| `options.substrateThicknessMm` | `1` | The substrate thickness, mm. |
| `options.surfaceMode` | `'front_only'` | Which sides carry layers: `'front_only'`, `'back_only'`, `'both_independent'`, or `'symmetric'`, whose back mirrors its front. The [evaluation modes](/design/evaluation-modes/) page explains them. |
| `options.mfEvalMode` | `'side'` | How a one-sided design is scored: `'side'`, its coated side alone, or `'total'`, the whole part. |
| `options.referenceWavelength` | `550` | The reference wavelength, nm, at which stack formulas count quarter waves. |

**Returns**: The design.

| Field | Meaning |
| ----- | ------- |
| `id` | The design's own id. |
| `name` | Its name. |
| `incidentMedium` | The medium the light comes from, by material id. |
| `exitMedium` | The medium behind the substrate, by material id. |
| `substrate` | `{ material, thickness }`, the thickness in mm. |
| `surfaceMode` | Which sides carry layers. |
| `mfEvalMode` | How a one-sided design is scored. |
| `referenceWavelength` | The reference wavelength, nm. |
| `frontLayers` | The front's layers, the outermost first, each `{ id, material, thickness, locked }` with the thickness in nm. |
| `backLayers` | The back's layers, the one on the substrate first. |
| `notes` | The design's notes, text. |

**Refuses**:

- a material id that resolves to nothing, naming the closest ids

```js
const design = tf.newDesign({ name: 'AR', substrate: 'SiO2', referenceWavelength: 600 });
console.log(design.name, 'on', design.substrate.material, design.substrate.thickness, 'mm');
```

### setDesignSetup

`tf.setDesignSetup(design, options)`

A design with any of the settings `newDesign` takes changed. A new reference wavelength rescales every layer to keep its count of quarter waves, as the Design Editor's λ0 field does, and a design made symmetric takes the mirror of its front as its back.

| Argument | Default | Meaning |
| -------- | ------- | ------- |
| `design` | required | The design. |
| `options` | required | Any of the options of `newDesign`. |

**Returns**: The design with the changes.

**Refuses**:

- a material id that resolves to nothing, naming the closest ids

```js
tf.design = tf.setDesignSetup(tf.design, { substrateThicknessMm: 3, mfEvalMode: 'total' });
console.log(tf.design.substrate.thickness, 'mm,', tf.design.mfEvalMode);
```

## Stack

### insertLayer

`tf.insertLayer(design, options)`

A design with a new layer on one side.

| Argument | Default | Meaning |
| -------- | ------- | ------- |
| `design` | required | The design. |
| `options.side` | `'front'` | `'front'` or `'back'`. |
| `options.index` |  | Where the layer goes, counted from 0: on the front, 0 is the outermost layer, next to the incident medium; on the back, 0 is the layer on the substrate. Without it, after the last layer: next to the substrate on the front, outermost on the back. |
| `options.material` | required | The layer's material, by id. |
| `options.thickness` | required | The layer's physical thickness, nm. |
| `options.locked` | `false` | Lock the layer, so that refinement and synthesis leave it as it is. |

**Returns**: The design with the layer.

**Refuses**:

- a side the Design Editor does not let you edit: the back of a symmetric design, which mirrors the front, or the side a one-sided design scored on its side alone does not evaluate
- an index outside the side's layers
- a material id that resolves to nothing, naming the closest ids

```js
tf.design = tf.insertLayer(tf.design, { material: 'SiO2', thickness: 95, index: 0 });
console.log(tf.design.frontLayers.map(l => `${l.material} ${l.thickness}`).join(', '));
```

### deleteLayer

`tf.deleteLayer(design, options)`

A design without one of its layers.

| Argument | Default | Meaning |
| -------- | ------- | ------- |
| `design` | required | The design. |
| `options.side` | `'front'` | `'front'` or `'back'`. |
| `options.index` | required | The layer's index on its side, counted as `insertLayer` counts it. |

**Returns**: The design without the layer.

**Refuses**:

- a side the Design Editor does not let you edit, as for `insertLayer`
- an index outside the side's layers

```js
tf.design = tf.deleteLayer(tf.design, { index: 0 });
console.log(tf.design.frontLayers.length, 'layers on the front');
```

### setLayer

`tf.setLayer(design, options)`

A design with one layer's material, thickness or lock changed.

| Argument | Default | Meaning |
| -------- | ------- | ------- |
| `design` | required | The design. |
| `options.side` | `'front'` | `'front'` or `'back'`. |
| `options.index` | required | The layer's index on its side, counted as `insertLayer` counts it. |
| `options.material` |  | The new material, by id. |
| `options.thickness` |  | The new physical thickness, nm. |
| `options.locked` |  | `true` locks the layer, `false` frees it. |

**Returns**: The design with the layer changed.

**Refuses**:

- a side the Design Editor does not let you edit, as for `insertLayer`
- an index outside the side's layers
- a material id that resolves to nothing, naming the closest ids

```js
tf.design = tf.setLayer(tf.design, { index: 0, thickness: 100, locked: true });
console.log(tf.design.frontLayers[0]);
```

### stackFromFormula

`tf.stackFromFormula(design, options)`

A design with the layers of one side replaced by those a [stack formula](/design/stack-formula/) builds, as the Stack Formula dialog's Replace builds them. Each letter is a quarter wave at the reference wavelength, so `'(HL)^5 H'` is eleven quarter-wave layers. Filling a side a one-sided design does not evaluate makes the design two-sided, as the dialog does.

| Argument | Default | Meaning |
| -------- | ------- | ------- |
| `design` | required | The design. |
| `options.formula` | required | The layers alone, such as `'(HL)^5 H'`; the media stay the design's. |
| `options.side` | `'front'` | `'front'` or `'back'`; a symmetric design takes the front. |
| `options.symbols` |  | The material of each letter, by id, such as `{ H: 'Ta2O5', L: 'SiO2' }`. A letter left out is H TiO2, L SiO2 or M Al2O3. |
| `options.referenceWavelength` |  | The wavelength, nm, the quarter waves are counted at, which the design then keeps. Without it, the design's own. |
| `options.startFromSubstrate` | `true` | The formula's first letter is the layer on the substrate; false makes it the layer next to the incident medium. |

**Returns**: The design with the new layers.

**Refuses**:

- a formula that does not read, saying where the reading stopped
- a formula that names media, such as `'Air | H L | BK7'`; `setDesignSetup` sets them
- a letter in `symbols` the formula does not use
- the back of a symmetric design
- a material id that resolves to nothing, naming the closest ids

```js
tf.design = tf.stackFromFormula(tf.design, { formula: '(HL)^3 H', symbols: { H: 'Ta2O5', L: 'SiO2' } });
console.log(tf.design.frontLayers.length, 'layers');
```

## Materials

### findMaterials

`tf.findMaterials(query)`

The materials whose id or name holds the text given, in upper or lower case: the built-in ones and those of the catalogs in the data folder.

| Argument | Default | Meaning |
| -------- | ------- | ------- |
| `query` | `''` | The text to look for; empty finds every material. |

**Returns**: The materials found, a list, each with these fields.

| Field | Meaning |
| ----- | ------- |
| `id` | The id designs and calls name the material by: a built-in material's own name, or `catalog:key` for one of another catalog, where `key` is the key the catalog files the material under, not always its name; use the id this call returns. |
| `name` | The name the app shows. |
| `catalog` | The catalog it is in, `'builtin'` for a built-in material. |

```js
for (const m of tf.findMaterials('TiO2')) console.log(m.id, m.name, m.catalog);
```

### materialNK

`tf.materialNK(id, wavelengths, design)`

n and k of a material at the wavelengths given, as the [Material Dispersion](/analysis/material-dispersion/) window shows them.

| Argument | Default | Meaning |
| -------- | ------- | ------- |
| `id` | required | The material, by id. |
| `wavelengths` | required | The wavelengths, nm, a list. |
| `design` | `null` | A design, so that its own copies of materials count as they do when it computes: the catalogs come first, and the design's copy is used where no catalog holds the material, or where the copy came from another catalog and has other n and k. |

**Returns**: The material's n and k.

| Field | Meaning |
| ----- | ------- |
| `id` | The material's id. |
| `rangeNm` | The range its data cover, `[first, last]` in nm, or null when it states none. |
| `nk` | One per wavelength, `{ wavelength, n, k }`, with `outside: true` where the wavelength is outside `rangeNm` and n and k are held at the edge value or extrapolated. |

**Refuses**:

- a material id that resolves to nothing, naming the closest ids

```js
const { rangeNm, nk } = tf.materialNK('TiO2', [400, 550, 700]);
console.log('Data from', rangeNm);
for (const p of nk) console.log(p.wavelength, 'nm: n', p.n.toFixed(4), 'k', p.k);
```

## Analysis

### spectrum

`tf.spectrum(design, options)`

R, T and A of a design over a range of wavelengths, for unpolarized light and for s and p, as the [Optical Evaluation](/analysis/optical-evaluation/) window computes them. The sides scored follow the design's [evaluation mode](/design/evaluation-modes/), and a design under a cone of incidence is averaged over its cone.

| Argument | Default | Meaning |
| -------- | ------- | ------- |
| `design` | required | The design. |
| `options.from` | required | The first wavelength, nm. |
| `options.to` | required | The last wavelength, nm, above `from`. |
| `options.step` | `1` | The wavelength step, nm. |
| `options.angles` | `[0]` | The angles of incidence, degrees in the incident medium, each from 0 up to but not including 90. |

**Returns**: The spectrum.

| Field | Meaning |
| ----- | ------- |
| `evalMode` | How the design was scored: `'front'`, `'back'` or `'total'`. |
| `lambda` | The wavelengths, nm. |
| `angles` | For each angle asked, by its value: the lists `R`, `T` and `A` for unpolarized light and `Rs`, `Rp`, `Ts`, `Tp`, `As` and `Ap` for s and p, one value per wavelength, as fractions of 1. |
| `outOfRange` | The materials whose data stop inside the range, each `{ id, name, rangeNm, heldFlat }`: outside `rangeNm` their n and k are held at the last value (`heldFlat` is `true`) or extrapolated. |

**Refuses**:

- a design that names a material that resolves to nothing
- more points, wavelengths times angles, than one call computes; the refusal names the limit

```js
const s = tf.spectrum(tf.design, { from: 400, to: 700, step: 10, angles: [0, 45] });
console.log(s.lambda.length, 'wavelengths');
console.log('At 400 nm, 45 degrees: Rs', s.angles[45].Rs[0], 'Rp', s.angles[45].Rp[0]);
```

### summarize

`tf.summarize(result, options)`

The mean, lowest and highest value of each quantity of a spectrum, with the wavelength of each extreme, over the whole range and over each band given.

| Argument | Default | Meaning |
| -------- | ------- | ------- |
| `result` | required | A spectrum, as `spectrum` returns it. |
| `options.bands` | `[]` | The bands, each `{ from, to }` in nm. |

**Returns**: For each angle of the spectrum, by its value, a list: the whole range first, then each band in the order given, each with these fields.

| Field | Meaning |
| ----- | ------- |
| `from` | The band's first wavelength, nm. |
| `to` | The band's last wavelength, nm. |
| `R` | For `R`, and likewise for `T`, `A`, `Rs`, `Rp`, `Ts`, `Tp`, `As` and `Ap`: `{ mean, min, minAt, max, maxAt }`, with `minAt` and `maxAt` in nm; null when no wavelength of the spectrum falls in the band. |

```js
const s = tf.spectrum(tf.design, { from: 400, to: 700, step: 5 });
const [whole, band] = tf.summarize(s, { bands: [{ from: 450, to: 650 }] })[0];
console.log('Mean R from 400 to 700 nm:', whole.R.mean);
console.log('Highest R from 450 to 650 nm:', band.R.max, 'at', band.R.maxAt, 'nm');
```

### monteCarlo

`await tf.monteCarlo(design, options, hooks)`

Monte Carlo trials of a design with random layer errors, as the [Monte Carlo](/analysis/error-analysis/) window runs them: the spread of one quantity over a range of wavelengths. With the design's [specification](/design/specification/), the share of trials that meet it is counted too.

| Argument | Default | Meaning |
| -------- | ------- | ------- |
| `design` | required | The design. |
| `options.from` | required | The first wavelength, nm. |
| `options.to` | required | The last wavelength, nm, above `from`. |
| `options.step` | `1` | The wavelength step, nm. |
| `options.quantity` | `'R'` | `'R'`, `'T'` or `'A'`. |
| `options.angle` | `0` | The angle of incidence, degrees in the incident medium, from 0 up to but not including 90. |
| `options.polarization` | `'avg'` | `'avg'`, `'s'` or `'p'`. |
| `options.runs` | `100` | How many trials, a whole number of 1 or more. |
| `options.thicknessRelPct` | `1` | The thickness error, in % of each layer. |
| `options.thicknessAbsNm` | `0` | A thickness error in nm, added to every layer's. |
| `options.indexRe` | `0` | The error on n, an absolute amount that moves each layer's n by the same draw at every wavelength: one standard deviation with `'gaussian'`, a bound with `'uniform'` and `'truncated'`. |
| `options.indexIm` | `0` | The error on k, an amount as `indexRe` is on n; k does not go below 0, so on a layer with k = 0 the error only adds absorption. |
| `options.distribution` | `'gaussian'` | How the errors are drawn: `'gaussian'`, each error level one standard deviation; `'uniform'`, a hard bound, every value inside it as likely; `'truncated'`, a hard bound at three standard deviations. |
| `options.seed` |  | The number the draws start from, a whole number from 1 to 2^32 - 1; the same seed and options repeat the run. Without it, or with null, a fresh one, which the result reports. |
| `hooks.signal` |  | An AbortSignal, looked at between trials; a stopped run returns the trials it ran. |
| `hooks.onProgress` |  | Called after each trial with `{ trial, total }`. |

**Returns**: A promise of the result.

| Field | Meaning |
| ----- | ------- |
| `lambda` | The wavelengths, nm. |
| `theory` | The quantity for the design without errors. |
| `mean` | The mean over the trials. |
| `stdev` | The standard deviation over the trials. |
| `lower` | The mean less one standard deviation, 0 at the least. |
| `upper` | The mean plus one standard deviation, 1 at the most. |
| `envLower` | The lowest value over the trials. |
| `envUpper` | The highest value over the trials. |
| `nTrials` | The trials run. |
| `char` | The quantity, `'R'`, `'T'` or `'A'`. |
| `seed` | The seed the draws started from. |
| `settings` | The error levels, distribution, angle and polarization the run used. |
| `spec` | With a specification, `{ yield, passCount, evaluated, yieldInterval }`: the share of trials that meet it, how many did, how many were checked and the 95 % interval of the share; null without one. |
| `trials` | `null`: the trials themselves are not kept. |

**Refuses**:

- a design with no layer the trials can change on the side it is scored on
- a design that names a material that resolves to nothing

```js
const mc = await tf.monteCarlo(tf.design, { from: 400, to: 700, step: 5, runs: 50, seed: 1 });
console.log(mc.nTrials, 'trials, largest spread of R:', Math.max(...mc.stdev));
```

### layerSensitivity

`tf.layerSensitivity(design, options)`

How much the merit moves when each layer's thickness is off, as the [Layer Sensitivity](/analysis/layer-sensitivity/) window ranks the layers: each layer is made thicker and thinner by a step, and the mean change of the merit is its score. The merit here leaves out the MNT and MXT rows.

| Argument | Default | Meaning |
| -------- | ------- | ------- |
| `design` | required | The design; it needs a merit function. |
| `options.mode` | `'absolute'` | `'absolute'`, a step of `deltaNm`, or `'relative'`, a step of `relPct` % of each layer. |
| `options.deltaNm` | `1` | The step, nm, in mode `'absolute'`. |
| `options.relPct` | `1` | The step, % of each layer, in mode `'relative'`. |
| `options.includeLocked` | `false` | Score the locked layers too. |

**Returns**: The ranking.

| Field | Meaning |
| ----- | ------- |
| `rows` | One per layer scored, the front's first. |
| `rows[].index` | The layer's place among those scored, from 0. |
| `rows[].side` | `'front'` or `'back'`. |
| `rows[].layerIndex` | The layer's index on its side. |
| `rows[].materialId` | The layer's material. |
| `rows[].thickness` | The layer's thickness, nm. |
| `rows[].deltaNm` | The step used, nm. |
| `rows[].deltaMFAbs` | The mean change of the merit over the two steps. |
| `rows[].deltaMF` | The same, positive when the thicker layer costs more and negative when the thinner one does. |
| `rows[].sensitivity` | The score as a share of the highest, 0 to 100. |
| `rows[].locked` | `true` for a locked layer. |
| `mf0` | The merit of the design as it is. |
| `surfaceMode` | The design's surface mode. |

**Refuses**:

- a design with no merit function, or one that names a material that resolves to nothing

```js
const { rows } = tf.layerSensitivity(tf.design, { deltaNm: 1 });
for (const row of rows) console.log(row.side, row.layerIndex, row.materialId, row.sensitivity.toFixed(1));
```

## Merit function

### setMerit

`tf.setMerit(design, rows)`

A design with its merit function replaced by the rows given, as the [Merit Function Editor](/design/merit-function-editor/) holds them. Each row is an operand of the [Operand Reference](/design/operands/), which says what each one computes and which fields it reads. A field a row leaves out takes the value a row added in the editor starts with; an MNT or MXT row covers layers 1 to 1000, counted from the substrate.

| Argument | Default | Meaning |
| -------- | ------- | ------- |
| `design` | required | The design. |
| `rows` | required | The rows, in order, each an object with at least a `type`. |
| `rows[].type` | required | The operand, such as `'RAV'` or `'MNT'`. |
| `rows[].lambdaStart` |  | The wavelength, or the first wavelength of the band, nm; for MNT and MXT the first layer. |
| `rows[].lambdaEnd` |  | The last wavelength of the band, nm; for MNT and MXT the last layer. |
| `rows[].aoi` |  | The angle of incidence, degrees in the incident medium. |
| `rows[].pol` |  | `'avg'`, `'s'` or `'p'`. |
| `rows[].target` |  | The value the row drives toward, or its bound, in the row's unit: R, T and A as fractions of 1, where the editor shows percent; a thickness in nm for MNT and MXT. |
| `rows[].targetEnd` |  | The target at `lambdaEnd` of a spectral target that slopes, or null for a flat one. |
| `rows[].weight` |  | How much the row counts, 0 or more. |
| `rows[].cmp` |  | For TT and STR, the comparison: `'eq'`, `'le'` or `'ge'`. |
| `rows[].flag` |  | The editor's Flag column, a whole number; the Operand Reference says what it does on each row. |
| `rows[].enabled` | `true` | `false` leaves the row out of the merit. |
| `rows[].id` |  | A name for the row, which a math row gives in `refId`, `refId1` or `refId2` to read it. |
| `rows[].refId` |  | For a math row that reads one row, that row's `id`; `refId1` and `refId2` for one that reads two. |
| `rows[].comment` |  | The text of a BLNK row. |

**Returns**: The design with the merit function, which it holds in `meritOperands`.

**Refuses**:

- a type this version does not evaluate
- a field no row has, such as a misspelling, or a value a field cannot take
- a `lambdaStart` above `lambdaEnd` on a row that reads a band or a layer range

```js
tf.design = tf.setMerit(tf.design, [
    { type: 'RAV', lambdaStart: 450, lambdaEnd: 650, target: 0, weight: 1 },
    { type: 'MNT', target: 10, weight: 1 },
]);
console.log('Merit:', tf.merit(tf.design).total);
```

### merit

`tf.merit(design)`

The merit of a design against its merit function, the total and each row, as the Merit Function Editor shows them.

| Argument | Default | Meaning |
| -------- | ------- | ------- |
| `design` | required | The design. |

**Returns**: The merit.

| Field | Meaning |
| ----- | ------- |
| `total` | The merit function, or null while a row cannot be evaluated. |
| `optical` | The merit without the manufacturing rows MNT, MXT, TT and STR, or null as `total`. |
| `rows` | One per row of the merit function, in order. |
| `rows[].type` | The operand. |
| `rows[].lambdaStart` | The row's wavelength, or the first wavelength of its band, nm; the first layer for MNT and MXT. Absent on a row that reads none. |
| `rows[].lambdaEnd` | The last wavelength of the band, nm, on a row that reads a band; the last layer for MNT and MXT. |
| `rows[].aoi` | The angle of incidence, on a row that reads one. |
| `rows[].pol` | The polarization the row is scored in; absent on a row scored on both, such as PSI or DPR. |
| `rows[].cmp` | For TT and STR, the comparison. |
| `rows[].value` | The row's value for the design as it is. |
| `rows[].target` | The row's target. |
| `rows[].weight` | The row's weight. |
| `rows[].enabled` | `false` for a row left out of the merit. |
| `rows[].error` | Why the row cannot be evaluated, or null. |

**Refuses**:

- a design that names a material that resolves to nothing

```js
const m = tf.merit(tf.design);
console.log('Merit:', m.total);
for (const row of m.rows) console.log(row.type, row.value, row.target);
```

## Runs

### refine

`await tf.refine(design, settings, hooks)`

Refines the layer thicknesses of a design against its merit function, as the [Refinement](/synthesis/refinement/) window does; no layer is added or taken out. The run computes on the script's own thread, so the script waits for it.

| Argument | Default | Meaning |
| -------- | ------- | ------- |
| `design` | required | The design; it needs a merit function. |
| `settings.method` | required | The method: an id from the methods below, `'all'` for each of them in turn, or a list of ids tried one by one from the same start, keeping the best. |
| `settings.seed` |  | The number the random draws of a method that makes them start from, a whole number from 1 to 2^32 - 1; the same seed, design and settings repeat the run. Without it, a fresh one, which the result reports. |
| `settings.maxIter` |  | The most iterations of a one-method run, which still stops when the merit stops falling. Without it, the method's own budget; a list of methods takes none, and runs each to its own. A whole number of 1 or more. |
| `settings.nRestarts` | `20` | How many perturbed starts DLS multi-start runs. A whole number of 1 or more. |
| `settings.perturbPct` | `30` | How far each multi-start restart moves each free thickness, in ± %. A number of 0 or more. |
| `hooks.signal` |  | An AbortSignal; aborting it stops the run, which then ends `'stopped'` with the design as it was. The run looks at it between its jobs. |
| `hooks.onStart` |  | Called once the run has started, with `{ seed }`, null for a run that draws no random numbers. |
| `hooks.onMethodStart` |  | Called with `(method, index)` as each method of the run starts. |
| `hooks.onProgress` |  | Called as the run goes with the readout values that changed: `iter`, `mf`, `mfBest`, `omf`, `omfBest`, `mfInitial`, `omfInitial`, `mfHistory` and `restartIdx`, with `design`, the layers now, and `best`, the best design so far. |
| `hooks.onRecord` |  | Called when a method runs to its own end, with `{ method, iter, mf, omf, frontLayers, backLayers, layerSide, mfHistory }`, and `restarts` and `seed` where the method has them. |

**Returns**: A promise of `{ result, design }`.

| Field | Meaning |
| ----- | ------- |
| `result.completed` | `true` when the run ended on its own. |
| `result.stopReason` | Why it ended: `'target'` (the merit fell below 10^-6), `'maxiter'`, `'stalled'` (the merit stopped falling), `'best:<method>'` (a list of methods, naming the one kept), `'restartsDone'` (DLS multi-start), `'stopped'`, `'workerFailed'`, `'workerError'`, `'presampleFailed'` (the materials could not be sampled), or `'invalidOperand'` (a row that cannot be evaluated, with `message`). |
| `result.mf` | The merit at the end, on the run's own wavelength grid, as the Refinement window shows it; `tf.merit` of the answer scores it as the Merit Function Editor does, and the two can differ in the last digits. |
| `result.omf` | The merit at the end without the manufacturing rows MNT, MXT, TT and STR. |
| `result.mfInitial` | The merit at the start. |
| `result.omfInitial` | The merit at the start without the manufacturing rows. |
| `result.iter` | The iterations the run took. |
| `result.frontLayers` | The refined front layers, or null when the run did not complete. |
| `result.backLayers` | The refined back layers, or null. |
| `result.seed` | The seed the random draws started from, or null. |
| `design` | The design with the refined layers when the run completed, otherwise the design as it was. |

**Refuses**:

- a design with no merit function, or one that names a material that resolves to nothing
- a method or setting the run does not know, or a value it cannot take

```js
const { result, design } = await tf.refine(tf.design, { method: 'dls', maxIter: 100 });
console.log(result.stopReason, 'merit', result.mf);
tf.design = design;
```

#### Methods

| Method | Name | Default `maxIter` | Takes `seed` |
| ------ | ---- | ----------------- | ------------ |
| `sqp` | Sequential QP | 200 |  |
| `dls` | Damped Least Squares | 500 |  |
| `cg` | Conjugate Gradient | 600 |  |
| `newton` | Newton | 200 |  |
| `newton-cg` | Newton-CG | 200 |  |
| `dls-multi` | DLS multi-start | 500 | yes |
| `de` | Differential Evolution | 250 | yes |
| `sa` | Simulated Annealing | 400 | yes |
| `all` | Each of `cg`, `dls`, `newton`, `newton-cg`, `sqp`, `de`, `sa`, `dls-multi` in turn, from the same start, keeping the best |  | yes |

### synthesize

`await tf.synthesize(design, request, hooks)`

Grows or restructures a design against its merit function with a synthesis method, inserting materials from a pool, as the method's window does. The run computes on the script's own thread, so the script waits for it.

| Argument | Default | Meaning |
| -------- | ------- | ------- |
| `design` | required | The design; it needs a merit function. |
| `request.method` | required | The method, from the methods below. |
| `request.pool` | required | The materials the run may insert, by id: one or more, none twice. |
| `request.settings` | `{}` | The method's settings, below; a setting left out takes its default. |
| `hooks.signal` |  | An AbortSignal; aborting it stops the run, which then answers with the design as it was. |
| `hooks.onStart` |  | Called once the run has started. |
| `hooks.onProgress` |  | Called as the run goes with what changed, such as `mf`, `layerCount`, `design` (the layers the run goes on from) and `activity`, what it is doing. |
| `hooks.onGeneration` |  | Needle: called with each accepted generation: its number `genNum`, `mf`, `omf`, the change `dMF`, `layerCount`, the material inserted `insertMat` and the `layers`. |
| `hooks.onRow` |  | Gradual Evolution and Structural: called with each row of the run's history: `genNum`, the row's `type` (Gradual Evolution) or mutation `kind` (Structural), `mf`, `omf`, `dMF`, `layerCount`, `insertMat` and the `layers`. |

**Returns**: A promise of `{ result, design }`.

| Field | Meaning |
| ----- | ------- |
| `result.completed` | `true` when the run ended on its own. |
| `result.stopReason` | Why it ended. On its own: `'target'` (with `stopMF`, the merit that reached it); for Needle `'maxLayers'` or `'needleOptimal'`; for Gradual Evolution `'maxGeCycles'` or `'stuck'` (no step left); for Structural `'maxIter'`, `'iterationCap'`, `'patience'` (with `patience`), `'budget'`, `'layerCap'` or `'noMutation'`. Otherwise `'stopped'`, `'workerError'` (with `message`), or why the run could not start: `'workerFailed'`, `'noOperands'`, `'noMaterials'` or `'presampleFailed'`. |
| `result.mf` | The merit of the answer, or null when there is none. |
| `result.omf` | Needle and Structural: the same merit without the manufacturing rows MNT, MXT, TT and STR. |
| `result.frontLayers` | The answer's front layers, or null. |
| `result.backLayers` | The answer's back layers, or null. |
| `result.seed` | Structural: the seed the random draws started from. |
| `result.geSteps` | Gradual Evolution: the forced steps it took. |
| `result.iters` | Structural: the generations it ran. |
| `result.reheats` | Structural: the restarts deepSearch made. |
| `design` | The design with the answer when the run has one, otherwise the design as it was; a symmetric design's back mirrors its front. |

**Refuses**:

- a design with no merit function, or one that names a material that resolves to nothing
- a method or setting the run does not know, or a value it cannot take
- a pool material id that resolves to nothing, and a pool given inside the settings
- a hook the method does not call

```js
const { result, design } = await tf.synthesize(tf.design, {
    method: 'ge', pool: ['TiO2', 'SiO2'], settings: { maxLayers: 10, maxGeCycles: 2 },
});
console.log(result.stopReason, 'merit', result.mf, design.frontLayers.length, 'layers');
tf.design = design;
```

#### Methods

| Method | Window | Page | Hooks |
| ------ | ------ | ---- | ----- |
| `needle` | Needle Automatic | [Needle Variation](/synthesis/needle/) | `signal`, `onStart`, `onProgress`, `onGeneration` |
| `ge` | Gradual Evolution | [Gradual Evolution (GE)](/synthesis/gradual-evolution/) | `signal`, `onStart`, `onProgress`, `onRow` |
| `structural` | Structural Optimizer | [Structural Optimizer](/synthesis/structural-optimizer/) | `signal`, `onStart`, `onProgress`, `onRow` |

#### `needle` settings

| Setting | Default | Meaning |
| ------- | ------- | ------- |
| `maxLayers` | `60` | The most layers the design may grow to. A whole number of 1 or more. |
| `targetMF` | `0.0005` | The merit at which the run stops; Infinity stops it at its first accepted generation. A merit of 0 or more, or Infinity. |
| `deltaNm` | `0.5` | The thickness step that probes each candidate position. A thickness in nm above 0. |
| `dMin` | `1` | The thinnest a needle goes in, and the thickness below which a refined layer is dropped. A thickness in nm above 0. |
| `refineIter` | `60` | The refinement steps after each insertion. A whole number of 1 or more. |
| `innerEngine` | `'cg'` | The method that refines the stack after each insertion. One of cg, dls, newton, newton-cg, sqp, trust-region. |
| `candidateSearch` | `'balanced'` | How many of the improving candidates each step tries before it moves on, trading speed for quality. One of fast, balanced, thorough. |
| `sensitivity` | `'off'` | How weak a candidate may be, beside the strongest of its scan, and still be tried; off tries every one. One of off, light, medium, aggressive. |
| `smartSeed` | `false` | Start from the best of the design and the quarter- and half-wave antireflection designs built from the pool, each refined first. True or false. |
| `threads` |  | How many candidates are refined as one batch; the answer depends on it. Without it, the thread count the app recommends for this computer. A whole number of 1 or more. |

#### `ge` settings

| Setting | Default | Meaning |
| ------- | ------- | ------- |
| `maxLayers` | `50` | The most layers the design may hold; at the limit the run frees a layer rather than stopping. A whole number of 1 or more. |
| `maxGeCycles` | `16` | How many forced steps and freed layers the run may take in all; deepSearch lifts the limit. A whole number of 1 or more. |
| `targetMF` | `0.0005` | The merit at which the run stops; Infinity stops it at its first accepted step. A merit of 0 or more, or Infinity. |
| `refineIter` | `30` | The refinement each candidate insertion gets, in two passes, the second with half the steps. A whole number of 1 or more. |
| `dMin` | `15` or the strictest `MNT` row | The thinnest a layer goes in, and the thickness below which a layer is dropped. A thickness in nm above 0. |
| `deepSearch` | `false` | When no step is left, start again from the best design with its thicknesses perturbed, until the target merit or a stop. True or false. |
| `innerEngine` | `'cg'` | The method that refines the stack between steps. One of cg, dls, newton, newton-cg, sqp, trust-region. |
| `candidateSearch` | `'balanced'` | How many of the improving candidates each step tries before it moves on, trading speed for quality. One of fast, balanced, thorough. |
| `sensitivity` | `'off'` | How weak a candidate may be, beside the strongest of its scan, and still be tried; off tries every one. One of off, light, medium, aggressive. |
| `smartSeed` | `true` | Start from the best of the design and the quarter- and half-wave antireflection designs built from the pool, each refined first. True or false. |
| `seedMode` | `'preserve-bulk'` | How a thick starting design is treated: `'refine'` refines it first, `'preserve-bulk'` keeps its bulk and refines gently after each insertion. One of refine, preserve-bulk. |
| `consolidate` | `true` | At the end, take out each layer whose removal keeps the merit within consolidateTol. True or false. |
| `consolidateTol` | `0.05` | How much the merit may rise, as a share of it, when consolidate takes a layer out. A relative merit slack of 0 or more. |
| `threads` |  | How many candidates are refined as one batch; the answer depends on it. Without it, the thread count the app recommends for this computer. A whole number of 1 or more. |

#### `structural` settings

| Setting | Default | Meaning |
| ------- | ------- | ------- |
| `maxIter` | `80` | The most generations the search runs. A whole number of 1 or more. |
| `targetMF` | `0.0005` | The merit at which the search stops. A merit of 0 or more. |
| `T0` | `0.3` | The starting temperature, in merit units; a higher one accepts more uphill moves early on. A temperature of 0 or more. |
| `jitterPct` | `0.15` | How far the perturb mutation moves a thickness, as a fraction of it. A fraction of 0 or more. |
| `refineIter` | `60` | The refinement steps each proposal gets; 0 scores each proposal as it is. A whole number of 0 or more. |
| `dMin` | `1` or the strictest `MNT` row | The thinnest a layer may be. A thickness in nm above 0. |
| `addMaxNm` | `500` | The thickest a randomly added layer starts at. A thickness in nm above 0. |
| `maxLayers` | `80` | The most layers the design may grow to. A whole number of 1 or more. |
| `kinds` | `['add', 'remove', 'split', 'merge', 'perturb']` | The mutations the search may use. A list of one or more of add, remove, split, merge, perturb. |
| `deepSearch` | `false` | When no better design has turned up for a while, restart from the best one, until the time limit or a stop. True or false. |
| `deepMaxMin` | `0` | With deepSearch, the time after which the search ends. A time in minutes of 0 or more (0: no limit). |
| `seed` |  | The number the random draws start from; the same seed, design, settings and threads repeat the run. The result reports the seed it drew from. A whole number from 1 to 2^32 - 1, or null for a fresh one. |
| `innerEngine` | `'cg'` | The method that refines each proposal. One of cg, dls, newton, newton-cg, sqp, trust-region. |
| `smartSeed` | `false` | Start from the best of the design and the quarter- and half-wave antireflection designs built from the pool, each refined first. True or false. |
| `threads` |  | How many proposals each generation refines; the answer depends on it. Without it, the thread count the app recommends for this computer. A whole number of 1 or more. |

### runHooks

`tf.runHooks(method)`

The names of the hooks a run takes. A hook a run does not call is refused, so a script can look here before it passes one.

| Argument | Default | Meaning |
| -------- | ------- | ------- |
| `method` | required | `'refine'`, or a synthesis method as `synthesize` takes it. |

**Returns**: The hook names, a list; an empty one for a name that is no run.

```js
console.log('refine:', tf.runHooks('refine').join(', '));
console.log('needle:', tf.runHooks('needle').join(', '));
```
