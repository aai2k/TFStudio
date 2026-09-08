---
title: Merit Function Editor
description: "Targets, operands, weights and thickness constraints: what the optimizer drives toward."
ribbonIcon: merit-function
---

The **Merit Function Editor** is where you tell the optimizer what "good" looks
like. Every target the design should hit and every constraint on the layer
stack lives here, expressed as a list of **operands**. Each operand is a single
number the optimizer tries to drive toward a target value, and the merit
function (MF) is the weighted root-mean-square of how far each operand misses:

```
MF = √( Σ_i  w_i · residual_i²  /  Σ_i w_i )
```

The weight `w_i` enters linearly. The residual is `value − target` for an
equality target, or a one-sided `max(0, …)` term for an inequality or
constraint (so a satisfied constraint drops out of the sum entirely).
Wavelength-valued residuals are rescaled to optical scale first so they don't
dominate. A smaller MF is better; the optimizers (Refinement, Needle and
Gradual Evolution) move layer thicknesses to reduce it.

## Operand types

The table below is a quick orientation. The full catalog (every type, its
arguments, its output value and unit, and how it forms a residual) is on the
[Operand Reference](/design/operands/) page.

| Group                | Types                          | Output                       |
| -------------------- | ------------------------------ | ---------------------------- |
| Single-λ optical     | `T` `R` `A`                    | T/R/A at one λ               |
| Band average         | `TAV` `RAV` `AAV`              | mean T/R/A over a band       |
| Spectral target      | `TGT` `RGT` `AGT`              | deviation from a flat/ramp line |
| Weighted integral    | `TIW` `RIW` `AIW`              | source × detector weighted mean |
| Worst-case           | `TMN` `RMN` `AMN` `TMX` `RMX` `AMX` | band extremum of T/R/A   |
| Phase / field        | `PSI` `DEL` `TANPSI` `COSDEL` `PR` `PT` `DPR` `DPT` `GD*` `GDD*` `TOD*` `EFMX` | phase, ellipsometry, dispersion, peak \|E\|² |
| Argmax/min λ         | `MXWT` `MXWR` `MXWA` `MNWT` `MNWR` `MNWA` | wavelength of the extremum |
| Math (reference rows)| `OPGT` `OPLT` `OPVA` `ABSO` `ABGT` `ABLT` `DIFF` `SUMM` `PROD` | derived from other rows |
| Thickness            | `TT` `MNT` `MXT`               | total / per-layer thickness  |
| Comment              | `BLNK` `DMFS`                  | inert                        |

Reflection and transmission targets are typically generated in **paired** rows
by the filter-type wizard so the optimizer can't trade absorption for an easy
win.

## The wizard

The wizard sits above the table. Its bar carries the Optimize and Eval badges
and the current MF and OMF; the chevron at the left folds the form away and
brings it back. Under the bar are three boxes:

- **Preset**: the coating category (AR, mirror, beamsplitter, edge filter,
  bandpass or notch, gradient, integral or worst-case, custom target), the
  type within it, and the type's own values, the wavelength range first. The
  **Custom target** type generates a single target of your own: a channel
  (T/R/A), a comparison (`=`, `≤`, `≥`), a value and a range.
- **Angle and target**: the angle of incidence, or a range of angles with the
  number of steps, the polarization, and whether the target is a continuous
  line or discrete points. A type that sets polarization itself, such as the
  polarizing beamsplitter, shows no polarization control.
- **Thickness limits**: minimum and maximum layer thickness (`MNT`/`MXT`) and a
  total thickness cap, each behind a checkbox.

The line under the boxes says how many rows the wizard will add and of which
types. **Start at row** is where the block goes; **Generate** adds it. The form
keeps its values while the window is closed and reopened.

## The table

One row per operand. The table works like a spreadsheet:

- Click a cell to focus it, type to replace its value, or press Enter or
  double-click to edit it. Enter commits and moves down, Tab moves right,
  Escape cancels.
- The **Type** cell holds the operand code. Typing a letter opens the operand
  picker searching for it; Enter or a double-click opens it on the current
  type. The **Pol** cell shows a chevron while it is focused; the chevron,
  Enter or a double-click opens its three values as a list, and `a`, `s` or
  `p` typed straight in sets it without the list.
- Drag across cells, or hold Shift, to select a rectangle; hold Ctrl to add
  single cells. Ctrl+C copies the selection as tab-separated text, Ctrl+V
  pastes text over it: one value fills every selected cell, a block of values
  is laid out from the focused cell. Text that came from copying rows is
  inserted as rows.
- Rows are selected from the row-number column at the left: click one, drag
  down the column for a run, Shift for a run, Ctrl to add. A comment or header
  row is selected by a click anywhere on it. Delete, Ctrl+X and Ctrl+D act on
  selected rows; Insert adds a row above the focused one, Shift+Insert below.
- Right-click opens the same actions as a menu: copy and paste of the cell or
  cells, cut, copy and paste of operands, insert, duplicate and delete.

**Load MF** and **Save MF** in the table's bar load and save the whole table as
a named merit function you can reuse in another design.

**Constraints**: minimum and maximum layer-thickness bounds (`MNT`/`MXT`) per
layer or per material. A bound can be written to cover layers that synthesis
will add later.

## MF vs OMF

The header shows **two** numbers:

- **MF**: the full merit function, including the manufacturing and thickness
  constraints (`MNT`, `MXT`, `TT`).
- **OMF**: the **optical merit function**: the same RMS but counting *only the
  optical operands* (T/R/A targets, bands, and so on), with the thickness
  constraints dropped.

They separate two questions the plain MF blurs together: *how good is the
spectrum?* (OMF) versus *how good is the spectrum while honoring my thickness
limits?* (MF). When MF is high but OMF is low, the optical performance is fine
and it is a constraint (a too-thin or too-thick layer) costing you, not the
optics.

## How to read it

Each operand row shows its current value and its residual, so you can see at a
glance which targets are met and which are dragging the merit up. Bigger
weights make an operand count for more; bumping the stopband weight on an HR
design is the most common tweak.

The operand list is saved with the design and is read by every optimizer:
[Refinement](/synthesis/refinement/), [Needle](/synthesis/needle/),
[Gradual Evolution](/synthesis/gradual-evolution/) and the
[Structural Optimizer](/synthesis/structural-optimizer/). The synthesis tools
optimize against the optical operands only while they build the stack, then the
thickness constraints are enforced during Refinement. A good final sequence is
Refinement, then Cleaner, then Refinement again.

## References

- A. V. Tikhonravov, M. K. Trubetskov, G. W. DeBell, "Application of the needle optimization technique to the design of optical coatings," *Appl. Opt.* **35**, 5493 (1996).
- J. A. Dobrowolski, R. A. Kemp, "Refinement of optical multilayer systems with different optimization procedures," *Appl. Opt.* **29**, 2876 (1990).
