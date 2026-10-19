---
title: Operand Reference
description: "Every merit-function operand: what it computes, the columns it reads, and how it scores."
ribbonIcon: merit-function
---

Each row of the [Merit Function Editor](/design/merit-function-editor/) table is one operand. Find the operand in the quick reference, then read its section. Names in **bold** are the column headers the table shows when that row has focus. How rows add up to the merit function, how the worst-case and peak-wavelength rows search their band and how bands are sampled are explained after the operands.

## Quick reference

| Subject | Operands |
| ------- | -------- |
| [Single wavelength](#single-wavelength) | `T` `R` `A` `TDB` |
| [Band average](#band-average) | `TAV` `RAV` `AAV` |
| [Spectral target](#spectral-target) | `TGT` `RGT` `AGT` |
| [Weighted integral](#weighted-integral) | `TIW` `RIW` `AIW` |
| [Worst case over a band](#worst-case-over-a-band) | `TMN` `TMX` `RMN` `RMX` `AMN` `AMX` `TDBMN` `TDBMX` `RDBMX` `ODMN` |
| [Wavelength of a peak or dip](#wavelength-of-a-peak-or-dip) | `MXWT` `MXWR` `MXWA` `MNWT` `MNWR` `MNWA` |
| [Curves](#curves) | `MCURVE` `PPEF` |
| [Ellipsometry](#ellipsometry) | `PSI` `DEL` `TANPSI` `COSDEL` |
| [Phase and dispersion](#phase-and-dispersion) | `PR` `PT` `DPR` `DPT` `GD` `GDT` `GDD` `GDDT` `TOD` `TODT` and the `*FLAT` rows |
| [Field](#field) | `EFMX` |
| [Math on other rows](#math-on-other-rows) | `OPGT` `OPLT` `OPVA` `ABSO` `ABGT` `ABLT` `DIFF` `SUMM` `PROD` |
| [Thickness and stress](#thickness-and-stress) | `TT` `STR` `MNT` `MXT` |
| [Table control](#table-control) | `BLNK` `DMFS` |

## Columns

| Column | What it holds |
| ------ | ------------- |
| **Type** | The operand code. |
| **λ / Layer**, **End \*** | The two values that define the operand. Their headers change with the row: **λ** for one wavelength, **λ Start** and **λ End** for a band, **Integral** for a weighted integral, **Layer 1** and **Layer 2** for a layer range, **Cmp** for a comparison, **Ref Op#**, **Ref Op#1** and **Ref Op#2** for other rows, **Curve** on a `PPEF` row, **Comment** for a comment. A dash means the row does not use the cell. |
| **AOI (°)** | Angle of incidence in the incident medium. |
| **Pol** | `s`, `p`, or `avg`, the mean (Cs + Cp)/2. |
| **Flag** | Headed **Step** on the rows that take it. On a row that looks for a peak it sets how finely the band is searched ([Searching for a peak or dip](#searching-for-a-peak-or-dip)); on a band average, spectral target, weighted integral or `*FLAT` row, the coarsest step of its grid ([Sampling a band](#sampling-a-band)). Other rows show a dash. |
| **Target** | The value the row is driven toward, or the bound it must stay inside. T, R and A are entered in percent. |
| **Weight** | How much the row counts. |
| **Current** | The row's value for the design as it is. |
| **% of MF²** | The row's share of the sum of squares under the merit function's root. The shares add up to 100 % when the merit is not zero. |

The headers follow the row of the focused cell, or the one selected row, or else the first row. With an empty table or a `DMFS` row in focus they read **λ / Layer**, **End \*** and **Flag**.

Hover a **% of MF²** cell to see how far the row is from its target in its own unit: **Current − target**, **Slack** for a layer constraint, or **RMS deviation** for a row whose value is a deviation. The figure is shown even when a one-sided row is satisfied and scores nothing. The cell shows a dash for a disabled row, a row with no value and a row with no valid weight; while any enabled row shows **Error**, every % of MF² cell shows a dash.

---

## Single wavelength

| Name | Description |
| ---- | ----------- |
| `T` | Transmittance at **λ**. **Target** in percent. |
| `R` | Reflectance at **λ**. **Target** in percent. |
| `A` | Absorptance at **λ**. **Target** in percent. |
| `TDB` | Transmittance at **λ** in dB, 10·log₁₀ T, so a loss reads negative. **Target** in dB; a new row starts at 0 dB. |

All four read **AOI (°)** and **Pol**. Older designs can hold `TS`, `TP`, `RS`, `RP`, `AS` and `AP`, with the polarization in the code; they still evaluate, with **Pol** dimmed, but the type picker no longer offers them.

## Band average

| Name | Description |
| ---- | ----------- |
| `TAV` | Mean transmittance from **λ Start** to **λ End**. **Target** in percent. Uses **Step**. |
| `RAV` | Mean reflectance over the band. |
| `AAV` | Mean absorptance over the band. |

The mean is taken by the trapezoid rule on the [band grid](#sampling-a-band), so the two end points count half, as in an integral. One target sets the average level; for a target at every wavelength use a spectral target.

## Spectral target

| Name | Description |
| ---- | ----------- |
| `TGT` | RMS deviation of T from a straight target line from **λ Start** to **λ End**. **Target** holds the line's two ends in percent as `start→end`, typed as `start->end`: `50→50` is a flat 50 % line, `0→100` a ramp. A single number makes the line flat. Uses **Step**. |
| `RGT` | The same for R. |
| `AGT` | The same for A. |

**Current** shows the RMS deviation, and the residual is that value, so the optimizer drives it to zero. In a run each sample on the band grid is a residual of its own. These rows suit beamsplitters and gradient filters.

## Weighted integral

| Name | Description |
| ---- | ----------- |
| `TIW` | T averaged with the weight Source(λ)·Detector(λ) over the band, Σ wᵢ·Tᵢ / Σ wᵢ. **Integral** picks a saved preset, such as Tvis (D65 and the photopic eye) or Tsol (AM1.5G), which sets the source, the detector, the band and the channel: Rvis on a `TIW` row makes it an `RIW` row. **Target** in percent. Uses **Step**. |
| `RIW` | The same for R. |
| `AIW` | The same for A. |

The band belongs to the preset, so **End** shows a dash. A new row starts at 400-700 nm under D65 and the photopic eye with no preset picked, and the cell describes that setup instead of a preset name. The presets come from the [Integral Values](/analysis/integral-values/) tool.

## Worst case over a band

| Name | Description |
| ---- | ----------- |
| `TMN` | Lowest T from **λ Start** to **λ End**. Holds T ≥ **Target**, in percent. |
| `TMX` | Highest T over the band. Holds T ≤ **Target**. Takes **Step**. |
| `RMN` | Lowest R over the band. Holds R ≥ **Target**. Takes **Step**. |
| `RMX` | Highest R over the band. Holds R ≤ **Target**. |
| `AMN` | Lowest A over the band. Holds A ≥ **Target**. |
| `AMX` | Highest A over the band. Holds A ≤ **Target**. Takes **Step**. |
| `TDBMN` | Lowest T over the band in dB. Holds T ≥ **Target** in dB, an insertion loss; a new row starts at −0.5 dB. |
| `TDBMX` | Highest T over the band in dB. Holds T ≤ **Target** in dB, an isolation or blocking level; a new row starts at −30 dB. Takes **Step**. |
| `RDBMX` | Highest R over the band in dB. Holds R ≤ **Target** in dB, the return loss of an AR coating; a new row starts at −30 dB. |
| `ODMN` | Lowest optical density D = −log₁₀ T over the band, which is where T is highest. Holds D ≥ **Target**; a new row starts at 3. Takes **Step**. |

The value is the band's true highest or lowest point, however narrow, found as described in [Searching for a peak or dip](#searching-for-a-peak-or-dip). A row scores nothing until the worst case breaks the specification. An `AMN` or `AMX` row on a design where nothing absorbs reads 0.

**Why score in dB.** In linear T a stopband held at 0.1 % adds almost nothing to a least-squares merit, so missing −30 dB by a factor of ten is invisible beside the passband ripple. With the [unit scale](#unit-scale) of the dB and density rows, each row scores the natural log of the ratio its miss stands for in T or R. A miss by the same factor then costs the same at any level. Near T = 1 a small miss costs what it would on a `T` row. And 20 dB and 30 dB are as far apart in the merit as in the specification.

**Floor.** T or R below 10⁻¹⁵ (−150 dB, OD 15) reads as 10⁻¹⁵, and below it the row stops steering. No specification comes near it.

On [Optical Evaluation](/analysis/optical-evaluation/) the dB and density targets are drawn at the level they stand for, −30 dB at 0.1 %, on any y unit: `TDB` as a point marker, a band row as a level line over its band. They drag like other targets, and a dragged level is written back in dB or OD. An `ODMN` target is a T target, so it shows on the OD axis.

## Wavelength of a peak or dip

| Name | Description |
| ---- | ----------- |
| `MXWT` | Wavelength of the highest T from **λ Start** to **λ End**. **Target** in nm; a new row starts at the middle of the band. Takes **Step**. |
| `MXWR` | Wavelength of the highest R over the band. |
| `MXWA` | Wavelength of the highest A over the band. Takes **Step**. |
| `MNWT` | Wavelength of the lowest T over the band. |
| `MNWR` | Wavelength of the lowest R over the band. Takes **Step**. |
| `MNWA` | Wavelength of the lowest A over the band. |

The value is a wavelength, not a T, R or A. Use these rows to pin a peak or a notch to a wavelength. A 5 nm miss weighs like a 1 % miss on a `T` row.

## Curves

| Name | Description |
| ---- | ----------- |
| `MCURVE` | A curve block: the RMS deviation of the design from a set of measured or target points, in the block's channel, T, R or A in percent, T in dB, Ψ or Δ. **Fit…** in [Measured Spectra](/data-exchange/measured-spectra/) or [Measured Ellipsometry](/data-exchange/measured-ellipsometry/), and the wizard's curve targets, write it; the type picker does not offer it. Only **Weight** and the enable tick can be changed. |
| `PPEF` | Peak-to-peak error against the block picked in **Curve**: at each of the block's points EF(λ) = C_target(λ) − C_design(λ), both in dB, with C the block's channel, and the value is max EF − min EF. Holds the spread ≤ **Target**, in dB; a new row starts at 0 dB. |

A block shows its band, angle and polarization in **λ Start**, **λ End**, **AOI (°)** and **Pol**, and a dash for **Target**. A block with its level free first takes out the constant offset that fits best, and scores only the shape. In a run a block becomes one residual per point, each with an equal share of the block's weight.

A gain-flattening filter is specified by its error against a target loss curve, not by its own transmittance, and that error is what `PPEF` measures. A design that differs from the target by the same number of dB everywhere scores zero: that constant is insertion loss, which a datasheet states on a line of its own. The [Specification](/design/specification/) window has the same number as a check, read through this row.

The row reads the block's wavelengths, angle and polarization, so its **AOI (°)** and **Pol** show a dash. The block can be a T, R or A curve in percent or a T curve in dB, at weight 0 if it is there only to be measured against; a Ψ or Δ block is refused. Deleting the block deletes the row; a row whose block is missing or switched off shows **Error**. The synthesis tools leave the row out, since its slope comes from only the two worst wavelengths and stalls their search, and fit the block instead. If the block weighs less than the rows that read it, they fit it at their combined weight.

## Ellipsometry

| Name | Description |
| ---- | ----------- |
| `PSI` | Ellipsometric Ψ at **λ** and **AOI (°)**, from ρ = r_p / r_s = tan Ψ · e^{iΔ}, 0° to 90°. A new row starts at 45°. |
| `DEL` | Ellipsometric Δ at **λ** and **AOI (°)**, 0° to 360°. A new row starts at 180°. |
| `TANPSI` | tan Ψ. A new row starts at 1. |
| `COSDEL` | cos Δ, −1 to 1. A new row starts at 0. |

Ψ and Δ use both polarizations, so **Pol** has no effect. These rows always score the front coating; in back-only mode they read the front as it is and steer nothing. A `DEL` row is not in the Azzam–Bashara convention an ellipsometer writes and the [Ellipsometry](/analysis/ellipsometry/) window shows by default. Set the window's **Δ convention** to 360° − Δ to read the same number as the row. To fit a measured Ψ/Δ pair, generate the targets from [Measured Ellipsometry](/data-exchange/measured-ellipsometry/#fitting-the-design-to-a-measurement), which stores each channel as one block with its own convention.

## Phase and dispersion

| Name | Description |
| ---- | ----------- |
| `PR`, `PT` | Phase of the reflection or transmission amplitude at **λ**, in degrees. |
| `DPR`, `DPT` | Phase difference p minus s on reflection or transmission at **λ**, in degrees. |
| `GD`, `GDT` | Group delay on reflection or transmission at **λ**, in fs. |
| `GDD`, `GDDT` | Group delay dispersion on reflection or transmission at **λ**, in fs². |
| `TOD`, `TODT` | Third-order dispersion on reflection or transmission at **λ**, in fs³. |
| `GDFLAT`, `GDTFLAT` | RMS deviation of the group delay from **Target** between **λ Start** and **λ End**, in fs. Uses **Step**. |
| `GDDFLAT`, `GDDTFLAT` | RMS deviation of the GDD from **Target** over the band, in fs². Uses **Step**. |
| `TODFLAT`, `TODTFLAT` | RMS deviation of the TOD from **Target** over the band, in fs³. Uses **Step**. |

**Pol** selects s or p; `avg` is their mean, except on the p-minus-s rows. Each value comes from the complex amplitude at exactly the wavelength asked for, by the same calculation as the [GD & GDD](/analysis/gd-gdd/) window. A new row starts at a target of 0. A phase miss is taken the short way round the circle. On a `*FLAT` row, **Current** shows the level the band reaches, the trapezoid-weighted mean over the band grid, so it reads against the target directly; the RMS deviation the merit scores is in the tooltip of the % of MF² cell.

These rows score the front coating, and the back coating when the design's surface mode is back-only. There is no phase row for the whole element: in Total merit mode the R and T rows score the complete element while the phase rows in the same table keep scoring the one coating, and the Merit Function Editor and Refinement window say so above the table. A phase row whose wavelength lies outside the stated range of a material's model has no value: **Current** shows **Error**, the row's tooltip names the material, and the merit and Refinement stay unavailable until every enabled row has a value.

## Field

| Name | Description |
| ---- | ----------- |
| `EFMX` | Peak of the normalized \|E\|² anywhere in the front coating at **λ** and **AOI (°)**. **Pol** selects s or p; `avg` takes the larger of the two peaks. A new row starts at a target of 0, so it lowers the peak field, the usual aim for laser damage resistance. |

The [Electric Field](/analysis/efield/) window draws `avg` as the mean of the s and p profiles, so its peak there can be lower than this row's. An `EFMX` row makes every optimizer step slower: its slopes are taken by finite differences, and so are every other row's while it is in the merit function.

## Math on other rows

| Name | Reads | Value | Holds |
| ---- | ----- | ----- | ----- |
| `OPGT` | **Ref Op#** | ref | ref ≥ **Target** |
| `OPLT` | **Ref Op#** | ref | ref ≤ **Target** |
| `OPVA` | **Ref Op#** | ref | ref = **Target** |
| `ABSO` | **Ref Op#** | \|ref\| | \|ref\| = **Target** |
| `ABGT` | **Ref Op#** | \|ref\| | \|ref\| ≥ **Target** |
| `ABLT` | **Ref Op#** | \|ref\| | \|ref\| ≤ **Target** |
| `DIFF` | **Ref Op#1**, **Ref Op#2** | ref1 − ref2 | value = **Target** |
| `SUMM` | **Ref Op#1**, **Ref Op#2** | ref1 + ref2 | value = **Target** |
| `PROD` | **Ref Op#1**, **Ref Op#2** | ref1 · ref2 | value = **Target** |

A math row reads the value of another row instead of computing one from the coating. Its target is in that row's unit, shown in percent when every row it reads is a T, R or A row. **AOI (°)** and **Pol** show a dash: the value read was computed at the other row's angle and polarization. The optimizers take a math row's slopes from those of the rows it reads. A math row that reads an `EFMX` row, or a curve block whose level is not free, directly or through another math row, makes every optimizer step slower: its slopes are taken by finite differences, and so are every other row's while it is in the merit function.

The reference cell lists the rows by their current number and type, such as `#4 TMN`. The link is kept to the row itself, not to its number, so inserting, deleting or moving rows does not break it. Deleting a row also deletes the math rows that read it. A reference to a row that is no longer there, as in a merit function loaded from elsewhere, shows **(deleted)** in red. A row that reads a disabled, missing or valueless row, or that sits on a loop of references, has no value: **Current** shows **Error** and the merit cannot be computed until it is fixed.

**Generate MF** in the [Specification](/design/specification/) window writes, for each ≥ or ≤ specification, a measurement row at weight 0 (`TAV`, `TMN` and so on) and an `OPGT` or `OPLT` row reading it, so the table reads "target 99 %, value 99.5 %".

## Thickness and stress

| Name | Description |
| ---- | ----------- |
| `TT` | Sum of the layer thicknesses of the coating being optimized, locked layers included, in nm. **Cmp** sets ≤, ≥ or =; a new row compares with = and starts at 1000 nm. In symmetric mode it sums the front stack only. |
| `STR` | Force per unit width the coatings put on the substrate, Σ σ_l·d_l, in N/m. **Cmp** sets ≤, ≥ or =; a new row starts at = 0 N/m, a flat substrate. |
| `MNT` | Thinnest layer from **Layer 1** to **Layer 2**. Holds it ≥ **Target**, in nm. |
| `MXT` | Thickest layer from **Layer 1** to **Layer 2**. Holds it ≤ **Target**, in nm. |

Layers are numbered as in the Design Editor, layer 1 on the substrate. With both faces optimized independently, the front layers come first and the back layers follow, each side counted out from its substrate. The range is clamped to the stack, and a new `MNT` or `MXT` row covers layers 1 to 1000, so it keeps covering the layers synthesis adds. A range that holds no layer has no value and the merit skips it. An `MXT` row is the only upper limit on a layer's thickness: without one, the optimizers let a layer grow as thick as the merit asks.

These four rows are kept out of the OMF and out of the synthesis searches. Needle, automatic and manual, leaves `MNT` and `MXT` out and keeps its layers above its own minimum thickness; a `TT` or `STR` row stays in Needle's refinement steps but not in its search for where to insert a layer. Deep Synthesis and the Structural Optimizer leave `MNT` and `MXT` out and hold the strictest of each as the floor and ceiling on every layer; the Structural Optimizer keeps `TT` and `STR` in the merit function it accepts a change by. Gradual Evolution and Refinement keep all four in the merit function.

### Film stress

A coating pulls on the substrate it sits on, and a substrate too thin to ignore it bends. The force per unit width behind that bend is

```
F = Σ σ_l · d_l      (N/m, which is MPa·µm)
```

summed over the films, with the back coating entering negative because it pulls the other way. `STR` puts that force in the merit function, so the bow becomes something the optimizer steers rather than something the first part off the machine reveals. **A target of 0 is the zero-deflection condition:** a coating whose compressive and tensile films balance leaves the substrate flat.

Each film's stress comes from its material record, on the **Mechanical** tab of the [Material Editor](/design/material-editor/), never from the row. The one number `STR` needs is the **intrinsic stress in MPa**, tensile positive, which is what a wafer-bow measurement gives. A material that states no intrinsic stress contributes nothing, and the merit table names it, so a blank record never reads as an unstressed film.

If the material also states Young's modulus, Poisson's ratio and an expansion coefficient, and the design carries stress temperatures, set in the [Stress Analysis](/analysis/stress/) window (a missing one reads 20 °C), two thermal terms are added. One corrects for the stress having been measured at the material's reference temperature rather than at deposition; a material with no reference temperature is taken as measured at deposition. The other is the expansion mismatch with the substrate between the deposition and evaluation temperatures, when the substrate states its expansion coefficient. The deposition temperature is the substrate's temperature while the film grows.

Which coatings count follows the design's evaluation mode, as in every analysis window: the active side alone with "ignore the other side" on, both otherwise. In symmetric mode the mirrored back coating cancels the front exactly, so the row sits at zero whatever the layers do, and the merit table says so.

The residual is raw N/m and the merit adds weight times its square, so a 1 N/m miss at weight 10⁻⁵ weighs about as much as a 0.3 % reflectance miss at weight 1.

## Table control

| Name | Description |
| ---- | ----------- |
| `BLNK` | A comment row: free text in **Comment**, no value. |
| `DMFS` | The header of a block the wizard generated, with a line describing it. No value. |

A row added in the Merit Function Editor or the Refinement window starts as a `BLNK`, so it cannot score anything until you pick a type.

---

## How rows add up

The merit function is

```
MF = √( Σ wᵢ · (rᵢ / σᵢ)²  /  W )
```

with wᵢ the row's weight, rᵢ its residual and σᵢ the [scale of its unit](#unit-scale). W is the sum of the weights of the rows that have a value, leaving out `MNT`, `MXT`, `TT` and `STR`, whose weights count only when the other rows with a value weigh nothing in total. Disabled rows, comment rows and rows with no value add nothing. The OMF beside it is the same sum without the `MNT`, `MXT`, `TT` and `STR` rows.

| Residual | Rows | rᵢ |
| -------- | ---- | -- |
| Equality | `T` `R` `A` `TDB`, band averages, integrals, `MXW*` `MNW*`, `PSI` `TANPSI` `COSDEL`, `GD` `GDD` `TOD` and their transmission forms, `EFMX`, `OPVA` `ABSO` `DIFF` `SUMM` `PROD` | value − target |
| Equality on a circle | `DEL` `PR` `PT` `DPR` `DPT` | value − target, taken the short way round, −180° to 180° |
| At least | `TMN` `RMN` `AMN` `TDBMN` `ODMN` `OPGT` `ABGT` `MNT` | target − value when the value is below the target, else 0 |
| At most | `TMX` `RMX` `AMX` `TDBMX` `RDBMX` `OPLT` `ABLT` `MXT` `PPEF` | value − target when the value is above the target, else 0 |
| By the **Cmp** cell | `TT` `STR` | ≤ at most, ≥ at least, = equality |
| Deviation | `TGT` `RGT` `AGT`, the `*FLAT` rows, `MCURVE` | the RMS deviation, which **Current** shows except on a `*FLAT` row, where it is in the tooltip |

A satisfied one-sided row has a residual of zero and pulls on nothing, but its weight still counts in W, except for `MNT`, `MXT`, `TT` and `STR`. It therefore lowers the MF reading: a `T` row missing by 0.1 scores 0.1 alone and 0.0707 beside a satisfied `TMN` row of the same weight.

### Unit scale

Dividing each residual by σ puts rows of different units on one footing, so the weight stays a matter of importance rather than of units.

| Rows | σ | A miss that scores 0.01 |
| ---- | - | ----------------------- |
| T, R and A rows of every kind, `TANPSI`, `COSDEL`, `EFMX` | 1 | 1 % in T, R or A |
| `MXW*` `MNW*` | 500 nm | 5 nm |
| `TDB` `TDBMN` `TDBMX` `RDBMX` `PPEF` | 10/ln 10 ≈ 4.343 dB | about 0.04 dB, a 1 % change in T or R |
| `ODMN` | 1/ln 10 ≈ 0.4343 | about 0.004 |
| `PSI` | 10° | 0.1° |
| `DEL` | 20° | 0.2° |
| `PR` `PT` `DPR` `DPT` | 180° | 1.8° |
| `GD*` `GDD*` | 50 fs, 50 fs² | 0.5 fs, 0.5 fs² |
| `TOD*` | 500 fs³ | 5 fs³ |
| `MCURVE` | the σ of its channel | |
| `TT` `STR` `MNT` `MXT` | 1, in nm or N/m | 0.01 nm or 0.01 N/m |
| Math rows | the σ of the rows they read | |

A math row takes the σ of the row it reads, so an `OPLT` on an `MXWT` row scores a miss exactly as the `MXWT` row would with that target. `DIFF` and `SUMM` of two rows with the same σ take that σ; of two rows with different σ they keep 1. `PROD` takes the product of the two σ. The thickness and stress rows are scored raw, so a violated manufacturing bound is fixed before anything else.

## Searching for a peak or dip

The worst-case rows and the `MXW*` / `MNW*` rows report the true highest or lowest value of the band, not the best of a set of samples. A row looks either for a peak of T, 1 − R or A, where a narrow resonance or a leak can sit, or for a dip:

| Looks for a peak | Looks for a dip |
| ---------------- | --------------- |
| `TMX` `RMN` `AMX` `TDBMX` `ODMN` `MXWT` `MNWR` `MXWA` | `TMN` `RMX` `AMN` `TDBMN` `RDBMX` `MNWT` `MXWR` `MNWA` |

A row that looks for a peak starts from a uniform grid at the step its **Step** flag sets; a row that looks for a dip starts from 13 points. On a thick coating either grid is made finer, to three points per interference fringe, and like the [band grid](#sampling-a-band) it is set from the design when a run starts. Every peak or dip the grid shows is tried, the one that decides the row is then refined, and the band ends are checked, so the value does not depend on where the samples fall.

| Step | 1 or empty | 2 | 3 | 4 |
| ---- | ---------- | - | - | - |
| Grid step | 1 nm | 0.1 nm | 0.01 nm | 0.001 nm |

The step decides only whether two peaks close together are told apart. Two peaks closer than about two steps, such as the split top of a two-cavity filter, can read as one, and not always the higher. If the band holds such a pair, raise the step. Each level samples the band ten times as densely as the one before, and the row costs that much more time.

A check in the [Specification](/design/specification/) window searches or samples its band at its own **Step**, the flag **Generate MF** writes on its row, wherever it is evaluated: the window, the report's specification block, the claims in the [Coating Library](/design/coating-library/), the [Monte Carlo](/analysis/error-analysis/) yield and the specification badge in the tolerance windows. A FWHM or Edge λ check, which has no row, walks out from the peak along a scan of the band at its Step to bracket each crossing of its level, then finds the crossing by bisection, so its value is exact at any step; the step decides only which peak is found and whether a dip between the peak and its crossing is seen. While the window follows an optimizer run it reads every check at its default step, and at its own Step again once the run stops. The status-bar monitors search and scan at 0.1 nm.

## Sampling a band

Band averages, spectral targets, weighted integrals and the `*FLAT` rows sample a uniform grid across the band. The grid follows the coating: its step is an eighth of the fringe spacing λ²/(2G) at the short end of the band, where G is the coating's optical thickness taken with the group index n − λ·dn/dλ (or with n, where n is larger); with both faces coated the two coatings' thicknesses add. The grid has at least 101 points and no upper limit, so the optimizer cannot lower the merit by moving fringes into the gaps between samples.

The **Step** flag of a band row sets the coarsest step its grid may take; the row takes whichever of that step and the fringe grid is finer.

| Step | empty | 1 | 2 | 3 | 4 |
| ---- | ----- | - | - | - | - |
| Grid step no coarser than | the fringe grid | 1 nm | 0.1 nm | 0.01 nm | 0.001 nm |

The fringe grid follows the coating's fringes, but the pass band of a cavity is about a fringe divided by the cavity's finesse wide, so the grid can step right over it, and a band average or target across it reads far from its value. Over such a band set a step a few times finer than the pass band: a TiO2/SiO2 single-cavity filter of seventeen layers needs step 2, one of thirty-three layers step 3. Each level samples the band ten times as densely as the one before, and the row costs that much more time.

The merit tables of the Merit Function Editor and Refinement, the Design Cleaner, Needle Manual and every optimizer run size the grid from the design. A refinement keeps that grid for the whole run; a synthesis run enlarges it as the design grows. The Specification window and the Coating Library's band figures read the grid the merit table uses. Other views that report a band average keep a 2 nm step, so on a thick coating their figure can differ slightly from the merit table's.

When a run starts, each spectral-target row (`TGT`, `RGT`, `AGT`) is checked for a peak or dip at least 2 % high that is narrower than its grid step. If it has one, the row is sampled finely enough to put four points across the narrowest such feature, up to 2001 points over the band. The merit table does not do this, so during a run such a row can score a little differently from the table.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed.: §2.6.4 for the two-sided system; Ch. 3, automatic design, for the merit function.
- B. T. Sullivan, J. A. Dobrowolski, "Implementation of a numerical needle method for thin-film design," *Appl. Opt.* **35**, 5484 (1996).
- C. A. Klein, "Normal and interfacial stresses in thin-film coated optics: the case of diamond-coated zinc sulfide windows," *Opt. Eng.* **40**, 1115 (2001): eq. 14 for the film force, eq. 34 for the zero-deflection condition a `STR` target of 0 asks for.
