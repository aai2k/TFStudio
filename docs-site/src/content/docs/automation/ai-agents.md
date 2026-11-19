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

**Other assistants**: an assistant that starts MCP servers itself takes the same two settings, the path of `TFStudio.exe` as the command and `--mcp` as its argument. Codex, Cursor, Cline and Cherry Studio do, whichever model you run in them. ChatGPT's app connects only to servers it reaches over the internet, so it cannot start TFStudio.

Restart the assistant after adding the server.

The server works on the data folder the app uses: `Documents\TFStudio` unless you moved it in Preferences. Its materials, including your own catalogs and the library catalogs, are the ones the app sees. It reads designs and catalogs and writes only the `.tfs` files the assistant saves, and a file that already exists is written over only when the assistant asks for that. Beside them it keeps a log of its own, `mcp-server.log` next to the app.

## What the assistant can do

| Group | Tools |
| ----- | ----- |
| Method | `designMethod` |
| Designs | `openDesign`, `newDesign`, `setDesignSetup`, `saveDesign`, `showDesign`, `listDesigns`, `copyDesign`, `designDifferences` |
| Stack | `insertLayer`, `deleteLayer`, `setLayer`, `stackFromFormula`, `cleanDesign`, `scaleThicknesses`, `quantize`, `perturb`, `flipLayers`, `copySide`, `edgeFilter`, `applyEdgeFilter`, `needleProfile`, `insertNeedle` |
| Environments | `environments`, `addEnvironment`, `setEnvironment`, `removeEnvironment` |
| Merit function | `setMerit`, `merit` |
| Specification | `setSpecification`, `checkSpecification` |
| Materials | `findMaterials`, `materialNK`, `materialDispersion` |
| Analysis | `spectrum`, `layerSensitivity`, `indexProfile`, `layerThicknesses`, `designFacts`, `admittance`, `electricField`, `color`, `integrals`, `ellipsometry`, `ellipsometryVsAngle`, `groupDelay`, `pulseAnalysis`, `setPulseSpectrum`, `inhomogeneities`, `roughness`, `stress`, `bandFeature`, `edgeShift`, `readSpectrumFile`, `measuredDifference`, `readEllipsometryFile`, `addMeasuredCurves`, `fitMeasured`, `exportMeasuredCurves`, `processSteps`, `exportProcess`, `monitorWorksheet` |
| Coating files | `saveZemaxCoating`, `readZemaxCoating`, `importZemaxCoating`, `saveCodevCoating`, `readCodevCoating`, `importCodevCoating` |
| Runs | `refine`, `synthesize`, `monteCarlo`, `jobStatus`, `stopJob`, `listJobs` |
| The open design, with `--live` | `listAppDesigns`, `selectAppDesign`, `readAppDesign`, `applyToApp`, `addAppDesign`, `deleteAppDesign` |

Each tool computes as its window does, with the same code, so its numbers are the ones the app shows:

