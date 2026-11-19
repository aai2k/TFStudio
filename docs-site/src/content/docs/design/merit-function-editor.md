---
title: Merit Function Editor
description: "Targets, operands, weights and thickness constraints: what the optimizer drives toward."
ribbonIcon: merit-function
---

The Merit Function Editor holds what the optimizers drive toward: a list of operands, each one number with a target, a weight and a comparison. The merit function (MF) is how far the design misses them all, and Refinement, Needle, Gradual Evolution and the Structural Optimizer move layer thicknesses to bring it down. Every operand type, its arguments and how it scores are on the [Operand Reference](/design/operands/); this page is the window.

<!-- shot: merit-function | the wizard's broadband AR target over 450-700 nm on bare BK7, generated with no minimum layer thickness, the rows in the table under it -->

## Computed quantities

- **MF**: the merit over every row. **OMF**: the same over the optical rows alone, leaving out `MNT`, `MXT`, `TT` and `STR`. When MF is high and OMF low, the spectrum is fine and a constraint is costing it: a layer too thin or too thick, a thickness budget, or a coating bending its substrate.
- Each row's **Current** value and its **% of MF²**, its share of the total, so the rows holding the merit up stand out.
- On a design with more than one [environment](/design/environments/), **Current** is the value in the current environment, named in its header as **Current (2)**, with a dash where the row is not scored; **% of MF²** adds the row's part over every environment it is scored in, and MF covers every environment that is on.

A row with a **Step** of its own over a wide band can take seconds, so it shows at once at its default step, faded with ≈, until the value at its Step is worked out off the window's thread. A math row reading it is marked the same way, and when it has a weight so are MF, OMF and **% of MF²**. While the table follows an optimizer run it stays at the default steps until the run stops. Under a cone of incidence every row is worked out off the thread. The MF in the Round and Perturb dialogs, the [Design Cleaner](/synthesis/design-cleaner/), [History](/design/history/), the OMF in [Needle Manual](/synthesis/needle/#needle-manual) and the ranking in [Layer Sensitivity](/analysis/layer-sensitivity/) are read the same way.

## Controls and settings

### The wizard

The wizard above the table writes blocks of rows from a few numbers. Its bar carries the **Optimize** and **Eval** badges with MF and OMF, and the chevron folds the form away.

- **Preset**: the category (AR, mirror, beamsplitter, edge filter, bandpass or notch, gradient, integral or worst case, custom target, curve target, color), the type within it, and its values, wavelength range first. **Custom target** writes one target of your own: channel T, R or A, unit %, dB or OD, comparison `=`, `≤` or `≥`, a value and a range.
- **Angle and target**: the angle or a range of angles with its steps, the polarization (absent where the type sets it, as for a polarizing beamsplitter), and a continuous line or discrete points. On a design with environments, **Env** scores the rows in one environment or **All**; the header row and thickness limits are scored in all.
- **Thickness limits**: minimum and maximum layer thickness (`MNT`, `MXT`) and a total-thickness cap, each behind a checkbox.

