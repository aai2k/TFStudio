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
MF = √( Σ_i  w_i · (r_i / σ_i)²  /  W )
```

The weight `w_i` enters linearly. The residual `r_i` is `value − target` for an equality target, a one-sided term for an inequality or constraint that is zero while it holds, or the value itself for a row that is already a deviation (`TGT`, the `*FLAT` rows, curve blocks). `σ_i` puts rows of different units on one footing, so a wavelength miss in nanometres does not swamp a reflectance miss, and `W` is the sum of the weights of the rows that have a value, other than `MNT`, `MXT`, `TT` and `STR`. The [Operand Reference](/design/operands/#how-rows-add-up) has the details. A smaller MF is better; the optimizers (Refinement, Needle and Gradual Evolution) move layer thicknesses to reduce it.

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
| In dB or optical density | `TDB` `TDBMN` `TDBMX` `RDBMX` `ODMN` `PPEF` | T or R in dB, optical density, peak-to-peak error against a curve |
| Phase / field        | `PSI` `DEL` `TANPSI` `COSDEL` `PR` `PT` `DPR` `DPT` `GD*` `GDD*` `TOD*` `EFMX` | phase, ellipsometry, dispersion, peak \|E\|² |
| Argmax/min λ         | `MXWT` `MXWR` `MXWA` `MNWT` `MNWR` `MNWA` | wavelength of the extremum |
| Math (reference rows)| `OPGT` `OPLT` `OPVA` `ABSO` `ABGT` `ABLT` `DIFF` `SUMM` `PROD` `CONS` | derived from other rows, or a constant they read |
| Thickness and stress | `TT` `STR` `MNT` `MXT`         | total / per-layer thickness, film force on the substrate |
| Comment              | `BLNK` `DMFS`                  | inert                        |

Reflection and transmission targets are typically generated in **paired** rows
by the filter-type wizard so the optimizer can't trade absorption for an easy
win.

## The wizard

The wizard sits above the table. Its bar carries the Optimize and Eval badges
and the current MF and OMF; the chevron at the left folds the form away and
brings it back. Under the bar are three boxes:

- **Preset**: the coating category (AR, mirror, beamsplitter, edge filter,
  bandpass or notch, gradient, integral or worst-case, custom target, curve
  target), the type within it, and the type's own values, the wavelength range first. The
  **Custom target** type generates a single target of your own: a channel
  (T/R/A), a unit (%, dB or OD), a comparison (`=`, `≤`, `≥`), a value and a range.
- **Angle and target**: the angle of incidence, or a range of angles with the
  number of steps, the polarization, and whether the target is a continuous
  line or discrete points. A type that sets polarization itself, such as the
  polarizing beamsplitter, shows no polarization control.
- **Thickness limits**: minimum and maximum layer thickness (`MNT`/`MXT`) and a
  total thickness cap, each behind a checkbox.

On a design scored in more than one [environment](/design/environments/), the Angle and target box also has **Env**: the environment the generated rows are scored in, **All** by default. The header row and the thickness limits are scored in every environment whatever it says.

A custom target in dB or OD writes one of the [dB and OD rows](/design/operands/#worst-case-over-a-band): T ≥ in dB a `TDBMN` row, T ≤ in dB a `TDBMX` row, R ≤ in dB an `RDBMX` row, T ≥ in OD an `ODMN` row, and T = in dB one `TDB` row per wavelength step, with a step field in place of the line-or-points choice. Combinations with no row behind them are not offered: A has only %, R in dB only ≤, OD only ≥. Switching the unit converts the typed value to the same level, so 80 % becomes −0.97 dB. A value in dB is held at or below 0 dB, a density at or above 0.

### Curve targets

The **Curve target** category takes a curve instead of numbers. Its rows read the curve's own angle and polarization, so the Angle and target box has no angle of its own to set. For gain flattening it holds the two values the filter is specified by, **Insertion loss** and **Peak-to-peak error**, and for a gain also the angle and polarization its target is put at. On a design with no curve to take, the line under the boxes says so and **Open Measured Spectra** beside it opens the window where a curve is imported or typed.

- **Curve** picks one of the design's curves from [Measured Spectra](/data-exchange/measured-spectra/) and writes the block **Fit…** writes for it, in % or in dB. When the design has only one curve the type can take, it is taken without a pick.
- **Gain flattening** builds the merit function a gain-flattening filter is specified by. Its input is either a target loss curve already on the design, or an amplifier gain in dB, imported from a text file or typed into the curve editor with **Type…**. A gain is turned into the loss that brings every wavelength down to the lowest gain, `T(λ)[dB] = G_min − G(λ)`: 0 dB at the gain minimum and negative everywhere else, the least loss a passive filter can flatten with. That target goes on the design as a T curve named after the gain, at the angle and polarization you give, so it draws on the plot; the gain itself is not kept.

Gain flattening writes three rows. The target as a curve block in dB with its **level free**: the constant the design sits away from it by is taken out, so the block scores the shape and not the level. A [`PPEF`](/design/operands/#curves) row against that block, at the peak-to-peak value you set: least squares brings the shape in, and this row works on the worst point, the number the filter is sold against. And a `TDBMN` row at the wavelength where the target is highest, held at minus the insertion loss you set: if T is that high there, the peak insertion loss meets it. Both values start at 0 dB, which asks for the flattest shape and the least loss the stack can reach. Choosing Gain flattening unticks the layer maximum in the Thickness limits box, since these filters often need layers several micrometres thick; tick it again if the coating process limits layer thickness.

The synthesis tools leave the `PPEF` row out: its gradient comes from only the two worst wavelengths, and the needle search stalls on it. They bring the shape in with the block, and a [Refinement](/synthesis/refinement/) run afterwards works the peak-to-peak error down.

The line under the boxes says how many rows the wizard will add and of which
types. **Start at row** is where the block goes; **Generate** adds it. The form
keeps its values while the window is closed and reopened.

## The table

One row per operand. The table works like a spreadsheet:

- Click a cell to focus it, type to replace a number, or press Enter or
  double-click to edit it. Backspace opens a number cell with its text
  cleared. Enter commits and moves down, Tab moves right, Escape cancels.
- The **Type** cell holds the operand code. Typing a letter opens the operand
  picker searching for it, Backspace opens it with an empty search, and Enter,
  a double-click or the chevron beside the code opens it on the current type.
  The **Pol** cell shows a
  chevron while it is focused; the chevron, Enter, Backspace or a double-click
  opens its three values as a list, and `a`, `s` or `p` typed straight in sets
  it without the list. A math row's **Ref Op#** cells name the rows it reads,
  as `#4 TMN`, and open the table's other rows as a list the same way. So do
  **Cmp** on a `TT` or `STR` row (`≤`, `≥` or `=`), **Integral** on a
  weighted integral (the integral presets) and **Curve** on a `PPEF` row (the
  table's curve blocks). On these four a typed key does nothing. The first
  entry of a Ref Op# or Curve list empties the cell. A weighted integral that
  matches no preset shows its own source, detector and band, and lists them
  first.
- On a design scored in more than one [environment](/design/environments/), an **Env** column follows **Type**: **All**, or the one environment the row is scored in, by number and name. It opens its list as **Pol** does, and copies and pastes as the name it shows. A constant is scored nowhere and shows a dash.
- The **Flag** cell is headed **Step** on the rows that take it. On a row that looks for a peak, such as `TMX` or `MXWT`, it sets how finely the band is searched, from 1 for 1 nm to 4 for 0.001 nm ([Searching for a peak or dip](/design/operands/#searching-for-a-peak-or-dip)); on a band average, spectral target, weighted integral or `*FLAT` row, the coarsest step of its grid ([Sampling a band](/design/operands/#sampling-a-band)). Other rows show a dash there.
- Drag across cells, or hold Shift, to select a rectangle; hold Ctrl to add
  single cells. Ctrl+C copies the selection as tab-separated text, Ctrl+V
  pastes text over it: one value fills every selected cell, a block of values
  is laid out from the focused cell. Text that came from copying rows is
  inserted as rows. A cell that picks from a list copies the name of its
  value, such as `#4 TMN` or `Tvis`, and takes a name from its list when
  pasted over; a number or any other text leaves it as it is. On the ✓
  column, a dash, **Current** or **% of MF²**, Ctrl+C and Ctrl+V do nothing.
- Rows are selected from the row-number column at the left: click one, drag
  down the column for a run, Shift for a run, Ctrl to add. Left from a row's
  first cell also moves to its row number and selects the row; Up and Down
  then move along the row numbers, Shift selects a run, and Ctrl+C and Ctrl+V
  copy and paste whole rows. A comment or header row is selected by a click
  anywhere on it, or by an arrow key landing on it. Ctrl+X, Ctrl+D and Delete
  cut, duplicate and remove the selected rows, or with none selected, the rows
  holding the selected cells. Insert adds a row above the focused one,
  Shift+Insert below.
- A comment row is typed into from the table: a key typed on it starts the
  comment, Up or Down moves on to the next row, and Escape goes back to the
  table with the comment kept. Its **Type** cell, left of the comment, takes
  an operand code like any row's and turns the row into that operand.
- Right-click opens the same actions as a menu: copy and paste of the cell or
  cells, cut, copy and paste of operands, insert, duplicate and delete. Its
  cut, copy, duplicate and delete act on the selected rows, or with none
  selected, the rows holding the selected cells.

**Load MF** and **Save MF** in the table's bar load and save the whole table as
a named merit function you can reuse in another design.

**Constraints**: minimum and maximum layer-thickness bounds (`MNT`/`MXT`) over
a range of layers. A bound can be written to cover layers that synthesis
will add later. An `MXT` row is the only upper limit on a layer's thickness;
without one the optimizers let a layer grow as thick as the merit asks.

## MF vs OMF

The header shows **two** numbers:

- **MF**: the full merit function, including the manufacturability rows
  (`MNT`, `MXT`, `TT`, `STR`).
- **OMF**: the **optical merit function**: the same RMS but counting *only the
  optical operands* (T/R/A targets, bands, and so on), with the
  manufacturability rows dropped.

They separate two questions the plain MF blurs together: *how good is the
spectrum?* (OMF) versus *how good is the spectrum while honoring what I can
build?* (MF). When MF is high but OMF is low, the optical performance is fine
and it is a constraint costing you, not the optics: a too-thin or too-thick
layer, a thickness budget, or a coating that bends its substrate too far.

## How to read it

Each operand row shows its current value and its residual, so you can see at a
glance which targets are met and which are dragging the merit up. Bigger
weights make an operand count for more; bumping the stopband weight on an HR
design is the most common tweak.

On a design scored in more than one environment, **Current** shows each row's value in the current environment and names it in its header, as **Current (2)**; a row not scored there shows a dash, and every row does while the current environment is off. **% of MF²** adds a row's part over every environment it is scored in, and the MF in the bar is the merit over every environment that is on. The current environment is picked in the Design Editor's Settings, with **Previous** and **Next** on the Setup tab of the ribbon, or in the [Environments](/design/environments/) window.

A fine Step over a wide band takes seconds to evaluate, so a row with a Step of its own is shown at once at its default step, faded with ≈ before it, and its value at its Step replaces that once it has been worked out. The window stays free in the meantime. A math row that reads such a row is marked the same way, and when such a row has a weight, so are the MF, the OMF and every row's **% of MF²**. While the table follows an optimizer run it stays at the default steps until the run stops. Under a cone of incidence every row is worked out off the window's thread, and the table shows its values when they come. The Refinement window's table and its MF between runs work the same way. The MF shown in the Round and Perturb dialogs, the [Design Cleaner](/synthesis/design-cleaner/) and the [History](/design/history/) window, the OMF in [Needle Manual](/synthesis/needle/#needle-manual) and the ranking in [Layer Sensitivity](/analysis/layer-sensitivity/) are read the same way when a row has a Step of its own: at once at the default steps, faded with ≈, then at the rows' Steps.

The operand list is saved with the design and is read by every optimizer: [Refinement](/synthesis/refinement/), [Needle](/synthesis/needle/), [Gradual Evolution](/synthesis/gradual-evolution/) and the [Structural Optimizer](/synthesis/structural-optimizer/). The synthesis tools optimize against the optical operands only while they build the stack, less any `PPEF` row and the math rows that refer to it; the thickness constraints and the peak-to-peak error are then enforced during Refinement. A good final sequence is Refinement, then Cleaner, then Refinement again.

## References

- A. V. Tikhonravov, M. K. Trubetskov, G. W. DeBell, "Application of the needle optimization technique to the design of optical coatings," *Appl. Opt.* **35**, 5493 (1996).
- J. A. Dobrowolski, R. A. Kemp, "Refinement of optical multilayer systems with different optimization procedures," *Appl. Opt.* **29**, 2876 (1990).
