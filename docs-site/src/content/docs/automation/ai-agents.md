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

The server works on the data folder the app uses: `Documents\TFStudio` unless you moved it in Settings. Its materials, including your own catalogs and the library catalogs, are the ones the app sees. It reads designs and catalogs and writes only the `.tfs` files the assistant saves, and a file that already exists is written over only when the assistant asks for that. Beside them it keeps a log of its own, `mcp-server.log` next to the app, and a browser profile of its own in the app's settings folder, so it leaves the open app's alone.

## What the assistant can do

| Group | Tools |
| ----- | ----- |
| Designs | `openDesign`, `newDesign`, `setDesignSetup`, `saveDesign`, `showDesign`, `listDesigns`, `copyDesign` |
| Stack | `insertLayer`, `deleteLayer`, `setLayer`, `stackFromFormula` |
| Merit function | `setMerit`, `merit` |
| Materials | `findMaterials`, `materialNK` |
| Analysis | `spectrum`, `layerSensitivity` |
| Runs | `refine`, `synthesize`, `monteCarlo`, `jobStatus`, `stopJob`, `listJobs` |

`spectrum` computes R, T, A, Rs and Rp as the [Optical Evaluation](/analysis/optical-evaluation/) window does, `merit` gives the total and each row as the [Merit Function Editor](/design/merit-function-editor/) shows them, `refine` runs any method of the [Refinement](/synthesis/refinement/) window, and `synthesize` runs [Needle](/synthesis/needle/), [Gradual Evolution](/synthesis/gradual-evolution/), the [Structural Optimizer](/synthesis/structural-optimizer/) or Deep Synthesis. `monteCarlo` and `layerSensitivity` are the [Monte Carlo](/analysis/error-analysis/) and [Layer Sensitivity](/analysis/layer-sensitivity/) windows' computations. Merit rows take the operands of the [Operand Reference](/design/operands/).

## How it works

- **Designs by id.** The assistant works on designs held by the server under ids such as `d1`. Nothing it does reaches the designs open in the app; to see a result, open the file it saved.
- **Full paths.** Files are opened and saved by their full path, such as `C:\Users\you\Documents\TFStudio\Projects\AR.tfs`, since the folder the server runs in depends on how the assistant started it.
- **Runs are jobs.** `refine`, `synthesize` and `monteCarlo` start a job on a thread of its own and answer within half a minute with the job's state. The assistant follows a longer run with `jobStatus` and can stop it with `stopJob`. A run that changes the design adds its answer as a new design, so the one it started from stays for comparison.
- **Units.** Wavelengths and layer thicknesses are in nm, angles in degrees in the incident medium, the substrate thickness in mm. R, T and A are fractions of 1, also in merit targets, where the Merit Function Editor shows percent.
- **Refusals.** A misspelt argument, an unknown material or a value a tool cannot use is refused with a message that says what the tool takes, so nothing runs on a value the assistant did not ask for.
