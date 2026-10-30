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

Each result says what it was computed on in its `mode`: [SpecReport](#specreport), [Yield](#yield), [Spectrum](#spectrum-1), [IndexProfile](#indexprofile), [LayerThicknesses](#layerthicknesses), [Admittance](#admittance-1), [ElectricField](#electricfield), [Color](#color-1), [Integrals](#integrals-1), [Ellipsometry](#ellipsometry-1), [GroupDelay](#groupdelay), [Pulse](#pulse-1), [Inhomogeneities](#inhomogeneities-1), [Roughness](#roughness-1), [Stress](#stress-1), [RunResult](#runresult), [MonteCarlo](#montecarlo) and [LayerSensitivity](#layersensitivity).

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

**JavaScript**: What starting TFStudio found, an object: `wasm`, `true` when the WebAssembly kernel loaded, `dataDir`, the data folder whose catalogs it read, or null, and `unreadable`, the catalog files it could not read.

**Python**: What the TFStudio serving this program said as it started, a dict: version, wasm (whether the WebAssembly kernel loaded), dataDir (the data folder, or None), unreadable (catalogs it could not read) and live.

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

### readSpectrumFile / read_spectrum_file

| JavaScript | Python |
| ---------- | ------ |
| `tf.readSpectrumFile(path, { angle, pol, quantity, scale, xUnit })` | `tf.read_spectrum_file(path, angle=..., pol=..., quantity=..., scale=..., x_unit=...)` |

**JavaScript**: Reads a spectrum file as the Measured Spectra window's import reads it: a CSV or text table, one curve per column after the wavelength column, or a JCAMP-DX file, one curve per spectrum, each what the window would add to a design. The options take the place of the import panel's settings, which ask only what the file leaves unsaid: an angle or a polarization the file states, in its header lines or in a column's heading, is kept, as in the window.

**Python**: Reads a spectrum file as the Measured Spectra window's import reads it: a CSV or text table, one curve per column after the wavelength column, or a JCAMP-DX file, one curve per spectrum, each what the window would add to a design. The keywords take the place of the import panel's settings, which ask only what the file leaves unsaid: an angle or a polarization the file states, in its header lines or in a column's heading, is kept, as in the window.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `path` | `path` |  | **JavaScript**: The file, by its full path. A relative path is taken as `openDesign` takes it.<br>**Python**: The file. A relative path is taken as open_design() takes it. |
| `angle` | `angle` |  | **JavaScript**: The angle of incidence, degrees, for the curves whose file states none; 0 where neither does.<br>**Python**: The angle of incidence, degrees, for the curves whose file states none. Without it, 0 where neither does. |
| `pol` | `pol` |  | **JavaScript**: `'avg'`, `'s'` or `'p'`, for the curves whose file states none; `'avg'` where neither does. A column headed with its polarization, such as Rs, keeps it, and an A column headed with none is `'avg'`.<br>**Python**: "avg", "s" or "p", for the curves whose file states none. Without it, "avg" where neither does. A column headed with its polarization, such as Rs, keeps it, and an A column headed with none is "avg". |
| `quantity` | `quantity` |  | **JavaScript**: For a table, `'T'`, `'R'` or `'A'` for every column; without it, what each column's heading says, and T where it says none.<br>**Python**: For a table, "T", "R" or "A" for every column. Without it, what each column's heading says, and T where it says none. |
| `scale` | `scale` |  | **JavaScript**: For a table, how every column's values are written: `'fraction'`, `'percent'` or `'absorbance'`; without it, what the import makes of each column.<br>**Python**: For a table, how every column's values are written: "fraction", "percent" or "absorbance". Without it, what the import makes of each column. |
| `xUnit` | `x_unit` |  | **JavaScript**: For a table, the unit of its wavelength column: `'nm'`, `'um'`, `'cm-1'` or `'eV'`; without it, what the import makes of it.<br>**Python**: For a table, the unit of its wavelength column: "nm", "um", "cm-1" or "eV". Without it, what the import makes of it. |

**Returns**: **JavaScript**: An object: `format`, `'table'` or `'jcamp'`; `fileName`; `xUnit`, the unit a table's wavelengths were read in, or null; `skippedRows`, lines of a table that held no row; and `curves`, each `{ name, quantity, angle, pol, wavelength, values }`, the wavelengths in nm rising and R, T and A as fractions of 1, which `design.compareMeasured()` takes.<br>**Python**: A SpectrumFile, a named tuple: format, "table" or "jcamp"; file_name; x_unit, the unit a table's wavelengths were read in, or None; skipped_rows, lines of a table that held no row; and curves, each a MeasuredCurve, a named tuple of name, quantity, angle, pol, wavelength and values, the wavelengths in nm rising and R, T and A as fractions of 1, which design.compare_measured() takes.

**Refuses**:

- a file that cannot be read or holds no spectrum the import reads, an option it does not take or a value an option cannot take, or for a JCAMP-DX file an option other than angle and pol

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

**JavaScript**: Reads an ellipsometer file as the Measured Ellipsometry window's import reads it: a table of a wavelength column and columns of Ψ and Δ in degrees, each column typed as the window types it, the curves the window's Add all adds. The options take the place of the import panel's settings: an angle the file states, in its header lines or in a column's heading, is kept, as in the window, and the side its header states fills the panel, which `side` replaces.

**Python**: Reads an ellipsometer file as the Measured Ellipsometry window's import reads it: a table of a wavelength column and columns of Psi and Delta in degrees, each column typed as the window types it, the curves the window's Add all adds. The keywords take the place of the import panel's settings: an angle the file states, in its header lines or in a column's heading, is kept, as in the window, and the side its header states fills the panel, which side replaces.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `path` | `path` |  | **JavaScript**: The file, by its full path. A relative path is taken as `openDesign` takes it.<br>**Python**: The file. A relative path is taken as open_design() takes it. |
| `angle` | `angle` |  | **JavaScript**: The angle of incidence, degrees, for the columns whose file states none; 70 where neither does.<br>**Python**: The angle of incidence, degrees, for the columns whose file states none. Without it, 70 where neither does. |
| `side` | `side` |  | **JavaScript**: `'front'` or `'back'`, the side measured; without it, the side the file's header states, or `'front'`.<br>**Python**: "front" or "back", the side measured. Without it, the side the file's header states, or "front". |
| `deltaConvention` | `delta_convention` | `'azzam'` | **JavaScript**: The sign the file writes Δ in: `'azzam'` or `'reversed'`, 360 degrees less it.<br>**Python**: The sign the file writes Delta in: "azzam" or "reversed", 360 degrees less it. |
| `xUnit` | `x_unit` |  | **JavaScript**: The unit of the wavelength column: `'nm'`, `'um'`, `'cm-1'` or `'eV'`; without it, what the import makes of it.<br>**Python**: The unit of the wavelength column: "nm", "um", "cm-1" or "eV". Without it, what the import makes of it. |
| `quantities` | `quantities` |  | Each column's type, in the file's order: `'PSI'`, `'DEL'`, or `null` / `None` for the type the import gives it; a column with no type is left out. |

**Returns**: **JavaScript**: An object: `fileName`; `xUnit`, the unit the wavelengths were read in; `skippedRows`, lines that held no row; and `curves`, each `{ name, quantity, angle, side, deltaConvention, cosDelta, wavelength, values }`: quantity `'PSI'` or `'DEL'`, deltaConvention null for Ψ, cosDelta true for a Δ that looks like cos Δ, the wavelengths in nm rising and the values in degrees, which `design.addMeasuredCurves()` and `design.compareMeasured()` take.<br>**Python**: An EllipsometryFile, a named tuple: file_name; x_unit, the unit the wavelengths were read in; skipped_rows, lines that held no row; and curves, each an EllipsometryCurve, a named tuple of name, quantity ("PSI" or "DEL"), angle, side, delta_convention (None for Psi), cos_delta (True for a Delta that looks like cos Delta), wavelength and values, the wavelengths in nm rising and the values in degrees, which design.add_measured_curves() and design.compare_measured() take.

**Refuses**:

- a file that cannot be read or holds no table of numbers, an option it does not take or a value an option cannot take

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

**JavaScript**: Writes measured curves a design holds to a file as the Export tab writes them: Measured Spectra's for R, T and A, as CSV, its condition lines above the columns, or as JCAMP-DX; Measured Ellipsometry's for Ψ and Δ, as CSV in degrees. Without options, the window's factory format: CSV, nm, R, T and A in percent.

**Python**: Writes measured curves a design holds to a file as the Export tab writes them: Measured Spectra's for R, T and A, as CSV, its condition lines above the columns, or as JCAMP-DX; Measured Ellipsometry's for Psi and Delta, as CSV in degrees. Without keywords, the window's factory format: CSV, nm, R, T and A in percent.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `design` | `design` |  | The design, a Design. |
| `path` | `path` |  | **JavaScript**: The file to write, by its full path. A relative path is taken as `openDesign` takes it.<br>**Python**: The file to write. A relative path is taken as open_design() takes it. |
| `curves` | `curves` |  | **JavaScript**: The names of the curves written, all R, T and A or all Ψ and Δ. Without it, every R, T and A curve the design holds, or its Ψ and Δ when it holds none.<br>**Python**: The names of the curves written, all R, T and A or all Psi and Delta. Without it, every R, T and A curve the design holds, or its Psi and Delta when it holds none. |
| `format` | `format` | `'csv'` | `'csv'`, or `'jcamp'` for JCAMP-DX, which R, T and A take. |
| `xUnit` | `x_unit` | `'nm'` | **JavaScript**: The unit of the wavelength column: `'nm'`, `'um'` or `'cm-1'` for R, T and A, `'nm'`, `'um'` or `'eV'` for Ψ and Δ.<br>**Python**: The unit of the wavelength column: "nm", "um" or "cm-1" for R, T and A, "nm", "um" or "eV" for Psi and Delta. |
| `scale` | `scale` | `'percent'` | For R, T and A, `'percent'` or `'fraction'`. |
| `overwrite` | `overwrite` | `false` / `False` | **JavaScript**: Write over a file that is already there.<br>**Python**: True writes over a file that is already there. |

**Refuses**:

- a design that is not a Design or holds no measured curve, a name of a curve it does not hold, curves of both kinds, an option it does not take or a value an option cannot take, or a file that is already there, without `overwrite`

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

**JavaScript**: Writes one side of a design to a Zemax OpticStudio COATING.DAT file as the Zemax Coatings window's Export tab writes it: a MATE record for each material, n and k sampled every `step` nm from `start` to `end` and written in µm with the imaginary index as -k, then one COAT record of the side's layers, from the incident medium side. The back is written from the exit medium to the substrate, so on either face the file means air to glass.

**Python**: Writes one side of a design to a Zemax OpticStudio COATING.DAT file as the Zemax Coatings window's Export tab writes it: a MATE record for each material, n and k sampled every step nm from start to end and written in um with the imaginary index as -k, then one COAT record of the side's layers, from the incident medium side. The back is written from the exit medium to the substrate, so on either face the file means air to glass.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `design` | `design` |  | The design, a Design. |
| `path` | `path` |  | **JavaScript**: The file to write, by its full path. A relative path is taken as `openDesign` takes it.<br>**Python**: The file to write. A relative path is taken as open_design() takes it. |
| `name` | `name` | `'TFSTUDIO_DESIGN'` | The name of the COAT record, written in capitals, every character but letters, digits, `_` and `.` as `_`, and cut to 32 characters. |
| `thickness` | `thickness` | `'absolute'` | **JavaScript**: `'absolute'`, each layer's physical thickness in µm; or `'relative'`, its optical thickness in waves of `wavelength`.<br>**Python**: "absolute", each layer's physical thickness in um; or "relative", its optical thickness in waves of wavelength. |
| `wavelength` | `wavelength` | `550` | **JavaScript**: λ₀, nm, for relative thicknesses.<br>**Python**: The reference wavelength, nm, for relative thicknesses. |
| `start` | `start` | `400` | The first wavelength of the MATE records, nm. |
| `end` | `end` | `800` | The last wavelength of the MATE records, nm, above `start`. |
| `step` | `step` | `25` | The step of the MATE records, nm. |
| `scope` | `scope` | `'used'` | `'used'`, the materials the design uses, its media and substrate included; or `'all'`, every material of the catalogs here as well. |
| `side` | `side` |  | **JavaScript**: `'front'` or `'back'`; without it, the front, or the back of a design coated on the back alone.<br>**Python**: "front" or "back". Without it, the front, or the back of a design coated on the back alone. |
| `overwrite` | `overwrite` | `false` / `False` | **JavaScript**: Write over a file that is already there.<br>**Python**: True writes over a file that is already there. |

**Refuses**:

- a design that is not a Design, a side with no layers, an option it does not take or a value an option cannot take, a start and end that are not a range, a file that is already there, without `overwrite`, or a design that names a material that resolves to nothing

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

Reads a Zemax OpticStudio COATING.DAT file as the Zemax Coatings window lists it: its MATE records, as the Materials tab lists them, and its coatings, as the Coatings tab lists them, a relative thickness given in nm at `wavelength`. Nothing is written to a catalog.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `path` | `path` |  | **JavaScript**: The file, by its full path. A relative path is taken as `openDesign` takes it.<br>**Python**: The file. A relative path is taken as open_design() takes it. |
| `wavelength` | `wavelength` | `550` | **JavaScript**: λ₀, nm, at which a thickness the file gives in waves is converted to nm.<br>**Python**: The wavelength, nm, at which a thickness the file gives in waves is converted to nm. |

**Returns**: **JavaScript**: An object: `fileName`; `materials`, each MATE record `{ name, repeat, importedAs, wavelength, n, k }`, repeat `{ index, count }` for a name the file defines more than once and null otherwise, importedAs the name an import gives it, wavelengths in nm rising and k 0 or more; and `coatings`, each COAT `{ name, type, layers }`, type `'stack'` for a stack of layers, the only kind that imports, or `'ideal'`, `'table'` or `'encrypted'`, and layers null but for a stack, each `{ material, thickness, fileThickness, mode }`, thickness in nm (null for a relative thickness whose material the file gives no index for), fileThickness as the file writes it, mode `'absolute'` or `'relative'`.<br>**Python**: A ZemaxCoatingFile, a named tuple: file_name; materials, each a ZemaxMaterial, a named tuple of name, repeat (for a name the file defines more than once, a dict of index and count from 1; else None), imported_as (the name an import gives it), wavelength (nm, rising), n and k (0 or more); and coatings, each a ZemaxCoating, a named tuple of name, type ("stack", the only kind that imports, or "ideal", "table" or "encrypted") and layers, None but for a stack, each a ZemaxLayer, a named tuple of material, thickness (nm; None for a relative thickness whose material the file gives no index for), file_thickness (as the file writes it) and mode ("absolute" or "relative").

**Refuses**:

- **JavaScript**: a file that cannot be read or holds neither a MATE record nor a coating, an option it does not take or a value an option cannot take<br>**Python**: a file that cannot be read or holds neither a MATE record nor a coating, or a value wavelength cannot take

```js
const file = require('path').join(require('os').homedir(), `COATING-${Date.now()}.DAT`);
require('fs').writeFileSync(file, 'MATE MGF2\n0.4 1.39 0\n0.8 1.38 0\nMATE AL2O3\n0.4 1.68 0\n0.8 1.66 0\nCOAT AR\nMGF2 0.25 0\nAL2O3 0.25 0\n');
const read = tf.readZemaxCoating(file);
for (const layer of read.coatings[0].layers) console.log(layer.material, layer.thickness.toFixed(2), 'nm');
```

```python
import time

name = "COATING-{}.DAT".format(time.time_ns())
with open(name, "w") as f:
    f.write("MATE MGF2\n0.4 1.39 0\n0.8 1.38 0\nMATE AL2O3\n0.4 1.68 0\n0.8 1.66 0\nCOAT AR\nMGF2 0.25 0\nAL2O3 0.25 0\n")
for layer in tf.read_zemax_coating(name).coatings[0].layers:
    print(layer.material, round(layer.thickness, 2), "nm")
```

### saveCodevCoating / save_codev_coating

| JavaScript | Python |
| ---------- | ------ |
| `tf.saveCodevCoating(design, path, { title, saveName, start, end, step, angles, wavelength, side, overwrite })` | `tf.save_codev_coating(design, path, title=..., save_name=..., start=400, end=800, step=10, angles=[0], wavelength=..., side=..., overwrite=False)` |

Writes one side of a design to a CODE V .seq command file as the CODE V Coatings window's Export tab writes it: the commands that enter the stack in the MULTILAYER option, thicknesses in nm from the incident medium side, layers of zero thickness left out, a MIC table of each material's n and k at up to 21 of the analysis wavelengths, and SAV, which has CODE V save it as a .mul. The back is written from the exit medium to the substrate.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `design` | `design` |  | The design, a Design. |
| `path` | `path` |  | **JavaScript**: The file to write, by its full path. A relative path is taken as `openDesign` takes it.<br>**Python**: The file to write. A relative path is taken as open_design() takes it. |
| `title` | `title` |  | **JavaScript**: TIT, the stack's title, cut to 80 characters, single quotes left out; without it, the design's name.<br>**Python**: TIT, the stack's title, cut to 80 characters, single quotes left out. Without it, the design's name. |
| `saveName` | `save_name` |  | **JavaScript**: The name SAV saves the .mul under, each run of characters but letters, digits, `_` and `-` written as one `_`; without it, the design's name.<br>**Python**: The name SAV saves the .mul under, each run of characters but letters, digits, _ and - written as one _. Without it, the design's name. |
| `start` | `start` | `400` | The first analysis wavelength, nm. |
| `end` | `end` | `800` | The last analysis wavelength, nm, above `start`. |
| `step` | `step` | `10` | The step of the analysis wavelengths, nm; CODE V takes 100 of them at most. |
| `angles` | `angles` | `[0]` | ANG, the angles of incidence in degrees, 0 or more and below 90; CODE V takes 5 at most. |
| `wavelength` | `wavelength` |  | **JavaScript**: REF, the reference wavelength, nm; without it, the design's reference wavelength.<br>**Python**: REF, the reference wavelength, nm. Without it, the design's reference wavelength. |
| `side` | `side` |  | **JavaScript**: `'front'` or `'back'`; without it, the front, or the back of a design coated on the back alone.<br>**Python**: "front" or "back". Without it, the front, or the back of a design coated on the back alone. |
| `overwrite` | `overwrite` | `false` / `False` | **JavaScript**: Write over a file that is already there.<br>**Python**: True writes over a file that is already there. |

**Returns**: What the writer noted, as the window lists it under the text: a material sampled on fewer wavelengths than it has, or an absorbing medium written without its k.

**Refuses**:

- a design that is not a Design, a side with no layers, a stack past a limit of the MUL option (1000 layers, 100 wavelengths, 5 angles), an option it does not take or a value an option cannot take, a start and end that are not a range, a file that is already there, without `overwrite`, or a design that names a material that resolves to nothing

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

Reads a CODE V coating file, a .seq command file or a .mul CODE V saved, as the CODE V Coatings window's Import tab shows it: what the stack sets around its layers, and its layers from the incident medium side, a thickness the file gives in waves of REF given in nm. Nothing is written to a catalog.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `path` | `path` |  | **JavaScript**: The file, by its full path; a name ending in .mul is read as a saved .mul, any other as commands. A relative path is taken as `openDesign` takes it.<br>**Python**: The file; a name ending in .mul is read as a saved .mul, any other as commands. A relative path is taken as open_design() takes it. |

**Returns**: **JavaScript**: An object: `fileName`; `title`; `reference`, REF in nm; `wavelengths`, the analysis wavelengths in nm; `angles`, in degrees; `incident` and `substrate`, each `{ label, n, k }`, a MIC material by its label with n and k null, or a constant index with label null; `layers`, each `{ index, thickness, code, locked }`, index as for `incident`, thickness in nm, code its COA code (100 frozen, 0 free, 1 to 99 coupled) and locked whether it is 100; and `warnings`, what the reader noted.<br>**Python**: A CodevCoatingFile, a named tuple: file_name; title; reference, REF in nm; wavelengths, the analysis wavelengths in nm; angles, in degrees; incident and substrate, each a CodevIndex, a named tuple of label, n and k, a MIC material by its label with n and k None, or a constant index with label None; layers, each a CodevLayer, a named tuple of index (a CodevIndex), thickness (nm), code (its COA code: 100 frozen, 0 free, 1 to 99 coupled) and locked (whether the code is 100); and warnings, what the reader noted.

**Refuses**:

- a file that cannot be read, or that does not enter a stack the reader can read, with what stopped it

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

### stressTemperature / stress_temperature

| JavaScript | Python |
| ---------- | ------ |
| `design.stressTemperature` | `design.stress_temperature` |
| `design.stressTemperature = value` | `design.stress_temperature = value` |

The temperature the Stress window evaluates the part at, °C, or `null` / `None` when it is not set. While only the deposition temperature is set it reads 20 °C; with neither set, each film carries its intrinsic stress alone. Setting it to `null` / `None` unsets it.

**Refuses**:

- a temperature of -273.15 °C or less

```js
const design = tf.newDesign('Mirror');
design.stressTemperature = 60;
console.log(design.stressTemperature, '°C');
```

```python
design = tf.new_design("Mirror")
design.stress_temperature = 60
print(design.stress_temperature, "°C")
```

### depositionTemperature / deposition_temperature

| JavaScript | Python |
| ---------- | ------ |
| `design.depositionTemperature` | `design.deposition_temperature` |
| `design.depositionTemperature = value` | `design.deposition_temperature = value` |

The temperature the films were deposited at, °C, or `null` / `None` when it is not set. While only the other temperature is set it reads 20 °C. Setting it to `null` / `None` unsets it.

**Refuses**:

- a temperature of -273.15 °C or less

```js
const design = tf.newDesign('Mirror');
design.depositionTemperature = 250;
console.log(design.depositionTemperature, '°C');
```

```python
design = tf.new_design("Mirror")
design.deposition_temperature = 250
print(design.deposition_temperature, "°C")
```

### substrate

| JavaScript | Python |
| ---------- | ------ |
| `design.substrate` | `design.substrate` |

The substrate: its material, thickness and diameter, a Substrate.

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

### scaleThicknesses / scale_thicknesses

| JavaScript | Python |
| ---------- | ------ |
| `design.scaleThicknesses(factor, { side })` | `design.scale_thicknesses(factor, side=...)` |

Makes every unlocked layer of one side thicker or thinner by one factor. Locked layers stay as they are, and a symmetric design's back follows its front.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `factor` | `factor` |  | What each thickness is multiplied by, above 0: 1.02 makes every unlocked layer 2% thicker. |
| `side` | `side` |  | `'front'` or `'back'`. Without it, the front, or the back of a design coated on the back alone. |

**Refuses**:

- **JavaScript**: a factor that is not a number above 0, an option scaleThicknesses does not take, a side other than `'front'` or `'back'`, or a side the design does not let you edit, such as the back of a symmetric design<br>**Python**: a factor that is not a number above 0, a side other than "front" or "back", or a side the design does not let you edit, such as the back of a symmetric design

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

Rounds the unlocked layers of one side as the Design Editor's Round / quantize dialog does: to a number of decimal places of a nm, to the nearest whole number of controller steps, or to the nearest whole number of a QWOT increment at the reference wavelength. Locked layers stay as they are, and a symmetric design's back follows its front. A layer thinner than half a step rounds to 0 nm, as in the dialog; in `'qwot'` mode a layer whose material has no quarter wave stays as it is.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `mode` | `mode` | `'step'` | `'decimals'`, `'step'` (a controller step in nm) or `'qwot'` (a QWOT increment). |
| `value` | `value` |  | The number of decimal places, from 0 to 8, the step in nm, or the QWOT increment, as the mode takes. Without it, what the dialog opens with: 2 places, 0.1 nm or 1 QWOT. |
| `side` | `side` |  | `'front'` or `'back'`. Without it, the front, or the back of a design coated on the back alone. |

**Refuses**:

- **JavaScript**: an option quantize does not take, a mode other than `'decimals'`, `'step'` or `'qwot'`, a value the mode does not take, a side other than `'front'` or `'back'`, or a side the design does not let you edit<br>**Python**: a mode other than "decimals", "step" or "qwot", a value the mode does not take, a side other than "front" or "back", or a side the design does not let you edit

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

Gives the unlocked layers of one side random thickness errors, as the Design Editor's Perturb dialog does: each thickness is multiplied by 1 + k · percent / 100, with k drawn for each layer uniformly from -1 to 1. Locked layers stay as they are, and a symmetric design's back follows its front. The same seed, design and percent give the same errors.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `percent` | `percent` | `2` | The largest error, ± % of each thickness, above 0 and up to 100. |
| `side` | `side` |  | `'front'` or `'back'`. Without it, the front, or the back of a design coated on the back alone. |
| `seed` | `seed` |  | **JavaScript**: The number the draws start from, a whole number from 1 to 2^32 - 1. Without it, or with null, a fresh one.<br>**Python**: The number the draws start from, a whole number from 1 to 2^32 - 1. Without it, a fresh one. |

**Returns**: The seed the draws started from.

**Refuses**:

- **JavaScript**: a percent that is not above 0 and up to 100, an option perturb does not take, a seed that is not a whole number from 1 to 2^32 - 1, a side other than `'front'` or `'back'`, or a side the design does not let you edit<br>**Python**: a percent that is not above 0 and up to 100, a seed that is not a whole number from 1 to 2^32 - 1, a side other than "front" or "back", or a side the design does not let you edit

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

Copies the front's layers onto the back, as the Design Editor's Copy to back does: the back gets the same stack outward from the substrate, and its own layers are replaced. `sides` stays as it was, so set it to `'both'` to coat both.

**Refuses**:

- a front the design does not let you edit, on a design coated on the back alone and scored on that side

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

Copies the back's layers onto the front, as the Design Editor's Copy to front does: the front gets the same stack outward from the substrate, and its own layers are replaced. `sides` stays as it was.

**Refuses**:

- a back the design does not let you edit: the back of a symmetric design, or of a design coated on the front alone and scored on that side

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

What differs between this design and `other`: their setup and their layers, compared side by side by number from the substrate, so a layer added near the substrate shows every layer outside it as changed. Values are compared exactly. The name, merit rows, specification checks, the cone of incidence and the materials a design carries are not compared.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `other` | `other` |  | The Design compared with this one. |

**Returns**: **JavaScript**: An object: `same`, true when nothing compared differs; `setup`, each setting that differs as `{ setting, before, after }`, setting by this object's name (`'incidentMedium'`, `'exitMedium'`, `'substrate.material'`, `'substrate.thickness'`, `'reference'`, `'sides'`, `'scoreOn'`, `'stressTemperature'`, `'depositionTemperature'` or `'substrate.diameter'`), before its value here and after in `other`; `layers`, each layer that differs, the front's first, as `{ side, number, before, after, change }`, before and after `{ material, thickness, locked }` or null where that design has no layer of the number, change after's thickness less before's in nm, or null.<br>**Python**: A named tuple Differences: same, True when nothing compared differs; setup, each setting that differs as a SetupChange (setting, before, after), setting by the package's name ("incident_medium", "exit_medium", "substrate.material", "substrate.thickness", "reference", "sides", "score_on", "stress_temperature", "deposition_temperature" or "substrate.diameter"), before its value here and after in other; layers, each layer that differs, the front's first, as a LayerChange (side, number, before, after, change), before and after a LayerState (material, thickness, locked) or None where that design has no layer of the number, change after's thickness less before's in nm, or None.

**Refuses**:

- an other that is not a Design

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

**JavaScript**: The periods of a non-polarizing edge filter, as the Edge Filter window searches them: the five-layer period (aA bB cA bB aA), or (aB bA cB bA aB), whose s and p zone edges meet at the edge wavelength at the angle of incidence, a, b and c quarter waves at the edge wavelength, best first: the widest rejection band, then the widest pass region. At 0° the search gives the quarter-wave period both ways round, with c null. A and B are taken as lossless, at their real indices at the edge wavelength. Without options, the window's opening settings on this design.

**Python**: The periods of a non-polarizing edge filter, as the Edge Filter window searches them: the five-layer period (aA bB cA bB aA), or (aB bA cB bA aB), whose s and p zone edges meet at the edge wavelength at the angle of incidence, a, b and c quarter waves at the edge wavelength, best first: the widest rejection band, then the widest pass region. At 0° the search gives the quarter-wave period both ways round, with c None. A and B are taken as lossless, at their real indices at the edge wavelength. Without keywords, the window's opening settings on this design.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `pass` | `pass_` | `'short'` | `'short'`, a shortwave pass, or `'long'`, a longwave pass. |
| `edge` | `edge` |  | The edge wavelength, nm. Without it, the design's reference wavelength. |
| `angle` | `angle` | `0` | The angle of incidence, degrees in the incident medium, 0 up to but not including 90. |
| `a` | `a` |  | Material A, by id. Without it, the lowest index of the front layers, or SiO2 when the front has fewer than two materials. |
| `b` | `b` |  | Material B, by id. Without it, the highest index of the front layers, or TiO2. |
| `incident` | `incident` |  | The medium the light arrives from, by id. Without it, the design's incident medium. |
| `lower` | `lower` | `0.1` | The first a searched, quarter waves, from 0. |
| `upper` | `upper` | `1` | The last a searched, quarter waves, above lower and up to 2. |
| `step` | `step` | `0.05` | The step of a, 0.0001 or more; at an angle above 0 the finest step over the widest range takes minutes. |
| `periods` | `periods` | `10` | The number of periods each solution's formula repeats. |

**Returns**: **JavaScript**: An object: `pass`, `edge` (nm), `angle`; `materials` and `indices`, each `{ a, b, incident }`, the ids searched and their real indices at the edge; `absorbing`, the ids of A and B with k above 0 there; `periods`; and `solutions`, best first, each `{ outer, a, b, c, sigma, zoneS, zoneP, passWidth, formula }`: outer `'A'` or `'B'`, the material of the outer and centre layers; a, b and c in quarter waves; sigma, N11 at the edge, +1 or -1; zoneS and zoneP the widths of the s and p zones and passWidth that of the pass region, nm, Infinity where it does not end; formula, the filter as Stack Formula writes it, H the higher index of A and B.<br>**Python**: An EdgeFilter, a named tuple: pass_, edge (nm), angle; materials and indices, each a dict of a, b and incident, the ids searched and their real indices at the edge; absorbing, the ids of A and B with k above 0 there; periods; and solutions, best first, each an EdgeSolution: outer, "A" or "B", the material of the outer and centre layers; a, b and c in quarter waves; sigma, N11 at the edge, +1 or -1; zone_s and zone_p the widths of the s and p zones and pass_width that of the pass region, nm, inf where it does not end; formula, the filter as Stack Formula writes it, H the higher index of A and B.

**Refuses**:

- an option it does not take or a value an option cannot take, a material id that resolves to nothing, a material with no index at the edge wavelength, A and B of one index there, or a material past its critical angle

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

**JavaScript**: Puts an edge filter in, as the Edge Filter window's Replace or Append puts the period it lists in: the search is edgeFilter()'s with the same options, and the solution chosen is built through Stack Formula with each pair of touching outer layers joined into one. Replace puts the filter in place of the side's layers, makes the edge wavelength the reference wavelength, and makes the medium searched the incident medium of a front filter or the exit medium of a back one; Append adds the layers outside the side's own. Filling the side a one-sided design does not coat makes it coated on both when its other side has layers, and on the filled side alone when it has none, as the window does.

**Python**: Puts an edge filter in, as the Edge Filter window's Replace or Append puts the period it lists in: the search is edge_filter()'s with the same keywords, and the solution chosen is built through Stack Formula with each pair of touching outer layers joined into one. Replace puts the filter in place of the side's layers, makes the edge wavelength the reference wavelength, and makes the medium searched the incident medium of a front filter or the exit medium of a back one; Append adds the layers outside the side's own. Filling the side a one-sided design does not coat makes it coated on both when its other side has layers, and on the filled side alone when it has none, as the window does. It takes edge_filter()'s keywords too, which give the search.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `options` |  |  | **JavaScript**: edgeFilter()'s options, and these. |
| `solution` | `solution` | `0` | Which solution, its place in `edgeFilter()'s` / `edge_filter()'s` list, from 0, the best. |
| `side` | `side` |  | `'front'` or `'back'`. Without it, the front, or the back of a design coated on the back alone. A symmetric design takes the front. |
| `mode` | `mode` | `'replace'` | `'replace'` or `'append'`. |

**Refuses**:

- **JavaScript**: what edgeFilter() throws, a solution that is not in the list, a side other than `'front'` or `'back'`, the back of a symmetric design, or a mode other than `'replace'` or `'append'`<br>**Python**: what edge_filter() raises, a solution that is not in the list, a side other than "front" or "back", the back of a symmetric design, or a mode other than "replace" or "append"

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

Where a thin layer of each material would lower the merit, as the Needle Manual window's Compute P-function finds it: the slope of the optical merit against the thickness of a needle of each pool material put in at each interface of one side's layers and at points inside each layer. A negative gradient is a place where a needle lowers the merit. The scan scores the enabled merit rows less the MNT, MXT and PPEF rows, as the window does.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `pool` | `pool` |  | **JavaScript**: The materials a needle may be, by id: one or more, none twice.<br>**Python**: The materials a needle may be, a list of ids: one or more, none twice. |
| `side` | `side` |  | `'front'` or `'back'`. Without it, the front, or the back of a design coated on the back alone. A side the window does not scan is refused: the back of a symmetric design, or the uncoated side of a one-sided design. |
| `step` | `step` | `0.5` | The probe needle's thickness, nm, 0.05 or more, over which a slope with no exact formula is differenced: the window's Probe δ. |
| `intraSamples` | `intra_samples` | `16` | Points inside each layer, a whole number from 2 to 60: the window's Profile pts / layer. |

**Returns**: **JavaScript**: An object: `mode`, the side scanned; `mf0`, the optical merit of the design as the scan scores it, null when there is no candidate; and `candidates`, in the scan's order, none when the window would call the design needle-optimal, each `{ material, kind, layer, position, fraction, depth, gradient }`: kind `'gap'` or `'inside'`; layer, for `'inside'`, the number of the layer split, 1 next to the substrate, else null; position, for `'gap'`, how many layers lie between the gap and the substrate, else null; fraction, for `'inside'`, where the layer is split, from the side light reaches first (the incident medium on the front, the substrate on the back), else null; depth in nm from that same side; gradient, the slope of the optical merit per nm. The needle becomes layer `position + 1` or `layer + 1`.<br>**Python**: A NeedleProfile, a named tuple: mode, the side scanned; mf0, the optical merit of the design as the scan scores it, None when there is no candidate; and candidates, in the scan's order, none when the window would call the design needle-optimal, each a NeedleCandidate: material; kind, "gap" or "inside"; layer, for "inside", the number of the layer split, 1 next to the substrate, else None; position, for "gap", how many layers lie between the gap and the substrate, else None; fraction, for "inside", where the layer is split, from the side light reaches first (the incident medium on the front, the substrate on the back), else None; depth in nm from that same side; gradient, the slope of the optical merit per nm. The needle becomes layer position + 1 or layer + 1.

**Refuses**:

- **JavaScript**: an option it does not take or a value an option cannot take, a side the window does not scan, a design with no merit row the scan scores, or a pool material id that resolves to nothing<br>**Python**: a value an argument cannot take, a side the window does not scan, a design with no merit row the scan scores, or a pool material id that resolves to nothing

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

Puts one needle in, as the Needle Manual window's Apply puts in the candidate picked from its profile: a layer of the candidate's material at its gap, or splitting its layer in two at its fraction. A symmetric design's back follows its front. Without `thickness` the needle starts where the window starts it: at the thickness between 1 and 60 nm where golden-section search finds the optical merit lowest, or at 1 nm when no thickness there beats it.

**JavaScript**: To do what Apply does with Refine after insert, add an MNT row at 1 nm, the window's minimum thickness, and refine with sqp: `design.merit.add('MNT', { target: 1 })`, then `await design.refine({ method: 'sqp', maxIter: 80 })`. The layers end on the thicknesses the window's refine gives.

**Python**: To do what Apply does with Refine after insert, add an MNT row at 1 nm, the window's minimum thickness, and refine with sqp: design.merit.add("MNT", target=1), then design.refine(method="sqp", max_iter=80). The layers end on the thicknesses the window's refine gives.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `candidate` | `candidate` |  | **JavaScript**: A candidate from needleProfile() on this design and side.<br>**Python**: A NeedleCandidate from needle_profile() on this design and side, or a dict of its fields. |
| `thickness` | `thickness` |  | The needle's thickness, nm, from 1 to 200 at a gap and from 1 to the split layer's thickness less 1 inside one (at least 2): the window's slider range. Without it, the window's starting thickness. |
| `side` | `side` |  | `needleProfile()'s` / `needle_profile()'s` side. |

**Refuses**:

- **JavaScript**: an option it does not take, a side needleProfile() refuses, a thickness outside the window's range there, a candidate this design and side do not have, or, without a thickness, a design with no merit row the scan scores<br>**Python**: a side needle_profile() refuses, a thickness outside the window's range there, a candidate this design and side do not have, or, without a thickness, a design with no merit row the scan scores

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

### edgeShift / edge_shift

| JavaScript | Python |
| ---------- | ------ |
| `design.edgeShift(start, end, angles, { quantity, level, edgeSide, direction, step })` | `design.edge_shift(start, end, angles, quantity="T", level=0.5, edge_side=..., direction="max", step=1)` |

Where the design's spectrum crosses a level beside the peak of a band at each of several angles of incidence, and how far that edge has moved from where it is at the first angle, each found as an EDGE_LAMBDA check of the Specification window finds it, as a spectrum curve's edge() finds it. What it is computed on follows the design's `sides` and `scoreOn` / `score_on`, as a spectrum does, and a design under a cone of incidence is averaged over its cone.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `start` | `start` |  | The first wavelength of the band, nm. |
| `end` | `end` |  | The last wavelength of the band, nm, above `start`. |
| `angles` | `angles` |  | The angles of incidence, degrees in the incident medium, each from 0 up to but not including 90. |
| `quantity` | `quantity` | `'T'` | `'R'`, `'T'` or `'A'` for unpolarized light, or `'Rs'`, `'Rp'`, `'Ts'`, `'Tp'`, `'As'` or `'Ap'`. |
| `level` | `level` | `0.5` | The level crossed, a fraction from 0 to 1; below 0.001 or above 0.999 it is taken as 0.001 or 0.999. |
| `edgeSide` | `edge_side` |  | **JavaScript**: `'right'` for the crossing above the peak; otherwise the one below it, or the one above where there is none below.<br>**Python**: "right" for the crossing above the peak. Without it, the one below it, or the one above where there is none below. |
| `direction` | `direction` | `'max'` | `'max'`, the level a fraction of the band's highest value, or `'min'`, a fraction of the way from its lowest value up to 1. |
| `step` | `step` | `1` | The step the peak is searched at, nm: 1, 0.1, 0.01 or 0.001. The crossing is bracketed on a scan of the band no coarser than it, of 301 samples at the least. |

**Returns**: **JavaScript**: An object: `angles`, and one value per angle in each of `edge`, the crossing, nm, `shift`, the edge less the edge at the first angle, nm, both null where the spectrum does not cross the level inside the band, `reason`, then `'edgeNotCrossed'` and otherwise null, `peak`, `peakValue` and `levelValue`; and `level`, the level used, `mode`, `quantity`, `direction` and `step`.<br>**Python**: An EdgeShift, a named tuple: angles, and one value per angle in each of edge, the crossing, nm, shift, the edge less the edge at the first angle, nm, both None where the spectrum does not cross the level inside the band, reason, then "edgeNotCrossed" and otherwise None, peak, peak_value and level_value; and level, the level used, mode, quantity, direction and step.

**Refuses**:

- a band that is not one, an empty list of angles or an angle outside 0 to 90, an option it does not take or a value an option cannot take, or a design that names a material that resolves to nothing

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

**JavaScript**: How the design differs from a measured curve, as the MCURVE merit row the Fit… dialog writes scores it: Measured Spectra's for R, T and A, Measured Ellipsometry's for Ψ and Δ. The curve is sampled on the dialog's grid and kept to the span every material of the design has data for, and the design read at each point at the curve's angle and polarization. R, T and A are read on what the design's `sides` and `scoreOn` say, as the merit function scores them, averaged over a cone of incidence the design has; Ψ and Δ on the front side alone, each Δ difference taken the short way round the circle.

**Python**: How the design differs from a measured curve, as the MCURVE merit row the Fit... dialog writes scores it: Measured Spectra's for R, T and A, Measured Ellipsometry's for Psi and Delta. The curve is sampled on the dialog's grid and kept to the span every material of the design has data for, and the design read at each point at the curve's angle and polarization. R, T and A are read on what the design's sides and score_on say, as the merit function scores them, averaged over a cone of incidence the design has; Psi and Delta on the front side alone, each Delta difference taken the short way round the circle.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `measured` | `measured` |  | **JavaScript**: The path of a spectrum file, read as `tf.readSpectrumFile()` reads it, or a curve as that or `tf.readEllipsometryFile()` gives one, `{ wavelength, values, quantity, angle, pol, name }`, its values fractions of 1, quantity `'T'` unless given, angle 0 and pol `'avg'`; a Ψ or Δ curve also takes `side` and `deltaConvention`, its values in degrees.<br>**Python**: The path of a spectrum file, read as tf.read_spectrum_file() reads it, or a MeasuredCurve that gives, an EllipsometryCurve tf.read_ellipsometry_file() gives, or a dict of wavelength, values, quantity, angle, pol and name, its values fractions of 1, quantity "T" unless given, angle 0 and pol "avg"; a Psi or Delta curve also takes side and delta_convention, its values in degrees. |
| `curve` | `curve` |  | For a file of several curves, the one compared, by its name or its number from 0. |
| `angle` | `angle` |  | For a file, as `tf.readSpectrumFile()` / `tf.read_spectrum_file()` takes it. |
| `pol` | `pol` |  | For a file, as `tf.readSpectrumFile()` / `tf.read_spectrum_file()` takes it. |
| `quantity` | `quantity` |  | For a file, as `tf.readSpectrumFile()` / `tf.read_spectrum_file()` takes it. |
| `scale` | `scale` |  | For a file, as `tf.readSpectrumFile()` / `tf.read_spectrum_file()` takes it. |
| `xUnit` | `x_unit` |  | For a file, as `tf.readSpectrumFile()` / `tf.read_spectrum_file()` takes it. |
| `grid` | `grid` | `'measured'` | `'measured'`, the curve's own points; `'thinned'`, every `thinEvery-th` / `thin_every-th` of them and the last; or `'uniform'`, every `step` nm, the curve read between its points as the dialog reads it. |
| `step` | `step` |  | **JavaScript**: With grid `'uniform'`, the step, nm; the curve's median spacing without it.<br>**Python**: With grid "uniform", the step, nm. Without it, the curve's median spacing. |
| `thinEvery` | `thin_every` | `2` | With grid `'thinned'`, which points are kept. |
| `start` | `start` |  | **JavaScript**: The first wavelength compared, nm; the curve's first without it.<br>**Python**: The first wavelength compared, nm. Without it, the curve's first. |
| `end` | `end` |  | **JavaScript**: The last wavelength compared, nm; the curve's last without it.<br>**Python**: The last wavelength compared, nm. Without it, the curve's last. |
| `db` | `db` | `false` / `False` | For a T curve, `true` / `True` compares in dB, as the dialog's dB scale does. |
| `levelFree` | `level_free` | `false` / `False` | For R, T and A, `true` / `True` takes off the mean difference before the RMS, as an MCURVE row with its level free scores. |

**Returns**: **JavaScript**: An object: `rms`, the MCURVE row's value, a fraction of 1, dB with `db`, or degrees for Ψ and Δ; `ppef`, a PPEF row's value against it, dB, null for Ψ and Δ; `level`, the mean difference taken off with `levelFree`, otherwise null; `wavelength`, the wavelengths compared, nm, and at each `measured`, `design` and `deviation`, design less measured (less `level`); `clipped`, true when fewer wavelengths were compared than asked for; and `mode`, `name`, `quantity`, `angle`, `pol`, `grid`, `db` and `levelFree`.<br>**Python**: A MeasuredDifference, a named tuple: rms, the MCURVE row's value, a fraction of 1, dB with db, or degrees for Psi and Delta; ppef, a PPEF row's value against it, dB, None for Psi and Delta; level, the mean difference taken off with level_free, otherwise None; wavelength, the wavelengths compared, nm, and at each measured, design and deviation, design less measured (less level); clipped, True when fewer wavelengths were compared than asked for; and mode, name, quantity, angle, pol, grid, db and level_free.

**Refuses**:

- **JavaScript**: a measured that is not a file path or a curve, a file that cannot be read or holds no spectrum, a file of several curves without `curve`, an option it does not take or a value an option cannot take, no point to compare, a Ψ or Δ curve at normal incidence or on the back side or one on a design scored on its back alone, or a design that names a material that resolves to nothing<br>**Python**: a measured that is not a file path or a curve, a file that cannot be read or holds no spectrum, a file of several curves without curve, an option it does not take or a value an option cannot take, no point to compare, a Psi or Delta curve at normal incidence or on the back side or one on a design scored on its back alone, or a design that names a material that resolves to nothing

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

**JavaScript**: Adds measured curves to the design as the import of Measured Spectra and Measured Ellipsometry adds them, each with an id of its own: R, T and A to the design's spectra, Ψ and Δ to its ellipsometry, after the curves it holds. The design saves them, the windows show them, and `fitMeasured()` turns one into merit rows. A curve holds what it is given: the file it came from, the unit that file was written in and whether it was in percent are not part of it.

**Python**: Adds measured curves to the design as the import of Measured Spectra and Measured Ellipsometry adds them, each with an id of its own: R, T and A to the design's spectra, Psi and Delta to its ellipsometry, after the curves it holds. The design saves them, the windows show them, and fit_measured() turns one into merit rows. A curve holds what it is given: the file it came from, the unit that file was written in and whether it was in percent are not part of it.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `curves` | `curves` |  | **JavaScript**: A curve or a list of curves, as `tf.readSpectrumFile()` or `tf.readEllipsometryFile()` gives them, `{ wavelength, values, quantity, angle, pol, name }`: R, T and A as fractions of 1, quantity `'T'` unless given, angle 0 and pol `'avg'`; a Ψ or Δ curve also takes `side` and `deltaConvention`, `'front'` and `'azzam'` unless given, its values in degrees.<br>**Python**: A curve or a list of curves: MeasuredCurves as tf.read_spectrum_file() gives them, EllipsometryCurves as tf.read_ellipsometry_file() gives them, or dicts of wavelength, values, quantity, angle, pol and name, R, T and A as fractions of 1, quantity "T" unless given, angle 0 and pol "avg"; a Psi or Delta curve also takes side and delta_convention, "front" and "azzam" unless given, its values in degrees. |

**Refuses**:

- **JavaScript**: a curve that is not an object of those fields, or a value a field cannot take<br>**Python**: a curve that is not one of those, or a value a field cannot take

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

**JavaScript**: Adds the merit rows the Fit… dialog adds for a measured curve the design holds: Measured Spectra's for R, T and A, Measured Ellipsometry's for Ψ and Δ. The MCURVE block holds the curve sampled on the dialog's grid, kept to the span every material of the design has data for; a Ψ or Δ block is scored on the front side alone. With `constraints`, an MNT and an MXT row follow it, as the dialog's thickness constraints add them. `compareMeasured()` with the same options gives the block's value.

**Python**: Adds the merit rows the Fit... dialog adds for a measured curve the design holds: Measured Spectra's for R, T and A, Measured Ellipsometry's for Psi and Delta. The MCURVE block holds the curve sampled on the dialog's grid, kept to the span every material of the design has data for; a Psi or Delta block is scored on the front side alone. With constraints, an MNT and an MXT row follow it, as the dialog's thickness constraints add them. compare_measured() with the same keywords gives the block's value.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `curve` | `curve` |  | The name of a curve the design holds. |
| `grid` | `grid` | `'measured'` | `'measured'`, the curve's own points; `'thinned'`, every `thinEvery-th` / `thin_every-th` of them and the last; or `'uniform'`, every `step` nm, the curve read between its points as the dialog reads it. |
| `step` | `step` |  | **JavaScript**: With grid `'uniform'`, the step, nm; the curve's median spacing without it.<br>**Python**: With grid "uniform", the step, nm. Without it, the curve's median spacing. |
| `thinEvery` | `thin_every` | `2` | With grid `'thinned'`, which points are kept. |
| `start` | `start` |  | **JavaScript**: The first wavelength kept, nm; the curve's first without it.<br>**Python**: The first wavelength kept, nm. Without it, the curve's first. |
| `end` | `end` |  | **JavaScript**: The last wavelength kept, nm; the curve's last without it.<br>**Python**: The last wavelength kept, nm. Without it, the curve's last. |
| `db` | `db` | `false` / `False` | For a T curve, `true` / `True` fits in dB, as the dialog's dB scale does. |
| `weight` | `weight` | `1` | The block's weight, 0 or more. |
| `output` | `output` | `'append'` | `'append'` adds the rows after the merit rows the design has; `'replace'` puts them in place of all of them. |
| `constraints` | `constraints` |  | **JavaScript**: `{ min: 10, max: 1000, weight: 1 }`, thicknesses in nm, to add the dialog's MNT and MXT rows over every layer.<br>**Python**: A dict of min, max and weight, thicknesses in nm, 10, 1000 and 1 unless given, to add the dialog's MNT and MXT rows over every layer. Without it, none. |

**Refuses**:

- **JavaScript**: a curve the design does not hold or two of that name, an option it does not take or a value an option cannot take, no point to keep, a Ψ or Δ curve at normal incidence or on the back side or one on a design scored on its back alone, or a design that names a material that resolves to nothing<br>**Python**: a curve the design does not hold or two of that name, an option it does not take or a value an option cannot take, no point to keep, a Psi or Delta curve at normal incidence or on the back side or one on a design scored on its back alone, or a design that names a material that resolves to nothing

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

### groupDelay / group_delay

| JavaScript | Python |
| ---------- | ------ |
| `design.groupDelay(start, end, { step, angle, pol, response, side, reference })` | `design.group_delay(start=400, end=800, step=0.5, angle=0, pol="avg", response="R", side=..., reference=...)` |

**JavaScript**: Phase, group delay, GDD, TOD and CDC of the design's reflected or transmitted light against wavelength, as the Group Delay / GDD window computes them. They are computed on the front, or on the back of a design coated on the back alone, unless `side` is given; a side with no layers gives its bare surface. `side: 'total'`, with `response: 'T'` alone, is the whole part as Pulse Analysis computes it: the front coating, one pass through the substrate and the back coating. The design's cone of incidence is not used, as the window does not use it.

**Python**: Phase, group delay, GDD, TOD and CDC of the design's reflected or transmitted light against wavelength, as the Group Delay / GDD window computes them. They are computed on the front, or on the back of a design coated on the back alone, unless side is given; a side with no layers gives its bare surface. side="total", with response="T" alone, is the whole part as Pulse Analysis computes it: the front coating, one pass through the substrate and the back coating. The design's cone of incidence is not used, as the window does not use it.

**JavaScript**: GD, GDD and TOD are analytic values at each wavelength, so they do not depend on the grid. The phase is unwrapped along the grid, so on a uniform grid it can land 2π off across a resonance narrower than the step. On the whole part the substrate's own phase, −2π n d cosθ / λ, n, d and θ its index, thickness and the angle in it, is added as it is, so only the coatings' phase is unwrapped. `step: 'auto'` gives the window's own grid, which adds points at reflection minima and table knots, so a mean over it leans toward the spikes there.

**Python**: GD, GDD and TOD are analytic values at each wavelength, so they do not depend on the grid. The phase is unwrapped along the grid, so on a uniform grid it can land 2π off across a resonance narrower than the step. On the whole part the substrate's own phase, −2π n d cosθ / λ, n, d and θ its index, thickness and the angle in it, is added as it is, so only the coatings' phase is unwrapped. step="auto" gives the window's own grid, which adds points at reflection minima and table knots, so a mean over it leans toward the spikes there.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `start` | `start` | `400` | The first wavelength, nm. |
| `end` | `end` | `800` | The last wavelength, nm, above `start`. |
| `step` | `step` | `0.5` | The wavelength step, nm, or `'auto'`, the window's own grid. |
| `angle` | `angle` | `0` | The angle of incidence, degrees in the medium light comes from, 0 up to but not including 90. |
| `pol` | `pol` | `'avg'` | The polarization: `'avg'`, `'s'` or `'p'`. |
| `response` | `response` | `'R'` | The light whose phase is taken: `'R'`, reflected, or `'T'`, transmitted. |
| `side` | `side` |  | **JavaScript**: `'front'`, `'back'`, or with `response: 'T'` `'total'`, the whole part. Without it, the back of a design coated on the back alone and the front of any other.<br>**Python**: "front", "back", or with response="T" "total", the whole part. Without it, the back of a design coated on the back alone and the front of any other. |
| `reference` | `reference` |  | A wavelength, nm: the phase is then 0 at the sample nearest it, as the window plots it; when that sample has no value, the phase stays absolute and `reference` is `null` / `None`. Without it, the phase is absolute. |

**Returns**: A GroupDelay.

**Refuses**:

- **JavaScript**: an option it does not take, a range that is not one, a step that is not a positive number or `'auto'`, an angle outside 0 to 90, a polarization, response or side it does not have, `'total'` with `response: 'R'`, a reference that is not a wavelength above 0, more than a million wavelengths, or a design that names a material that resolves to nothing<br>**Python**: a range that is not one, a step that is not a positive number or "auto", an angle outside 0 to 90, a polarization, response or side it does not have, "total" with response="R", a reference that is not a wavelength above 0, more than a million wavelengths, or a design that names a material that resolves to nothing

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

**JavaScript**: Sets the spectrum the design holds for Pulse Analysis, as the window's Load file… and Apply set it: a text table read as the curve editor reads it, its wavelength column in the unit its heading names, or rows given. Each row is a wavelength, an intensity and, when a third column is given, the spectral phase in rad; against wavelength the intensity is read as per unit wavelength, as a spectrometer records it. The rows are kept in the units given, in rising order, and the design saves them. pulse() with `source: 'design'` reads them, its centre then their centroid, where the window's Apply moves its centre.

**Python**: Sets the spectrum the design holds for Pulse Analysis, as the window's Load file… and Apply set it: a text table read as the curve editor reads it, its wavelength column in the unit its heading names, or rows given. Each row is a wavelength, an intensity and, when a third column is given, the spectral phase in rad; against wavelength the intensity is read as per unit wavelength, as a spectrometer records it. The rows are kept in the units given, in rising order, and the design saves them. pulse() with source="design" reads them, its centre then their centroid, where the window's Apply moves its centre.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `fileOrRows` | `file_or_rows` |  | **JavaScript**: The path of a text table, by its full path, or rows `[wavelength nm, intensity]` or `[wavelength nm, intensity, phase rad]`.<br>**Python**: The path of a text table, or rows [wavelength nm, intensity] or [wavelength nm, intensity, phase rad]. A relative path is taken from the program's working folder. |

**Refuses**:

- a file that cannot be read or holds no wavelength and intensity columns, a row that is not two or three numbers, fewer than two rows with a wavelength above 0 and an intensity not below 0, no row with an intensity above 0, or a phase on some rows and not on others

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

**JavaScript**: A pulse's passage through the design, in time and in its spectrum, as the Pulse Analysis window computes it: the pulse is reflected off or transmitted through one coated side, or through the whole part, the front coating, one pass through the substrate and the back coating, the first pulse to come out of it; `passes` bounces or passes in a row. Its spectrum is a Gaussian, sech² or super-Gaussian about the centre wavelength, or with `source: 'design'` the spectrum the design holds (setPulseSpectrum()), with the chirp of `gdd` and `tod` on top. The design's cone of incidence is not used, as the window does not use it. Without options, the window's opening settings, on the side the PR, GD, GDD and TOD merit rows score: the back of a design coated on the back alone and the front of any other. The window opens on the front unless only the back holds layers, so with one side empty the two can differ; a side with no layers gives its bare surface.

**Python**: A pulse's passage through the design, in time and in its spectrum, as the Pulse Analysis window computes it: the pulse is reflected off or transmitted through one coated side, or through the whole part, the front coating, one pass through the substrate and the back coating, the first pulse to come out of it; passes bounces or passes in a row. Its spectrum is a Gaussian, sech² or super-Gaussian about the centre wavelength, or with source="design" the spectrum the design holds (set_pulse_spectrum()), with the chirp of gdd and tod on top. The design's cone of incidence is not used, as the window does not use it. Without keywords, the window's opening settings, on the side the PR, GD, GDD and TOD merit rows score: the back of a design coated on the back alone and the front of any other. The window opens on the front unless only the back holds layers, so with one side empty the two can differ; a side with no layers gives its bare surface.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `source` | `source` | `'model'` | `'model'`, the spectrum of `shape`, or `'design'`, the spectrum the design holds. |
| `shape` | `shape` | `'gaussian'` | `'gaussian'` or `'sech2'`, a pulse of `duration`, or `'superGaussian'`, a spectrum of `bandwidth` and `order`. |
| `centre` | `centre` |  | **JavaScript**: The centre wavelength, nm, the carrier the chirp is taken about. Without it, 800 nm; with `source: 'design'`, the spectrum's centroid in frequency to the hundredth of a nanometre, as Apply sets it.<br>**Python**: The centre wavelength, nm, the carrier the chirp is taken about. Without it, 800 nm, or with source="design" the spectrum's centroid in frequency to the hundredth of a nanometre, as Apply sets it. |
| `duration` | `duration` | `10` | The intensity FWHM of the transform-limited pulse, fs, for `'gaussian'` and `'sech2'`. |
| `bandwidth` | `bandwidth` | `100` | The intensity FWHM of the spectrum, nm, for `'superGaussian'`. |
| `order` | `order` | `2` | The super-Gaussian's order, above 0; 2 is a Gaussian, and a higher order flattens the top of the spectrum. |
| `gdd` | `gdd` | `0` | The input's own GDD, fs², about the centre wavelength. |
| `tod` | `tod` | `0` | The input's own TOD, fs³, about the centre wavelength. |
| `side` | `side` |  | **JavaScript**: `'front'`, `'back'`, or with `response: 'T'` `'total'`, the whole part. Without it, the back of a design coated on the back alone and the front of any other.<br>**Python**: "front", "back", or with response="T" "total", the whole part. Without it, the back of a design coated on the back alone and the front of any other. |
| `response` | `response` | `'R'` | `'R'`, the reflected pulse, or `'T'`, the transmitted one. |
| `pol` | `pol` | `'avg'` | The polarization: `'avg'`, `'s'` or `'p'`. |
| `angle` | `angle` | `0` | The angle of incidence, degrees in the medium light comes from, 0 up to but not including 90. |
| `passes` | `passes` | `1` | The bounces off the coating, or passes through it, a whole number. |

**Returns**: A Pulse.

**Refuses**:

- **JavaScript**: an option it does not take or a value an option cannot take, `'total'` with `response: 'R'`, `source: 'design'` on a design that holds no spectrum with light in it, a design that names a material that resolves to nothing, a pulse too short for its centre wavelength, a response that cannot be computed across the spectrum, or no light out of the part<br>**Python**: an option it does not take or a value an option cannot take, "total" with response="R", source="design" on a design that holds no spectrum with light in it, a design that names a material that resolves to nothing, a pulse too short for its centre wavelength, a response that cannot be computed across the spectrum, or no light out of the part

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

The spectrum a monitor in the chamber reads after each layer of one side, as the Process Exporter window computes its finished-layer curves: the layers deposited from the substrate out, an empty layer left out, the piece read in air. On the part the other side stays bare or carries its whole coating for the run; on witness chips each chip is a run of its own from bare chip glass, each layer `witnessRatio` / `witness_ratio` times its thickness on the part. The design's cone of incidence is not used.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `start` | `start` | `400` | The first wavelength, nm. |
| `end` | `end` | `1100` | The last wavelength, nm, above `start`. |
| `step` | `step` | `0.5` | The wavelength step, nm. |
| `side` | `side` |  | `'front'` or `'back'`, the side deposited. Without it, the front, or the back of a design coated on the back alone. |
| `otherSide` | `other_side` | `'bare'` | `'bare'` or `'coated'`: the other side of the part, without or with its coating. Not used on chips. |
| `quantity` | `quantity` | `'T'` | `'T'`, `'R'` or `'A'`. |
| `angle` | `angle` | `0` | The angle of incidence, degrees in air, 0 up to but not including 90. |
| `pol` | `pol` | `'avg'` | `'avg'`, `'s'` or `'p'`. |
| `chips` | `chips` |  | **JavaScript**: On witness chips, `{ layersPerChip, plan, glass, witnessRatio }`, each optional: `plan` a chip number for each layer of the side from the substrate out, empty layers included, in place of `layersPerChip` layers to a chip (3 without either); `glass` the chip glass by id, the substrate without it; `witnessRatio` the witness thickness over the part's, from 0.05 to 10, 1 without it. Without it, the part.<br>**Python**: On witness chips, a dict of layers_per_chip, plan, glass and witness_ratio, each optional: plan a chip number for each layer of the side from the substrate out, empty layers included, in place of layers_per_chip layers to a chip (3 without either); glass the chip glass by id, the substrate without it; witness_ratio the witness thickness over the part's, from 0.05 to 10, 1 without it. Without it, the part. |

**Returns**: **JavaScript**: An object: `mode`, the side deposited; `quantity`; `wavelength` (nm); `bare`, the spectrum before the first layer; and `steps`, one per layer deposited, each `{ step, layer, material, thickness, chip, values }`: step from 1, layer its Design Editor number from 1 next to the substrate, material by id, thickness on the piece read in nm, chip its chip number or null on the part, values the spectrum when it is finished, fractions of 1.<br>**Python**: A ProcessSteps, a named tuple: mode, the side deposited; quantity; wavelength (nm); bare, the spectrum before the first layer; and steps, one ProcessStep per layer deposited: step from 1, layer its Design Editor number from 1 next to the substrate, material by id, thickness on the piece read in nm, chip its chip number or None on the part, values the spectrum when it is finished, fractions of 1.

**Refuses**:

- an option it does not take or a value an option cannot take, a range that is not one, more than a million wavelengths, a chip plan whose length is not the side's layer count, a chip glass that resolves to nothing, or a design that names a material that resolves to nothing

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

**JavaScript**: Writes the files the Process Exporter window's Save writes for a run into a folder: one .res file a step (01.res, 02.res, ...), or CSV or text files, one a step or one table a run, each spectrum as processSteps() computes it. On witness chips each chip's files go in a folder of its own inside it. A file of the same name already there is replaced, as Save replaces it.

**Python**: Writes the files the Process Exporter window's Save writes for a run into a folder: one .res file a step (01.res, 02.res, ...), or CSV or text files, one a step or one table a run, each spectrum as process_steps() computes it. On witness chips each chip's files go in a folder of its own inside it. A file of the same name already there is replaced, as Save replaces it. It takes process_steps()'s keywords too, which give the run.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `folder` | `folder` |  | The folder the files go in, which must be there. |
| `start` | `start` | `400` | The first wavelength written, nm. |
| `end` | `end` | `1100` | The last wavelength written, nm, above `start`. |
| `options` |  |  | **JavaScript**: processSteps()'s options, and these. |
| `format` | `format` | `'res'` | **JavaScript**: `'res'`, `'csv'` or `'txt'`. A .res file has one layout, which the options below do not change.<br>**Python**: "res", "csv" or "txt". A .res file has one layout, which the keywords below do not change. |
| `files` | `files` | `'step'` | `'step'`, one file a step, or `'table'`, one file a run with a column a step. |
| `header` | `header` | `'layers'` | `'layers'`, the .res header with its layer table; `'conditions'`, the lines Measured Spectra's import reads back; or `'none'`. |
| `delimiter` | `delimiter` | `','` | `','`, `';'`, a tab or a space. |
| `scale` | `scale` | `'percent'` | `'percent'` or `'fraction'`. |
| `decimals` | `decimals` | `5` | The decimals of each value, a whole number from 0 to 12. |
| `decimalMark` | `decimal_mark` | `'.'` | `'.'` or `','`; a comma takes a delimiter other than a comma. |

**Returns**: The paths of the files written, in run order.

**Refuses**:

- **JavaScript**: what processSteps() throws, an output option or value it does not take, a folder that is not there, or a side with no layers to deposit<br>**Python**: what process_steps() raises, an output option or value it does not take, a folder that is not there, or a side with no layers to deposit

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

Whether each layer of one side can be stopped on an optical monitor, as the Monitor Worksheet window works it out: the layers deposited from the substrate out on witness chips, each chip a short coating of its own from bare chip glass, read in air, each layer `witnessRatio` / `witness_ratio` times its thickness on the part. Each row gives the signal at its chip's wavelength when the layer is cut, the turning points in it, the swing there is to stop on and the thickness a signal error of the monitor's own size costs, flagged past `maxTerminationErrPct` / `max_termination_err_pct` of the layer. Every layer is a row, an empty one included. The chip plan is `processSteps()'s` / `process_steps()'s` `chips`: `processSteps()` / `process_steps()` given the same `chips` gives the Process Exporter's spectra of these chips, and needs them given, `{}` for 3 layers to a chip, as without `chips` it runs on the part. A plan given here does not reach the window or the Report. The design's cone of incidence is not used.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `side` | `side` |  | `'front'` or `'back'`, the side deposited. Without it, the front, or the back of a design coated on the back alone; the window has the front alone. |
| `quantity` | `quantity` | `'T'` | `'T'` or `'R'`, what the monitor reads. |
| `angle` | `angle` | `0` | The angle of incidence on the chip, degrees in air, 0 up to but not including 90. |
| `pol` | `pol` | `'avg'` | `'avg'`, `'s'` or `'p'`. |
| `chips` | `chips` |  | **JavaScript**: The chip plan, `{ layersPerChip, plan, glass, witnessRatio }`, each optional: `plan` a chip number for each layer of the side from the substrate out, empty layers included, in place of `layersPerChip` layers to a chip (3 without either); `glass` the chip glass by id, the substrate without it; `witnessRatio` the witness thickness over the part's, from 0.05 to 10, 1 without it.<br>**Python**: The chip plan, a dict of layers_per_chip, plan, glass and witness_ratio, each optional: plan a chip number for each layer of the side from the substrate out, empty layers included, in place of layers_per_chip layers to a chip (3 without either); glass the chip glass by id, the substrate without it; witness_ratio the witness thickness over the part's, from 0.05 to 10, 1 without it. |
| `wavelengths` | `wavelengths` |  | The monitor wavelengths, nm: `'auto'`, the window's Auto button, each chip at the reference wavelength or one of 25 from 0.7 to 1.3 times it, whichever its worst layer stops most closely at, to the whole nm; a number, every chip there, as Set all does; or a list of one for each layer of the side from the substrate out, empty layers included, a chip read at the one given for its first layer. Without it, every chip at the design's reference wavelength. |
| `signalErrorPct` | `signal_error_pct` | `0.3` | The monitor's signal error, % of the reading, from 0.001 to 50. |
| `noiseFloorPct` | `noise_floor_pct` | `0.1` | The monitor's noise floor, % of full scale, from 0 to 10. |
| `maxTerminationErrPct` | `max_termination_err_pct` | `1` | The termination error a layer is flagged past, % of its thickness, from 0.01 to 100. |

**Returns**: **JavaScript**: An object: `mode`, the side deposited; `rows`, one per layer in deposition order; `chips`, one per chip in the order it enters the run, each `{ chip, wavelength, initialLevel, steps }`, its wavelength in nm, its bare reading and the steps on it; and `runLength`, the run's optical thickness on the witnesses in quarter waves at the reference wavelength, the length of the window's chart. Each row is `{ step, layer, chip, onChip, material, wavelength, thickness, signal, turningPoints, amplitude, swingIn, swingOut, cutoffRatio, terminationError, crystal, initialLevel, poor, strategy, curve }`: step from 1; layer its Design Editor number from 1 next to the substrate, the same as step; chip its chip number and onChip its place on that chip from 1; material by id; wavelength the chip's, nm; thickness the witness's, nm; signal the reading when the layer is cut, a fraction of 1 (the window shows %); turningPoints how many lie inside the layer; amplitude the swing from the reading the cut is taken against, the last turning point at or before the cut on the chip or else the chip's bare reading, to the next turning point, null with none after the cut; swingIn and swingOut the swing from that reading to the layer's start and to the cut, fractions of 1; cutoffRatio swingOut over amplitude, or null; terminationError the thickness a signal error of the monitor's own size leaves, nm, null for a layer cut on time and Infinity where the signal has no slope or turn to read; crystal the part's thickness, nm, which a quartz monitor runs to (the window shows kÅ); initialLevel the chip's bare reading on its first layer, null on the others; poor true when the layer has no turning point after its cut or its termination error is past the budget; strategy `'turning'`, `'level'` or `'time'`, how the layer is cut; curve `{ thickness, signal }`, the reading against the layer's own thickness on the chip, nm, from 0 to 1.35 quarter waves of the layer past the cut, beyond the next turning point where there is one.<br>**Python**: A MonitorWorksheet, a named tuple: mode, the side deposited; rows, one WorksheetRow per layer in deposition order; chips, one WorksheetChip per chip in the order it enters the run, its chip, its wavelength in nm, its bare reading initial_level and the steps on it; and run_length, the run's optical thickness on the witnesses in quarter waves at the reference wavelength, the length of the window's chart. A WorksheetRow holds step from 1; layer its Design Editor number from 1 next to the substrate, the same as step; chip its chip number and on_chip its place on that chip from 1; material by id; wavelength the chip's, nm; thickness the witness's, nm; signal the reading when the layer is cut, a fraction of 1 (the window shows %); turning_points how many lie inside the layer; amplitude the swing from the reading the cut is taken against, the last turning point at or before the cut on the chip or else the chip's bare reading, to the next turning point, None with none after the cut; swing_in and swing_out the swing from that reading to the layer's start and to the cut, fractions of 1; cutoff_ratio swing_out over amplitude, or None; termination_error the thickness a signal error of the monitor's own size leaves, nm, None for a layer cut on time and inf where the signal has no slope or turn to read; crystal the part's thickness, nm, which a quartz monitor runs to (the window shows kÅ); initial_level the chip's bare reading on its first layer, None on the others; poor True when the layer has no turning point after its cut or its termination error is past the budget; strategy "turning", "level" or "time", how the layer is cut; curve a WorksheetCurve of thickness and signal, the reading against the layer's own thickness on the chip, nm, from 0 to 1.35 quarter waves of the layer past the cut, beyond the next turning point where there is one.

**Refuses**:

- an option it does not take or a value an option cannot take, a chip plan or a list of wavelengths whose length is not the side's layer count, a chip glass that resolves to nothing, a design that names a material that resolves to nothing, or a material with no refractive index at the reference wavelength or at a chip's wavelength, named by id

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

Puts the layers of a COAT record of a Zemax OpticStudio COATING.DAT file on one side of the design, as the Zemax Coatings window's Import to front coating puts them on the front: a relative thickness converted at `wavelength` with the index the file gives. A COAT lists its layers from the incident medium, so on the back they go in reversed. The side's layers are replaced; the media and the substrate stay the design's. Each layer's material takes the id an import in the app gives it, in the catalog of the file, and the design carries its definition, so it computes and saves with it: nothing is written to a catalog. On a computer where the app imported the file before, the ids are that catalog's and the materials it holds are used, edits included; otherwise each import draws a new random part of the catalog id, as a first import does.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `path` | `path` |  | **JavaScript**: The file, by its full path. A relative path is taken as `tf.openDesign()` takes it.<br>**Python**: The file. A relative path is taken as tf.open_design() takes it. |
| `coating` | `coating` |  | **JavaScript**: The COAT record, by its name or its place among the file's coatings from 0; without it, the first stack of layers.<br>**Python**: The COAT record, by its name or its place among the file's coatings from 0. Without it, the first stack of layers. |
| `wavelength` | `wavelength` | `550` | **JavaScript**: λ₀, nm, at which a thickness the file gives in waves is converted to nm.<br>**Python**: The wavelength, nm, at which a thickness the file gives in waves is converted to nm. |
| `side` | `side` |  | **JavaScript**: `'front'` or `'back'`; without it, the front, or the back of a design coated on the back alone.<br>**Python**: "front" or "back". Without it, the front, or the back of a design coated on the back alone. |

**Returns**: The layers left out, each with why: a material the file does not define, or a relative thickness whose material it gives no index for.

**Refuses**:

- **JavaScript**: a file that cannot be read or holds neither a MATE record nor a coating, a coating the file does not hold or one that is not a stack of layers, one none of whose layers converts, a side the Design Editor does not let you edit, an option it does not take or a value an option cannot take<br>**Python**: a file that cannot be read or holds neither a MATE record nor a coating, a coating the file does not hold or one that is not a stack of layers, one none of whose layers converts, a side the Design Editor does not let you edit, or a value an argument cannot take

```js
const file = require('path').join(require('os').homedir(), `COATING-${Date.now()}.DAT`);
require('fs').writeFileSync(file, 'MATE MGF2\n0.4 1.39 0\n0.8 1.38 0\nMATE AL2O3\n0.4 1.68 0\n0.8 1.66 0\nCOAT AR\nMGF2 0.25 0\nAL2O3 0.25 0\n');
const design = tf.newDesign('AR');
console.log(design.importZemaxCoating(file));
for (const layer of design.layers) console.log(layer.material, layer.thickness.toFixed(2), 'nm');
```

```python
import time

name = "COATING-{}.DAT".format(time.time_ns())
with open(name, "w") as f:
    f.write("MATE MGF2\n0.4 1.39 0\n0.8 1.38 0\nMATE AL2O3\n0.4 1.68 0\n0.8 1.66 0\nCOAT AR\nMGF2 0.25 0\nAL2O3 0.25 0\n")
design = tf.new_design("AR")
print(design.import_zemax_coating(name))
for layer in design.layers:
    print(layer.material, round(layer.thickness, 2), "nm")
```

### importCodevCoating / import_codev_coating

| JavaScript | Python |
| ---------- | ------ |
| `design.importCodevCoating(path, { side })` | `design.import_codev_coating(path, side=...)` |

Puts the layers of a CODE V coating file, a .seq or a .mul, on one side of the design, as the CODE V Coatings window's Import to front coating and Import to back coating put them: physical thickness in nm, a layer of code 100 locked. The file lists its layers from the incident medium, so on the back they go in reversed. The side's layers are replaced; the media and the substrate stay the design's, and the file's INC and SUB are not taken. The materials are carried in the design under the ids an import in the app gives them, as `importZemaxCoating()` / `import_zemax_coating()` carries them.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `path` | `path` |  | **JavaScript**: The file, by its full path; a name ending in .mul is read as a saved .mul, any other as commands. A relative path is taken as `tf.openDesign()` takes it.<br>**Python**: The file; a name ending in .mul is read as a saved .mul, any other as commands. A relative path is taken as tf.open_design() takes it. |
| `side` | `side` |  | **JavaScript**: `'front'` or `'back'`; without it, the front, or the back of a design coated on the back alone.<br>**Python**: "front" or "back". Without it, the front, or the back of a design coated on the back alone. |

**Returns**: What the reader and the conversion noted, as `tf.readCodevCoating()` / `tf.read_codev_coating()` and the window's report give it.

**Refuses**:

- **JavaScript**: a file that cannot be read, or that does not enter a stack the reader can read, a side the Design Editor does not let you edit, an option it does not take or a value an option cannot take<br>**Python**: a file that cannot be read, or that does not enter a stack the reader can read, a side the Design Editor does not let you edit, or a value an argument cannot take

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

The spectrum of the design with graded interlayers at its interfaces, against the design as it stands, as the Inhomogeneities window computes it: each interlayer is put in between the two materials that meet at its interface, adding its thickness to the coating, and is cut into slices of one index each, the share of the second material rising along its profile, n and k mixed in proportion. What it is computed on follows the design's `sides` and `scoreOn` / `score_on`, as a spectrum does, unless `side` is given, and a design under a cone of incidence is averaged over its cone, as the window averages it. A side with no layers has no interface, and gives its bare surface.

Interface k of a side is the top of its layer k, numbered from the substrate as `layers` numbers them: 0 is the substrate's surface and N, on a side of N layers, the surface that meets the medium. A layer of 0 nm keeps its number and its interfaces. On the front the grading runs from the material farther from the substrate to the nearer one, and on the back from the nearer to the farther, as the window grades them; a linear or sigmoid profile reads the same either way. When the design has a specification, `specification` is its verdict with the interlayers in, as the badge under the window's chart reads it.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `interlayers` | `interlayers` | `[]` | **JavaScript**: One row per interlayer, each `{ side, interface, thickness, profile, slices }`: `side` `'front'` or `'back'`, the side computed, or the coated side on a whole part coated on one side, and given on each row of a whole part coated on both sides; `interface` from 0, the substrate's surface, to the side's layer count; `thickness` in nm, 0 or more, 5 when left out; `profile` `'linear'`, `'parabolic'`, `'invParabolic'`, `'exponential'` or `'sigmoid'`, `'linear'` when left out; `slices` a whole number, 2 or more, 10 when left out. One row to an interface.<br>**Python**: One dict per interlayer, with side, interface, thickness, profile and slices: side "front" or "back", the side computed, or the coated side on a whole part coated on one side, and given on each row of a whole part coated on both sides; interface from 0, the substrate's surface, to the side's layer count; thickness in nm, 0 or more, 5 when left out; profile "linear", "parabolic", "invParabolic", "exponential" or "sigmoid", "linear" when left out; slices a whole number, 2 or more, 10 when left out. One row to an interface. Without it, none. |
| `start` | `start` | `400` | The first wavelength, nm. |
| `end` | `end` | `800` | The last wavelength, nm, above `start`. |
| `step` | `step` | `0.5` | The wavelength step, nm. |
| `angle` | `angle` | `0` | The angle of incidence, degrees in the incident medium, 0 up to but not including 90. |
| `side` | `side` |  | `'front'`, `'back'` or `'total'`, the whole part. Without it, what the design is scored on. |

**Returns**: An Inhomogeneities.

**Refuses**:

- an option it does not take, a range that is not one, an angle outside 0 to 90, a side it does not have, more than a million wavelengths, a row with a field it does not have, a row for a side not computed or with no side on a whole part coated on both sides, an interface the side does not have or one another row names, a thickness below 0, a profile it does not have, slices that are not a whole number of 2 or more, or a design that names a material that resolves to nothing

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

The specular R and T of the design with rough interfaces, against the smooth design, as the Roughness / Scattering window computes them: each rough interface becomes a transition layer 2σ thick, σ the rms roughness. Short range is a graded layer whose n and k run in a straight line from one material to the other, and loses no light; long range is one layer whose extinction coefficient stands for the light scattered out of the specular beams, derived for one surface at normal incidence, so at an angle, under a cone or in a multilayer it is an estimate. What it is computed on follows the design's `sides` and `scoreOn` / `score_on`, as a spectrum does, unless `side` is given, and a design under a cone of incidence is averaged over its cone, as the window averages it.

Interface k of a side is the top of its layer k, numbered from the substrate as `layers` numbers them: 0 is the substrate's surface and N, on a side of N layers, the surface that meets the medium. A side with no layers, or none thicker than 0 nm, has no interface, and gives its bare surface, on its own or on the whole part. A transition layer takes its thickness out of the layer beneath its interface, and the substrate is not thinned; a layer thinner than 2σ is set to 0 nm and listed in `thinned`. A layer of 0 nm is not in the coating: the σ set on its top is not used, and the layer beneath it meets the next layer there is, at the interface on top of the layer beneath.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `sigma` | `sigma` | `1` | The rms roughness of every interface, nm, 0 or more. |
| `range` | `range` | `'long'` | **JavaScript**: The kind of roughness of every interface: `'short'` or `'long'`.<br>**Python**: The kind of roughness of every interface, "short" or "long". |
| `interfaces` | `interfaces` | `[]` | **JavaScript**: The interfaces that differ from `sigma` and `range`, one row each, `{ side, interface, sigma, range }`, as the per-interface editor sets them: `side` `'front'` or `'back'`, the side computed, or the coated side on a whole part coated on one side, and given on each row of a whole part coated on both sides; `interface` from 0, the substrate's surface, to the side's layer count; `sigma` and `range` as above, the call's own when left out. One row to an interface. One rough interface alone is `sigma: 0` with that interface listed.<br>**Python**: The interfaces that differ from sigma and range, one dict each, with side, interface, sigma and range, as the per-interface editor sets them: side "front" or "back", the side computed, or the coated side on a whole part coated on one side, and given on each row of a whole part coated on both sides; interface from 0, the substrate's surface, to the side's layer count; sigma and range as above, the call's own when left out. One row to an interface. One rough interface alone is sigma=0 with that interface listed. Without it, none. |
| `start` | `start` | `400` | The first wavelength, nm. |
| `end` | `end` | `800` | The last wavelength, nm, above `start`. |
| `step` | `step` | `0.5` | The wavelength step, nm. |
| `angle` | `angle` | `0` | The angle of incidence, degrees in the incident medium, 0 up to but not including 90. |
| `side` | `side` |  | `'front'`, `'back'` or `'total'`, the whole part. Without it, what the design is scored on. |

**Returns**: A Roughness.

**Refuses**:

- **JavaScript**: an option it does not take, a range that is not one, an angle outside 0 to 90, a side it does not have, more than a million wavelengths, a σ below 0 or a kind other than `'short'` or `'long'`, a row with a field it does not have, a row for a side not computed or with no side on a whole part coated on both sides, an interface the side does not have or one another row names, or a design that names a material that resolves to nothing<br>**Python**: an option it does not take, a range that is not one, an angle outside 0 to 90, a side it does not have, more than a million wavelengths, a sigma below 0 or a range other than "short" or "long", a row with a field it does not have, a row for a side not computed or with no side on a whole part coated on both sides, an interface the side does not have or one another row names, or a design that names a material that resolves to nothing

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

### stress

| JavaScript | Python |
| ---------- | ------ |
| `design.stress()` | `design.stress()` |

The stress each film carries and what the coating does to the part, as the Stress window computes them from the constants on the materials' Mechanical tab, `stressTemperature` / `stress_temperature`, `depositionTemperature` / `deposition_temperature` and the substrate's thickness and diameter. A film's stress is tensile positive, and the force is Σ σ·d, the quantity the `STR` merit row reads. The coatings that count follow the design's `sides` and `scoreOn` / `score_on`, as the window and the `STR` row count them. With coatings on both faces the force is F_front − F_back; a coating on one face alone reads the same on the back as on the front. A film whose material states no stress counts as carrying none in the force and the edge shear, as in the `STR` row; its strain energy, the delamination factor of it and of every film below it, the total strain energy and the cracking parameter are `null` / `None`. With the temperatures set, a missing thermal constant does not leave a film's stress `null` / `None`: the stress leaves out the terms that need it, as the `STR` row does. A film whose material states no reference temperature has its intrinsic stress read as that of a film deposited at the deposition temperature, so only the expansion mismatch is added to it; one that states no Young's modulus, Poisson's ratio or expansion coefficient carries its intrinsic stress alone; and a substrate that states no expansion coefficient adds no expansion mismatch to any film. Beyond the stress, a constant a material does not state leaves the quantities that need it `null` / `None`, and `missing` names it. The built-in materials state no constants, so a design of them reads a force of 0.

**Returns**: A Stress.

**Refuses**:

- a design that names a material that resolves to nothing

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
design.depositionTemperature = 250;
design.substrate.diameter = 25.4;
const s = design.stress();
console.log(s.mode, 'force', s.whole.force, 'N/m;', s.films.length, 'films;', s.missing.length, 'materials missing constants');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
design.deposition_temperature = 250
design.substrate.diameter = 25.4
s = design.stress()
print(s.mode, "force", s.whole.force, "N/m;", len(s.films), "films;", len(s.missing),
      "materials missing constants")
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

Why it ended. On its own: `'target'` (with `stopMF`, the merit that reached it); for Needle `'maxLayers'` or `'needleOptimal'`; for Gradual Evolution `'maxGeCycles'` or `'stuck'` (no step left); for Structural `'maxIter'`, `'iterationCap'`, `'patience'` (with `patience`), `'budget'`, `'layerCap'`, `'noMutation'` or `'refineFailed'` (the starting design could not be refined, with `message`; there is no answer). Otherwise `'stopped'`, `'workerError'` (with `message`), or why the run could not start: `'workerFailed'`, `'noOperands'`, `'noMaterials'` or `'presampleFailed'`.

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

A design's substrate: its material, thickness and diameter. Setting any of them changes the design.

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

### diameter

| JavaScript | Python |
| ---------- | ------ |
| `design.substrate.diameter` | `design.substrate.diameter` |
| `design.substrate.diameter = value` | `design.substrate.diameter = value` |

The substrate's diameter, mm, which only the Stress window's centre deflection needs, or `null` / `None` when it is not set. Setting it to `null` / `None` unsets it.

**Refuses**:

- a diameter of 0 or less

```js
const design = tf.newDesign('Bare BK7');
design.substrate.diameter = 25.4;
console.log(design.substrate.diameter, 'mm');
```

```python
design = tf.new_design("Bare BK7")
design.substrate.diameter = 25.4
print(design.substrate.diameter, "mm")
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

### flip

| JavaScript | Python |
| ---------- | ------ |
| `design.layers.flip()` | `design.layers.flip()` |

Reverses the side's layer order on the substrate, as the Design Editor's Invert button does: layer 1 becomes the outermost. On a symmetric design the back follows the flipped front.

**Refuses**:

- a side the design does not let you edit, such as the back of a symmetric design

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

Writes the spectrum to a CSV file: the conditions on # lines as Measured Spectra's export writes them, which its import reads back (the design's name; the angle of incidence when the spectrum has one angle, and the side light comes in on, the back for a design scored on its back alone and the front otherwise; and "Polarization: per column"), then a column of wavelengths and R, T, A, Rs, Rp, Ts, Tp, As and Ap at each angle, as fractions of 1, each headed with its quantity and angle. A file that is there is written over.

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

### saveJcamp / save_jcamp

| JavaScript | Python |
| ---------- | ------ |
| `s.saveJcamp(path)` | `s.save_jcamp(path)` |

**JavaScript**: Writes the spectrum to a JCAMP-DX file as Measured Spectra's Export tab writes a design spectrum, with T, R and A and "Include s and p" checked: one spectrum each of T, R and A for unpolarized light and of Ts, Rs, Tp and Rp at each angle, as fractions of 1, each titled with the design's name, its quantity and, at more than one angle, its angle. Measured Spectra's import reads each back as a curve. A file that is there is written over.

**Python**: Writes the spectrum to a JCAMP-DX file as Measured Spectra's Export tab writes a design spectrum, with T, R and A and "Include s and p" checked: one spectrum each of T, R and A for unpolarized light and of Ts, Rs, Tp and Rp at each angle, as fractions of 1, each titled with the design's name, its quantity and, at more than one angle, its angle. The file is the window's, byte for byte, and Measured Spectra's import reads each spectrum back as a curve. A file that is there is written over.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `path` | `path` |  | **JavaScript**: The file to write, by its full path. A relative path is taken from the folder the program was started from: in the Script Console, the folder TFStudio was started from, often its install folder.<br>**Python**: The file to write. A relative path is taken from the program's working folder: in the Script Console, the script's folder, or the data folder for a script not saved. |

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

### ripple

| JavaScript | Python |
| ---------- | ------ |
| `s.R.ripple(start, end, { unit })` | `s.R.ripple(start=..., end=..., unit="fraction")` |

**JavaScript**: The ripple over a band: the highest value whose wavelength is from `start` to `end`, both included, less the lowest, NaN values left out, so `max(start, end) - min(start, end)`; with `unit: 'dB'`, the ratio of the two in decibels, 10·log10(max/min), for a curve of values above 0.

**Python**: The ripple over a band: the highest value whose wavelength is from `start` to `end`, both included, less the lowest, NaN values left out, so max(start, end) - min(start, end); with unit="dB", the ratio of the two in decibels, 10·log10(max/min), for a curve of values above 0.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `start` | `start` |  | The first wavelength of the band, nm. Without it, the curve's first. |
| `end` | `end` |  | The last wavelength of the band, nm. Without it, the curve's last. |
| `unit` | `unit` | `'fraction'` | `'fraction'`, the difference in the curve's own unit, a fraction of 1 for R, T and A; or `'dB'`. |

**Returns**: The ripple; NaN when every value in the band is NaN.

**Refuses**:

- a band no wavelength of the curve is in, or a unit it does not have

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

The value at a wavelength, read off the straight line between the two samples either side of it, as the plot draws the curve; at a sample, that sample's value.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `wavelength` | `wavelength` |  | The wavelength, nm, from the curve's first to its last. |

**Returns**: The value; NaN when a sample it is read from is NaN.

**Refuses**:

- a wavelength outside the curve, or one that is not a number

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

The optical density at each wavelength, −log10 T, a Curve, as the ODMN merit row reads it: a T below 1e-15 reads as a density of 15. A spectrum's T, Ts and Tp have one; other curves do not.

**Returns**: A Curve of densities over the same wavelengths.

**Refuses**:

- a curve that is not a spectrum's T, Ts or Tp

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

**JavaScript**: Where the curve crosses a level beside the peak of a band, as an EDGE_LAMBDA check of the Specification window finds it: computed on the design the spectrum was computed on, at the curve's angle, so the crossing is exact and not read off the samples. The level is a fraction of the band's peak, so on a band peaking at T = 0.90, `level: 0.5` is crossed where T = 0.45. A spectrum's curves have it; other curves do not.

**Python**: Where the curve crosses a level beside the peak of a band, as an EDGE_LAMBDA check of the Specification window finds it: computed on the design the spectrum was computed on, at the curve's angle, so the crossing is exact and not read off the samples. The level is a fraction of the band's peak, so on a band peaking at T = 0.90, level=0.5 is crossed where T = 0.45. A spectrum's curves have it; other curves do not.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `start` | `start` |  | The first wavelength of the band, nm, inside the curve. Without it, the curve's first. |
| `end` | `end` |  | The last wavelength of the band, nm, inside the curve. Without it, the curve's last. |
| `level` | `level` | `0.5` | The level crossed, a fraction from 0 to 1; below 0.001 or above 0.999 it is taken as 0.001 or 0.999. |
| `edgeSide` | `edge_side` |  | **JavaScript**: `'right'` for the crossing above the peak; otherwise the one below it, or the one above where there is none below.<br>**Python**: "right" for the crossing above the peak. Without it, the one below it, or the one above where there is none below. |
| `direction` | `direction` | `'max'` | `'max'`, the level a fraction of the band's highest value, or `'min'`, a fraction of the way from its lowest value up to 1. |
| `step` | `step` | `1` | The step the peak is searched at, nm: 1, 0.1, 0.01 or 0.001. The crossing is bracketed on a scan of the band no coarser than it, of 301 samples at the least. |

**Returns**: **JavaScript**: An object: `edge`, the crossing, nm, null when the curve does not cross the level inside the band, and `reason`, then `'edgeNotCrossed'` and otherwise null; `peak`, the wavelength of the band's peak, nm, and `peakValue`, the curve's value there; `level`, the level used, 0.001 to 0.999, and `levelValue`, the curve's value at the crossing; and `feature`, `mode`, `quantity`, `angle`, `direction` and `step`.<br>**Python**: An Edge, a named tuple: edge, the crossing, nm, None when the curve does not cross the level inside the band, and reason, then "edgeNotCrossed" and otherwise None; peak, the wavelength of the band's peak, nm, and peak_value, the curve's value there; level, the level used, 0.001 to 0.999, and level_value, the curve's value at the crossing; and feature, mode, quantity, angle, direction and step.

**Refuses**:

- a curve that is not a spectrum's, a band not inside the curve, or an option it does not take or a value an option cannot take

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

The full width of the peak of a band where the curve crosses a level, by default half the peak, as a FWHM check of the Specification window finds it, with the two crossings, their midpoint and the peak: computed on the design the spectrum was computed on, at the curve's angle, so the crossings are exact and not read off the samples. A spectrum's curves have it; other curves do not.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `start` | `start` |  | The first wavelength of the band, nm, inside the curve. Without it, the curve's first. |
| `end` | `end` |  | The last wavelength of the band, nm, inside the curve. Without it, the curve's last. |
| `level` | `level` | `0.5` | The level crossed, a fraction of the peak from 0 to 1; below 0.001 or above 0.999 it is taken as 0.001 or 0.999. |
| `direction` | `direction` | `'max'` | `'max'`, the width of a peak, or `'min'`, of a dip, crossed a fraction of the way from its lowest value up to 1. |
| `step` | `step` | `1` | The step the peak is searched at, nm: 1, 0.1, 0.01 or 0.001. The crossings are bracketed on a scan of the band no coarser than it, of 301 samples at the least. |

**Returns**: **JavaScript**: An object: `width`, `right` − `left`, nm, the value of a FWHM check; `left` and `right`, the crossings below and above the peak, nm; `centre`, their midpoint, nm; each null when a crossing is not inside the band, and `reason`, then `'fwhmNotBracketed'` and otherwise null; `peak`, `peakValue`, `level` and `levelValue`, as edge() gives them; and `feature`, `mode`, `quantity`, `angle`, `direction` and `step`.<br>**Python**: A Width, a named tuple: width, right - left, nm, the value of a FWHM check; left and right, the crossings below and above the peak, nm; centre, their midpoint, nm; each None when a crossing is not inside the band, and reason, then "fwhmNotBracketed" and otherwise None; peak, peak_value, level and level_value, as edge() gives them; and feature, mode, quantity, angle, direction and step.

**Refuses**:

- a curve that is not a spectrum's, a band not inside the curve, or an option it does not take or a value an option cannot take

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

The wavelength of the peak of a band, or of its dip, as a Central λ check of the Specification window finds it: searched on the design the spectrum was computed on, at the curve's angle, not read off the samples. A spectrum's curves have it; other curves do not.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `start` | `start` |  | The first wavelength of the band, nm, inside the curve. Without it, the curve's first. |
| `end` | `end` |  | The last wavelength of the band, nm, inside the curve. Without it, the curve's last. |
| `direction` | `direction` | `'max'` | `'max'`, the highest value, or `'min'`, the lowest. |
| `step` | `step` | `1` | The step the peak is searched at, nm: 1, 0.1, 0.01 or 0.001. The peak of R, and the dip of T or A, is found without a step, so it stays 1. |

**Returns**: **JavaScript**: An object: `peak`, the wavelength, nm, and `peakValue`, the curve's value there; and `feature`, `mode`, `quantity`, `angle`, `direction` and `step`.<br>**Python**: A Peak, a named tuple: peak, the wavelength, nm, and peak_value, the curve's value there; and feature, mode, quantity, angle, direction and step.

**Refuses**:

- a curve that is not a spectrum's, a band not inside the curve, or an option it does not take or a value an option cannot take

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

**JavaScript**: Writes Ψ and Δ to a CSV file as the window's export writes its table: a column of wavelengths, λ (nm), or of angles, AOI (°), then Ψ (°) and Δ (°). Against wavelength at more than one angle, Ψ and Δ come for each angle in turn, each headed with its angle. Against wavelength at one angle, two # lines come first, as Measured Ellipsometry's export of the design's Ψ/Δ writes them: the design's name, then the angle and the side, which its import reads back. A file that is there is written over.

**Python**: Writes Ψ and Δ to a CSV file as the window's export writes its table: a column of wavelengths, λ (nm), or of angles, AOI (°), then Ψ (°) and Δ (°). Against wavelength at more than one angle, Ψ and Δ come for each angle in turn, each headed with its angle. Against wavelength at one angle, two # lines come first, as Measured Ellipsometry's export of the design's Psi/Delta writes them: the design's name, then the angle and the side, which its import reads back. The numbers are the window's, written in Python's float notation. A file that is there is written over.

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

## GroupDelay

Phase, group delay, GDD, TOD and CDC of a design's reflected or transmitted light against wavelength, as `design.groupDelay()` / `design.group_delay()` computes them and the Group Delay / GDD window shows them. `g.phase`, `g.gd`, `g.gdd`, `g.tod` and `g.cdc` are Curves.

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

The sides computed: `'front'` or `'back'`, one coated side, or `'total'`, the whole part in transmission.

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

The light whose phase is taken: `'R'`, reflected, or `'T'`, transmitted.

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

The angle of incidence, degrees in the medium light comes from.

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

The polarization: `'avg'`, `'s'` or `'p'`.

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

The wavelength step, nm, or `'auto'`, the window's own grid.

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

The wavelength the phase is shifted to 0 at, nm, or `null` / `None` for the absolute phase: without a reference, or when the sample nearest it has no value.

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

The wavelengths, nm.

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

The phase φ, degrees, a Curve: unwrapped along the grid, absolute, or 0 at the sample nearest the reference when one was given.

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

The group delay, fs, a Curve.

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

The GDD, fs², a Curve.

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

The TOD, fs³, a Curve.

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

The CDC, GDD · 2πc/λ², fs/nm, a Curve: the chromatic dispersion as Essential Macleod reports it, with the sign of GDD. The slope of group delay against wavelength, dGD/dλ, is its negative.

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

For each wavelength, the name of the material whose data its value was taken outside of, or `null` / `None`.

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

**JavaScript**: The table knots that are exactly wavelengths of the grid, an array of `{ wavelength, gd, gdd, tod, cdc }`, each quantity a pair `[left, right]` of its values on the two sides of the knot; the value the curves hold at that wavelength reads the material averaged across the knot. On the uniform grid none is read when the knots in range are dense against the grid, more than one per 8 points, and on `side: 'total'` none is read.

**Python**: The table knots that are exactly wavelengths of the grid, a list of dicts with wavelength, gd, gdd, tod and cdc, each quantity a pair [left, right] of its values on the two sides of the knot; the value the curves hold at that wavelength reads the material averaged across the knot. On the uniform grid none is read when the knots in range are dense against the grid, more than one per 8 points, and on side="total" none is read.

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

**JavaScript**: The wavelengths with no value, an array of `{ wavelength, reason }`; the curves are NaN there. Empty when every wavelength has one.

**Python**: The wavelengths with no value, a list of dicts with wavelength and reason; the curves are NaN there. Empty when every wavelength has one.

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

The material models the values come from, each `'name: model'`.

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

**JavaScript**: The materials of the sides computed whose data stop inside the range, an array of `{ id, name, rangeNm, heldFlat }`: outside `rangeNm` their n and k are held at the last value (`heldFlat` true) or extrapolated. Empty when every material covers it.

**Python**: The materials of the sides computed whose data stop inside the range, a list of dicts with id, name, rangeNm and heldFlat: outside rangeNm their n and k are held at the last value (heldFlat True) or extrapolated. Empty when every material covers it.

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

**JavaScript**: Writes the curves to a CSV file as the window's Copy CSV writes its table: λ (nm), then Knot where a table knot is sampled, a row for each side of it, λ− and λ+, then Outside data where a value was taken outside a material's data, then Group Delay (fs), GDD (fs²), CDC (fs/nm), Phase φ (°) and TOD (fs³). The phase is the one `phase` holds. A file that is there is written over.

**Python**: Writes the curves to a CSV file as the window's Copy CSV writes its table: λ (nm), then Knot where a table knot is sampled, a row for each side of it, λ− and λ+, then Outside data where a value was taken outside a material's data, then Group Delay (fs), GDD (fs²), CDC (fs/nm), Phase φ (°) and TOD (fs³). The phase is the one phase holds. The numbers are the window's, written in Python's float notation. A file that is there is written over.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `path` | `path` |  | **JavaScript**: The file to write, by its full path. A relative path is taken from the folder the program was started from: in the Script Console, the folder TFStudio was started from, often its install folder.<br>**Python**: The file to write. A relative path is taken from the program's working folder: in the Script Console, the script's folder, or the data folder for a script not saved. |

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

A pulse's passage through a design, in time and in its spectrum, as design.pulse() computes it and the Pulse Analysis window shows it: its metrics, the window's Results table, and its curves.

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

The sides computed: `'front'` or `'back'`, one coated side, or `'total'`, the whole part in transmission.

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

The pulse taken: `'R'`, the reflected one, or `'T'`, the transmitted one.

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

The polarization: `'avg'`, `'s'` or `'p'`.

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

The angle of incidence, degrees in the medium light comes from.

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

The bounces off the coating, or passes through it.

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

Where the spectrum comes from: `'model'`, the shape, or `'design'`, the spectrum the design holds.

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

The centre wavelength, nm: the one given, 800 nm, or with the design's spectrum its centroid.

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

`false` / `False` when the time window reached its largest size before the output fitted inside it, so part of the output may wrap round from one end to the other and the curves and metrics are not reliable; `true` / `True` otherwise.

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

Whether the input's own chirp changes its shape anywhere by more than 1e-4 of the Fourier-limited peak; the window's table lists the input's FWHM only then.

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

**JavaScript**: The window's Results table: `flpFwhm`, `inputFwhm` and `outputFwhm`, the intensity FWHM of the Fourier-limited pulse, the input and the output, fs; `outputRms`, the output's RMS width, fs; `peakVsFlp`, the output's peak over the Fourier-limited pulse's, and `transformLimitedRatio`, over the peak the output's own spectrum would reach with a flat phase, fractions of 1; `energyRatio`, the energy out over the energy in; `delay`, the output's delay after the input, fs; `residualGdd` and `residualTod`, the output's GDD, fs², and TOD, fs³, averaged over its spectrum; `inputBandwidth` and `outputBandwidth`, the spectral intensity FWHM, nm; `timeBandwidth`, the output's time-bandwidth product.

**Python**: The window's Results table, a PulseMetrics named tuple: flp_fwhm, input_fwhm and output_fwhm, the intensity FWHM of the Fourier-limited pulse, the input and the output, fs; output_rms, the output's RMS width, fs; peak_vs_flp, the output's peak over the Fourier-limited pulse's, and transform_limited_ratio, over the peak the output's own spectrum would reach with a flat phase, fractions of 1; energy_ratio, the energy out over the energy in; delay, the output's delay after the input, fs; residual_gdd and residual_tod, the output's GDD, fs², and TOD, fs³, averaged over its spectrum; input_bandwidth and output_bandwidth, the spectral intensity FWHM, nm; time_bandwidth, the output's time-bandwidth product.

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

**JavaScript**: The time curves, `flp`, `input` and `output`, each `{ t, intensity }`: t in fs, the intensity on the scale where the Fourier-limited pulse peaks at 1. They hold the transform's samples from the first to the last above 1e-4 of that peak, and past 4000 samples the lowest and highest of each run in turn, so each curve has its own t. The output is at its absolute delay; the window's Delay removed view moves it back by `metrics.delay`.

**Python**: The time curves, a PulseTime named tuple of flp, input and output, each a TimeCurve of t, fs, and intensity, on the scale where the Fourier-limited pulse peaks at 1. They hold the transform's samples from the first to the last above 1e-4 of that peak, and past 4000 samples the lowest and highest of each run in turn, so each curve has its own t. The output is at its absolute delay; the window's Delay removed view moves it back by metrics.delay.

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

**JavaScript**: The spectrum curves, each `{ wavelength, values }`, wavelengths in nm rising: `input` and `output`, the spectral intensity on the scale where the input peaks at 1; `coatingGdd`, the response's GDD times the passes, fs², the mean of s and p with `pol: 'avg'`; `compensatingGdd`, the GDD that undoes the input's own chirp, fs². They hold the transform's samples where the input is above 1e-3 of its peak, or a fresh evaluation at least 600 points across that band when the transform has fewer. Past 4000 samples each keeps the lowest and highest of each run of its own values in turn, so each curve then has its own wavelengths. `band` is `[low, high]`, nm, the band they cover.

**Python**: The spectrum curves, a PulseSpectrum named tuple, each curve a SpectrumCurve of wavelength, nm rising, and values: input and output, the spectral intensity on the scale where the input peaks at 1; coating_gdd, the response's GDD times the passes, fs², the mean of s and p with pol="avg"; compensating_gdd, the GDD that undoes the input's own chirp, fs². They hold the transform's samples where the input is above 1e-3 of its peak, or a fresh evaluation at least 600 points across that band when the transform has fewer. Past 4000 samples each keeps the lowest and highest of each run of its own values in turn, so each curve then has its own wavelengths. band is [low, high], nm, the band they cover.

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

On the whole part, the time from this pulse to the first echo reflected inside the substrate, fs, the substrate's group delay there and back at the centre wavelength; `null` / `None` on one side.

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

**JavaScript**: The materials of the sides computed whose data stop inside the spectrum's band, an array of `{ id, name, rangeNm, heldFlat }`: outside `rangeNm` their n and k are held at the last value (`heldFlat` true) or extrapolated. Empty when every material covers it.

**Python**: The materials of the sides computed whose data stop inside the spectrum's band, a list of dicts with id, name, rangeNm and heldFlat: outside rangeNm their n and k are held at the last value (heldFlat True) or extrapolated. Empty when every material covers it.

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

**JavaScript**: Writes the metrics to a CSV file as the window's Copy CSV writes its Results table: Quantity, Value and Unit, a row for each metric in the window's words, the peaks and the energy in percent, and the input's FWHM only when the input is chirped. A file that is there is written over.

**Python**: Writes the metrics to a CSV file as the window's Copy CSV writes its Results table: Quantity, Value and Unit, a row for each metric in the window's words, the peaks and the energy in percent, and the input's FWHM only when the input is chirped. The numbers are the window's, written in Python's float notation. A file that is there is written over.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `path` | `path` |  | **JavaScript**: The file to write, by its full path. A relative path is taken from the folder the program was started from: in the Script Console, the folder TFStudio was started from, often its install folder.<br>**Python**: The file to write. A relative path is taken from the program's working folder: in the Script Console, the script's folder, or the data folder for a script not saved. |

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

The spectrum of a design with graded interlayers at its interfaces, against the design as it stands, as design.inhomogeneities() computes it and the Inhomogeneities window shows it. `r.homogeneous` and `r.graded` hold the curves, each a Curve.

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

The sides computed: `'front'`, `'back'` or `'total'`, the whole part.

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

The angle of incidence, degrees in the incident medium.

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

The wavelengths, nm.

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

**JavaScript**: The design as it stands: `R`, `T` and `A` for unpolarized light and `Rs`, `Rp`, `Ts`, `Tp`, `As` and `Ap` for s and p, each a Curve of fractions of 1.

**Python**: The design as it stands, a named tuple of Curves of fractions of 1: R, T and A for unpolarized light and Rs, Rp, Ts, Tp, As and Ap for s and p.

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

The design with the interlayers in, the same curves as `homogeneous`.

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

**JavaScript**: The interlayers, in the order given, with their defaults filled in, an array of `{ side, interface, thickness, profile, slices, materials }`: `materials` the two that meet there, by id, in the order the interlayer grades from one to the other.

**Python**: The interlayers, in the order given, with their defaults filled in, each a named tuple (side, interface, thickness, profile, slices, materials): materials the two that meet there, by id, in the order the interlayer grades from one to the other.

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

What the interlayers add to the coating, nm: the window's Σ.

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

The verdict for the design with its interlayers in, a SpecReport as specification.check() gives one, each check read at its own Step, as the badge under the window's chart reads it; `null` / `None` when the design has no specification.

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

**JavaScript**: The materials of the sides computed whose data stop inside the range, an array of `{ id, name, rangeNm, heldFlat }`: outside `rangeNm` their n and k are held at the last value (`heldFlat` true) or extrapolated. Empty when every material covers it.

**Python**: The materials of the sides computed whose data stop inside the range, a list of dicts with id, name, rangeNm and heldFlat: outside rangeNm their n and k are held at the last value (heldFlat True) or extrapolated. Empty when every material covers it.

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

**JavaScript**: Writes the curves to a CSV file as the window's Copy CSV writes its table with every curve switched on: λ (nm), then for T, Ts, Tp, R, Rs, Rp, A, As and Ap in turn the homogeneous and the graded value in %, as the headings name them. A file that is there is written over.

**Python**: Writes the curves to a CSV file as the window's Copy CSV writes its table with every curve switched on: λ (nm), then for T, Ts, Tp, R, Rs, Rp, A, As and Ap in turn the homogeneous and the graded value in %, as the headings name them. The numbers are the window's, written in Python's float notation. A file that is there is written over.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `path` | `path` |  | **JavaScript**: The file to write, by its full path. A relative path is taken from the folder the program was started from: in the Script Console, the folder TFStudio was started from, often its install folder.<br>**Python**: The file to write. A relative path is taken from the program's working folder: in the Script Console, the script's folder, or the data folder for a script not saved. |

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

The specular R and T of a design with rough interfaces, against the smooth design, as design.roughness() computes them and the Roughness / Scattering window shows them. `r.smooth` and `r.rough` hold the curves and `r.loss` the light lost from the specular beams, each a Curve.

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

The sides computed: `'front'`, `'back'` or `'total'`, the whole part.

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

The angle of incidence, degrees in the incident medium.

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

The wavelengths, nm.

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

**JavaScript**: The design as it stands: `R` and `T` for unpolarized light and `Rs`, `Rp`, `Ts` and `Tp` for s and p, each a Curve of fractions of 1.

**Python**: The design as it stands, a named tuple of Curves of fractions of 1: R and T for unpolarized light and Rs, Rp, Ts and Tp for s and p.

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

The design with its rough interfaces, the same curves as `smooth`.

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

The light lost from the specular beams, smooth R + T minus rough R + T for unpolarized light, a Curve of fractions of 1. In an absorbing design it holds the change in absorption too, and where a transition layer replaces part of an absorbing layer it can fall below 0.

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

**JavaScript**: The layers set to 0 nm because their transition layer took more than they had, an array of `{ side, number }`, numbered as the Design Editor numbers them. Empty when every layer is thicker than 2σ.

**Python**: The layers set to 0 nm because their transition layer took more than they had, each a named tuple (side, number), numbered as the Design Editor numbers them. Empty when every layer is thicker than 2σ.

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

`true` / `True` when a long-range interface with a σ above 0 is in. The long-range layer is derived for one surface at normal incidence, so at an angle, under a cone or in a multilayer it is an estimate.

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

**JavaScript**: The materials of the sides computed whose data stop inside the range, an array of `{ id, name, rangeNm, heldFlat }`: outside `rangeNm` their n and k are held at the last value (`heldFlat` true) or extrapolated. Empty when every material covers it.

**Python**: The materials of the sides computed whose data stop inside the range, a list of dicts with id, name, rangeNm and heldFlat: outside rangeNm their n and k are held at the last value (heldFlat True) or extrapolated. Empty when every material covers it.

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

**JavaScript**: Writes the curves to a CSV file as the window's Copy CSV writes its table with every curve switched on: λ (nm), then for T, Ts, Tp, R, Rs and Rp in turn the smooth and the rough value in %, then the loss in ppm, as the headings name them. A file that is there is written over.

**Python**: Writes the curves to a CSV file as the window's Copy CSV writes its table with every curve switched on: λ (nm), then for T, Ts, Tp, R, Rs and Rp in turn the smooth and the rough value in %, then the loss in ppm, as the headings name them. The numbers are the window's, written in Python's float notation. A file that is there is written over.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `path` | `path` |  | **JavaScript**: The file to write, by its full path. A relative path is taken from the folder the program was started from: in the Script Console, the folder TFStudio was started from, often its install folder.<br>**Python**: The file to write. A relative path is taken from the program's working folder: in the Script Console, the script's folder, or the data folder for a script not saved. |

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

## Stress

The stress each film carries and what the coating does to the part, as design.stress() computes them and the Stress window shows them: `s.films` the per-film table and `s.whole` the whole part.

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
const s = design.stress();
console.log(s.mode, 'force', s.whole.force, 'N/m;', s.missing.map(m => m.material).join(', '), 'state no constants');
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
s = design.stress()
print(s.mode, "force", s.whole.force, "N/m;", ", ".join(m.material for m in s.missing),
      "state no constants")
```

### mode

| JavaScript | Python |
| ---------- | ------ |
| `s.mode` | `s.mode` |

The coatings counted: `'front'`, `'back'` or `'total'`, both faces.

```js
const design = tf.newDesign('Two-sided');
design.sides = 'both';
console.log(design.stress().mode);
```

```python
design = tf.new_design("Two-sided")
design.sides = "both"
print(design.stress().mode)
```

### run

| JavaScript | Python |
| ---------- | ------ |
| `s.run` | `s.run` |

**JavaScript**: The temperatures, `{ temperature, depositionTemperature }` in °C, the one not set reading 20, or null when the design sets neither and each film carries its intrinsic stress alone.

**Python**: The temperatures, a named tuple (temperature, deposition_temperature) in °C, the one not set reading 20, or None when the design sets neither and each film carries its intrinsic stress alone.

```js
const design = tf.newDesign('Mirror');
design.depositionTemperature = 250;
console.log(design.stress().run);
```

```python
design = tf.new_design("Mirror")
design.deposition_temperature = 250
print(design.stress().run)
```

### substrate

| JavaScript | Python |
| ---------- | ------ |
| `s.substrate` | `s.substrate` |

**JavaScript**: The substrate, `{ material, thickness, diameter }`: the material by id, the thickness and the diameter in mm, the diameter null when it is not set.

**Python**: The substrate, a named tuple (material, thickness, diameter): the material by id, the thickness and the diameter in mm, the diameter None when it is not set.

```js
const design = tf.newDesign('Mirror');
design.substrate.diameter = 25.4;
console.log(design.stress().substrate);
```

```python
design = tf.new_design("Mirror")
design.substrate.diameter = 25.4
print(design.stress().substrate)
```

### whole

| JavaScript | Python |
| ---------- | ------ |
| `s.whole` | `s.whole` |

**JavaScript**: The part: `force`, Σ σ·d over the films counted, N/m; `radius`, the radius of curvature, m, null at no force; `deflection`, the centre deflection, µm, null without a diameter; `strainEnergy`, the films' total, J/m²; `cracking`, the sum over the films of U/2γ. With coatings on both faces the force is F_front − F_back; a coating on one face alone reads the same on the back as on the front. The radius and the deflection are positive for the convex face a compressive coating leaves. Each null when a constant it needs is missing; a film that states no stress counts as carrying none in the force, the radius and the deflection, and leaves the strain energy and the cracking parameter null.

**Python**: The part, a named tuple: force, Σ σ·d over the films counted, N/m; radius, the radius of curvature, m, None at no force; deflection, the centre deflection, µm, None without a diameter; strain_energy, the films' total, J/m²; cracking, the sum over the films of U/2γ. With coatings on both faces the force is F_front − F_back; a coating on one face alone reads the same on the back as on the front. The radius and the deflection are positive for the convex face a compressive coating leaves. Each None when a constant it needs is missing; a film that states no stress counts as carrying none in the force, the radius and the deflection, and leaves the strain energy and the cracking parameter None.

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
console.log(design.stress().whole);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
print(design.stress().whole)
```

### films

| JavaScript | Python |
| ---------- | ------ |
| `s.films` | `s.films` |

**JavaScript**: One per film counted, front first, each `{ side, number, material, name, thickness, stress, strainEnergy, delamination, shear }`: number from 1 at the substrate, as `layers` numbers them; material by id and name as the window shows it; thickness in nm; stress in MPa, tensile positive; strainEnergy in J/m²; delamination, at 1 the energy to let go at the interface below the film; shear, the peak shear at the coating's edge, MPa. stress is null when the material states none; strainEnergy is then null too, and so is the delamination of that film and of every film below it, while shear counts it as carrying none. A missing thermal constant does not leave stress null: with the temperatures set, it leaves out the terms that need that constant, as design.stress() says. The other three are null when another constant they need is missing.

**Python**: One per film counted, front first, each a named tuple (side, number, material, name, thickness, stress, strain_energy, delamination, shear): number from 1 at the substrate, as layers numbers them; material by id and name as the window shows it; thickness in nm; stress in MPa, tensile positive; strain_energy in J/m²; delamination, at 1 the energy to let go at the interface below the film; shear, the peak shear at the coating's edge, MPa. stress is None when the material states none; strain_energy is then None too, and so is the delamination of that film and of every film below it, while shear counts it as carrying none. A missing thermal constant does not leave stress None: with the temperatures set, it leaves out the terms that need that constant, as design.stress() says. The other three are None when another constant they need is missing.

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^2 H');
for (const film of design.stress().films) console.log(film.number, film.name, film.thickness.toFixed(2), 'nm', film.stress);
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^2 H")
for film in design.stress().films:
    print(film.number, film.name, round(film.thickness, 2), "nm", film.stress)
```

### missing

| JavaScript | Python |
| ---------- | ------ |
| `s.missing` | `s.missing` |

**JavaScript**: The materials that leave a constant out, the substrate's included, an array of `{ material, name, fields }`: material by id, and fields the constants it lacks by their names on the material's mechanical record. Each material is listed once: one that is the substrate and a film, or that two ids name, as `SiO2` and `builtin:SiO2` do, is one entry, under the id the films name it by first. Empty when every material states every constant.

**Python**: The materials that leave a constant out, the substrate's included, each a named tuple (material, name, fields): material by id, and fields the constants it lacks by their names on the material's mechanical record. Each material is listed once: one that is the substrate and a film, or that two ids name, as SiO2 and builtin:SiO2 do, is one entry, under the id the films name it by first. Empty when every material states every constant.

```js
const design = tf.newDesign('Mirror');
design.stack('(HL)^2 H');
for (const m of design.stress().missing) console.log(m.material, m.fields.join(', '));
```

```python
design = tf.new_design("Mirror")
design.stack("(HL)^2 H")
for m in design.stress().missing:
    print(m.material, ", ".join(m.fields))
```

### saveCsv / save_csv

| JavaScript | Python |
| ---------- | ------ |
| `s.saveCsv(path)` | `s.save_csv(path)` |

**JavaScript**: Writes the films to a CSV file as the window's Copy CSV writes its per-film table: the side when both faces are counted, then the layer, the material, d (nm), the stress (MPa), U (J/m²), the delamination factor and the edge shear (MPa), an empty cell where `films` holds null. A file that is there is written over.

**Python**: Writes the films to a CSV file as the window's Copy CSV writes its per-film table: the side when both faces are counted, then the layer, the material, d (nm), the stress (MPa), U (J/m²), the delamination factor and the edge shear (MPa), an empty cell where films holds None. The numbers are the window's, written in Python's float notation. A file that is there is written over.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `path` | `path` |  | **JavaScript**: The file to write, by its full path. A relative path is taken from the folder the program was started from: in the Script Console, the folder TFStudio was started from, often its install folder.<br>**Python**: The file to write. A relative path is taken from the program's working folder: in the Script Console, the script's folder, or the data folder for a script not saved. |

```js
const file = require('path').join(require('os').homedir(), `stress-${Date.now()}.csv`);
const design = tf.newDesign('Mirror');
design.stack('(HL)^4 H');
design.stress().saveCsv(file);
console.log('Wrote', file);
```

```python
import time

name = "stress-{}.csv".format(time.time_ns())
design = tf.new_design("Mirror")
design.stack("(HL)^4 H")
design.stress().save_csv(name)
print("Wrote", name)
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

### range

| JavaScript | Python |
| ---------- | ------ |
| `material.range` | `material.range` |

The range of wavelengths the material's data cover, `[first, last]` in nm, or `null` / `None` when it states none, as a formula with no stated range.

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

Phase, group delay, GDD, CDC and TOD of light through a slab of the material, and its group index, against wavelength, as the Material Dispersion window computes them: φ = −(d/c)·ω·n of the slab of thickness d and its derivatives against ω, from the material's formula or its table read as the app reads it, so the values are analytic at each wavelength and the phase is absolute. The wavelengths are the window's, 2000 steps over the range and never finer than 0.2 nm, with a sample on each table knot in range. Light the slab absorbs to an optical depth above 50 leaves no value.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `start` | `start` | `400` | The first wavelength, nm. |
| `end` | `end` | `1100` | The last wavelength, nm, above `start`. |
| `thickness` | `thickness` | `1` | The slab's thickness, mm, from 1e-9 (1 pm) to 100000 (100 m). |

**Returns**: A MaterialDispersion.

**Refuses**:

- **JavaScript**: an option it does not take, a range that is not one, or a thickness outside 1e-9 to 100000 mm<br>**Python**: a range that is not one, or a thickness outside 1e-9 to 100000 mm

```js
const d = tf.materials.get('BK7').dispersion(700, 900, { thickness: 2 });
console.log('2 mm of BK7: GDD from', d.gdd.min().toFixed(1), 'to', d.gdd.max().toFixed(1), 'fs²');
```

```python
d = tf.materials["BK7"].dispersion(700, 900, thickness=2)
print("2 mm of BK7: GDD from", round(d.gdd.min(), 1), "to", round(d.gdd.max(), 1), "fs²")
```

## MaterialDispersion

Phase, group delay, GDD, CDC and TOD of light through a slab of one material, and its group index, against wavelength, as material.dispersion() computes them and the Material Dispersion window shows them. `d.phase`, `d.gd`, `d.gdd`, `d.cdc`, `d.tod` and `d.groupIndex` / `d.group_index` are Curves.

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

The slab's thickness, mm.

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

The wavelengths, nm: the window's grid, with a sample on each table knot in range.

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

The phase φ = −(d/c)·ω·n, degrees, a Curve.

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

The group delay, fs, a Curve.

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

The GDD, fs², a Curve.

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

The CDC, GDD · 2πc/λ², fs/nm, a Curve, with the sign of GDD; the slope of group delay against wavelength, dGD/dλ, is its negative.

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

The TOD, fs³, a Curve.

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

The group index n − λ·dn/dλ, a Curve.

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

For each wavelength, the material's name where its value was taken outside the material's data, held at the edge or extrapolated, or `null` / `None`.

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

**JavaScript**: The wavelengths with no value, an array of `{ wavelength, reason, maximumThickness }`. `reason` says why: most often the slab absorbs the light there to an optical depth above 50, and `maximumThickness`, mm, is then the thickness up to which it would have one; it is `null` when no thickness gives one, as where the material's model has no third derivative. The curves are NaN there. Empty when every wavelength has one.

**Python**: The wavelengths with no value, a list of dicts with wavelength, reason and maximumThickness. reason says why: most often the slab absorbs the light there to an optical depth above 50, and maximumThickness, mm, is then the thickness up to which it would have one; it is None when no thickness gives one, as where the material's model has no third derivative. The curves are NaN there. Empty when every wavelength has one.

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

**JavaScript**: The table knots that are wavelengths of the grid, an array of `{ wavelength, gd, gdd, tod, cdc }`, each quantity a pair `[left, right]` of its values on the two sides of the knot; the value the curves hold at that wavelength reads the material averaged across the knot. None is read when the knots are dense against the grid, more than one per 8 points.

**Python**: The table knots that are wavelengths of the grid, a list of dicts with wavelength, gd, gdd, tod and cdc, each quantity a pair [left, right] of its values on the two sides of the knot; the value the curves hold at that wavelength reads the material averaged across the knot. None is read when the knots are dense against the grid, more than one per 8 points.

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

The models the material's n and k come from, as the window names them.

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

**JavaScript**: Writes the curves to a CSV file as the window's Copy CSV writes its table: λ (nm), then Outside data where a value was taken outside the material's data, then Phase φ (°), Group Delay (fs), GDD (fs²), CDC (fs/nm), TOD (fs³) and nᵧ, the group index. A file that is there is written over.

**Python**: Writes the curves to a CSV file as the window's Copy CSV writes its table: λ (nm), then Outside data where a value was taken outside the material's data, then Phase φ (°), Group Delay (fs), GDD (fs²), CDC (fs/nm), TOD (fs³) and nᵧ, the group index. The numbers are the window's, written in Python's float notation. A file that is there is written over.

| JavaScript | Python | Default | Meaning |
| ---------- | ------ | ------- | ------- |
| `path` | `path` |  | **JavaScript**: The file to write, by its full path. A relative path is taken from the folder the program was started from: in the Script Console, the folder TFStudio was started from, often its install folder.<br>**Python**: The file to write. A relative path is taken from the program's working folder: in the Script Console, the script's folder, or the data folder for a script not saved. |

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
