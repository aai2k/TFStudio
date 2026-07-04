---
title: Broadband Monitoring Simulator
description: Simulate making your coating under a broadband optical monitor, then see the as-built spectrum and where the errors come from.
ribbonIcon: bbm-simulator
---

The **Broadband Monitoring Simulator** is a 6-page wizard that simulates what
happens when your design is actually deposited and watched by an in-chamber
**broadband spectrophotometer**. It grows the coating layer by layer with
realistic deposition-rate jitter, per-material index drift, and signal noise,
lets the simulated monitor decide when to cut each layer, and then shows you
the manufactured spectrum next to the theoretical one so you can see how well
the design survives production.

You set up the deposition conditions on the first four pages, run a single
computational-manufacturing experiment on page 5 and scrub through it like a
movie, and read the resulting performance on page 6.

## Settings

The wizard walks through one topic per page.

**Page 1 — Deposition Rates.** For each material, set the **mean rate**
(nm/s), the **RMS** rate fluctuation, and the **correlation time** that
controls how slowly the rate drifts. The preview shows a sample rate-vs-time
trace; press **Randomize** to draw a new one.

**Page 2 — Parameters Deviation.** Per material, add a **systematic** and
**random** shift to the real refractive index, plus a **systematic
inhomogeneity**. The lower table lets you **exclude** individual layers from
monitoring (they are then cut purely on time) and give each one an extra
relative thickness error. **Shutter delay** (mean and RMS, in seconds) models
the lag between the cut decision and the shutter actually closing.

**Page 3 — Monitoring System.** Choose the measured **quantity** and
polarization (T or R, s/p/average), the **angle of incidence**, the **scan
interval** between spectrum readings, and the monitoring **band** (λ min, λ
max, and number of points). The preview shows the ideal monitoring signal for
the layer selected in the tab strip.

**Page 4 — Signal Errors.** Add **random noise** (percent of signal) and a
slow baseline **drift** to the monitor signal. The preview shows the noisy
signal for the selected layer.

**Page 5 — Deposition Simulation.** Press **Start** to run one full
manufacturing experiment. The coating then plays back layer by layer on an
interactive timeline (play/pause, speed, scrub, layer ticks). The bar chart
compares the **estimated**, **actual**, and **target** thickness of the
current layer; the spectrum shows the theoretical guide curves (end, 80 %,
90 %) against the as-built curve.

**Page 6 — Resulting Performance.** Tabs show the **manufactured vs.
theoretical** spectrum, **relative** and **absolute** thickness-error bars per
layer, and tables of as-built **thicknesses** and **refractive indices**.

The coating side that is deposited, and the way the resulting spectrum is
scored, follow the surface mode set in the
[Design Editor](/design/design-editor/), shown as a badge on the window. The
in-chamber monitor signal is always computed on a semi-infinite substrate,
the way a spectrophotometer aimed through the chamber actually sees it.

## How to read it

Page 6 is the verdict. If the manufactured curve hugs the theoretical one and
the error bars are small, the design is robust to the monitoring conditions
you set. Large thickness errors on a particular layer point to a layer that is
hard to monitor at the chosen wavelength or strategy — a candidate for a
different monitoring wavelength, tighter rate control, or a more tolerant
redesign. Because every run uses fresh random draws, run it a few times (or
re-run page 5) to see the spread of outcomes rather than trusting a single
realization.

## References

- Tikhonravov & Trubetskov, *Appl. Opt.* **44**, 6877 (2005) — computational
  manufacturing as a bridge between design and production.
- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Ch. 12.
