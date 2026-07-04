---
title: Monochromatic Monitoring Simulator
description: Simulate making your coating under a single-wavelength monitor, with turning-point, level, or timed cut strategies per layer.
ribbonIcon: mono-simulator
---

The **Mono Simulator** is a 6-page wizard that simulates depositing your
design under an in-chamber **single-wavelength optical monitor**. It is the
monochromatic counterpart of the
[Broadband Monitoring Simulator](/simulation/bbm-simulator/) and shares the
same setup and playback; the difference is that each layer is cut from one
monitoring wavelength using one of three classic termination strategies.

You configure the deposition conditions and the per-layer monitoring plan on
the first four pages, run a single manufacturing experiment on page 5, and
read the resulting performance on page 6.

## Settings

**Page 1 — Deposition Rates.** Per material, set the **mean rate** (nm/s),
the **RMS** fluctuation, and the **correlation time** governing how slowly the
rate drifts. The preview shows a sample rate-vs-time trace; **Randomize** draws
a new one.

**Page 2 — Parameters Deviation.** Per material, add **systematic** and
**random** index shifts and a **systematic inhomogeneity**. The lower table
**excludes** chosen layers from monitoring (cut on time) with an optional extra
relative thickness error, and **shutter delay** (mean and RMS) models the cut
lag.

**Page 3 — Monitoring System.** Set the measured **quantity** and polarization,
the **angle of incidence**, the **scan interval**, and the number of
**confirm scans** a cut needs before it is accepted. The per-layer table is the
heart of this page: for each layer choose the **monitoring wavelength** and the
termination **strategy** —

- **Turning point** — cut when the monitor signal reaches an expected extremum.
  The **order** column picks which extremum.
- **Level** — cut when the signal crosses a target level in the expected
  direction.
- **By time** — cut after a precomputed time, with no signal feedback.

**Auto wavelength** picks a sensitive monitoring wavelength for every layer.
The preview plots the ideal signal versus deposited thickness for the selected
layer, with the cut point marked.

**Page 4 — Signal Errors.** Add **random noise** and a slow **drift** to the
single-wavelength signal; the preview shows the noisy signal for the selected
layer.

**Page 5 — Deposition Simulation.** Press **Start** to run one manufacturing
experiment, then play it back on the interactive timeline. The bar chart shows
the **estimated / actual / target** thickness of the current layer; the
spectrum shows the theoretical guide curves against the as-built curve.

**Page 6 — Resulting Performance.** Tabs show the **manufactured vs.
theoretical** spectrum, per-layer **relative** and **absolute** thickness-error
bars, and tables of as-built **thicknesses** and **refractive indices**.

The deposited side and the way the resulting spectrum is scored follow the
surface mode set in the [Design Editor](/design/design-editor/), shown as a
badge on the window. The monitor signal is computed on a semi-infinite
substrate, the way a single-wavelength monitor actually sees the growing
coating.

## How to read it

Match the strategy to the layer. When a layer's thickness is close to a
quarter-wave multiple at the monitoring wavelength, a turning point is precise
and direction-blind, so it is the natural choice. For other thicknesses, pick a
level cut at a wavelength where the signal slope is steep through the cut point,
which gives the best precision. On page 6, layers with large thickness errors
are the ones whose monitoring wavelength or strategy isn't serving them — try
the auto-wavelength suggestion or a different strategy, then re-run. Run the
experiment several times to see the spread rather than a single outcome.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Ch. 12.
- Tikhonravov & Trubetskov, *Appl. Opt.* **44**, 6877 (2005).
