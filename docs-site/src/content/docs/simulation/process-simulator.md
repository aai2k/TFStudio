---
title: Process Exporter
description: Play back your coating layer by layer, watch the spectrum build up, and export per-step deposition data for in-chamber monitoring software.
ribbonIcon: process-sim
---

The Process Exporter plays the coating back one layer at a time, the spectrum after layer 1, after layer 2 and so on to the finished design, so you see what the in-chamber spectrophotometer will read as the stack grows. It exports the target spectrum at the end of every layer as `.res` deposition files for monitoring software, one per layer, or as CSV or text tables. The spectra use nominal materials with no noise; for an as-built prediction use the [Broadband](/simulation/bbm-simulator/) or [Monochromatic](/simulation/mono-simulator/) simulator.

<!-- shot: process-sim | the quarter-wave mirror deposited layer by layer on the part, held at its last layer, with the transmittance after every step drawn over the uncoated baseline -->
![Process Exporter](/screenshots/process-sim.png)

## Computed quantities

- The chart: the bare baseline (dotted), the finished spectrum of the layer the timeline is on, and the live curve at the current position (bold). **Show all layers** adds every other finished curve in faint grey; the current layer stays at full strength, since a turning point means something only against the curves before it. The hover readout stays on the three main curves.
- The sequence table: each layer's thickness and time, the current one marked by a bar.

A layer that barely moves the spectrum is hard to monitor; one that swings it sharply is easy. The piece is computed as the whole part, front, incoherent substrate and back, with air on both sides whatever media the design sits in, as the spectrometer sees it in the chamber.

## Controls and settings

| Control | Sets |
|---|---|
| **Active side** | The coating being deposited, front or back. |
| **Deposit on** | The part, or witness chips. On the part every layer goes on one piece and the **opposite-surface state** is bare or already coated. On chips each chip carries only its own layers from bare chip glass, grown like a front coating and read with a bare back. |
| **T / R** | What the monitor reads. |
| **Show all layers** | Off by default; see above. |
| **Angle of incidence**, **polarization** | In Settings, s, p or average. |
| **Spectral range** | In Settings, the chart's start, end and step; a coarse step keeps scrubbing responsive. A range past a material's measured data is named in the toolbar badge, which offers to pull it back. |
| **Export step** | The step written to the files, 0.5 nm by default; match your spectrophotometer's grid, which for a fixed array is often odd, such as 0.4375 nm. A dot or comma both work. |
| **File format** | `.res` (one fixed layout), CSV, or text (the CSV under `.txt`). |

On witness chips the chip plan, **Chip glass** and **Witness ratio** are those of the [Monitor Worksheet](/simulation/monitor-worksheet/): a chip number typed in either window shows in the other, the sequence table gains an editable Chip column, and **Layers per chip** sits in the sidebar.

For CSV and text, Settings also holds:

- **Files**: one per step, numbered like the `.res` files, or one table with a column per step (one per chip on witness chips).
- **Header**: **Layer table**, the `.res` header with its layer table; **Conditions**, design, step, angle, side and polarization on `#` lines, which [Measured Spectra](/data-exchange/measured-spectra/) reads back on import; or **None**, numbers only. The side named is the one light comes from, the front in every run; the side being coated, or the chip's design layers, follow on that line.
- **Delimiter**: comma, semicolon, tab or space; a spreadsheet set to a decimal comma opens a semicolon file without its import wizard.
- **Y scale**, **Decimal places**, **Decimal mark**: percent or fraction, decimals for every value, point or comma; the wavelength is always written in full.

**Deposition rates**, per material in nm/s in the sidebar, shape only the time axis, not the spectrum. Click a layer to move the timeline to it fully deposited, then walk with the arrow keys; click again, press Play or move the timeline to release it. Setup and rates are remembered between sessions.

**Save** writes to a folder: in `.res`, one file per finished step (`01.res`, `02.res`, …) with a header and a table of each layer's physical and optical thickness, layers numbered in deposition order from the substrate. On witness chips each chip has a folder, `chip-1`, `chip-2` and so on, its files numbered from 01, its layer table at the thickness the witness receives, and each file's comment line naming its design layer. CSV and text per step follow the same names; one table goes under the design's name, with `_chip-1` and so on on chips. A long run shows its progress under the toolbar.

## Theory

After layer j the piece is the deposited layers 1 to j on its substrate, the opposite surface bare or coated, the passes through the substrate combined in intensity ([Surface & Evaluation Modes](/design/evaluation-modes/#theory)). On witness chips the deposited thickness is the design layer's times the witness ratio. The time axis is Σ d_i / r_i over the layers deposited, r_i the rate of layer i's material.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Section 2.14, pp. 60–63: incoherent reflection at two or more surfaces.
