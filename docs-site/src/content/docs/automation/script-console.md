---
title: Script Console
description: Run a script in JavaScript or Python on the open design, and keep the design it leaves as one undo step.
ribbonIcon: script-console
---

The **Script Console** window runs a script on the open design, written in JavaScript or in Python. A script works with TFStudio's designs as objects: it can build and clean a stack, read its index profile, layer thicknesses and total thickness, compute a side's admittance locus, electric field, Ψ and Δ, and phase, group delay and GDD, compute a material's dispersion, compute spectra, colour, integral values and the merit function, find a band's peak, edge and FWHM and how an edge moves with angle, check the design against its specification and count its yield, run refinement and synthesis, write files and print what it finds. The window opens from the **Scripts** group of the **Optimization** tab. Its buttons sit in one row over the editor, and what the script prints shows under the editor; drag the bar between the two to share the window as you need.

A script runs with the rights of any program you run: it can read, write and delete your files and start other programs. Run only scripts you trust.

## The editor

The editor colours the script by its language, numbers its lines and marks the bracket that matches the one at the cursor. Ctrl+F opens search and Ctrl+G goes to the next match. Tab indents the line; to move to the next control instead, press Escape, then Tab. When a script stops on an error, the editor marks the line the error came from and scrolls to it.

The **Language** picker in the row sets the script's language, JavaScript or Python. **Open…** reads a `.js` or `.py` file into the editor and sets the language from its extension. Opening a file never runs it; it runs only when you press **Run**. When the editor holds a script that is not saved to a file, or has changed since it was, **Open…** asks before it replaces it. **Save…** writes the editor's text to a `.js` or `.py` file, by the language.

The editor keeps your script when you close the window and when you quit TFStudio, saved or not: a window that opens with an empty editor gets the last script back. It is not run.

## Run a script

Press **Run**, or Ctrl+Enter in the editor. While the script runs, the row shows how long it has been running, and when it ends, how it ended and after how many seconds. The script shows no progress of its own: print what you want to follow. **Stop** ends the script at once and changes nothing; what it printed in the last quarter of a second may not show. Hiding or closing the window stops the script too, and so does moving it to another group or tearing it off; the output then says the script was stopped.

The output keeps the newest lines the script printed. When it has printed more than the output keeps, the first line says how many earlier lines are not shown, and a very long line is cut with a note of how much of it is not shown. When the script stops on an error, the output shows the message and the line of the script it came from.

The keys in the editor:

| Keys | What they do |
| ---- | ------------ |
| Ctrl+Enter | Runs the script. |
| Ctrl+Z, Ctrl+Y or Ctrl+Shift+Z | Undo and redo your typing, not a change to the design. |
| Ctrl+F, Ctrl+G | Search the script, and go to the next match. |
| Tab | Indents the line; Escape, then Tab, leaves the editor. |
| Ctrl+S, Ctrl+O, Ctrl+N | Do nothing while the editor has focus. |

## Python scripts

A Python script runs in your own Python, 3.8 or newer; TFStudio does not ship Python. It uses the Python set under **Python for scripts** in Preferences, then Automation, and with none set, the `py` launcher on Windows, then `python3` or `python` on the PATH. When none is found, choosing Python says so and where to set the path. TFStudio gives the script its own `tfstudio` package, so nothing needs installing for the console; the [Python](/automation/python/) page says how to use the same package in a program of your own.

A Python script runs in the folder of its file, so its relative paths and imports find the files beside it; a script not saved to a file runs in the data folder. A saved script whose folder is no longer there is not run.

## What a script gets

Both languages give the script `tf`, which holds TFStudio's designs and materials, and `tf.design`, the open design, or `null` in JavaScript and `None` in Python when no design is open. What `tf` and a design offer, in both languages, is in the [API Reference](/automation/api-reference/). A design computes with the code the windows compute with, so its numbers are the app's. The materials are the built-in ones, those in your catalogs in the data folder, and the copies a design carries.

In JavaScript, the script is the body of an async function, so it can use `await` anywhere. Beside `tf` it gets two names:

- `console`: `console.log`, `info`, `warn`, `error` and `debug` print to the output.
- `require`: Node's `require`, for Node's own modules such as `fs` and `path`, and for files beside a saved script. `import()` is not available.

A file loaded with `require` prints to the app log, not to the output, unless the script hands it its `console`, for example as an argument. Relative paths in `fs` calls, `tf.openDesign` and `save` are taken from the folder TFStudio was started from, not from the script's folder, so give full paths.

In Python, what the script prints goes to the output, and so do its errors and warnings. It reads nothing from input. `import tfstudio` gives it the package's other names, such as `tfstudio.Stop` and `tfstudio.TFStudioError`.

## What happens to the design

When the script ends, the design it left in `tf.design`, whether the script changed it in place or put another design there, is applied to the open design as one step: Undo (Ctrl+Z) puts the design back as it was before the run. The design keeps its name. A script that left `tf.design` as it was changes nothing.

The design is applied only to the design the script started on, and only while that design is as it was at the start. If you edited it, undid or redid a step, or selected another design while the script ran, or a run in another window such as Refinement is still going when the script ends, the output says that it was not applied and why. To keep a result whatever happens, save it from the script with `save`.

## Examples

Each example builds the design it works on, so it runs whatever design is open. Each is shown in JavaScript, then in Python.

### A mirror's reflectance across its stop band

A quarter-wave mirror, `(HL)^8 H` at 550 nm, and where its reflectance is 99 % or more:

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

### Refine an antireflection coating

Four alternating layers, an antireflection target over 450-650 nm with no layer thinner than 10 nm, and a refinement with SQP, which moves the thicknesses alone. The script puts the result in `tf.design`, so it is applied to the open design:

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

### Grow a design with Needle

Needle grows an antireflection coating over 420-680 nm from one SiO2 layer, with TiO2 and SiO2, up to 12 layers:

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

### Scan the angle of incidence

Rs and Rp of the mirror at 550 nm from 0 to 80 degrees. A spectrum takes a range of wavelengths, so the scan asks for 550 to 551 nm and reads the first:

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

### Write R, T and A for s and p to a file

The mirror's spectrum at 45 degrees as a CSV file in your home folder, one row per wavelength, named by the time so that it writes over nothing:

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

`refine` and `synthesize` work against the design's merit function: set it in the [Merit Function Editor](/design/merit-function-editor/), or from the script with `merit.add` as above.
