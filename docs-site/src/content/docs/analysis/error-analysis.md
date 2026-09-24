---
title: Monte-Carlo
description: See how random manufacturing errors blur your spectrum and what yield you can expect against the design Specification.
ribbonIcon: error-analysis
---

Monte-Carlo answers a practical question: if your coater deposits every layer
with a realistic random error, how much does the spectrum move, and how often
does the result still pass your Specification? You set the size and shape of the
per-layer thickness and index errors, choose how many trials to run, and the
tool builds a fresh randomly-perturbed version of your design for each trial. It
evaluates T, R or A for every trial, keeps a running mean and standard deviation
across them, and tracks the realized extremes. If your design has a
Specification, every trial is re-checked against it so you get a yield figure.

The analysis runs for the surface mode set in the
[Design Editor](/design/design-editor/) (front, back, or total), shown as a
badge on the window.

## Settings

**T / R / A**: the spectral characteristic to study.

**λ range / step**: the wavelength grid, in nanometres.

**AOI / pol**: angle of incidence and polarization (s, p, or averaged).

## Errors

What a trial is drawn from lives in the **Errors** strip below the plot, beside
the trial count it was drawn with.

**N trials**: how many randomly-perturbed designs to simulate. More trials give
a smoother corridor and a steadier yield estimate; the corridor noise shrinks
roughly as 1/√N. Default is 200.

**seed**: the number the random draws start from. Leave it empty and **Run**
fills it with a new seed and keeps it there, so running again with the same seed
and settings gives exactly the same trials. Clear the field to draw afresh. The
seed belongs to the open session and is not saved with the design; the trials
dialog shows the seed each result was drawn from.

**Distribution**: how each layer's error is drawn. This controls the *shape* of
the random draw, not its size:

- **Gaussian**: the value you enter is one standard deviation σ. About 68 % of
  layers stay within ±σ and the rest exceed it; the tails are unbounded, so σ is
  not a hard maximum.
- **Uniform**: the value you enter is a hard ± bound B. Errors are spread
  evenly over [−B, +B], so none exceeds B, and the realized RMS works out to
  B/√3 ≈ 0.58·B.
- **Truncated**: a Gaussian bell clipped so no error exceeds the entered bound
  B (taken as 3σ). The realized RMS is about B/3.

Choosing Uniform or Truncated relabels the error fields from σ to ± and turns on
the min/max envelope automatically, since those distributions have a true hard
bound worth seeing.

**σ abs / σ rel** (nm / %): the per-layer thickness error. The absolute part is
a fixed amount in nanometres; the relative part scales with each layer's own
thickness. They add together.

**σ Re(n) / σ Im(n)**: the per-layer error on the real part of the refractive
index (n) and on the extinction (k). k cannot go below zero, so on a layer with
k = 0 the Im(n) error only ever adds absorption and its mean effect is not zero.

**Per-material errors**: draw one shared error per material instead of an
independent error for every layer, modelling a material-chemistry drift rather
than monitoring scatter.

**keep n·d**: links the thickness error to the index error so that the optical
thickness n·d at the design reference wavelength stays constant. The plotted
wavelength range does not enter it, so widening the plot does not change the
draws. Only meaningful when an index error is set; with thickness errors alone
it would cancel the perturbation.

**k σ corridor**: the width of the shaded band, in standard deviations. This is
display-only: changing k redraws the band instantly without re-running the
trials and never affects the yield.

**min/max envelope**: overlays the extreme spectra realized across all trials.
For Uniform and Truncated this is the true hard bound; for Gaussian it has no
fixed limit and widens as you add trials.

## How to read it

The chart is in **percent**. The solid line is the theoretical (unperturbed)
spectrum, the dotted line is the mean across all trials, and the shaded band is
mean ± k·σ. A wide band means the design is sensitive to manufacturing error; a
tight band means it is robust. Note that the mean can sit slightly off the
theoretical curve where the spectrum is curved (for example, the mean reflectance
of an antireflection minimum drifts upward). That is real physics, not noise.

If the design carries a Specification, the Results strip shows the **yield** (the
fraction of trials that pass every requirement) with its **95 % interval** in
brackets, and a red chip for any requirement that fails, with its fail rate.
The interval is the range the true yield lies in with 95 % confidence for the
number of trials run (the Wilson score interval). Two runs whose intervals
overlap may differ only by chance; more trials narrow it. Open **View trials…**
for a deeper look: a statistics tab shows the interval and the seed, ranks the
worst requirements by fail rate and the worst
layers (those whose thickness deviates more in failing trials than passing ones,
or, when nothing fails, those with the largest typical deviation). The trials tab
lists every trial with a pass/fail mark and shows the exact per-layer Δd, Δn and
Δk applied. **Load thicknesses into design** copies a chosen trial's perturbed
thicknesses onto the active design so you can inspect it directly; the change is
undoable.

A quick sanity check: set every error to zero and every trial collapses onto the
theoretical curve with zero corridor width.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., §13.7.
- E. B. Wilson, "Probable inference, the law of succession, and statistical inference," *Journal of the American Statistical Association* **22**, 209-212 (1927).
