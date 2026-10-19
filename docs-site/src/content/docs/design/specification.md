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

An average or integral row reads its band on the grid the merit table gives the same row, so the row **Generate MF** writes for it reads the same number ([Sampling a band](/design/operands/#sampling-a-band)).

A row that looks for a peak searches its band at 0.01 nm, so the window tells apart two close peaks that a merit row at its default step can read as one. **FWHM** and **Edge λ** find each crossing of their level exactly, by bisection between the samples of a scan at that step. The value searched at 1 nm shows at once and the finer one replaces it when it is ready, a fraction of a second per check over a few hundred nanometres and longer over a wide band; while the window follows an optimizer run it stays at 1 nm until the run stops. See [Searching for a peak or dip](/design/operands/#searching-for-a-peak-or-dip).

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
| **Thickness budget**| Total physical stack thickness.                                | nm    |
| **Layer count**     | Number of layers in the stack.                                 | count |
| **Peak-to-peak error vs curve** | Spread of the design's error against a measured T, R or A curve, in dB. | dB |

## Settings

Each row exposes only the fields that apply to its kind:

**Kind**: one of the qualifier kinds above. **Channel** picks T, R or A
(fixed for the at-a-wavelength and average kinds). **λ / band** is a single
wavelength or a start/end range. **AOI** and **pol** set the angle of incidence
and polarization for optical kinds.

**Comparison and target**: the actual test. You can require `≥`, `≤`, an
equality `= ± tol`, or a range `∈ [lo, hi]`, against the target value you enter
(percentages for T/R/A; nanometres or a count for the geometric kinds; dB for
the peak-to-peak error).

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
The rows it writes search their band at the default 1 nm step; if a band holds two peaks closer than about 2 nm, raise their **Step** flag so the merit function reads the band as the window does.
The specification is saved in the project file alongside the design.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Ch. 7 (filter specifications: central wavelength, FWHM, edges).
