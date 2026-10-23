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

Each result says what it was computed on in its `mode`: [Spectrum](#spectrum-1), [RunResult](#runresult), [MonteCarlo](#montecarlo) and [LayerSensitivity](#layersensitivity).

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

Methods that change a design change it in place: stack(), the layer edits, refine() and synthesize(). copy() keeps a copy first.

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
| `innerEngine` | `inner_engine` | `'cg'` | The method that refines the stack after each insertion. One of cg, dls, newton, newton-cg, sqp, trust-region. |
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
- **JavaScript**: more than `start` and `end` before the options

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

**JavaScript**: With the design's specification, the share of trials that meet it: an object `{ yield, passCount, evaluated, yieldInterval }`, `yieldInterval` the 95 % interval of the share; null for a design without one.

**Python**: With the design's specification, the share of trials that meet it: a dict { yield, passCount, evaluated, yieldInterval }, yieldInterval the 95 % interval of the share; None for a design without one.

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
