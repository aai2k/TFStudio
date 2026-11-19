---
title: Specification
description: The design's requirements as pass/fail checks, judged live on the design and turned into a merit function in one click.
ribbonIcon: specification
---

The Specification holds what the coating must meet, as pass/fail checks such as "$T \ge 99\,\%$ averaged over 450–650 nm" or "no more than 30 layers". It is the requirement sheet, kept apart from the [merit function](/design/merit-function-editor/) the optimizers minimize; **Generate MF** turns the sheet into a merit function so a run aims at exactly what was specified. The checks are saved with the design.

<!-- shot: specification | the 8-layer AR's own spec plus the Photopic AR preset appended and a layer count ≤ 8, every row passing and the banner green -->
![Specification](/screenshots/specification.png)

## Computed quantities

Each row shows the value it reads on the design beside its target, and a green tick or red cross; a failing row adds a line saying why. The banner turns green only when every row that is on passes, and counts how many do.

| Kind | Reads | Unit |
|---|---|---|
| **T / R / A at λ** | The channel at one wavelength. | % |
| **Avg T / R / A over band** | The channel averaged over a band. | % |
| **Min / Max** | The lowest or highest value of the channel in a band, so a narrow spike inside a good average still fails. | % |
| **Weighted integral** | The channel weighted by a source and a detector, such as Tvis or Tsol. | % |
| **Central λ** | The wavelength of the peak or notch in a band. | nm |
| **FWHM** | The width of the peak or notch at a level, half of the peak by default. | nm |
| **Edge λ** | Where the channel crosses the level on one side of the peak: the edge of a long-pass or short-pass filter. | nm |
| **Total thickness** | Physical thickness of the front, the back or both. | nm |
| **Layer count** | Layers on the front, the back or both. | count |
| **Peak-to-peak error vs curve** | The spread of the design's error against a measured T, R or A curve, the figure a gain-flattening filter is specified by. | dB |

A value faded and marked ≈ is read at the default step while the value at the check's own **step** is worked out. During an optimizer run the window stays at the default steps until the run stops.

## Controls and settings

Each row shows only the fields its kind uses: **Ch**, the wavelength or **λ start** and **λ end**, **AOI**, **pol**, and for a peak **dir** (max or min). FWHM and Edge λ add **level**, a fraction of the peak between 0 and 1, and Edge λ the **edge** side, left or right of the peak. **cmp** is ≥, ≤, = ± **tol**, or between **lo** and **hi**.

**step**: how finely a check searches or samples its band.

- On a peak (Min / Max, Central λ): the search step, 1 nm by default, down to 0.001 nm. Two peaks closer than about two steps can read as one. A check on a dip searches the design's fringes and has no step.
- On a band average or integral: **auto** takes the grid from the design's fringes, no more than 2 nm apart ([sampling a band](/design/operands/#sampling-a-band)), which can step over a narrow pass band; a set step is the grid exactly.
- On FWHM and Edge λ: the scan step, 1 nm by default, never fewer than 301 samples across the band. Each crossing is found exactly between samples, so the step decides only which peak is found and whether a narrow feature next to it is seen.

The same step holds wherever the check is read: the report, the Coating Library, the Monte Carlo yield and the tolerance windows' badge. A fine step over a wide band is slow in all of them and in every optimizer run: at 0.01 nm a check over a few hundred nanometres takes a fraction of a second, at 0.001 nm several seconds.

**side**: what a thickness or layer count adds up, the front, the back (the mirrored front on a symmetric design) or both.

**curve**: the peak-to-peak check reads one of the design's [measured curves](/data-exchange/measured-spectra/) at its own points and conditions instead of a band.

**Env**: on a design with more than one [environment](/design/environments/), **All** judges the check in every environment that is on, and a numbered one judges it there alone while it is on. A check passes when it passes in each. Rows show their value in the current environment and a dash where they are not judged; the banner counts every environment that is on and names where a failing check fails. Deleting an environment deletes the checks judged in it alone.

**Preset**: built-in sheets for common coatings, **replace** or **append**. **Save…** keeps the list as your own preset under Documents\TFStudio\Qualifiers, loaded from **Saved**. Presets carry no environment.

## Generate MF

**Generate MF** replaces the design's merit function, as one undo step. Each check becomes a measurement row at weight 0 and the rows that hold it to the target: `OPGT` for ≥, `OPLT` for ≤, and the pair at lo and hi for a range or at target ± tol for an equality. The merit function is then met exactly when the check passes, and a run stops at the edge of a tolerance rather than its centre. An equality with no tolerance becomes the measurement row at its target, except on Min / Max and peak-to-peak, whose row scores one side only and so gets the pair. Every row carries its check's step and environment.

- A **Total thickness** on the coating the optimizers move becomes a `TT` row, or a `TT` minimum and maximum for a range.
- A peak-to-peak check writes its curve as a block at weight 0, a `PPEF` row against it and the comparison rows ([curves](/design/operands/#curves)).
- **FWHM**, **Edge λ**, **Layer count**, a thickness on another side and a peak-to-peak check whose curve is not on the design write nothing; a note beside the button names them.

## Theory

With $C(\lambda)$ the channel as a fraction, a band average and an integral read

$$
\begin{aligned}
\bar{C} &= \frac{\int C\,d\lambda}{\lambda_2 - \lambda_1} \\
C_w &= \frac{\int S(\lambda)\,D(\lambda)\,C(\lambda)\,d\lambda}{\int S(\lambda)\,D(\lambda)\,d\lambda}
\end{aligned}
$$

over the band, with $S$ the source and $D$ the detector of the integral. FWHM and Edge λ start from the peak $\lambda_p$ found as Central λ finds it, with value $C_p$. For level $L$ the crossing value is

$$
\begin{aligned}
C_x &= L\,C_p && \text{on a peak (max)} \\
C_x &= C_p + L\,(1 - C_p) && \text{on a notch (min)} \\
\text{FWHM} &= \lambda_\text{right} - \lambda_\text{left}
\end{aligned}
$$

where $\lambda_\text{left}$ and $\lambda_\text{right}$ are the first wavelengths either side of $\lambda_p$ at which $C$ reaches $C_x$, each found by bisection between scan samples. Edge λ is $\lambda_\text{left}$ or $\lambda_\text{right}$. $L$ is held between 0.001 and 0.999, since a level of 0 or 1 has no crossing.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Chapter 7, p. 213 and Chapter 8, p. 251: edge filters and band-pass filters, their edges and halfwidths.