| Tool | Computes as |
|---|---|
| `spectrum`, `bandFeature`, `edgeShift` | [Optical Evaluation](/analysis/optical-evaluation/): R, T, A, Rs and Rp; a band's peak, edge and FWHM; how an edge moves with angle |
| `merit`, `setMerit` | the [Merit Function Editor](/design/merit-function-editor/), total and each row, with the operands of the [Operand Reference](/design/operands/) |
| `refine`, `synthesize` | [Refinement](/synthesis/refinement/), any method; [Needle](/synthesis/needle/), [Gradual Evolution](/synthesis/gradual-evolution/) or the [Structural Optimizer](/synthesis/structural-optimizer/) |
| `monteCarlo`, `layerSensitivity` | [Monte Carlo](/analysis/error-analysis/), with the yield on a design with checks; [Layer Sensitivity](/analysis/layer-sensitivity/) |
| `setSpecification`, `checkSpecification` | the [Specification](/design/specification/), with how far each value is from its bound |
| `cleanDesign`, `quantize`, `perturb`, `flipLayers`, `copySide`, `scaleThicknesses`, `designDifferences` | the [Design Cleaner](/synthesis/design-cleaner/); the [Design Editor](/design/design-editor/)'s Round, Perturb (with a seed), Invert and Copy; one thickness factor for a side; what differs between two designs |
| `environments`, `addEnvironment`, `setEnvironment`, `removeEnvironment` | the [Environments](/design/environments/) window |
| `edgeFilter`, `applyEdgeFilter` | the [Edge Filter](/design/edge-filter/) search, and its Replace or Append |
| `needleProfile`, `insertNeedle` | [Needle Manual](/synthesis/needle/#needle-manual)'s profile and Apply |
| `indexProfile`, `layerThicknesses`, `designFacts` | the [Refractive Index Profile](/analysis/refractive-index-profile/) and [Layer Thicknesses](/analysis/layer-thicknesses/) at one wavelength; total and optical thickness, layers per material and each layer's QWOT |
| `admittance`, `electricField` | the [Admittance Diagram](/analysis/admittance/) and [Electric Field](/analysis/efield/), one coated side at one wavelength |
| `color`, `integrals` | [Color Evaluation](/analysis/color-evaluation/) and [Integral Values](/analysis/integral-values/), on the scored sides and over the cone |
| `ellipsometry`, `ellipsometryVsAngle` | [Ellipsometry](/analysis/ellipsometry/), against wavelength or angle, Δ in either sign |
| `groupDelay`, `pulseAnalysis`, `setPulseSpectrum` | [Group Delay / GDD](/analysis/gd-gdd/) and [Pulse Analysis](/analysis/pulse-analysis/), from a model pulse or a spectrum set on the design |
| `inhomogeneities`, `roughness`, `stress`, `materialDispersion` | [Inhomogeneities](/analysis/inhomogeneities/) with the specification verdict, [Roughness / Scattering](/analysis/roughness-scattering/), [Stress](/analysis/stress/) from the materials' constants and `setDesignSetup`, [Material Dispersion](/analysis/material-dispersion/) |
| `processSteps`, `exportProcess`, `monitorWorksheet` | the [Process Exporter](/simulation/process-simulator/) and its Save; the [Monitor Worksheet](/simulation/monitor-worksheet/) rows |
| `saveZemaxCoating`, `readZemaxCoating`, `importZemaxCoating`, and the same three for `Codev` | the [Zemax Coatings](/data-exchange/zemax-coatings/) and [CODE V Coatings](/data-exchange/codev-coatings/) windows; an import carries the file's materials in the design rather than a catalog |

On a design with more than one environment, a merit row or specification check takes `env` to be scored in one environment alone; `merit` gives each environment's merit beside the total; `refine`, `synthesize` and `needleProfile` score every environment that is on, and so do `checkSpecification` and the yield. The analysis tools compute environment 1 unless `env` names another, and every environment that is on with `env: 'all'`.

## The design method

`designMethod` gives the assistant the order a coating engineer works in: the requirement, the materials, a starting stack, the merit function, refinement and synthesis, a stack the coater can make, the specification and the yield. The server tells the assistant to read it before a design job.

The same text ships as an Agent Skill, a folder an assistant loads on its own when a task is about coatings. It is `skills\coating-design` in the `resources` folder of the install, such as `C:\Users\you\AppData\Local\Programs\TFStudio\resources\skills\coating-design`, and in the `skills` folder of the TFStudio repository on GitHub. Copy that folder into the skills folder your assistant reads, which its documentation names; Claude Code reads `%USERPROFILE%\.claude\skills`, and Claude Desktop takes the folder as a zip file in its settings. With Node.js installed, `npx skills add aai2k/TFStudio -g` installs it from GitHub for the assistants you choose. An assistant that reads no skills still gets the method from the tool.

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
- **Open, add and delete.** The assistant can open any design in the project explorer, so nothing needs to be open when it connects. It can add a design to a project folder, one it made or a blank one, and delete one: the file goes to the Recycle Bin without a question, and a design with edits that are not saved is not deleted. A notice names each design it adds or deletes.
- **Your edits come first.** If the design changed after the assistant read it, by an edit, an undo or a run, its write is refused and it is told to read the design again, so nothing you did is written over. A write is also refused while a run is going in one of the app's windows.
- **Runs without a window.** A refinement or synthesis the assistant starts runs in the server. When the assistant asks for it, the result is written back as one step when the run ends, if the design is still as it was when the assistant read it. A run that is stopped writes nothing.
- **New materials.** The server reads the catalogs when it starts, so a material you add in the app later reaches the assistant after you restart the assistant.

**Start listening when TFStudio starts**, in Preferences, then Automation, has TFStudio listen from the moment it starts, without Interactive, for an assistant you leave working. TFStudio then asks before a program connects for the first time, with **Allow** and **Deny**, and holds the app once you allow it; a program you deny, or let go with Terminate, gets back in only through Interactive. While the setting is on, any program you run can ask to work on your designs; other users of the computer cannot reach it. It is off by default, so leave it off unless you need it.

An assistant that works on files, without `--live`, needs none of this: it opens and saves `.tfs` files beside you, and the app does not wait for it.
