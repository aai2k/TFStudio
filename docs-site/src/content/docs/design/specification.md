---
title: Specification
description: State your design requirements as PASS/FAIL qualifiers — and turn them into a merit function.
ribbonIcon: specification
---

The **Specification** window holds your design's *requirements* as a list of
PASS/FAIL **qualifiers** — "T ≥ 99 % averaged over 450–650 nm", "R ≤ 0.5 % at
550 nm", "no more than 30 layers", and so on. It is the human-readable contract
the coating must meet, kept separate from the
[Merit Function](/design/merit-function-editor/) the optimizer minimizes. Each
qualifier answers a yes/no question with a tolerance, and one button converts
the whole list into merit operands so you can optimize toward exactly what you
specified.

Each row is evaluated against the active design and recomputes on every change,
showing a per-row verdict and an overall PASS/FAIL badge at the top.

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

## Settings

Each row exposes only the fields that apply to its kind:

**Kind** — one of the qualifier kinds above. **Channel** picks T, R or A
(fixed for the at-a-wavelength and average kinds). **λ / band** is a single
wavelength or a start/end range. **AOI** and **pol** set the angle of incidence
and polarization for optical kinds.

**Comparison and target** — the actual test. You can require `≥`, `≤`, an
equality `= ± tol`, or a range `∈ [lo, hi]`, against the target value you enter
(percentages for T/R/A; nanometres or a count for the geometric kinds).

**Presets** — drop in a ready-made requirement set for a common coating type,
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
requirements are in place, **Generate MF** writes them into the design as
`OPGT`/`OPLT` merit operands — each spec becomes a measurement row plus a
one-sided target referencing it — so [Refinement](/synthesis/refinement/) and
the synthesis tools optimize toward the specification directly and stay in sync
with it. The specification is saved in the project file alongside the design.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Ch. 7 (filter specifications: central wavelength, FWHM, edges).
