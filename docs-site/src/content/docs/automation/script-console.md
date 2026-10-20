---
title: Script Console
description: Run a JavaScript script on the open design with the TFStudio API, and keep the design it leaves as one undo step.
ribbonIcon: script-console
---

The **Script Console** window runs a script written in JavaScript on the open design. A script has the calls of the TFStudio API: it can build a stack, compute spectra and the merit function, run refinement and synthesis, write files and print what it finds. The window opens from the **Scripts** group of the **Optimization** tab. Its buttons sit in one row over the editor, and what the script prints shows under the editor; drag the bar between the two to share the window as you need.

A script runs with the rights of any program you run: it can read, write and delete your files and start other programs. Run only scripts you trust.

## Run a script

Write the script in the editor and press **Run**, or Ctrl+Enter in the editor. While it runs, the row shows how long it has been running, and when it ends, how it ended and after how many seconds. The script shows no progress of its own: print what you want to follow. **Stop** ends the script at once and changes nothing; what it printed in the last quarter of a second may not show. Hiding or closing the window stops the script too, and so does moving it to another group or tearing it off; the output then says the script was stopped.

The output keeps the newest lines the script printed. When it has printed more than the output keeps, the first line says how many earlier lines are not shown, and a very long line is cut with a note of how much of it is not shown.

When the script stops on an error, the output shows the message and the line of the script it came from.

While the editor has focus, Ctrl+Z and Ctrl+Y undo and redo your typing rather than a change to the design, and Ctrl+S, Ctrl+O and Ctrl+N do nothing.

## Open and save

**Open…** reads a `.js` file into the editor. Opening a file never runs it; it runs only when you press **Run**. When the editor holds a script that is not saved to a file, or has changed since it was, **Open…** asks before it replaces it. **Save…** writes the editor's text to a `.js` file.

The editor keeps your script when you close the window and when you quit TFStudio, saved or not: a window that opens with an empty editor gets the last script back. It is not run.

## What a script gets

The script is the body of an async function, so it can use `await` anywhere. It gets three names:

- `tf`: the TFStudio API, with `tf.design` the open design, or `null` when no design is open.
- `console`: `console.log`, `info`, `warn`, `error` and `debug` print to the output.
- `require`: Node's `require`, for Node's own modules such as `fs` and `path`, and for files beside a saved script. `import()` is not available.

A file loaded with `require` prints to the app log, not to the output, unless the script hands it its `console`, for example as an argument. Relative paths in `fs` calls, `tf.openDesign` and `tf.saveDesign` are taken from the folder TFStudio was started from, not from the script's folder, so give full paths.

The calls on `tf`:

| Group | Calls |
| ----- | ----- |
| Designs | `openDesign`, `saveDesign`, `newDesign`, `setDesignSetup` |
| Stack | `insertLayer`, `deleteLayer`, `setLayer`, `stackFromFormula` |
| Materials | `findMaterials`, `materialNK` |
| Analysis | `spectrum`, `summarize`, `layerSensitivity`, `monteCarlo` |
| Merit function | `setMerit`, `merit` |
| Runs | `refine`, `synthesize`, `runHooks` |

They compute with the code the windows compute with, so their numbers are the app's. Wavelengths and layer thicknesses are in nm, angles in degrees in the incident medium, the substrate thickness in mm, and R, T and A are fractions of 1. A call that changes a design returns a new one and leaves the one it was given as it was. The materials are the built-in ones, those in your catalogs in the data folder, and the copies a design carries.

## What happens to the design

When the script ends, the design it left in `tf.design`, whether a call replaced it or the script changed it in place, is applied to the open design as one step: Undo (Ctrl+Z) puts the design back as it was before the run. The design keeps its name. A script that left `tf.design` as it was changes nothing.

The design is applied only to the design the script started on, and only while that design is as it was at the start. If you edited it, undid or redid a step, or selected another design while the script ran, or a run in another window such as Refinement is still going when the script ends, the output says that it was not applied and why. To keep a result whatever happens, save it from the script with `tf.saveDesign`.

## Examples

The reflectance of the open design from 450 to 650 nm:

```js
const s = tf.spectrum(tf.design, { from: 450, to: 650, step: 5 });
const [band] = tf.summarize(s)[0];
console.log(`R from ${band.R.min} to ${band.R.max}, mean ${band.R.mean}`);
```

Refine the open design against its merit function, keep the result, and write its transmittance to a CSV file in your home folder:

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

The design needs a merit function for `refine`: set one in the [Merit Function Editor](/design/merit-function-editor/), or from the script with `tf.setMerit`.
