---
title: AI Agents (MCP)
description: Let an AI assistant open, compute, refine and save TFStudio designs through the Model Context Protocol.
---

TFStudio can hand its design tools to an AI assistant such as Claude, through the Model Context Protocol (MCP). The assistant can then open and build designs, compute spectra and merit functions, run refinement and synthesis, and save the result as a `.tfs` file that you open in the app. It computes with the same code as the app's windows, so its numbers are the ones the app shows.

## Connect an assistant

The installed app is the server. Started with `--mcp`, TFStudio opens no window and talks to the assistant over its standard input and output. It can run while the app is open.

**Claude Desktop**: open Settings, then Developer, then Edit Config, and add TFStudio under `mcpServers` in `claude_desktop_config.json`, with the path of your install:

```json
{
  "mcpServers": {
    "tfstudio": {
      "command": "C:\\Users\\you\\AppData\\Local\\Programs\\TFStudio\\TFStudio.exe",
      "args": ["--mcp"]
    }
  }
}
```

**Claude Code**: add it from a terminal.

```bash
claude mcp add tfstudio -- "C:\Users\you\AppData\Local\Programs\TFStudio\TFStudio.exe" --mcp
```

Restart the assistant after adding the server.

The server works on the data folder the app uses: `Documents\TFStudio` unless you moved it in Preferences. Its materials, including your own catalogs and the library catalogs, are the ones the app sees. It reads designs and catalogs and writes only the `.tfs` files the assistant saves, and a file that already exists is written over only when the assistant asks for that. Beside them it keeps a log of its own, `mcp-server.log` next to the app.

## What the assistant can do

| Group | Tools |
| ----- | ----- |
| Designs | `openDesign`, `newDesign`, `setDesignSetup`, `saveDesign`, `showDesign`, `listDesigns`, `copyDesign`, `designDifferences` |
| Stack | `insertLayer`, `deleteLayer`, `setLayer`, `stackFromFormula`, `cleanDesign`, `scaleThicknesses`, `quantize`, `perturb`, `flipLayers`, `copySide` |
| Merit function | `setMerit`, `merit` |
| Specification | `setSpecification`, `checkSpecification` |
| Materials | `findMaterials`, `materialNK`, `materialDispersion` |
| Analysis | `spectrum`, `layerSensitivity`, `indexProfile`, `layerThicknesses`, `designFacts`, `admittance`, `electricField`, `color`, `integrals`, `ellipsometry`, `ellipsometryVsAngle`, `groupDelay`, `bandFeature`, `edgeShift` |
| Runs | `refine`, `synthesize`, `monteCarlo`, `jobStatus`, `stopJob`, `listJobs` |
| The open design, with `--live` | `listAppDesigns`, `readAppDesign`, `applyToApp` |

`spectrum` computes R, T, A, Rs and Rp as the [Optical Evaluation](/analysis/optical-evaluation/) window does, `merit` gives the total and each row as the [Merit Function Editor](/design/merit-function-editor/) shows them, `refine` runs any method of the [Refinement](/synthesis/refinement/) window, and `synthesize` runs [Needle](/synthesis/needle/), [Gradual Evolution](/synthesis/gradual-evolution/) or the [Structural Optimizer](/synthesis/structural-optimizer/). `monteCarlo` and `layerSensitivity` are the [Monte Carlo](/analysis/error-analysis/) and [Layer Sensitivity](/analysis/layer-sensitivity/) windows' computations. Merit rows take the operands of the [Operand Reference](/design/operands/). `setSpecification` takes the checks of the [Specification](/design/specification/) window, `checkSpecification` judges a design against them as the window does, with how far each value is from its bound, and `monteCarlo` on a design with checks also counts its yield. `cleanDesign` merges adjacent layers of one material and takes out thin ones, as the [Design Cleaner](/synthesis/design-cleaner/) does. `quantize` and `perturb` round a side's thicknesses or give them random errors, with a seed, as the [Design Editor](/design/design-editor/)'s Round and Perturb dialogs do, `flipLayers` and `copySide` are its Invert and Copy buttons, `scaleThicknesses` makes a side thicker or thinner by one factor, and `designDifferences` lists what differs between two designs. `indexProfile` and `layerThicknesses` read the stack at one wavelength as the [Refractive Index Profile](/analysis/refractive-index-profile/) and [Layer Thicknesses](/analysis/layer-thicknesses/) windows do, and `designFacts` gives the total and optical thickness, the layers of each material and each layer's QWOT, which `setLayer` also takes. `admittance` and `electricField` compute one coated side at one wavelength as the [Admittance Diagram](/analysis/admittance/) and [Electric Field](/analysis/efield/) windows do: the locus with the admittance and reflection coefficient at each layer's outer surface, and the field through the layers with its peak and the layer it sits in. `color` and `integrals` compute what the [Color Evaluation](/analysis/color-evaluation/) and [Integral Values](/analysis/integral-values/) windows show, on the sides the design is scored on and averaged over its cone of incidence: the CIE colour of R or T with its colour spaces, dominant wavelength and colour temperature, and the weighted averages Tvis to RNIR with rows of your own. `ellipsometry` and `ellipsometryVsAngle` compute one coated side's Ψ and Δ as the [Ellipsometry](/analysis/ellipsometry/) window does, against wavelength at one angle or several, or against angle at one wavelength, with Δ in the sign an ellipsometer writes or the reversed one. `groupDelay` computes the phase, group delay, GDD, TOD and CDC of one coated side as the [Group Delay / GDD](/analysis/gd-gdd/) window does, in reflection or transmission, on an even wavelength step or the window's own grid, and in transmission also through the whole part as [Pulse Analysis](/analysis/pulse-analysis/) does. `materialDispersion` computes the phase, group delay, GDD, CDC and TOD of a slab of one material and its group index, as the [Material Dispersion](/analysis/material-dispersion/) window does.

