---
title: API Reference
description: "The objects of TFStudio's scripts in JavaScript and Python: what each method and attribute takes, gives and refuses, with an example in each language."
---

The objects TFStudio's scripts and programs work with, in JavaScript and in Python. Each section is one object: what it is, then each of its methods and attributes, with its JavaScript form beside its Python form, what it takes, what it gives and what it refuses, and an example in each language. The [Script Console](/automation/script-console/) runs a script in either language on the open design; the [Python](/automation/python/) page says how to use the same objects in a program of your own.

Wavelengths and layer thicknesses are in nm, angles in degrees in the incident medium, the substrate's thickness in mm, and R, T and A are fractions of 1, in merit targets too. Layers are numbered as the Design Editor numbers them, 1 next to the substrate.

A JavaScript name is camelCase, with the optional arguments in an options object at the end; a Python name is snake_case, with them as keyword arguments. Where the two languages agree, an entry says it once and gives a name that differs in both forms. Where they differ, it says what each does. A method that changes a design changes it in place, and copy() keeps a copy first.

A method refuses an option it does not know and a value it cannot use, with a message that says what it takes, so nothing runs on a value you did not mean: JavaScript throws an Error with that message, and Python raises `tfstudio.TFStudioError`.

Each example builds the design it works on and prints what it found, so it runs whatever design is open and leaves that design alone. The examples are Script Console scripts, except the Python ones that start a TFStudio of their own; to run one in a program, put it inside `with tfstudio.TFStudio() as tf:`.

## Front, back and total

A design's `sides` says which sides carry layers, and its `scoreOn` / `score_on` whether a design coated on one side is scored on that side alone or as the whole part, the substrate's other surface included. They are the Design Editor's Surface and Ignore other side, and every spectrum, merit, run and tolerance check follows them, as the [Surface & Evaluation Modes](/design/evaluation-modes/) page says:

| `sides` | `scoreOn` / `score_on` | In the Design Editor | Computed on, `mode` |
| ------- | ---------------------- | -------------------- | ------------------- |
| `'front'` | `'side'` | Surface: Front, Ignore other side: ticked | `'front'` (Eval: FRONT) |
| `'front'` | `'whole part'` | Surface: Front, Ignore other side: not ticked | `'total'` (Eval: TOTAL) |
| `'back'` | `'side'` | Surface: Back, Ignore other side: ticked | `'back'` (Eval: BACK) |
| `'back'` | `'whole part'` | Surface: Back, Ignore other side: not ticked | `'total'` (Eval: TOTAL) |
| `'both'` | either | Surface: Both | `'total'` (Eval: TOTAL) |
| `'symmetric'` | either | Surface: Both, Symmetric (back = front) | `'total'` (Eval: TOTAL) |

