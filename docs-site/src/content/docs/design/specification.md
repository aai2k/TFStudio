---
title: Specification
description: State your design requirements as PASS/FAIL qualifiers, then turn them into a merit function.
ribbonIcon: specification
---

The **Specification** window holds your design's *requirements* as a list of
PASS/FAIL **qualifiers**: "T ≥ 99 % averaged over 450–650 nm", "R ≤ 0.5 % at
550 nm", "no more than 30 layers", and so on. It is the human-readable contract
the coating must meet, kept separate from the
[Merit Function](/design/merit-function-editor/) the optimizer minimizes. Each
qualifier answers a yes/no question with a tolerance, and one button converts
the whole list into merit operands so you can optimize toward exactly what you
specified.

Each row is evaluated against the active design and recomputes on every change,
showing a per-row verdict and an overall PASS/FAIL badge at the top.

Every check that searches for a peak or samples a band has a **Step**, the flag of the merit row it stands for, and **Generate MF** writes the same step on that row, so the check and the row read the same number:

- **Min / Max** or **Central λ** on a peak (a maximum of T or A, a minimum of R): the step the band is searched at, 1 nm by default, or 0.1, 0.01 or 0.001 nm. Two peaks closer than about two steps can read as one. A check on a dip searches the design's fringes and has no Step. See [Searching for a peak or dip](/design/operands/#searching-for-a-peak-or-dip).
- **T / R / A avg** and **Integral**: the coarsest step of the band's grid. **auto** takes the grid from the design's fringes, at least 101 points ([Sampling a band](/design/operands/#sampling-a-band)); a set step is for a band across a narrow pass band, which the fringe grid can step over.
- **FWHM** and **Edge λ**: the step the band is scanned at, 1 nm by default, with never fewer than 301 samples across the band; on a peak it is also the step the peak is searched at, while a dip is found on the design's fringes. Each crossing of the level is found exactly by bisection between samples, so the step decides only which peak is found and whether a narrow feature between it and its crossing is seen. These have no merit row.

The same Step holds in the report, the Coating Library, the Monte Carlo yield and the specification badge in the tolerance windows. A fine Step over a wide band costs time in each of them and in every optimizer run on the merit function: at 0.01 nm a check over a few hundred nanometres takes a fraction of a second, at 0.001 nm several seconds. The Monte Carlo yield and the tolerance badge work on the window's own thread, so for that long, per trial or per badge, the window does not respond. The Specification window shows each check at once at its default step and replaces the value when the analysis worker has it at the check's own Step; while it follows an optimizer run it stays at the defaults until the run stops. A value read at a default step where the check has a Step of its own is shown faded, with ≈ before it.

## Qualifier kinds

| Kind                | Asks                                                            | Units |
| ------------------- | -------------------------------------------------------------- | ----- |
| **T / R / A at λ**  | Channel value at a single wavelength versus a target.          | %     |
| **T / R / A avg**   | Band-averaged channel value over a wavelength range.           | %     |
| **Min / Max**       | Worst-case extremum of a channel over a band (catches spikes). | %     |
| **Integral**        | A source × detector weighted metric (e.g. T_vis, T_sol).       | %     |
| **Central λ**       | Center wavelength of a passband or edge feature.               | nm    |
| **FWHM**            | Full width at half-maximum of a feature.                       | nm    |
| **Edge λ**          | Wavelength where a channel crosses a level (a filter edge).    | nm    |
| **Thickness budget**| Total physical thickness of the front, the back or both.       | nm    |
| **Layer count**     | Number of layers on the front, the back or both.               | count |
| **Peak-to-peak error vs curve** | Spread of the design's error against a measured T, R or A curve, in dB. | dB |

## Settings

Each row exposes only the fields that apply to its kind:

**Kind**: one of the qualifier kinds above. **Channel** picks T, R or A
(fixed for the at-a-wavelength and average kinds). **λ / band** is a single
wavelength or a start/end range. **AOI** and **pol** set the angle of incidence
and polarization for optical kinds. **Step** sets how finely a check searches or samples its band (above).

**Comparison and target**: the actual test. You can require `≥`, `≤`, an
equality `= ± tol`, or a range `∈ [lo, hi]`, against the target value you enter
(percentages for T/R/A; nanometres or a count for the geometric kinds; dB for
the peak-to-peak error).

**Side**: a thickness budget or layer count adds up the front stack, the back stack (on a symmetric design, the front mirrored) or both. A new one starts at the side the design coats; one saved without a side adds up both.

**Curve**: the peak-to-peak error kind takes one of the design's curves from [Measured Spectra](/data-exchange/measured-spectra/) in place of a band, an angle and a polarization; it is read at the curve's own points and conditions. It is the number a gain-flattening filter is specified by, the `PPEF` operand of the [Operand Reference](/design/operands/#curves). **Generate MF** writes the curve into the merit function as a block at weight 0, a `PPEF` row measured against it, and the comparison row.

**Presets**: drop in a ready-made requirement set for a common coating type,
either replacing or appending to the current list. You can also save the
current list as your own reusable preset and load it back later.

## How to read it

Each row carries a colored verdict: green and a check mark when it passes, red
and a cross when it fails, with the measured value shown beside the target. The
banner at the top turns green only when every active row passes, and reports
how many of the total are passing. A failing row adds a short summary line
explaining the miss.

For stopband suppression, prefer the **Min / Max** (worst-case) kinds: a band
*average* can pass while a narrow resonance spikes through it. Once your
requirements are in place, **Generate MF** writes them into the design as `OPGT`/`OPLT` merit operands: each spec becomes a measurement row plus the targets that reference it, one for `≥` or `≤` and two for a range or `= ± tol` (at target − tol and target + tol), so the rows are met exactly when the check passes, and [Refinement](/synthesis/refinement/) and the synthesis tools optimize toward the specification directly and stay in sync with it. A run stops at the edge of a tolerance rather than at its centre; an equality with no tolerance is written as the measurement row at its target, except a Min / Max or peak-to-peak one, whose row scores one side only and so gets the pair at the target.
Every row it writes carries its check's **Step** as its flag, so the merit function reads the band as the check does.
A **Thickness budget** on the coating the optimizer works on (the front of a front-only or symmetric design, the back of a back-only one, both when both sides are given) becomes a `TT` row, or a `TT` minimum and maximum for a range or `= ± tol`. **FWHM**, **Edge λ**, **Layer count** and a thickness budget on any other side have no merit row: while the list holds any of them, a note beside **Generate MF** names them, and names a peak-to-peak check whose curve is not on the design, since the merit function it writes leaves them out.
The specification is saved in the project file alongside the design.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Ch. 7 (filter specifications: central wavelength, FWHM, edges).