## How it works

- **Designs by id.** The assistant works on designs held by the server under ids such as `d1`. Unless the server runs with `--live`, nothing it does reaches the designs open in the app; to see a result, open the file it saved.
- **Full paths.** Files are opened and saved by their full path, such as `C:\Users\you\Documents\TFStudio\Projects\AR.tfs`, since the folder the server runs in depends on how the assistant started it.
- **Runs are jobs.** `refine`, `synthesize` and `monteCarlo` start a job on a thread of its own and answer within half a minute with the job's state. The assistant follows a longer run with `jobStatus` and can stop it with `stopJob`. A run that changes the design adds its answer as a new design, so the one it started from stays for comparison.
- **Units.** Wavelengths and layer thicknesses are in nm, angles in degrees in the incident medium, the substrate thickness in mm. R, T and A are fractions of 1, also in merit targets, where the Merit Function Editor shows percent.
- **Refusals.** A misspelt argument, an unknown material or a value a tool cannot use is refused with a message that says what the tool takes, so nothing runs on a value the assistant did not ask for.

## Work on the open design

With `--live` the assistant can also work on the design open in TFStudio while you watch it change. Add `--live` after `--mcp` where you added the server, so that its arguments read:

```json
"args": ["--mcp", "--live"]
```

In Claude Code the command ends in `--mcp --live`.

Then, before you ask the assistant to work on the open design, click **Interactive** in the **Scripts** group of TFStudio's **Optimization** tab. A window holds the rest of the app while the assistant works. It reads "Waiting for a program to connect.", then "Connected:" and the assistant's name. Meanwhile you cannot edit, switch designs or start runs, and the windows behind it keep showing the design as the assistant changes it. **Terminate** lets the assistant go and gives the app back. An assistant that reaches TFStudio while it is not listening is told to have Interactive clicked.

The assistant reads a copy of the open design, changes the copy with the tools above, and writes it back:

- **One step to undo.** Each change it writes back is one step in the design's history, so Ctrl+Z takes it back, and a notice names the design it changed. The change stays unsaved until you save the design.
- **Only the open design.** The assistant can read any design in the project explorer, but it writes only to the one that is open.
- **Your edits come first.** If the design changed after the assistant read it, by an edit, an undo or a run, its write is refused and it is told to read the design again, so nothing you did is written over. A write is also refused while a run is going in one of the app's windows.
- **Runs without a window.** A refinement or synthesis the assistant starts runs in the server. When the assistant asks for it, the result is written back as one step when the run ends, if the design is still as it was when the assistant read it. A run that is stopped writes nothing.
- **New materials.** The server reads the catalogs when it starts, so a material you add in the app later reaches the assistant after you restart the assistant.

**Start listening when TFStudio starts**, in Preferences, then Automation, has TFStudio listen from the moment it starts, without Interactive, for an assistant you leave working. TFStudio then asks before a program connects for the first time, with **Allow** and **Deny**, and holds the app once you allow it; a program you deny, or let go with Terminate, gets back in only through Interactive. While the setting is on, any program you run can ask to work on your designs; other users of the computer cannot reach it. It is off by default, so leave it off unless you need it.

An assistant that works on files, without `--live`, needs none of this: it opens and saves `.tfs` files beside you, and the app does not wait for it.