A custom target in dB or OD writes one of the [dB and OD rows](/design/operands/#worst-case-over-a-band): T ≥ in dB a `TDBMN`, T ≤ in dB a `TDBMX`, R ≤ in dB an `RDBMX`, T ≥ in OD an `ODMN`, and T = in dB one `TDB` per wavelength step. Only these combinations are offered. Switching the unit keeps the level, so 80 % becomes −0.97 dB.

**Start at row** keeps the rows above it and replaces every row from it down with the block; the default, after the last row, appends. **Generate** writes the block, one undo step. The form keeps its values while the window is closed.

#### Curve targets

**Curve target** takes one of the design's curves from [Measured Spectra](/data-exchange/measured-spectra/) instead of numbers, and its rows read the curve's own angle and polarization. **Open Measured Spectra** appears when the design has no curve to take.

- **Curve** writes the block **Fit…** writes for the curve, in % or dB.
- **Gain flattening** takes a target loss curve on the design, or an amplifier gain in dB imported or typed with **Type…**, and the filter's **Insertion loss** and **Peak-to-peak error**. It writes the target as a curve block in dB with its level free, so the block scores shape and not level; a [`PPEF`](/design/operands/#curves) row against it at the peak-to-peak value; and a `TDBMN` row at the wavelength where the target is highest, at minus the insertion loss. Both values start at 0 dB, the flattest shape and least loss the stack can reach. It also unticks the layer maximum, since these filters often need layers several micrometres thick.

The synthesis tools leave the `PPEF` row out, since its gradient comes from the two worst wavelengths alone and stalls the needle search; a [Refinement](/synthesis/refinement/) run afterwards brings the peak-to-peak error down.

#### Color targets

**Color** scores the coating's color at the angles a color specification names. **Type** is **Reflected color** or **Transmitted color**; **Target** holds the **Illuminant**, the **Observer** and **Pick…**, which opens **Color targets**.

<!-- new:color-targets | two reflected-color targets on the a*, b* diagram, the selected one as a diamond beside the ring of the coating's color at its angle, the target list with Name, AOI and Pol on the left -->

The window lists the targets, each with a patch of its color, **Name**, **AOI (°)** and **Pol**, with **Add** and **Delete**; one target always stays. A new target starts at the coating's color at 0°. **Space** sets the diagram for the selected target: x, y for x, y, Y; a\*, b\* at the target's L\* for L\*, a\*, b\*; u′, v′ for u′, v′, Y. Clicking or dragging on it moves the target's two coordinates and keeps the third; the three values can also be typed. Rings mark the coating at the targets' angles. **OK** keeps the list, **Cancel** drops the changes.

**Generate** writes one `RCOL` or `TCOL` row per coordinate of each target's space, at its angle and polarization, as the [Operand Reference](/design/operands/#color) sets out.

### The table

One row per operand, edited like a spreadsheet.

| Input | Does |
|---|---|
| Typing, Enter, double-click, Backspace on a number | Edits the cell; Enter commits and moves down, Tab right, Escape cancels. |
| Letter, Backspace, Enter or chevron on **Type** | Opens the operand picker, grouped in tabs, searching for the letter. |
| Enter, chevron or double-click on a list cell | Opens its values: **Pol** (`a`, `s`, `p` typed straight in), **Ref Op#** as `#4 TMN`, **Cmp** on `TT` and `STR`, **Integral**, **Curve**, **Color** and **ILL-OBS**. The first entry of Ref Op# or Curve empties the cell. |
| Drag, Shift, Ctrl on cells | Selects a rectangle or adds cells. |
| Ctrl+C, Ctrl+V on cells | Copies as tab-separated text; pastes one value over the selection or a block from the focused cell. A list cell copies and takes the name of its value; copied rows paste as rows. |
| Click, drag, Shift, Ctrl on row numbers | Selects rows; Left from a row's first cell moves there, and Ctrl+C, Ctrl+V copy and paste whole rows. |
| Ctrl+X, Ctrl+D, Delete, Insert, Shift+Insert | Cut, duplicate and delete the selected rows (or the rows of the selected cells); insert above or below. |
| Right-click | The same actions as a menu. |

- On a design with environments, **Env** follows **Type**: **All**, or the one environment the row is scored in. A constant is scored nowhere and shows a dash.
- **Flag** reads **Step** on rows that take one: on a row looking for a peak, such as `TMX` or `MXWT`, the search step from 1 (1 nm) to 4 (0.001 nm) ([searching for a peak or dip](/design/operands/#searching-for-a-peak-or-dip)); on a band average, spectral target, integral, color or `*FLAT` row, the coarsest step of its grid ([sampling a band](/design/operands/#sampling-a-band)).
- A comment row takes text typed on it, and its **Type** cell turns it into an operand.
- **Load MF** and **Save MF** keep the whole table as a named merit function for another design.

### Constraints

`MNT` and `MXT` bound the thickness of a range of layers, numbered from the substrate. A range can reach past the last layer to cover layers synthesis adds later, and it holds only the layers a run can move: locked layers are left out. An `MXT` row is the only upper limit on a layer's thickness; without one a layer grows as thick as the merit asks. Each optimizer treats the constraints in its own way, as the [Operand Reference](/design/operands/#thickness-and-stress) lists.

## Theory

```
MF = √( Σ_i  w_i · (r_i / σ_i)²  /  W )
```

`w_i` is the weight. The residual `r_i` is `value − target` for an equality, a one-sided term for an inequality or constraint that is zero while it holds, or the value itself for a row that is already a deviation (`TGT`, the `*FLAT` rows, curve blocks). `σ_i` puts rows of different units on one footing, so a miss in nanometres does not swamp a miss in reflectance. `W` is the sum of the weights of the rows that have a value, other than `MNT`, `MXT`, `TT` and `STR`. OMF is the same sum over the optical rows alone. The [Operand Reference](/design/operands/#how-rows-add-up) has each term.

## References

- A. V. Tikhonravov, M. K. Trubetskov, G. W. DeBell, "Application of the needle optimization technique to the design of optical coatings," *Appl. Opt.* **35**, 5493 (1996).
- J. A. Dobrowolski, R. A. Kemp, "Refinement of optical multilayer systems with different optimization procedures," *Appl. Opt.* **29**, 2876 (1990).