Each result says what it was computed on in its `mode`: [SpecReport](#specreport), [Yield](#yield), [Spectrum](#spectrum-1), [IndexProfile](#indexprofile), [LayerThicknesses](#layerthicknesses), [Admittance](#admittance-1), [ElectricField](#electricfield), [Color](#color-1), [Integrals](#integrals-1), [Ellipsometry](#ellipsometry-1), [RunResult](#runresult), [MonteCarlo](#montecarlo) and [LayerSensitivity](#layersensitivity).

## TFStudio

**JavaScript**: TFStudio, computing as the app does. In the Script Console, `tf` is one, with the open design in `tf.design`.

**Python**: TFStudio, started by this program with no window, computing as the app does. A with block ends it at its end, and close() ends it too. Without either, it ends once the program holds neither it nor anything it gave: a design, a material, tf.materials or tf.app. A design returned from a function that made its own TFStudio() therefore still computes.

| JavaScript | Python |
| ---------- | ------ |
| In the Script Console, `tf`, which the console gives the script. | `tfstudio.TFStudio(exe=..., live=False, data_dir=...)` |

| Python | Default | Meaning |
| ------ | ------- | ------- |
| `exe` |  | TFStudio's executable. Without it, the one TFSTUDIO_EXE names, else the TFStudio this package came with, else the TFStudio the installer recorded. |
| `live` | `False` | True links it to the TFStudio app that is open, whose designs tf.app reads and writes. |
| `data_dir` |  | A TFStudio data folder whose material catalogs it uses in place of the app's. Without it, the app's. |

**Refuses**:

- Python raises `ServerError`: TFStudio was not found, could not start, or speaks another protocol than this package

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

In the Script Console, the design open in the app when the script started, a Design, or `null` / `None` when none was open; `null` / `None` in a program. When the script ends, the design left here, whether `tf.design` was changed in place or set to another Design, is applied to the open design as one step Undo takes back, if that design has not changed meanwhile. The open design keeps its name, which is its file's, so nothing is applied when the design holds what it started with but for its name.

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

**JavaScript**: What starting TFStudio found, an object: `wasm`, `true` when the fast kernel loaded, `dataDir`, the data folder whose catalogs it read, or null, and `unreadable`, the catalog files it could not read.

**Python**: What the TFStudio serving this program said as it started, a dict: version, wasm (whether the fast kernel loaded), dataDir (the data folder, or None), unreadable (catalogs it could not read) and live.

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

The materials of TFStudio's catalogs, a Materials.

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

A new design as the app makes one: a bare substrate in air, with no layers, coated on the front and scored on its coated side.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `name` | `name` | `'New Design'` | The design's name. |
| `substrate` | `substrate` | `'BK7'` | The substrate material, by id. |
| `reference` | `reference` | `550` | The reference wavelength, nm, at which stack formulas count quarter waves. |

**Returns**: A Design.

**Refuses**:

- a material id that resolves to nothing, or a reference wavelength of 0 or less

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

A design read from a .tfs file, as File > Open reads it, with the same checks and repairs.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `path` | `path` |  | **JavaScript**: The file, by its full path. A relative path is taken from the folder the program was started from: in the Script Console, the folder TFStudio was started from, often its install folder.<br>**Python**: The file. A relative path is taken from the program's working folder: in the Script Console, the script's folder, or the data folder for a script not saved. |

**Returns**: A Design.

**Refuses**:

- a file that cannot be read or does not hold a usable design

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
| Not in JavaScript: a script works on the open design, `tf.design`. | `tf.app` |

The TFStudio app that is open, an App, for a TFStudio() started with live=True.

```python
import tfstudio

with tfstudio.TFStudio(live=True) as tf:
    print(tf.app.open_design().name)
```

### close

| JavaScript | Python |
| ---------- | ------ |
| Not in JavaScript: the console's TFStudio is the app itself. | `tf.close()` |

Ends the TFStudio serving this program, after stopping a run it is making. Designs from it cannot compute after this.

```python
import tfstudio

tf = tfstudio.TFStudio()
print(tf.info["version"])
tf.close()
```

## Design

A thin-film design, as a .tfs file holds it: its media and substrate, the layers of each side, and its merit function. `tf.newDesign()` / `tf.new_design()`, `tf.openDesign()` / `tf.open_design()` and copy() give one; in the Script Console, `tf.design` is the open design.

Methods that change a design change it in place: stack(), the layer edits, clean(), refine() and synthesize(). copy() keeps a copy first.

**Python**: In a program started with live=True, tf.app.open_design() reads one from the app, and push() writes it back.

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

The design's name. In the Script Console, a new name of `tf.design` is not applied to the open design, whose name is its file's.

**Refuses**:

- a name that is not text, or is empty

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

The reference wavelength, nm, at which stack formulas count quarter waves. Setting it rescales every layer to keep its count of quarter waves, as the Design Editor's reference wavelength field does.

**Refuses**:

- a wavelength of 0 or less

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

Which sides carry layers: `'front'`, `'back'`, `'both'`, or `'symmetric'`, whose back mirrors its front. Making a design symmetric gives it the mirror of its front as its back.

With `scoreOn` / `score_on`, it decides what a spectrum, the merit and every run compute on: the front alone, the back alone, or the whole part, which each result gives as its `mode`.

**Refuses**:

- any other value

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

How a design coated on one side is scored: `'side'`, its coated side alone, or `'whole part'`, the substrate's other surface included. A design coated on both sides is scored as the whole part. It is the Design Editor's Ignore other side: `'side'` with it ticked.

**Refuses**:

- any other value

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

The medium the light comes from, by material id.

**Refuses**:

- a material id that resolves to nothing

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

The medium behind the substrate, by material id.

**Refuses**:

- a material id that resolves to nothing

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

The substrate: its material and thickness, a Substrate.

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

The front's layers, a Layers numbered from 1 next to the substrate.

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

The back's layers, a Layers numbered from 1 next to the substrate. On a symmetric design they mirror the front and cannot be changed here.

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

The merit function, a Merit: its rows and the merit they add up to.

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

The specification, a Specification: the pass or fail checks of the Specification window, the verdict on them and the yield against them.

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

Replaces the layers of one side with those a stack formula builds, as the Stack Formula dialog's Replace builds them. Each letter is a quarter wave at the reference wavelength, so `'(HL)^5 H'` is eleven quarter-wave layers. Filling a side a design coated on one side does not score makes it coated on both, as the dialog does.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `formula` | `formula` |  | The layers alone, such as `'(HL)^5 H'`; the media stay the design's. |
| `at` | `at` |  | The wavelength, nm, the quarter waves are counted at, which the design then keeps as its reference. Without it, the design's reference wavelength. |
| `side` | `side` | `'front'` | `'front'` or `'back'`; a symmetric design takes the front. |
| `fromSubstrate` | `from_substrate` | `true` / `True` | `true` / `True` makes the formula's first letter the layer on the substrate, `false` / `False` the layer next to the incident medium. |
| `H` | `H` |  | The material of the letter H, by id, such as `'Ta2O5'`; any other letter of the formula likewise. A letter left out is H TiO2, L SiO2 or M Al2O3. |

**Refuses**:

- a formula that does not read, saying where the reading stopped; a formula that names media; a letter the formula does not use; an option stack does not take; the back of a symmetric design; or a material id that resolves to nothing

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

Cleans the stack as the Design Cleaner window does: adjacent layers of one material merged into one, and layers thinner than `minThickness` / `min_thickness` taken out, in passes, since taking a layer out can leave two layers of one material touching. Locked layers are never merged or taken out, and a symmetric design's back follows its front. The design then holds the cleaned layers.

**JavaScript**: The merit usually worsens a little, since the stack changed. To do what the window's Re-optimize does, add an MNT row at `minThickness` and refine with sqp: `design.merit.add('MNT', { target: 5 })`, then `await design.refine({ method: 'sqp', maxIter: 80 })`. The layers end on the thicknesses the window's pass gives. The window's pass keeps each layer at `minThickness` or above, and sqp keeps each layer inside the MNT row; without that row refine keeps layers at 1 nm or above.

**Python**: The merit usually worsens a little, since the stack changed. To do what the window's Re-optimize does, add an MNT row at min_thickness and refine with sqp: design.merit.add("MNT", target=5), then design.refine(method="sqp", max_iter=80). The layers end on the thicknesses the window's pass gives. The window's pass keeps each layer at min_thickness or above, and sqp keeps each layer inside the MNT row; without that row refine keeps layers at 1 nm or above.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `minThickness` | `min_thickness` | `5` | The thinnest layer kept, nm: a layer below it is taken out. 0 takes none out. |
| `merge` | `merge` | `true` / `True` | `true` / `True` merges adjacent layers of one material. |
| `back` | `back` | `true` / `True` | `true` / `True` cleans the back too, also on a design scored on its front alone, whose back the layer edits refuse to change; `false` / `False` cleans the front alone, also on a design coated on the back alone. |

**Returns**: A CleanReport.

**Refuses**:

- **JavaScript**: an option clean does not take, a minThickness that is not a number of 0 or more, a merge or back other than `true` or `false`, or a design with no layers<br>**Python**: a min_thickness that is not a number of 0 or more, a merge or back other than True or False, or a design with no layers

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

### spectrum

| JavaScript | Python |
| ---------- | ------ |
| `design.spectrum(start, end, { step, angles })` | `design.spectrum(start, end, step=1, angles=[0])` |

R, T and A over a range of wavelengths, for unpolarized light and for s and p, as the Optical Evaluation window computes them. What it is computed on follows the design's `sides` and `scoreOn` / `score_on`, and the spectrum's `mode` says which it was. A design under a cone of incidence is averaged over its cone.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `start` | `start` |  | The first wavelength, nm. |
| `end` | `end` |  | The last wavelength, nm, above `start`. |
| `step` | `step` | `1` | The wavelength step, nm. |
| `angles` | `angles` | `[0]` | The angles of incidence, degrees in the incident medium, each from 0 up to but not including 90. |

**Returns**: A Spectrum.

**Refuses**:

- a range that is not one, an angle outside 0 to 90, a design that names a material that resolves to nothing, or more than a million points (wavelengths times angles): take a larger step or fewer angles

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

### indexProfile / index_profile

| JavaScript | Python |
| ---------- | ------ |
| `design.indexProfile({ wavelength, side })` | `design.index_profile(wavelength=..., side=...)` |

The refractive index of the layers at one wavelength, laid out by depth, as the Refractive Index Profile window shows it. The sides follow the design's `sides` and `scoreOn` / `score_on`, as a spectrum does, unless `side` is given: on one side, the layers in the order light meets them coming from that side's medium; on the whole part, the front, the substrate and the back, as the window's Total view lays them. A layer with no thickness is left out, as the window leaves it out.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `wavelength` | `wavelength` |  | The wavelength n and k are read at, nm. Without it, the design's reference wavelength. |
| `side` | `side` |  | `'front'`, `'back'` or `'total'`, the whole part. Without it, what the design is scored on. |

**Returns**: An IndexProfile.

**Refuses**:

- **JavaScript**: an option it does not take, a wavelength of 0 or less, a side other than `'front'`, `'back'` or `'total'`, a side with no layer thicker than 0 nm, or a design that names a material that resolves to nothing<br>**Python**: a wavelength of 0 or less, a side other than "front", "back" or "total", a side with no layer thicker than 0 nm, or a design that names a material that resolves to nothing

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

Each layer's physical and optical thickness, as the Layer Thicknesses window lists them, with the optical ones taken at one wavelength. The sides follow the design's `sides` and `scoreOn` / `score_on`, as a spectrum does, unless `side` is given; on the whole part, the front's layers and then the back's. Every layer has its row, one with no thickness too.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `wavelength` | `wavelength` |  | The wavelength λ0 the optical thicknesses are taken at, nm. Without it, the design's reference wavelength. |
| `side` | `side` |  | `'front'`, `'back'` or `'total'`, both sides. Without it, what the design is scored on. |

**Returns**: A LayerThicknesses.

**Refuses**:

- **JavaScript**: an option it does not take, a wavelength of 0 or less, a side other than `'front'`, `'back'` or `'total'`, a side with no layers, or a design that names a material that resolves to nothing<br>**Python**: a wavelength of 0 or less, a side other than "front", "back" or "total", a side with no layers, or a design that names a material that resolves to nothing

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

The physical thickness of the layers, nm. Without `side`, of the sides a TT merit row sums, as the row reads it: the front of a design coated on the front or symmetric, the back of one coated on the back, both of one coated on both. So a symmetric design counts its front once. `'total'` counts the front and the back the design holds, a symmetric design's back as the mirror of its front.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `side` | `side` |  | `'front'`, `'back'` or `'total'`, both sides. Without it, the coated sides. |

**Returns**: The thickness, nm.

**Refuses**:

- **JavaScript**: an option it does not take, or a side other than `'front'`, `'back'` or `'total'`<br>**Python**: a side other than "front", "back" or "total"

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

The optical thickness of the layers, the sum of n times thickness at the design's reference wavelength, nm, over the layers `totalThickness()` / `total_thickness()` counts with the same `side`.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `side` | `side` |  | `'front'`, `'back'` or `'total'`, both sides. Without it, the coated sides. |

**Returns**: The optical thickness, nm; `null` / `None` when a material of a layer counted resolves to nothing.

**Refuses**:

- **JavaScript**: an option it does not take, or a side other than `'front'`, `'back'` or `'total'`<br>**Python**: a side other than "front", "back" or "total"

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

How many layers of each material, over the layers `totalThickness()` / `total_thickness()` counts with the same `side`.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `side` | `side` |  | `'front'`, `'back'` or `'total'`, both sides. Without it, the coated sides. |

**Returns**: **JavaScript**: An object of counts by material id.<br>**Python**: A dict of counts by material id.

**Refuses**:

- **JavaScript**: an option it does not take, or a side other than `'front'`, `'back'` or `'total'`<br>**Python**: a side other than "front", "back" or "total"

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

**JavaScript**: The admittance locus of one coated side at one wavelength, for s and p, as the Admittance Diagram window draws it and lists it in its table: from the substrate's admittance through the admittance at the outer surface of each layer to the coating's outer surface. It is computed on the front, or on the back of a design coated on the back alone, unless `side` is given. The design's cone of incidence is not used, as the window does not use it. Complex values are `{ re, im }` in Macleod's sign, the window's: an absorbing material's index is n − ik.

**Python**: The admittance locus of one coated side at one wavelength, for s and p, as the Admittance Diagram window draws it and lists it in its table: from the substrate's admittance through the admittance at the outer surface of each layer to the coating's outer surface. It is computed on the front, or on the back of a design coated on the back alone, unless side is given. The design's cone of incidence is not used, as the window does not use it. Complex values are Python complex numbers in Macleod's sign, the window's: an absorbing material's index is n − ik.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `wavelength` | `wavelength` |  | The wavelength, nm. Without it, the design's reference wavelength. |
| `angle` | `angle` | `0` | The angle of incidence, degrees in the medium light comes from, 0 up to but not including 90. |
| `side` | `side` |  | `'front'` or `'back'`. Without it, the back of a design coated on the back alone and the front of any other. |
| `plane` | `plane` | `'admittance'` | What the arcs are drawn in: `'admittance'`, the Y plane, or `'reflection'`, the plane of the reflection coefficient Γ. |

**Returns**: An Admittance.

**Refuses**:

- **JavaScript**: an option it does not take, a wavelength of 0 or less, an angle outside 0 to 90, a side other than `'front'` or `'back'`, a plane other than `'admittance'` or `'reflection'`, a side with no layers, or a design that names a material that resolves to nothing<br>**Python**: a wavelength of 0 or less, an angle outside 0 to 90, a side other than "front" or "back", a plane other than "admittance" or "reflection", a side with no layers, or a design that names a material that resolves to nothing

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

The electric field through one coated side at one wavelength, for s, p and unpolarized light, as the Electric Field window computes it, from the medium light comes from to the substrate. It is computed on the front, or on the back of a design coated on the back alone, unless `side` is given. The design's cone of incidence is not used, as the window does not use it. |E|² is a fraction of the incident |E|², and the amplitude is in V/m for 1 W/m² incident.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `wavelength` | `wavelength` |  | The wavelength, nm. Without it, the design's reference wavelength. |
| `angle` | `angle` | `0` | The angle of incidence, degrees in the medium light comes from, 0 up to but not including 90. |
| `side` | `side` |  | `'front'` or `'back'`. Without it, the back of a design coated on the back alone and the front of any other. |
| `pointsPerLayer` | `points_per_layer` | `60` | The samples taken across each layer, a whole number of 2 or more. |
| `depthUnit` | `depth_unit` | `'nm'` | What `depth` is in: `'nm'`, `'OT'` (n times thickness summed, nm), `'QWOT'` or `'FWOT'`. |
| `reference` | `reference` |  | The wavelength λ0, nm, the optical depth units read n at. Without it, the design's reference wavelength. |

**Returns**: An ElectricField.

**Refuses**:

- **JavaScript**: an option it does not take, a wavelength or reference of 0 or less, an angle outside 0 to 90, a side other than `'front'` or `'back'`, a depth unit it does not have, a pointsPerLayer that is not a whole number of 2 or more, more than a million samples, a side with no layer thicker than 0 nm, or a design that names a material that resolves to nothing<br>**Python**: a wavelength or reference of 0 or less, an angle outside 0 to 90, a side other than "front" or "back", a depth unit it does not have, a points_per_layer that is not a whole number of 2 or more, more than a million samples, a side with no layer thicker than 0 nm, or a design that names a material that resolves to nothing

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

The CIE colour of the design's reflectance or transmittance, as the Color Evaluation window computes it: the tristimulus values of R or T on the 380-780 nm band under one illuminant, and the colour spaces, dominant wavelength, correlated colour temperature and sRGB swatch the window shows. What it is computed on follows the design's `sides` and `scoreOn` / `score_on`, as a spectrum does, unless `side` is given, and a design under a cone of incidence is averaged over its cone, as the window averages it. A side with no layers gives the colour of its bare surface.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `quantity` | `quantity` | `'R'` | What is coloured: `'R'` or `'T'`. |
| `angle` | `angle` | `0` | The angle of incidence, degrees in the incident medium, 0 up to but not including 90. |
| `pol` | `pol` | `'avg'` | The polarization: `'avg'`, unpolarized, `'s'` or `'p'`. |
| `observer` | `observer` | `2` | The CIE standard observer, by its field in degrees: `2` (CIE 1931) or `10` (CIE 1964). |
| `illuminant` | `illuminant` | `'D65'` | The CIE illuminant: `'D65'`, `'D50'`, `'A'` or `'E'`. |
| `step` | `step` | `0.5` | The wavelength step of the spectrum the colour is integrated on, nm. |
| `side` | `side` |  | `'front'`, `'back'` or `'total'`, the whole part. Without it, what the design is scored on. |

**Returns**: A Color.

**Refuses**:

- **JavaScript**: an option it does not take, a quantity, polarization, observer, illuminant or side it does not have, an angle outside 0 to 90, a step of 0 or less, more than a million wavelengths, or a design that names a material that resolves to nothing<br>**Python**: a quantity, polarization, observer, illuminant or side it does not have, an angle outside 0 to 90, a step of 0 or less, more than a million wavelengths, or a design that names a material that resolves to nothing

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

**JavaScript**: Weighted averages of the design's T, R and A, as the Integral Values window computes them: each integral is ∫ C(λ) w(λ) dλ / ∫ w(λ) dλ over its weighting's band, on the spectrum's grid. The built-in rows are the window's, Tvis to RNIR; rows of your own come in `custom`. What it is computed on follows the design's `sides` and `scoreOn`, as a spectrum does, unless `side` is given, and a design under a cone of incidence is averaged over its cone, as the window averages it. A row whose band the spectrum does not span has no value: its numbers are NaN and `covered` is false. A row whose weighting is 0 over the whole band has no value either, though `covered` is true.

**Python**: Weighted averages of the design's T, R and A, as the Integral Values window computes them: each integral is ∫ C(λ) w(λ) dλ / ∫ w(λ) dλ over its weighting's band, on the spectrum's grid. The built-in rows are the window's, Tvis to RNIR; rows of your own come in custom. What it is computed on follows the design's sides and score_on, as a spectrum does, unless side is given, and a design under a cone of incidence is averaged over its cone, as the window averages it. A row whose band the spectrum does not span has no value: its numbers are nan and covered is False. A row whose weighting is 0 over the whole band has no value either, though covered is True.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `start` | `start` | `300` | The first wavelength of the spectrum, nm. |
| `end` | `end` | `2500` | The last wavelength, nm, above `start`. |
| `step` | `step` | `0.5` | The wavelength step, nm. |
| `angle` | `angle` | `0` | The angle of incidence, degrees in the incident medium, 0 up to but not including 90. |
| `pol` | `pol` | `'avg'` | The polarization: `'avg'`, unpolarized, `'s'` or `'p'`. |
| `custom` | `custom` | `[]` | **JavaScript**: Rows of your own, each `{ key, quantity, source, detector, band }`: `key` its name, which no other row has; `quantity` `'T'`, `'R'` or `'A'`; `source` `{ id }` with an id of `'D65'`, `'D50'`, `'A'`, `'AM1.5G'`, `'E'`, `'blackbody'` with `T`, its temperature in K, or `'custom'` with `table`, its `[nm, value]` rows, at least two at different wavelengths; `detector` `{ id }` with an id of `'photopic'`, `'flat'` or `'custom'` with its `table`; `band` `[start, end]` in nm, which the weighting's own range narrows. Left out: `'T'`, D65, photopic and 380-780 nm; a blackbody's T 5778 K.<br>**Python**: Rows of your own, each a dict with key, quantity, source, detector and band: key its name, which no other row has; quantity "T", "R" or "A"; source {"id": ...} with an id of "D65", "D50", "A", "AM1.5G", "E", "blackbody" with "T", its temperature in K, or "custom" with "table", its [nm, value] rows, at least two at different wavelengths; detector {"id": ...} with an id of "photopic", "flat" or "custom" with its "table"; band [start, end] in nm, which the weighting's own range narrows. Left out: "T", D65, photopic and 380-780 nm; a blackbody's T 5778 K. Without it, no rows of your own. |
| `side` | `side` |  | `'front'`, `'back'` or `'total'`, the whole part. Without it, what the design is scored on. |

**Returns**: An Integrals.

**Refuses**:

- **JavaScript**: an option it does not take, a range that is not one, an angle outside 0 to 90, a polarization or side it does not have, more than a million wavelengths, a custom row with a field it does not have or cannot use, a key another row has, or a design that names a material that resolves to nothing<br>**Python**: a range that is not one, an angle outside 0 to 90, a polarization or side it does not have, more than a million wavelengths, a custom row with a field it does not have or cannot use, a key another row has, or a design that names a material that resolves to nothing

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

Ψ and Δ of one coated side against wavelength, at one angle of incidence or several, as the Ellipsometry window's spectral sweep computes them, from ρ = r_p / r_s = tan Ψ · exp(i Δ). It is computed on the front, or on the back of a design coated on the back alone, unless `side` is given; a side with no layers gives its bare surface. The design's cone of incidence is not used, as the window does not use it.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `start` | `start` | `400` | The first wavelength, nm. |
| `end` | `end` | `800` | The last wavelength, nm, above `start`. |
| `step` | `step` | `0.5` | The wavelength step, nm. |
| `angles` | `angles` | `[65]` | The angles of incidence, degrees in the medium light comes from, each 0 up to but not including 90. |
| `side` | `side` |  | `'front'` or `'back'`. Without it, the back of a design coated on the back alone and the front of any other. |
| `deltaConvention` | `delta_convention` | `'azzam'` | The sign of Δ: `'azzam'`, the Azzam-Bashara sign an ellipsometer writes, or `'reversed'`, 360 degrees minus that. Ψ is the same in both. |

**Returns**: An Ellipsometry.

**Refuses**:

- **JavaScript**: an option it does not take, a range that is not one, an angle outside 0 to 90, a side other than `'front'` or `'back'`, a convention other than `'azzam'` or `'reversed'`, more than a million points (wavelengths times angles), or a design that names a material that resolves to nothing<br>**Python**: a range that is not one, an angle outside 0 to 90, a side other than "front" or "back", a convention other than "azzam" or "reversed", more than a million points (wavelengths times angles), or a design that names a material that resolves to nothing

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

Ψ and Δ of one coated side against angle of incidence at one wavelength, as the Ellipsometry window's angular sweep computes them. The angles run from `start` by `step`, each rounded to 0.001 degree, to `end`. It is computed on the front, or on the back of a design coated on the back alone, unless `side` is given; a side with no layers gives its bare surface. The design's cone of incidence is not used, as the window does not use it.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `wavelength` | `wavelength` |  | The wavelength, nm. Without it, the design's reference wavelength. |
| `start` | `start` | `45` | The first angle of incidence, degrees in the medium light comes from, 0 or more. |
| `end` | `end` | `80` | The last angle, degrees, above `start` and at most 89.5. |
| `step` | `step` | `0.5` | The angle step, degrees, from 0.05 up to the span, `end` minus `start`. |
| `side` | `side` |  | `'front'` or `'back'`. Without it, the back of a design coated on the back alone and the front of any other. |
| `deltaConvention` | `delta_convention` | `'azzam'` | The sign of Δ: `'azzam'`, the Azzam-Bashara sign an ellipsometer writes, or `'reversed'`, 360 degrees minus that. Ψ is the same in both. |

**Returns**: An Ellipsometry.

**Refuses**:

- **JavaScript**: an option it does not take, a wavelength of 0 or less, angles that are not a range from 0 to 89.5, a step below 0.05 degrees or above the span, a side other than `'front'` or `'back'`, a convention other than `'azzam'` or `'reversed'`, or a design that names a material that resolves to nothing<br>**Python**: a wavelength of 0 or less, angles that are not a range from 0 to 89.5, a step below 0.05 degrees or above the span, a side other than "front" or "back", a convention other than "azzam" or "reversed", or a design that names a material that resolves to nothing

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

### refine

| JavaScript | Python |
| ---------- | ------ |
| `await design.refine({ method, maxIter, nRestarts, perturbPct, seed, threads, progress, stop })` | `design.refine(method="dls", max_iter=..., n_restarts=..., perturb_pct=..., seed=..., threads=1, progress=..., stop=...)` |

Refines the layer thicknesses against the merit function, as the Refinement window does; no layer is added or taken out. The design then holds the refined layers, or, when the run is stopped, the layers it had. The layers it moves follow the design's `sides`.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `method` | `method` | `'dls'` | The method: an id from the API Reference's table of refine methods, such as `'dls'`, `'cg'` or `'de'`; `'all'` for each of them in turn; or a list of ids tried one by one from the same start, keeping the best. The Refinement window opens with `'sqp'` until you pick another method in it. |
| `maxIter` | `max_iter` |  | The iterations a one-method run may take. Without it, the method's own. |
| `nRestarts` | `n_restarts` | `20` | The restarts of a multi-start method. |
| `perturbPct` | `perturb_pct` | `30` | How far a multi-start method moves each thickness at a restart, %. |
| `seed` | `seed` |  | The number the random draws of a method that makes them start from, a whole number from 1 to 2^32 - 1; the same seed, design and settings repeat the run. Without it, a fresh one, which the result reports. |
| `threads` | `threads` | `1` | The workers multi-start and parallel differential evolution use at once. |
| `progress` | `progress` |  | **JavaScript**: A function called with a Progress each time the run reports. An error it throws ends the run, which then rejects with it, the design as it was.<br>**Python**: A function called with a Progress each time the run reports. An exception it raises stops the run and goes on. |
| `stop` | `stop` |  | **JavaScript**: An AbortSignal; aborting its AbortController ends the run, which then leaves the design as it was.<br>**Python**: A tfstudio.Stop whose stop() ends the run. |

**Returns**: **JavaScript**: A promise of a RunResult.<br>**Python**: A RunResult.

**Refuses**:

- a design with no merit function, a method or setting the run does not know, or a value it cannot take
- Python raises `KeyboardInterrupt`: Ctrl+C during the run, after stopping it; the design keeps the layers it had

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

#### `run.stopReason` / `run.stop_reason`

Why it ended: `'target'` (the merit fell below 10^-6), `'maxiter'`, `'stalled'` (the merit stopped falling), `'best:<method>'` (a list of methods, naming the one kept), `'restartsDone'` (DLS multi-start), `'stopped'`, `'workerFailed'`, `'workerError'`, `'presampleFailed'` (the materials could not be sampled), or `'invalidOperand'` (a row that cannot be evaluated, with `message`).

### synthesize

| JavaScript | Python |
| ---------- | ------ |
| `await design.synthesize(method, pool, { maxLayers, targetMF, refineIter, threads, seed, dMin, progress, stop })` | `design.synthesize(method, pool, max_layers=..., target_mf=..., refine_iter=..., threads=..., seed=..., d_min=..., progress=..., stop=...)` |

Grows or restructures the design against its merit function with a synthesis method, inserting materials from a pool, as the method's window does. The design then holds the run's answer, or, when the run is stopped, the layers it had. Each method's settings, with their defaults, are in the API Reference under synthesize; a setting left out takes its default.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `method` | `method` |  | `'needle'`, `'ge'` (Gradual Evolution) or `'structural'`. |
| `pool` | `pool` |  | The materials the run may insert, by id, none twice. |
| `maxLayers` | `max_layers` |  | The most layers the design may grow to. |
| `targetMF` | `target_mf` |  | The merit at which the run stops. |
| `refineIter` | `refine_iter` |  | The refinement steps after each insertion. |
| `threads` | `threads` |  | How many candidates are refined as one batch; the answer depends on it. |
| `seed` | `seed` |  | Structural: the number its random draws start from. |
| `dMin` | `d_min` |  | Any other setting of the method, such as `dMin` / `d_min`. |
| `progress` | `progress` |  | **JavaScript**: A function called with a Progress each time the run reports. An error it throws ends the run, which then rejects with it, the design as it was.<br>**Python**: A function called with a Progress each time the run reports. An exception it raises stops the run and goes on. |
| `stop` | `stop` |  | **JavaScript**: An AbortSignal; aborting its AbortController ends the run, which then leaves the design as it was.<br>**Python**: A tfstudio.Stop whose stop() ends the run. |

**Returns**: **JavaScript**: A promise of a RunResult.<br>**Python**: A RunResult.

**Refuses**:

- a design with no merit function, a method or setting the run does not know, a value it cannot take, or a pool material id that resolves to nothing
- Python raises `KeyboardInterrupt`: Ctrl+C during the run, after stopping it; the design keeps the layers it had

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

#### Methods

| Method | Window | Page |
| ------ | ------ | ---- |
| `needle` | Needle Automatic | [Needle Variation](/synthesis/needle/) |
| `ge` | Gradual Evolution | [Gradual Evolution (GE)](/synthesis/gradual-evolution/) |
| `structural` | Structural Optimizer | [Structural Optimizer](/synthesis/structural-optimizer/) |

#### `run.stopReason` / `run.stop_reason`

Why it ended. On its own: `'target'` (with `stopMF`, the merit that reached it); for Needle `'maxLayers'` or `'needleOptimal'`; for Gradual Evolution `'maxGeCycles'` or `'stuck'` (no step left); for Structural `'maxIter'`, `'iterationCap'`, `'patience'` (with `patience`), `'budget'`, `'layerCap'` or `'noMutation'`. Otherwise `'stopped'`, `'workerError'` (with `message`), or why the run could not start: `'workerFailed'`, `'noOperands'`, `'noMaterials'` or `'presampleFailed'`.

#### `needle` settings

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `maxLayers` | `max_layers` | `60` | The most layers the design may grow to. A whole number of 1 or more. |
| `targetMF` | `target_mf` | `0.0005` | The merit at which the run stops; Infinity stops it at its first accepted generation. A merit of 0 or more, or Infinity. |
| `deltaNm` | `delta_nm` | `0.5` | The thickness step that probes each candidate position. A thickness in nm above 0. |
| `dMin` | `d_min` | `1` | The thinnest a needle goes in, and the thickness below which a refined layer is dropped. A thickness in nm above 0. |
| `refineIter` | `refine_iter` | `60` | The refinement steps after each insertion. A whole number of 1 or more. |
| `innerEngine` | `inner_engine` | `'trust-region'` | The method that refines the stack after each insertion. One of cg, dls, newton, newton-cg, sqp, trust-region. |
| `candidateSearch` | `candidate_search` | `'balanced'` | How many of the improving candidates each step tries before it moves on, trading speed for quality. One of fast, balanced, thorough. |
| `sensitivity` | `sensitivity` | `'off'` | How weak a candidate may be, beside the strongest of its scan, and still be tried; off tries every one. One of off, light, medium, aggressive. |
| `smartSeed` | `smart_seed` | `false` / `False` | Start from the best of the design and the quarter- and half-wave antireflection designs built from the pool, each refined first. True or false. |
| `threads` | `threads` |  | How many candidates are refined as one batch; the answer depends on it. Without it, the thread count the app recommends for this computer. A whole number of 1 or more. |

#### `ge` settings

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `maxLayers` | `max_layers` | `50` | The most layers the design may hold; at the limit the run frees a layer rather than stopping. A whole number of 1 or more. |
| `maxGeCycles` | `max_ge_cycles` | `16` | How many forced steps and freed layers the run may take in all; deepSearch lifts the limit. A whole number of 1 or more. |
| `targetMF` | `target_mf` | `0.0005` | The merit at which the run stops; Infinity stops it at its first accepted step. A merit of 0 or more, or Infinity. |
| `refineIter` | `refine_iter` | `30` | The refinement each candidate insertion gets, in two passes, the second with half the steps. A whole number of 1 or more. |
| `dMin` | `d_min` | `15` or the strictest `MNT` row | The thinnest a layer goes in, and the thickness below which a layer is dropped. A thickness in nm above 0. |
| `deepSearch` | `deep_search` | `false` / `False` | When no step is left, start again from the best design with its thicknesses perturbed, until the target merit or a stop. True or false. |
| `innerEngine` | `inner_engine` | `'cg'` | The method that refines the stack between steps. One of cg, dls, newton, newton-cg, sqp, trust-region. |
| `candidateSearch` | `candidate_search` | `'balanced'` | How many of the improving candidates each step tries before it moves on, trading speed for quality. One of fast, balanced, thorough. |
| `sensitivity` | `sensitivity` | `'off'` | How weak a candidate may be, beside the strongest of its scan, and still be tried; off tries every one. One of off, light, medium, aggressive. |
| `smartSeed` | `smart_seed` | `true` / `True` | Start from the best of the design and the quarter- and half-wave antireflection designs built from the pool, each refined first. True or false. |
| `seedMode` | `seed_mode` | `'preserve-bulk'` | How a thick starting design is treated: `'refine'` refines it first, `'preserve-bulk'` keeps its bulk and refines gently after each insertion. One of refine, preserve-bulk. |
| `consolidate` | `consolidate` | `true` / `True` | At the end, take out each layer whose removal keeps the merit within consolidateTol. True or false. |
| `consolidateTol` | `consolidate_tol` | `0.05` | How much the merit may rise, as a share of it, when consolidate takes a layer out. A relative merit slack of 0 or more. |
| `threads` | `threads` |  | How many candidates are refined as one batch; the answer depends on it. Without it, the thread count the app recommends for this computer. A whole number of 1 or more. |

#### `structural` settings

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `maxIter` | `max_iter` | `80` | The most generations the search runs. A whole number of 1 or more. |
| `targetMF` | `target_mf` | `0.0005` | The merit at which the search stops. A merit of 0 or more. |
| `T0` | `t0` | `0.3` | The starting temperature, in merit units; a higher one accepts more uphill moves early on. A temperature of 0 or more. |
| `jitterPct` | `jitter_pct` | `0.15` | How far the perturb mutation moves a thickness, as a fraction of it. A fraction of 0 or more. |
| `refineIter` | `refine_iter` | `60` | The refinement steps each proposal gets; 0 scores each proposal as it is. A whole number of 0 or more. |
| `dMin` | `d_min` | `1` or the strictest `MNT` row | The thinnest a layer may be. A thickness in nm above 0. |
| `addMaxNm` | `add_max_nm` | `500` | The thickest a randomly added layer starts at. A thickness in nm above 0. |
| `maxLayers` | `max_layers` | `80` | The most layers the design may grow to. A whole number of 1 or more. |
| `kinds` | `kinds` | `['add', 'remove', 'split', 'merge', 'perturb']` | The mutations the search may use. A list of one or more of add, remove, split, merge, perturb. |
| `deepSearch` | `deep_search` | `false` / `False` | When no better design has turned up for a while, restart from the best one, until the time limit or a stop. True or false. |
| `deepMaxMin` | `deep_max_min` | `0` | With deepSearch, the time after which the search ends. A time in minutes of 0 or more (0: no limit). |
| `seed` | `seed` | `null` / `None` | The number the random draws start from; the same seed, design, settings and threads repeat the run. The result reports the seed it drew from. A whole number from 1 to 2^32 - 1, or null for a fresh one. |
| `innerEngine` | `inner_engine` | `'cg'` | The method that refines each proposal. One of cg, dls, newton, newton-cg, sqp, trust-region. |
| `smartSeed` | `smart_seed` | `false` / `False` | Start from the best of the design and the quarter- and half-wave antireflection designs built from the pool, each refined first. True or false. |
| `threads` | `threads` |  | How many proposals each generation refines; the answer depends on it. Without it, the thread count the app recommends for this computer. A whole number of 1 or more. |

### monteCarlo / monte_carlo

| JavaScript | Python |
| ---------- | ------ |
| `await design.monteCarlo(start, end, { runs, step, quantity, angle, polarization, thicknessRelPct, thicknessAbsNm, indexRe, indexIm, distribution, seed, progress, stop })` | `design.monte_carlo(start, end, runs=100, step=1, quantity="R", angle=0, polarization="avg", thickness_rel_pct=1, thickness_abs_nm=0, index_re=0, index_im=0, distribution="gaussian", seed=..., progress=..., stop=...)` |

Monte Carlo trials of the design with random layer errors, as the Monte Carlo window runs them: the spread of one quantity over a range of wavelengths, computed on what the design's `sides` and `scoreOn` / `score_on` say. With the design's specification, the share of trials that meet it is counted too. The design is not changed.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `start` | `start` |  | The first wavelength, nm. |
| `end` | `end` |  | The last wavelength, nm, above `start`. |
| `runs` | `runs` | `100` | How many trials. |
| `step` | `step` | `1` | The wavelength step, nm. |
| `quantity` | `quantity` | `'R'` | `'R'`, `'T'` or `'A'`. |
| `angle` | `angle` | `0` | The angle of incidence, degrees in the incident medium. |
| `polarization` | `polarization` | `'avg'` | `'avg'`, `'s'` or `'p'`. |
| `thicknessRelPct` | `thickness_rel_pct` | `1` | The thickness error, % of each layer. |
| `thicknessAbsNm` | `thickness_abs_nm` | `0` | A thickness error in nm added to every layer's. |
| `indexRe` | `index_re` | `0` | The error on n, an absolute amount: one standard deviation with `'gaussian'`, a bound with `'uniform'` and `'truncated'`. |
| `indexIm` | `index_im` | `0` | The error on k, an amount as `indexRe` / `index_re` is on n; k does not go below 0. |
| `distribution` | `distribution` | `'gaussian'` | `'gaussian'`, `'uniform'` or `'truncated'` (a bound at three standard deviations). |
| `seed` | `seed` |  | The number the draws start from, a whole number from 1 to 2^32 - 1; the same seed and settings repeat the run. Without it, a fresh one, which the result reports. |
| `progress` | `progress` |  | **JavaScript**: A function called with a Progress (`trial` and `total`) as the trials go. An error it throws ends the run, which then rejects with it.<br>**Python**: A function called with a Progress (trial and total) as the trials go. An exception it raises stops the run and goes on. |
| `stop` | `stop` |  | **JavaScript**: An AbortSignal; aborting its AbortController ends the run, which then answers with the trials it made.<br>**Python**: A tfstudio.Stop whose stop() ends the run, which then answers with the trials it made. |

**Returns**: **JavaScript**: A promise of a MonteCarlo.<br>**Python**: A MonteCarlo.

**Refuses**:

- a design with no layer the trials can change on the side it is scored on, a setting it does not take, a value outside its range, or a design that names a material that resolves to nothing
- Python raises `KeyboardInterrupt`: Ctrl+C during the run, after stopping it

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

How much the merit moves when each layer's thickness is off, as the Layer Sensitivity window ranks the layers: each layer is made thicker and thinner by a step, and the mean change of the merit is its score. The merit here leaves out the MNT and MXT rows.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `step` | `step` | `'nm'` | How the step is given: `'nm'`, `deltaNm` / `delta_nm` for every layer, or `'percent'`, `relPct` / `rel_pct` % of each layer. |
| `deltaNm` | `delta_nm` | `1` | The step, nm, with step `'nm'`. |
| `relPct` | `rel_pct` | `1` | The step, % of each layer, with step `'percent'`. |
| `includeLocked` | `include_locked` | `false` / `False` | `true` / `True` scores the locked layers too. |

**Returns**: A LayerSensitivity.

**Refuses**:

- a design with no merit function, a step other than `'nm'` or `'percent'`, or a value a setting cannot take

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

A copy of the design, which changes apart from it.

**Returns**: A Design.

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

Writes the design to a .tfs file as TFStudio saves it, with the materials it uses that are not built in carried inside the file.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `path` | `path` |  | **JavaScript**: The file to write, by its full path. A relative path is taken from the folder the program was started from: in the Script Console, the folder TFStudio was started from, often its install folder.<br>**Python**: The file to write. A relative path is taken from the program's working folder: in the Script Console, the script's folder, or the data folder for a script not saved. |
| `overwrite` | `overwrite` | `false` / `False` | `true` / `True` writes over a file that is there. |

**Refuses**:

- **JavaScript**: a file that is there, without `overwrite: true`<br>**Python**: a file that is there, without overwrite=True

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
| Not in JavaScript: the console applies `tf.design` when the script ends. | `design.push()` |

Writes the design over the one it was read from in the TFStudio app, as one step the app can undo. Only a design from tf.app.open_design() has one; push again after more changes.

**Refuses**:

- a design that was not read from the app
- Python raises `AppError`: the app refused: with code "edited" when its design changed since it was read or last pushed, "switched" when it is no longer the open one, "off" when the app is closed or not listening for this program

```python
import tfstudio

with tfstudio.TFStudio(live=True) as tf:
    design = tf.app.open_design()
    design.layers[1].thickness += 5
    design.push()
    print("Pushed", design.name)
```

## Substrate

A design's substrate: its material and thickness. Setting either changes the design.

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

The substrate's material, by id.

**Refuses**:

- a material id that resolves to nothing

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

The substrate's thickness, mm.

**Refuses**:

- a thickness of 0 or less

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

**JavaScript**: The layers of one side of a design, numbered as the Design Editor numbers them: 1 is next to the substrate. `layers[n]` is layer n, `layers.length` how many there are, and a for...of loop goes from layer 1 outward. The methods change the design.

**Python**: The layers of one side of a design, numbered as the Design Editor numbers them: 1 is next to the substrate. `layers[n]` is layer n, `len(layers)` how many there are, and a for loop goes from layer 1 outward. The methods change the design.

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

How many layers the side has.

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

The layers from 1, next to the substrate, outward, each a Layer. The layers are the ones the side has when the loop starts.

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

Adds a layer outside the others: the new outermost layer.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `material` | `material` |  | The layer's material, by id. |
| `thickness` | `thickness` |  | The layer's physical thickness, nm. |
| `locked` | `locked` | `false` / `False` | `true` / `True` locks the layer, so that refinement and synthesis leave it as it is. |

**Refuses**:

- a material id that resolves to nothing, a thickness of 0 or less, or a side the design does not let you edit, such as the back of a symmetric design

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

Adds a layer that becomes layer `number`; the layers from that number outward move one out.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `number` | `number` |  | The new layer's number, from 1, next to the substrate, to one more than the side has, which adds it outermost. |
| `material` | `material` |  | The layer's material, by id. |
| `thickness` | `thickness` |  | The layer's physical thickness, nm. |
| `locked` | `locked` | `false` / `False` | `true` / `True` locks the layer. |

**Refuses**:

- a number outside 1 to one more than the side has, a material id that resolves to nothing, a thickness of 0 or less, or a side the design does not let you edit

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

Takes layer `number` out; the layers outside it move one in.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `number` | `number` |  | The layer's number, 1 next to the substrate. |

**Refuses**:

- a number the side has no layer of, or a side the design does not let you edit

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

Layer `number`, a Layer: 1 is next to the substrate.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `number` | `number` |  | The layer's number, from 1 to as many as the side has. |

**Returns**: A Layer.

**Refuses**:

- a number the side has no layer of

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

One layer of a design, by its number on its side: 1 is next to the substrate. Reading an attribute reads the design as it is then, and setting one changes the design, as an edit in the Design Editor does.

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

The layer's number on its side, 1 next to the substrate.

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

The layer's side, `'front'` or `'back'`.

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

The layer's material, by id; set it to change the material.

**Refuses**:

- a material id that resolves to nothing, or a side the design does not let you edit

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

The layer's physical thickness, nm; set it to change the thickness.

**Refuses**:

- a thickness of 0 or less, or a side the design does not let you edit

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

The layer's quarter-wave optical thickness, 4 n d / λ0, with n its material's index at the design's reference wavelength λ0, as the Design Editor's QW column shows it; `null` / `None` for a layer whose material resolves to nothing or has n of 0 or less there, which has no quarter wave. Set it to change the thickness, converted to nm as the QW column converts a value typed in it. A locked layer changes too: a lock holds a layer in refinement and synthesis.

**Refuses**:

- a value of 0 or less, a layer with no quarter wave, or a side the design does not let you edit

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

`true` / `True` for a locked layer, which refinement and synthesis leave as it is; set it to lock or free the layer.

**Refuses**:

- a value other than `true` / `True` or `false` / `False`, or a side the design does not let you edit

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

A design's merit function, as the Merit Function Editor holds it: rows in order, each an operand of the Operand Reference, and the merit they add up to. Reading `value`, `opticalValue` / `optical_value` or `rows` evaluates the design as it is then.

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

Adds a row at the end of the merit function, made as the Merit Function Editor makes one: a field left out takes the value a row added there starts with. `start` and `end` may be left out.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `type` | `type` |  | The operand, such as `'RAV'`, `'TAV'` or `'MNT'`; the Operand Reference says what each computes and which fields it reads. |
| `start` | `start` |  | The wavelength, or the first wavelength of the band, nm; for MNT and MXT the first layer, numbered from the substrate. |
| `end` | `end` |  | The last wavelength of the band, nm; for MNT and MXT the last layer. MNT and MXT cover layers 1 to 1000 when both are left out, so layers a synthesis adds are covered too. |
| `target` | `target` |  | The value the row drives toward, or its bound: R, T and A as fractions of 1 (the editor shows percent), a thickness in nm for MNT and MXT. Without it, the editor's for the operand. |
| `weight` | `weight` | `1` | How much the row counts, 0 or more. |
| `aoi` | `aoi` | `0` | The angle of incidence, degrees in the incident medium. |
| `pol` | `pol` | `'avg'` | `'avg'`, `'s'` or `'p'`. |
| `targetEnd` | `target_end` |  | The target at `end` of a target that slopes from `target` at `start`; `null` / `None` for a flat one. |
| `cmp` | `cmp` |  | For TT and STR, the comparison: `'eq'`, `'le'` or `'ge'`. |
| `flag` | `flag` |  | The editor's Flag column, a whole number; the Operand Reference says what it does on each row. |
| `enabled` | `enabled` | `true` / `True` | `false` / `False` leaves the row out of the merit. |
| `comment` | `comment` |  | The text of a BLNK row. |
| `id` | `id` |  | A name for the row, which a math row names in `refId` / `ref_id`, `refId1` / `ref_id1` or `refId2` / `ref_id2` to read it. Without it, a fresh id, as a row added in the editor gets. |
| `refId` | `ref_id` |  | For a math row that reads one row, that row's id. |
| `refId1` | `ref_id1` |  | For a math row that reads two rows, the first one's id. |
| `refId2` | `ref_id2` |  | For a math row that reads two rows, the second one's id. |

**Refuses**:

- a type this version does not evaluate, a field no row has, a value a field cannot take, or `start` above `end` on a row that reads a band or a layer range
- **JavaScript**: more than `start` and `end` before the options, or the row's type, `start` or `end` among the options<br>**Python**: the row's `start` or `end` among the keyword arguments

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

The types this version evaluates, grouped as the [Operand Reference](/design/operands/) groups them:

| Kind | Types |
| ---- | ----- |
| Single wavelength | `T`, `R`, `A`, `TDB` |
| Band average | `TAV`, `RAV`, `AAV` |
| Spectral target | `TGT`, `RGT`, `AGT` |
| Curves | `MCURVE`, `PPEF` |
| Weighted integral | `TIW`, `RIW`, `AIW` |
| Worst case over a band | `TMN`, `RMN`, `AMN`, `TMX`, `RMX`, `AMX`, `TDBMN`, `TDBMX`, `RDBMX`, `ODMN` |
| Ellipsometry | `PSI`, `DEL`, `TANPSI`, `COSDEL` |
| Phase and dispersion | `PR`, `PT`, `DPR`, `DPT`, `GD`, `GDT`, `GDD`, `GDDT`, `TOD`, `TODT`, `GDFLAT`, `GDTFLAT`, `GDDFLAT`, `GDDTFLAT`, `TODFLAT`, `TODTFLAT` |
| Field | `EFMX` |
| Math on other rows | `OPGT`, `OPLT`, `OPVA`, `ABSO`, `ABGT`, `ABLT`, `DIFF`, `SUMM`, `PROD` |
| Wavelength of a peak or dip | `MXWT`, `MXWR`, `MXWA`, `MNWT`, `MNWR`, `MNWA` |
| Thickness and stress | `TT`, `STR`, `MNT`, `MXT` |
| Table control | `BLNK` |

### clear

| JavaScript | Python |
| ---------- | ------ |
| `design.merit.clear()` | `design.merit.clear()` |

Takes every row out of the merit function.

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

The rows, each a MeritRow with its value for the design as it is now.

**Refuses**:

- a design that names a material that resolves to nothing

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

The merit of the design as it is now, as the Merit Function Editor shows it; `null` / `None` while a row cannot be evaluated.

**Refuses**:

- a design that names a material that resolves to nothing

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

The merit without the manufacturing rows MNT, MXT, TT and STR; `null` / `None` while a row cannot be evaluated.

**Refuses**:

- a design that names a material that resolves to nothing

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

How many rows the merit function has.

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

One row of a design's merit function, with its value for the design as it was when design.merit.rows was read. A field the row does not read is `null` / `None`.

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

The operand, such as `'RAV'` or `'MNT'`.

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

The row's wavelength, or the first wavelength of its band, nm; the first layer for MNT and MXT.

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

The last wavelength of the row's band, nm; the last layer for MNT and MXT.

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

The angle of incidence, degrees in the incident medium.

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

The polarization the row is scored in, `'avg'`, `'s'` or `'p'`; `null` / `None` on a row scored on both, such as PSI.

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

For TT and STR, the comparison: `'eq'`, `'le'` or `'ge'`.

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

The value the row drives toward, or its bound: R, T and A as fractions of 1, a thickness in nm for MNT and MXT.

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

How much the row counts.

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

`false` / `False` for a row left out of the merit.

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

The row's value for the design; NaN for a row that cannot be evaluated.

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

Why the row cannot be evaluated, or `null` / `None`.

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

A design's specification, as the Specification window holds it: pass or fail checks in order, each a requirement on the design, such as R of 0.99 or more over a band, or no more than 30 layers. check() judges the design against them as the window does, and `estimateYield()` / `estimate_yield()` counts the share of Monte Carlo trials that meet them.

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

Adds a check at the end of the specification, made as the Specification window makes a row: a field left out takes the value a row added there starts with, and a thickness budget or layer count given no side adds up the side the design coats. The wavelengths follow the kind: one, `start`, for a check at one wavelength, `start` and `end` for a check over a band, and none for THICKNESS_BUDGET, LAYER_COUNT and PPEF. An INTEGRAL check given a preset takes its band from the preset, so its `start` and `end` may be left out.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `kind` | `kind` |  | What is checked: `'T_AT'`, `'R_AT'` or `'A_AT'` at one wavelength; `'T_AVG'`, `'R_AVG'` or `'A_AVG'`, the average over a band; `'MIN_MAX'`, the lowest or highest value over a band; `'INTEGRAL'`, a weighted average such as Tvis; `'CENTRAL_LAMBDA'`, the wavelength of the band's peak or dip; `'FWHM'`, the width of the peak at `level`; `'EDGE_LAMBDA'`, where the curve crosses `level` of the peak; `'THICKNESS_BUDGET'`, the total thickness; `'LAYER_COUNT'`, the number of layers; `'PPEF'`, the peak-to-peak error against a measured curve. |
| `start` | `start` |  | The wavelength of a check at one wavelength, or the first wavelength of the band, nm. Without it, 550 nm for one wavelength and 400 nm for a band. |
| `end` | `end` |  | The last wavelength of the band, nm, no lower than `start`. Without it, 700 nm. |
| `cmp` | `cmp` | `'ge'` | The comparison: `'ge'` or `'le'` with `target`, `'eq'` within `target` plus or minus `tol`, or `'between'` from `lo` to `hi`. |
| `target` | `target` | `0.99` | The bound, in the check's unit: T, R and A as fractions of 1, where the window shows percent; wavelengths, widths and thicknesses in nm; a layer count as a count; PPEF in dB. |
| `tol` | `tol` |  | The tolerance of `'eq'`, in the check's unit; 0 or less holds the value to the target itself. Without it, 0.01 for T, R and A, 1 nm for a centre or an edge, 2 nm for a width, 10 nm for a thickness, 0 for a layer count, 0.05 dB for PPEF. |
| `lo` | `lo` | `0.95` | The lowest value of `'between'`, in the check's unit. |
| `hi` | `hi` | `1` | The highest value of `'between'`, no lower than `lo`. |
| `aoi` | `aoi` | `0` | The angle of incidence, degrees in the incident medium. |
| `pol` | `pol` | `'avg'` | `'avg'`, `'s'` or `'p'`. |
| `channel` | `channel` | `'T'` | What MIN_MAX, INTEGRAL, CENTRAL_LAMBDA, FWHM and EDGE_LAMBDA read: `'T'`, `'R'` or `'A'`. |
| `direction` | `direction` | `'max'` | For MIN_MAX, CENTRAL_LAMBDA, FWHM and EDGE_LAMBDA: `'max'`, the highest value or a peak, or `'min'`, the lowest value or a dip. |
| `level` | `level` | `0.5` | For FWHM and EDGE_LAMBDA, the level the curve crosses, 0 to 1: with direction `'max'` that fraction of the band's highest value, with `'min'` that fraction of the way from its lowest value up to 1. A level below 0.001 or above 0.999 is taken as 0.001 or 0.999. |
| `edgeSide` | `edge_side` |  | For EDGE_LAMBDA, `'right'` for the crossing above the peak; otherwise the one below it, or the one above where there is none below. |
| `flag` | `flag` |  | The window's Step, `null` / `None` for its default: on T_AVG, R_AVG, A_AVG and INTEGRAL 1 to 4, a grid no coarser than 1, 0.1, 0.01 or 0.001 nm, the default being the design's fringe grid; on FWHM and EDGE_LAMBDA, and on MIN_MAX and CENTRAL_LAMBDA of the highest T or A or the lowest R, 2 to 4, a search at 0.1, 0.01 or 0.001 nm, the default being 1 nm. A check at one wavelength, MIN_MAX and CENTRAL_LAMBDA of the lowest T or A or the highest R, a thickness budget, a layer count and PPEF have no Step, and take `null` / `None`. |
| `side` | `side` |  | For THICKNESS_BUDGET and LAYER_COUNT, the layers added up: `'front'`, `'back'` or `'both'`. Without it, the side the design coats. |
| `presetKey` | `preset_key` | `''` | For INTEGRAL, one of the integral presets Tvis, Rvis, Avis, Tsol, Rsol, Asol, TUV, RUV, TNIR and RNIR, which sets the channel, band, source, detector and `presetLabel` / `preset_label` as picking it in the window does, or `''` for none. |
| `presetLabel` | `preset_label` | `''` | For INTEGRAL, the preset's name as the window shows it. |
| `source` | `source` | `{ id: 'D65' }` | **JavaScript**: For INTEGRAL without a preset, the source: `{ id }`, the id one of D65, D50, A, AM1.5G, E, blackbody (with `T` in K) or custom (with `table`, rows of [nm, value]).<br>**Python**: For INTEGRAL without a preset, the source: {"id": ...}, the id one of D65, D50, A, AM1.5G, E, blackbody (with "T" in K) or custom (with "table", rows of [nm, value]). Without it, {"id": "D65"}. |
| `detector` | `detector` | `{ id: 'photopic' }` | **JavaScript**: For INTEGRAL without a preset, the detector: `{ id }`, the id photopic, flat or custom (with `table`).<br>**Python**: For INTEGRAL without a preset, the detector: {"id": ...}, the id photopic, flat or custom (with "table"). Without it, {"id": "photopic"}. |
| `bandPoints` | `band_points` |  | For INTEGRAL, FWHM and EDGE_LAMBDA, how many points the band is sampled at in place of the default, a whole number of 2 or more; a width or edge scan takes 11 at the least. |
| `curveId` | `curve_id` |  | For PPEF, the id of one of the design's measured curves. |
| `label` | `label` | `''` | The check's label. |
| `enabled` | `enabled` | `true` / `True` | `false` / `False` leaves the check out of the verdict. |

**Refuses**:

- a kind this version does not evaluate, a field no check has, a value its field cannot take, a band whose end is below its start, or a `hi` below `lo`
- **JavaScript**: a wavelength the kind does not read, more than `start` and `end` before the options, or the check's kind, wavelengths or id among the options<br>**Python**: a wavelength the kind does not read, or the check's wavelengths or id among the keyword arguments
- a preset the window does not offer, a field the check gives otherwise than its preset sets it, a PPEF check whose curve is not one of the design's measured curves, or a flag on a check with no Step

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

Takes check `index` out; the checks after it move one up.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `index` | `index` |  | The check's place in the specification, from 0, as in `rows`. |

**Refuses**:

- an index the specification has no check at

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

Takes every check out of the specification.

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

The checks, in order, each a SpecCheck.

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

How many checks the specification has.

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

The design as it is now judged against its specification, as the Specification window judges it: each check read at its own Step, and averaged over the design's cone of incidence when it has one.

**Returns**: A SpecReport.

**Refuses**:

- a design with no check
- a design that names a material that resolves to nothing

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

The share of Monte Carlo trials with random layer errors that meet the specification, as the Monte Carlo window counts its yield: each trial is judged by every enabled check, at the check's own Step, on what the design's `sides` and `scoreOn` / `score_on` say. The trials draw the errors `design.monteCarlo()` / `design.monte_carlo()` draws with the same seed and settings, so the yield is its `spec`; no spread is computed. The design is not changed.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `runs` | `runs` |  | How many trials, a whole number of 1 or more. |
| `thicknessRelPct` | `thickness_rel_pct` | `1` | The thickness error, % of each layer. |
| `thicknessAbsNm` | `thickness_abs_nm` | `0` | A thickness error in nm added to every layer's. |
| `indexRe` | `index_re` | `0` | The error on n, an absolute amount: one standard deviation with `'gaussian'`, a bound with `'uniform'` and `'truncated'`. |
| `indexIm` | `index_im` | `0` | The error on k, an amount as `indexRe` / `index_re` is on n; k does not go below 0. |
| `distribution` | `distribution` | `'gaussian'` | `'gaussian'`, `'uniform'` or `'truncated'` (a bound at three standard deviations). |
| `seed` | `seed` |  | The number the draws start from, a whole number from 1 to 2^32 - 1; the same seed and settings repeat the run. Without it, a fresh one, which the result reports. |
| `progress` | `progress` |  | **JavaScript**: A function called with a Progress (`trial` and `total`) as the trials go. An error it throws ends the run, which then rejects with it.<br>**Python**: A function called with a Progress (trial and total) as the trials go. An exception it raises stops the run and goes on. |
| `stop` | `stop` |  | **JavaScript**: An AbortSignal; aborting its AbortController ends the run, which then answers with the trials it made.<br>**Python**: A tfstudio.Stop whose stop() ends the run, which then answers with the trials it made. |

**Returns**: **JavaScript**: A promise of a Yield.<br>**Python**: A Yield.

**Refuses**:

- a design with no enabled check, or with no layer the trials can change on the side it is scored on
- a setting it does not take, a value outside its range, or a design that names a material that resolves to nothing
- Python raises `KeyboardInterrupt`: Ctrl+C during the run, after stopping it

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

One check of a design's specification, as it was when design.specification.rows was read. Each attribute holds the check's field as the design holds it, `null` / `None` for a field it holds none of; a field the check's kind does not read holds the value it was given, or the one a check added in the Specification window starts with.

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

What the check checks, such as `'R_AVG'` or `'LAYER_COUNT'`; specification.add() lists the kinds.

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

The check's label, `''` when it has none.

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

`false` / `False` for a check left out of the verdict.

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

The comparison: `'ge'`, `'le'`, `'eq'` or `'between'`.

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

The bound of `'ge'` and `'le'`, and the value `'eq'` holds to, in the check's unit: T, R and A as fractions of 1, wavelengths, widths and thicknesses in nm, a layer count as a count, PPEF in dB.

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

The tolerance of `'eq'`, in the check's unit.

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

The lowest value of `'between'`, in the check's unit.

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

The highest value of `'between'`, in the check's unit.

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

The wavelength of a check at one wavelength, T_AT, R_AT or A_AT, nm.

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

The first wavelength of the band a check over a band reads, nm.

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

The last wavelength of the band, nm.

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

The angle of incidence, degrees in the incident medium.

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

The polarization, `'avg'`, `'s'` or `'p'`.

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

What MIN_MAX, INTEGRAL, CENTRAL_LAMBDA, FWHM and EDGE_LAMBDA read: `'T'`, `'R'` or `'A'`.

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

For MIN_MAX, CENTRAL_LAMBDA, FWHM and EDGE_LAMBDA: `'max'`, the highest value or a peak, or `'min'`, the lowest value or a dip.

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

For FWHM and EDGE_LAMBDA, the level the curve crosses, 0 to 1: with direction `'max'` that fraction of the band's highest value, with `'min'` that fraction of the way from its lowest value up to 1.

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

For EDGE_LAMBDA, `'left'` or `'right'`, the crossing below or above the peak; `null` / `None` for the one below it, or the one above where there is none below.

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

The window's Step, or `null` / `None` for its default; specification.add() says what it is on each kind.

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

For THICKNESS_BUDGET and LAYER_COUNT, the layers added up: `'front'`, `'back'` or `'both'`.

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

For INTEGRAL, the integral preset that set its channel, band, source and detector, such as `'Tvis'`, or `''` for none.

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

For INTEGRAL, the preset's name as the window shows it.

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

**JavaScript**: For INTEGRAL, the source the band is weighted by, such as `{ id: 'D65' }`.

**Python**: For INTEGRAL, the source the band is weighted by, such as {"id": "D65"}.

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

**JavaScript**: For INTEGRAL, the detector the band is weighted by, such as `{ id: 'photopic' }`.

**Python**: For INTEGRAL, the detector the band is weighted by, such as {"id": "photopic"}.

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

For INTEGRAL, FWHM and EDGE_LAMBDA, how many points the band is sampled at; `null` / `None` for the default.

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

For PPEF, the id of the measured curve the error is taken against; `null` / `None` on a check of another kind, such as the layer count below.

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

A design judged against its specification, as specification.check() judges it and the Specification window shows it: a CheckResult per check.

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

One CheckResult per check, in the specification's order.

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

`true` / `True` when every enabled check passes and there is one at least.

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

How many enabled checks pass.

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

How many checks are enabled.

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

What the checks were computed on: `'front'` or `'back'`, the coated side alone, or `'total'`, the whole part, as the design's `sides` and `scoreOn` / `score_on` said.

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

One check of a design's specification as specification.check() judged it, as the Specification window shows its row.

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

The check's kind, such as `'R_AVG'`.

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

The check's label, `''` when it has none.

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

The check's value: T, R and A as fractions of 1, wavelengths, widths and thicknesses in nm, PPEF in dB, a layer count as a count; `null` / `None` when there is none, as for a check left out of the verdict.

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

The value's unit: `'fraction'`, `'nm'` or `'dB'`, or `''` for a layer count and for a check left out of the verdict.

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

Whether the value meets the threshold, as the window marks it: `false` / `False` when there is no value, `null` / `None` for a check left out of the verdict.

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

How far the value is from the nearest bound, in its unit: positive by the room left, negative by how far it is out, so `passed` is `true` / `True` exactly when it is 0 or more; `null` / `None` when there is no value. A bound lies half the last digit the window shows past the stated one, so a value the window shows on its bound passes: 0.000005 for a fraction, 0.005 nm, 0.0005 dB, nothing for a layer count.

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

**JavaScript**: The comparison the value is held to, as the check holds it: an object `{ cmp, target, tol, lo, hi }`.

**Python**: The comparison the value is held to, as the check holds it: a named tuple (cmp, target, tol, lo, hi).

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

Why there is no value, or `null` / `None`: `'disabled'`, a check left out of the verdict; `'notComputable'`, a value that came out as no number; `'noCurve'`, a PPEF check whose curve the design does not hold; `'fwhmNotBracketed'` or `'edgeNotCrossed'`, a width or an edge whose crossing is not inside the band; `'unknownKind'`.

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

The yield of Monte Carlo trials with random layer errors against a design's specification, as the Monte Carlo window counts it: the share of the trials that meet every enabled check, each check read at its own Step.

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

The yield: the share of the trials checked that met every enabled check, 0 to 1; `null` / `None` when no trial was checked.

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

How many trials met every enabled check.

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

How many trials were checked: those run, less any whose checks could not be evaluated.

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

The 95 % interval of the yield, `[low, high]`, 0 to 1; `null` / `None` when no trial was checked.

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

**JavaScript**: One object per check of the specification, in its order: `{ label, failRate }`, the check's label, or its kind when it has none, and the share of all the trials run in which it failed. A check left out of the verdict fails in none.

**Python**: One named tuple (label, fail_rate) per check of the specification, in its order: the check's label, or its kind when it has none, and the share of all the trials run in which it failed. A check left out of the verdict fails in none.

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

The trials run: as many as asked, or fewer when the run was stopped.

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

The seed the draws started from: the same seed, design and settings repeat the trials.

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

What the trials scored: `'front'` or `'back'`, the coated side alone, or `'total'`, the whole part, as the design's `sides` and `scoreOn` / `score_on` said.

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

R, T and A of a design over a range of wavelengths, at one angle of incidence or several, as design.spectrum() computes them. `s.R` and the other quantities are at the first angle asked; `s.angle(45)` is the spectrum at another.

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

What the spectrum was computed on, as the design's `sides` and `scoreOn` / `score_on` say: `'front'` or `'back'`, the coated side alone, or `'total'`, the whole part.

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

The wavelengths, nm.

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

The angles of incidence, degrees in the incident medium, in the order they were asked.

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

**JavaScript**: The materials whose data stop inside the range, an array of `{ id, name, rangeNm, heldFlat }`: outside `rangeNm`, `[first, last]` in nm, their n and k are held at the last value (`heldFlat` true) or extrapolated. Empty when every material covers the range.

**Python**: The materials whose data stop inside the range, a list of dicts { id, name, rangeNm, heldFlat }: outside rangeNm, [first, last] in nm, their n and k are held at the last value (heldFlat True) or extrapolated. Empty when every material covers the range.

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

Reflectance for unpolarized light at the first angle, a Curve of fractions of 1, one per wavelength.

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

Transmittance for unpolarized light at the first angle, a Curve of fractions of 1, one per wavelength.

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

Absorptance for unpolarized light at the first angle, a Curve of fractions of 1, one per wavelength.

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

Reflectance for s-polarized light at the first angle, a Curve of fractions of 1, one per wavelength.

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

Reflectance for p-polarized light at the first angle, a Curve of fractions of 1, one per wavelength.

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

Transmittance for s-polarized light at the first angle, a Curve of fractions of 1, one per wavelength.

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

Transmittance for p-polarized light at the first angle, a Curve of fractions of 1, one per wavelength.

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

Absorptance for s-polarized light at the first angle, a Curve of fractions of 1, one per wavelength.

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

Absorptance for p-polarized light at the first angle, a Curve of fractions of 1, one per wavelength.

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

The spectrum at one of the angles it was computed at.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `angle` | `angle` |  | The angle of incidence, degrees in the incident medium. |

**Returns**: A Spectrum of that angle alone.

**Refuses**:

- an angle the spectrum was not computed at

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

Writes the spectrum to a CSV file: a column of wavelengths, then R, T, A, Rs, Rp, Ts, Tp, As and Ap at each angle, as fractions of 1, each headed with its quantity and angle. A file that is there is written over.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `path` | `path` |  | **JavaScript**: The file to write, by its full path. A relative path is taken from the folder the program was started from: in the Script Console, the folder TFStudio was started from, often its install folder.<br>**Python**: The file to write. A relative path is taken from the program's working folder: in the Script Console, the script's folder, or the data folder for a script not saved. |

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

**JavaScript**: One value per wavelength: an array of numbers, so `Math.max(...curve)`, a for loop and the array methods take it as they take any array; map(), filter() and the other methods that make a new array make a plain one.

**Python**: One value per wavelength: a list of floats, so `max(curve)`, `sum(curve)` and plotting libraries take it as they take any list.

mean(), min() and max() summarize it over a band of wavelengths, and `wavelength` holds the wavelength of each value, nm.

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

The wavelength of each value, nm.

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

The mean of the values whose wavelength is from `start` to `end`, both included.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `start` | `start` |  | The first wavelength of the band, nm. Without it, the curve's first. |
| `end` | `end` |  | The last wavelength of the band, nm. Without it, the curve's last. |

**Returns**: The mean; NaN when a value in the band is NaN.

**Refuses**:

- a band no wavelength of the curve is in

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

The lowest value whose wavelength is from `start` to `end`, both included, NaN values left out.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `start` | `start` |  | The first wavelength of the band, nm. Without it, the curve's first. |
| `end` | `end` |  | The last wavelength of the band, nm. Without it, the curve's last. |

**Returns**: The lowest value; `Infinity` / `inf` when every value in the band is NaN.

**Refuses**:

- a band no wavelength of the curve is in

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

The highest value whose wavelength is from `start` to `end`, both included, NaN values left out.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `start` | `start` |  | The first wavelength of the band, nm. Without it, the curve's first. |
| `end` | `end` |  | The last wavelength of the band, nm. Without it, the curve's last. |

**Returns**: The highest value; `-Infinity` / `-inf` when every value in the band is NaN.

**Refuses**:

- a band no wavelength of the curve is in

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

## IndexProfile

The refractive index of a design's layers at one wavelength, laid out by depth, as `design.indexProfile()` / `design.index_profile()` reads it and the Refractive Index Profile window shows it.

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

What it was laid out on: `'front'` or `'back'`, that side alone, or `'total'`, the whole part.

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

The wavelength n and k were read at, nm.

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

**JavaScript**: The medium light comes from, `{ material, n, k }`: the incident medium on the front, the exit medium on the back; null on the whole part, whose profile starts at the front's outer layer.

**Python**: The medium light comes from, a named tuple (material, n, k): the incident medium on the front, the exit medium on the back; None on the whole part, whose profile starts at the front's outer layer.

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

**JavaScript**: The substrate, `{ material, n, k }`; on the whole part also `thickness`, mm, and null when the design gives the substrate no thickness.

**Python**: The substrate, a named tuple (material, n, k, thickness), thickness in mm on the whole part and None on one side; None on the whole part when the design gives the substrate no thickness.

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

**JavaScript**: One object per layer with a thickness, `{ number, material, n, k, thickness, start, end }`: number as design.layers and design.backLayers number it, 1 next to the substrate; material by id; thickness, start and end in nm, start and end the layer's depth from its side's outer surface. On one side the layers run from the outer surface in. On the whole part each also has `side`; the front's come first, from its outer surface in, then the back's from the substrate out, with start and end from the substrate.

**Python**: One named tuple (side, number, material, n, k, thickness, start, end) per layer with a thickness: side the layer's side; number as design.layers and design.back_layers number it, 1 next to the substrate; material by id; thickness, start and end in nm, start and end the layer's depth from its side's outer surface. On one side the layers run from the outer surface in. On the whole part the front's come first, from its outer surface in, then the back's from the substrate out, with start and end from the substrate.

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

The physical thickness of the layers, nm.

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

The optical thickness of the layers, the sum of n times thickness at the wavelength, nm.

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

**JavaScript**: The materials whose data do not reach the wavelength, an array of `{ id, name, rangeNm, heldFlat }`: their n and k there are held at the last value (`heldFlat` true) or extrapolated. Empty when every material covers it.

**Python**: The materials whose data do not reach the wavelength, a list of dicts with id, name, rangeNm and heldFlat: their n and k there are held at the last value (heldFlat True) or extrapolated. Empty when every material covers it.

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

Writes the profile to a CSV file, the table the window exports less the stretch of medium and substrate it draws at each end: a row for each step of n and k with the depth it starts at, `z (nm)`, from the outer surface to the substrate, which the last row gives. On the whole part the columns are `region`, `z`, `n` and `k`, each part's depths counted from its start, the substrate's in mm. A file that is there is written over.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `path` | `path` |  | **JavaScript**: The file to write, by its full path. A relative path is taken from the folder the program was started from: in the Script Console, the folder TFStudio was started from, often its install folder.<br>**Python**: The file to write. A relative path is taken from the program's working folder: in the Script Console, the script's folder, or the data folder for a script not saved. |

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

Each layer's physical and optical thickness, as `design.layerThicknesses()` / `design.layer_thicknesses()` lists them and the Layer Thicknesses window shows them.

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

What was listed: `'front'` or `'back'`, that side's layers, or `'total'`, both sides.

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

The wavelength λ0 the optical thicknesses were taken at, nm.

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

**JavaScript**: One object per layer, from layer 1 next to the substrate outward, `{ number, material, thickness, opticalThickness, qwot, fwot }`: number as design.layers and design.backLayers number it; material by id; thickness, nm; opticalThickness, n times thickness, nm; qwot, 4 n d / λ0, and fwot, n d / λ0, with n the material's index at the wavelength. The three optical values are null for a layer with no material. On both sides each row also has `side`, the front's rows first.

**Python**: One named tuple (side, number, material, thickness, optical_thickness, qwot, fwot) per layer, from layer 1 next to the substrate outward: side the layer's side; number as design.layers and design.back_layers number it; material by id; thickness, nm; optical_thickness, n times thickness, nm; qwot, 4 n d / λ0, and fwot, n d / λ0, with n the material's index at the wavelength. The three optical values are None for a layer with no material. On both sides the front's rows come first.

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

**JavaScript**: The materials whose data do not reach the wavelength, an array of `{ id, name, rangeNm, heldFlat }`, as for an IndexProfile.

**Python**: The materials whose data do not reach the wavelength, a list of dicts with id, name, rangeNm and heldFlat, as for an IndexProfile.

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

**JavaScript**: The admittance locus of one coated side at one wavelength, for s and p, as design.admittance() computes it and the Admittance Diagram window draws it. Complex values are `{ re, im }` in Macleod's sign, the window's: an absorbing material's admittance has a negative imaginary part.

**Python**: The admittance locus of one coated side at one wavelength, for s and p, as design.admittance() computes it and the Admittance Diagram window draws it. Complex values are Python complex numbers in Macleod's sign, the window's: an absorbing material's admittance has a negative imaginary part.

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

The side computed: `'front'` or `'back'`.

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

The wavelength, nm.

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

The angle of incidence, degrees in the medium light comes from.

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

The plane the arcs are in: `'admittance'`, the Y plane, or `'reflection'`, the plane of the reflection coefficient Γ.

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

**JavaScript**: The medium light comes from, `{ material, name }`: the incident medium on the front, the exit medium on the back.

**Python**: The medium light comes from, a named tuple (material, name): the incident medium on the front, the exit medium on the back.

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

**JavaScript**: The substrate, `{ material, name }`.

**Python**: The substrate, a named tuple (material, name).

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

**JavaScript**: The s locus, `{ eta0, etaSubstrate, boundaries, arcs }`: eta0 and etaSubstrate the admittances of the medium and the substrate; boundaries the window's table, one `{ layer, material, name, Y, gamma }` per boundary from the substrate out, layer 0 the bare substrate and then each layer with a thickness by its number as design.layers numbers it, Y the admittance at its outer surface and gamma the reflection coefficient there, the last at the outer surface of the coating; arcs one `{ layer, material, re, im }` per layer with a thickness, from the substrate out, re and im the points the window draws it through, in the plane chosen.

**Python**: The s locus, a named tuple (eta0, eta_substrate, boundaries, arcs): eta0 and eta_substrate the admittances of the medium and the substrate; boundaries the window's table, one named tuple (layer, material, name, Y, gamma) per boundary from the substrate out, layer 0 the bare substrate and then each layer with a thickness by its number as design.layers numbers it, Y the admittance at its outer surface and gamma the reflection coefficient there, the last at the outer surface of the coating; arcs one named tuple (layer, material, re, im) per layer with a thickness, from the substrate out, re and im lists of the points the window draws it through, in the plane chosen.

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

The p locus, as for `s`.

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

**JavaScript**: The materials of the side computed whose data do not reach the wavelength, an array of `{ id, name, rangeNm, heldFlat }`: their n and k there are held at the last value (`heldFlat` true) or extrapolated. Empty when every material covers it.

**Python**: The materials of the side computed whose data do not reach the wavelength, a list of dicts with id, name, rangeNm and heldFlat: their n and k there are held at the last value (heldFlat True) or extrapolated. Empty when every material covers it.

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

**JavaScript**: Writes the loci to a CSV file as the window's Copy CSV writes its table with both polarizations shown: for s and then p, a row for the substrate, one for each layer from the substrate out and one for the medium light comes from, with Re(Y), Im(Y), Re(Γ) and Im(Γ). A file that is there is written over.

**Python**: Writes the loci to a CSV file as the window's Copy CSV writes its table with both polarizations shown: for s and then p, a row for the substrate, one for each layer from the substrate out and one for the medium light comes from, with Re(Y), Im(Y), Re(Γ) and Im(Γ). The numbers are the window's, written in Python's float notation. A file that is there is written over.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `path` | `path` |  | **JavaScript**: The file to write, by its full path. A relative path is taken from the folder the program was started from: in the Script Console, the folder TFStudio was started from, often its install folder.<br>**Python**: The file to write. A relative path is taken from the program's working folder: in the Script Console, the script's folder, or the data folder for a script not saved. |

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

The electric field through one coated side at one wavelength, for s, p and unpolarized light, as `design.electricField()` / `design.electric_field()` computes it and the Electric Field window draws it.

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

The side computed: `'front'` or `'back'`.

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

The wavelength the field was computed at, nm.

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

The angle of incidence, degrees in the medium light comes from.

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

The wavelength λ0 the depth was read at, nm.

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

The unit `depth` is in: `'nm'`, `'OT'`, `'QWOT'` or `'FWOT'`; `'nm'` where an optical unit was asked for and a material has no index at the reference wavelength.

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

The samples taken across each layer.

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

**JavaScript**: The depth of each sample from the outer surface, nm, an array: the first at the surface, the last at the substrate.

**Python**: The depth of each sample from the outer surface, nm, a list: the first at the surface, the last at the substrate.

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

**JavaScript**: The depth of each sample in `depthUnit`, an array.

**Python**: The depth of each sample in depth_unit, a list.

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

**JavaScript**: One object per layer with a thickness, in the order light meets them, `{ number, material, start, end, depthStart, depthEnd }`: number as design.layers and design.backLayers number it; material by id; start and end its depth from the outer surface in nm, depthStart and depthEnd in `depthUnit`.

**Python**: One named tuple (number, material, start, end, depth_start, depth_end) per layer with a thickness, in the order light meets them: number as design.layers and design.back_layers number it; material by id; start and end its depth from the outer surface in nm, depth_start and depth_end in depth_unit.

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

**JavaScript**: The s field, `{ e2, e2Tangential, e2Normal, amplitude }`, one value per sample: |E|² of the whole field and of its components along and normal to the layers, as fractions of the incident |E|², and the whole field's amplitude in V/m for 1 W/m² incident.

**Python**: The s field, a named tuple (e2, e2_tangential, e2_normal, amplitude) of lists, one value per sample: |E|² of the whole field and of its components along and normal to the layers, as fractions of the incident |E|², and the whole field's amplitude in V/m for 1 W/m² incident.

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

The p field, as for `s`.

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

The unpolarized field, the mean of the s and p fields sample by sample, as for `s`.

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

The incident beam's amplitude in V/m for 1 W/m², from the index of the medium light comes from: |E|² of 1 reads this amplitude.

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

**JavaScript**: The materials of the side computed whose data do not reach the wavelength, an array of `{ id, name, rangeNm, heldFlat }`, as for an Admittance.

**Python**: The materials of the side computed whose data do not reach the wavelength, a list of dicts with id, name, rangeNm and heldFlat, as for an Admittance.

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

**JavaScript**: Writes the field to a CSV file as the window's Copy CSV writes its table with its factory display: a row per sample with the depth in `depthUnit` and the amplitude of the whole field in V/m for 1 W/m², for avg, s and p. A file that is there is written over.

**Python**: Writes the field to a CSV file as the window's Copy CSV writes its table with its factory display: a row per sample with the depth in depth_unit and the amplitude of the whole field in V/m for 1 W/m², for avg, s and p. The numbers are the window's, written in Python's float notation. A file that is there is written over.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `path` | `path` |  | **JavaScript**: The file to write, by its full path. A relative path is taken from the folder the program was started from: in the Script Console, the folder TFStudio was started from, often its install folder.<br>**Python**: The file to write. A relative path is taken from the program's working folder: in the Script Console, the script's folder, or the data folder for a script not saved. |

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

The CIE colour of a design's reflectance or transmittance, as design.color() computes it and the Color Evaluation window shows it: the tristimulus values on the 380-780 nm band under one illuminant, the colour spaces, the dominant wavelength, the correlated colour temperature and the sRGB swatch.

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

The sides computed: `'front'`, `'back'` or `'total'`, the whole part.

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

What is coloured: `'R'` or `'T'`.

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

The angle of incidence, degrees in the incident medium.

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

The polarization: `'avg'`, `'s'` or `'p'`.

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

The CIE standard observer, by its field in degrees: `2` or `10`.

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

The CIE illuminant: `'D65'`, `'D50'`, `'A'` or `'E'`.

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

The wavelength step of the spectrum the colour is integrated on, nm.

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

The tristimulus X, on the scale where the white's Y is 100.

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

The tristimulus Y: the luminous reflectance or transmittance, %.

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

The tristimulus Z, on the scale where the white's Y is 100.

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

The chromaticity x.

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

The chromaticity y.

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

**JavaScript**: The illuminant's white, `{ X, Y, Z }` with Y 100: R or T of 1, integrated on the same grid.

**Python**: The illuminant's white, a named tuple (X, Y, Z) with Y 100: R or T of 1, integrated on the same grid.

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

**JavaScript**: The white's chromaticity, `{ x, y }`.

**Python**: The white's chromaticity, a named tuple (x, y).

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

**JavaScript**: CIE L*a*b*, `{ L, a, b, C, h }`, the hue angle h in degrees.

**Python**: CIE L*a*b*, a named tuple (L, a, b, C, h), the hue angle h in degrees.

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

**JavaScript**: CIE L*u*v*, `{ L, u, v, C, h, s }`, the hue angle h in degrees and s the saturation.

**Python**: CIE L*u*v*, a named tuple (L, u, v, C, h, s), the hue angle h in degrees and s the saturation.

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

**JavaScript**: The CIE 1976 UCS chromaticity, `{ u, v }`: u′ and v′.

**Python**: The CIE 1976 UCS chromaticity, a named tuple (u, v): u′ and v′.

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

**JavaScript**: The CIE 1960 UCS chromaticity, `{ u, v }`.

**Python**: The CIE 1960 UCS chromaticity, a named tuple (u, v).

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

**JavaScript**: Hunter Lab, `{ L, a, b }`.

**Python**: Hunter Lab, a named tuple (L, a, b).

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

**JavaScript**: `{ wavelength, complementary, purity }`: the dominant wavelength in nm, or for a purple null and its complementary wavelength in nm; purity the excitation purity as a fraction of 1, measured to the purple line for a purple. Both wavelengths are null for the white itself.

**Python**: A named tuple (wavelength, complementary, purity): the dominant wavelength in nm, or for a purple None and its complementary wavelength in nm; purity the excitation purity as a fraction of 1, measured to the purple line for a purple. Both wavelengths are None for the white itself.

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

**JavaScript**: The correlated colour temperature, K, by McCamy's formula on the 2 degree chromaticity whatever the observer; NaN outside the 1000 K to 1e6 K it covers, or more than 0.05 from the Planckian locus.

**Python**: The correlated colour temperature, K, by McCamy's formula on the 2 degree chromaticity whatever the observer; nan outside the 1000 K to 1e6 K it covers, or more than 0.05 from the Planckian locus.

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

**JavaScript**: The distance from the Planckian locus in CIE 1960 u, v, positive above it; NaN outside the range McCamy's formula covers.

**Python**: The distance from the Planckian locus in CIE 1960 u, v, positive above it; nan outside the range McCamy's formula covers.

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

**JavaScript**: The window's swatch, `{ r, g, b }`, each 0 to 255: sRGB at an exposure of 1, adapted from the illuminant's white to D65.

**Python**: The window's swatch, a named tuple (r, g, b), each 0 to 255: sRGB at an exposure of 1, adapted from the illuminant's white to D65.

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

**JavaScript**: The materials of the sides computed whose data stop inside 380-780 nm, an array of `{ id, name, rangeNm, heldFlat }`: outside `rangeNm` their n and k are held at the last value (`heldFlat` true) or extrapolated. Empty when every material covers the band.

**Python**: The materials of the sides computed whose data stop inside 380-780 nm, a list of dicts with id, name, rangeNm and heldFlat: outside rangeNm their n and k are held at the last value (heldFlat True) or extrapolated. Empty when every material covers the band.

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

**JavaScript**: A design's weighted averages of T, R and A, as design.integrals() computes them and the Integral Values window lists them: the built-in rows, Tvis to RNIR, and then the rows of your own, each read by its key with get().

**Python**: A design's weighted averages of T, R and A, as design.integrals() computes them and the Integral Values window lists them: the built-in rows, Tvis to RNIR, and then the rows of your own, each read by its key with [].

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

The sides computed: `'front'`, `'back'` or `'total'`, the whole part.

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

The first wavelength of the spectrum, nm.

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

The last wavelength of the spectrum, nm.

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

The wavelength step, nm.

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

The angle of incidence, degrees in the incident medium.

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

The polarization: `'avg'`, `'s'` or `'p'`.

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

**JavaScript**: The rows, the built-in ones first as the window lists them, then yours, each `{ key, quantity, value, min, minAt, max, maxAt, band, covered, spectrumSpan }`: `quantity` `'T'`, `'R'` or `'A'`; `value` the weighted average and `min` and `max` the lowest and highest value over the band, fractions of 1; `minAt` and `maxAt` their wavelengths, nm; `band` the band integrated, `[start, end]` in nm; `covered` whether the spectrum spans the band, its numbers NaN when it does not or when the weighting is 0 over the whole band; `spectrumSpan` the spectrum's first and last wavelength, nm.

**Python**: The rows, the built-in ones first as the window lists them, then yours, each a named tuple (key, quantity, value, min, min_at, max, max_at, band, covered, spectrum_span): quantity "T", "R" or "A"; value the weighted average and min and max the lowest and highest value over the band, fractions of 1; min_at and max_at their wavelengths, nm; band the band integrated, (start, end) in nm; covered whether the spectrum spans the band, its numbers nan when it does not or when the weighting is 0 over the whole band; spectrum_span the spectrum's first and last wavelength, nm.

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

The row of the integral named `key`, as `rows` gives it.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `key` | `key` |  | The row's key: Tvis, Rvis, Avis, Tsol, Rsol, Asol, TUV, RUV, TNIR, RNIR, or the key of a row of your own. |

**Returns**: The row.

**Refuses**:

- a key no row has

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

**JavaScript**: The materials of the sides computed whose data stop inside the range, an array of `{ id, name, rangeNm, heldFlat }`: outside `rangeNm` their n and k are held at the last value (`heldFlat` true) or extrapolated. Empty when every material covers it.

**Python**: The materials of the sides computed whose data stop inside the range, a list of dicts with id, name, rangeNm and heldFlat: outside rangeNm their n and k are held at the last value (heldFlat True) or extrapolated. Empty when every material covers it.

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

**JavaScript**: Writes the rows to a CSV file as the window's English export writes its table: Integral, Value, %, Min, Min λ (nm), Max, Max λ (nm) and Band, with each row named by its key, which for the built-in rows is the window's own name, and an empty cell where a row has no value. A file that is there is written over.

**Python**: Writes the rows to a CSV file as the window's English export writes its table: Integral, Value, %, Min, Min λ (nm), Max, Max λ (nm) and Band, with each row named by its key, which for the built-in rows is the window's own name, and an empty cell where a row has no value. The numbers are the window's, written in Python's float notation. A file that is there is written over.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `path` | `path` |  | **JavaScript**: The file to write, by its full path. A relative path is taken from the folder the program was started from: in the Script Console, the folder TFStudio was started from, often its install folder.<br>**Python**: The file to write. A relative path is taken from the program's working folder: in the Script Console, the script's folder, or the data folder for a script not saved. |

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

Ψ and Δ of one coated side, as design.ellipsometry() computes them against wavelength, at one angle of incidence or several, or `design.ellipsometryVsAngle()` / `design.ellipsometry_vs_angle()` against angle at one wavelength. Against wavelength, `e.psi` and `e.delta` are Curves at the first angle asked and `e.angle(70)` is the sweep at another; against angle, they are AngleCurves.

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

The side computed: `'front'` or `'back'`.

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

Against wavelength, the wavelengths, nm; against angle, the one wavelength, nm.

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

The angles of incidence, degrees in the medium light comes from: against wavelength, those asked, in the order asked; against angle, the angles swept.

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

The sign of Δ: `'azzam'`, the Azzam-Bashara sign an ellipsometer writes, or `'reversed'`, 360 degrees minus that.

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

Ψ, degrees from 0 to 90, where tan Ψ is |r_p| / |r_s|: against wavelength a Curve at the first angle, against angle an AngleCurve.

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

Δ, degrees from 0 up to 360, the phase of r_p / r_s in the convention `deltaConvention` / `delta_convention` names: against wavelength a Curve at the first angle, against angle an AngleCurve.

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

**JavaScript**: The materials of the side computed whose data stop inside the range, or do not reach the one wavelength of a sweep against angle, an array of `{ id, name, rangeNm, heldFlat }`: outside `rangeNm` their n and k are held at the last value (`heldFlat` true) or extrapolated. Empty when every material covers it.

**Python**: The materials of the side computed whose data stop inside the range, or do not reach the one wavelength of a sweep against angle, a list of dicts with id, name, rangeNm and heldFlat: outside rangeNm their n and k are held at the last value (heldFlat True) or extrapolated. Empty when every material covers it.

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

The sweep against wavelength at one of the angles it was computed at.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `angle` | `angle` |  | The angle of incidence, degrees. |

**Returns**: An Ellipsometry of that angle alone.

**Refuses**:

- an angle the sweep was not computed at, or a sweep against angle

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

**JavaScript**: Writes Ψ and Δ to a CSV file as the window's export writes its table: a column of wavelengths, λ (nm), or of angles, AOI (°), then Ψ (°) and Δ (°). Against wavelength at more than one angle, Ψ and Δ come for each angle in turn, each headed with its angle. A file that is there is written over.

**Python**: Writes Ψ and Δ to a CSV file as the window's export writes its table: a column of wavelengths, λ (nm), or of angles, AOI (°), then Ψ (°) and Δ (°). Against wavelength at more than one angle, Ψ and Δ come for each angle in turn, each headed with its angle. The numbers are the window's, written in Python's float notation. A file that is there is written over.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `path` | `path` |  | **JavaScript**: The file to write, by its full path. A relative path is taken from the folder the program was started from: in the Script Console, the folder TFStudio was started from, often its install folder.<br>**Python**: The file to write. A relative path is taken from the program's working folder: in the Script Console, the script's folder, or the data folder for a script not saved. |

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

**JavaScript**: One value per angle of incidence: an array of numbers, so `Math.max(...curve)`, a for loop and the array methods take it as they take any array; map(), filter() and the other methods that make a new array make a plain one.

**Python**: One value per angle of incidence: a list of floats, so `max(curve)`, `sum(curve)` and plotting libraries take it as they take any list.

mean(), min() and max() summarize it over a range of angles, and `angle` holds the angle of each value, degrees in the medium light comes from.

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

The mean of the values whose angle is from `start` to `end`, both included.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `start` | `start` |  | The first angle of the range, degrees. Without it, the curve's first. |
| `end` | `end` |  | The last angle of the range, degrees. Without it, the curve's last. |

**Returns**: The mean; NaN when a value in the range is NaN.

**Refuses**:

- a range no angle of the curve is in

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

The lowest value whose angle is from `start` to `end`, both included, NaN values left out.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `start` | `start` |  | The first angle of the range, degrees. Without it, the curve's first. |
| `end` | `end` |  | The last angle of the range, degrees. Without it, the curve's last. |

**Returns**: The lowest value; `Infinity` / `inf` when every value in the range is NaN.

**Refuses**:

- a range no angle of the curve is in

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

The highest value whose angle is from `start` to `end`, both included, NaN values left out.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `start` | `start` |  | The first angle of the range, degrees. Without it, the curve's first. |
| `end` | `end` |  | The last angle of the range, degrees. Without it, the curve's last. |

**Returns**: The highest value; `-Infinity` / `-inf` when every value in the range is NaN.

**Refuses**:

- a range no angle of the curve is in

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

The angle of incidence of each value, degrees.

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

## RunResult

How a refinement or a synthesis ended. The run has already left its answer in the design it was made on: the new layers when it finished, the layers as they were when it was stopped.

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

`true` / `True` when the run ended on its own, `false` / `False` when it was stopped or could not run.

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

Why the run ended: such as `'target'`, `'maxiter'`, `'stalled'` or `'stopped'` for a refinement, `'maxLayers'` or `'needleOptimal'` for Needle. The API Reference lists them under refine and synthesize.

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

The merit at the end, as the run's window shows it, or `null` / `None` when the run has no answer.

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

The merit at the end without the manufacturing rows MNT, MXT, TT and STR, or `null` / `None` where the run does not report it.

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

The merit at the start: refinement; `null` / `None` otherwise.

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

The iterations a refinement took, or the generations a Structural synthesis ran; `null` / `None` for the other runs.

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

The seed the run's random draws started from: the same seed, design and settings repeat the run. `null` / `None` for a run that draws none.

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

What the run scored: `'front'` or `'back'`, the coated side alone, or `'total'`, the whole part, as the design's `sides` and `scoreOn` / `score_on` said.

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

Everything the run answered, by name, such as `geSteps`, the forced steps of a Gradual Evolution run, or `reheats`, the restarts of a Structural deep search.

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

What a run has reported so far, given to the function passed as `progress` each time the run reports. An attribute the run has not reported, or does not report, is `null` / `None`.

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

The merit the run reports now: of the layers it is on (refinement), or of the design it goes on from (synthesis).

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

The best merit so far, where the run reports one.

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

The merit without the manufacturing rows MNT, MXT, TT and STR, where the run reports it.

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

The iteration under way: refinement, and Structural synthesis.

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

The last generation the run accepted: Needle, Gradual Evolution and Structural synthesis.

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

The layers of the design the run goes on from: synthesis.

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

The refinement method under way, such as `'dls'`, for a refinement that tries several.

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

The seed the run's random draws start from, once the run has started; `null` / `None` for a run that draws none.

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

The trials made so far: Monte Carlo.

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

The trials the run makes: Monte Carlo.

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

**JavaScript**: What a synthesis is doing, an object such as `{ id: 'scanning' }`, or null.

**Python**: What a synthesis is doing, a dict such as {"id": "scanning"}, or None.

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

Everything the run has reported so far, by name, such as `design`, the layers the run is on.

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

Monte Carlo trials of a design with random layer errors, as `design.monteCarlo()` / `design.monte_carlo()` runs them: the spread of one quantity over a range of wavelengths. Each spread is a Curve of fractions of 1.

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

The wavelengths, nm.

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

The quantity for the design without errors, a Curve.

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

The mean over the trials, a Curve.

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

The standard deviation over the trials, a Curve.

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

The mean less one standard deviation, 0 at the least, a Curve.

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

The mean plus one standard deviation, 1 at the most, a Curve.

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

The lowest value over the trials, a Curve.

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

The highest value over the trials, a Curve.

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

The trials made: as many as asked, or fewer when the run was stopped.

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

The quantity, `'R'`, `'T'` or `'A'`.

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

The seed the draws started from: the same seed and settings repeat the run.

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

With the design's specification, the share of the trials that meet it, a Yield, as `specification.estimateYield()` / `specification.estimate_yield()` counts it; `null` / `None` for a design without one.

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

What the trials scored: `'front'` or `'back'`, the coated side alone, or `'total'`, the whole part, as the design's `sides` and `scoreOn` / `score_on` said.

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

How much the merit moves when each layer's thickness is off, as `design.layerSensitivity()` / `design.layer_sensitivity()` ranks the layers.

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

One SensitivityRow per layer scored, the front's first.

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

The merit of the design as it is, without the MNT and MXT rows.

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

What was scored: `'front'` or `'back'`, the coated side alone, or `'total'`, the whole part, as the design's `sides` and `scoreOn` / `score_on` said.

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

One layer of a layer sensitivity ranking.

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

The layer's side, `'front'` or `'back'`.

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

The layer's number on its side, 1 next to the substrate, as design.layers and `design.backLayers` / `design.back_layers` number it.

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

The layer's material, by id.

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

The layer's thickness, nm.

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

The thickness step the layer was made thicker and thinner by, nm.

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

The mean change of the merit over the two steps.

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

The same change, positive when the thicker layer costs more and negative when the thinner one does.

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

The layer's score as a share of the highest, 0 to 100.

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

`true` / `True` for a locked layer.

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

What design.clean() did to the design, as the Design Cleaner window lists its operations: the layers it took out and those it merged into a neighbour.

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

How many layers were taken out.

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

How many layers were merged into a neighbour.

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

**JavaScript**: One object per operation, in the order they were made, the front's first: `{ side, kind, number, material, thickness, mergedInto }`. kind is `'remove'` or `'merge'`; number the layer's number on its side before the cleanup, 1 next to the substrate, as design.layers and design.backLayers numbered it then; material its material, by id; thickness, nm, for a layer taken out its thickness then, which counts any layer merged into it before, and for a merge what it adds to the layer it is merged into; mergedInto, for a merge, the number of that layer, numbered as number is, and null for a layer taken out.

**Python**: One named tuple (side, kind, number, material, thickness, merged_into) per operation, in the order they were made, the front's first. kind is "remove" or "merge"; number the layer's number on its side before the cleanup, 1 next to the substrate, as design.layers and design.back_layers numbered it then; material its material, by id; thickness, nm, for a layer taken out its thickness then, which counts any layer merged into it before, and for a merge what it adds to the layer it is merged into; merged_into, for a merge, the number of that layer, numbered as number is, and None for a layer taken out.

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

The materials of TFStudio's catalogs: the built-in ones and those of the catalogs in the data folder.

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

The material with this id, or else with this name. A built-in material's id may be given as `builtin:TiO2`, as a layer's material can hold it.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `idOrName` | `id_or_name` |  | The material's id, or its name. |

**Returns**: A Material.

**Refuses**:

- no material with this id or name, or several with this name and none with this id

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

The materials whose id or name holds `text`, in upper or lower case.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `text` | `text` | `''` | The text to look for; empty finds every material. |

**Returns**: The materials found, each a Material.

```js
for (const m of tf.materials.find('TiO2')) console.log(m.id, m.catalog);
```

```python
for m in tf.materials.find("TiO2"):
    print(m.id, m.catalog)
```

## Material

A material of TFStudio's catalogs, as tf.materials gives it.

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

The id designs name the material by: a built-in material's short id, such as `TiO2`, which can differ from its name, such as `TiO2 (anatase)`; or `catalog:key` for a material of another catalog. A design may also hold a built-in material as `builtin:TiO2`, the form the Design Editor and stack() write, which tf.materials takes too.

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

The name the app shows.

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

The catalog the material is in, `'builtin'` for a built-in one.

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

n and k of the material, as the Material Dispersion window shows them; outside the range its data cover they are held at the edge value or extrapolated.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `wavelengths` | `wavelengths` |  | One wavelength, nm, or several. |

**Returns**: **JavaScript**: `[n, k]` for one wavelength; for several, `[ns, ks]`, an array of n and an array of k, one of each per wavelength.<br>**Python**: (n, k) for one wavelength; for several, (ns, ks), a list of n and a list of k, one of each per wavelength.

**Refuses**:

- a wavelength of 0 or less

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

A Stop button for runs. Give it to a run as `stop=`, and `stop()` ends the run at its next step, as the Stop button of the run's window does: a refinement or synthesis then leaves the design as it was, and a Monte Carlo run answers with the trials it made.

One Stop can be given to several runs, on one TFStudio() or on several, and stop() ends them all. stop() may be called from any thread, from the run's progress function, or before the run starts, which then ends at once. Once stopped, a Stop stays stopped: make a new one for the next run.

JavaScript has no Stop: a run is stopped with an AbortController. Give its `signal` as the run's `stop` option, and its `abort()` ends the run at its next step, as `stop()` does in Python.

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

True once stop() has been called.

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

Ends the runs this Stop is given to, at their next step, and every run it is given to later, at once.

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

The TFStudio app that is open, for a TFStudio() started with live=True, while the app listens for programs: click Interactive on its Optimization tab first. The app's window then waits for the program until Terminate is clicked there, and names it as this Python's executable, python.exe on Windows. Terminate lets the program go: the app then refuses it with "off", even while it listens for programs, until Interactive is clicked again. A design read here is changed as any design is, and design.push() writes it back as one step the app can undo.

Not in JavaScript: a script in the Script Console works on the open design itself, `tf.design`, which the console applies when the script ends.

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

The designs the app holds.

**Returns**: A list of AppDesign.

**Refuses**:

- a TFStudio() started without live=True
- Python raises `AppError`: the app cannot be reached, with code "off" when it is closed or not listening for this program, "denied" when Deny was clicked there for this program

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

A copy of a design the app holds, to change and push() back.

| Python | Default | Meaning |
| ------ | ------- | ------- |
| `design` |  | The design's id or name, or an AppDesign from designs(). Without it, the design open in the app. |

**Returns**: A Design.

**Refuses**:

- a TFStudio() started without live=True, an id or name the app holds no design of, or a name several designs have
- Python raises `AppError`: the app cannot be reached, or holds no design

```python
import tfstudio

with tfstudio.TFStudio(live=True) as tf:
    design = tf.app.open_design()
    print("The open design:", design.name, len(design.layers), "layers")
    last = tf.app.open_design(tf.app.designs()[-1].name)
    print("By name:", last.name)
```

## AppDesign

A design open in the TFStudio app, as tf.app.designs() lists it.

Not in JavaScript: tf.app lists these, and a script in the Script Console has the open design alone.

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

The design's id in the app, which tf.app.open_design() takes.

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

The design's name.

```python
import tfstudio

with tfstudio.TFStudio(live=True) as tf:
    print([d.name for d in tf.app.designs()])
```

### folder

| Python |
| ------ |
| `d.folder` |

The project folder the design is in, as the Project Explorer shows it, or None.

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

True for the design open in the app now, the only one push() can write.

```python
import tfstudio

with tfstudio.TFStudio(live=True) as tf:
    print([d.name for d in tf.app.designs() if d.active])
```

### unsaved

| Python |
| ------ |
| `d.unsaved` |

True when the design has changes not saved to its file.

```python
import tfstudio

with tfstudio.TFStudio(live=True) as tf:
    print([d.name for d in tf.app.designs() if d.unsaved])
```

### layer_count

| Python |
| ------ |
| `d.layer_count` |

How many layers the design's front has.

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

How many layers the design's back has.

```python
import tfstudio

with tfstudio.TFStudio(live=True) as tf:
    for d in tf.app.designs():
        print(d.name, d.back_layer_count)
```

## Errors

A refusal in JavaScript throws an Error whose message says what was refused, starting with the method's name; catch it with try and catch. Python raises one of the errors below.

```js
const design = tf.newDesign('Bare BK7');
try {
    design.layers.append('SiO2', -5);
} catch (err) {
    console.log(err.message);
}
```

### TFStudioError

A call TFStudio refused, with a message saying why in the package's names: it starts with the name of the method called, such as "refine: ", or, for an attribute that was set, names the attribute. A refusal of no one call, such as of a material id that resolves to nothing, says what was wrong alone.

```python
import tfstudio

design = tf.new_design("Bare BK7")
try:
    design.layers.append("SiO2", -5)
except tfstudio.TFStudioError as err:
    print(err)
```

### AppError

A call to the app (tf.app) refused, with `code` saying why: 'off', 'timeout', 'protocol', 'denied', 'edited', 'switched', 'optimizing', 'noDesign', 'unknown' or 'invalid'.

```python
import tfstudio

try:
    with tfstudio.TFStudio(live=True) as tf:
        print(tf.app.open_design().name)
except tfstudio.AppError as err:
    print(err.code, err)
```

### ServerError

TFStudio could not be found or started, or the TFStudio serving the calls ended or was closed. When it ended on its own, the message ends with the last lines it wrote to its log.

```python
import tfstudio

try:
    tfstudio.TFStudio("no TFStudio here")
except tfstudio.ServerError as err:
    print(err)
```
