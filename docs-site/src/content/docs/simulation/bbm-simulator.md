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

**Page 1: Deposition Rates.** For each material, set the **mean rate**
(nm/s), the **RMS** rate fluctuation, and the **correlation time** that
controls how slowly the rate drifts. The preview shows a sample rate-vs-time
trace; press **Randomize** to draw a new one. The rate wanders within each
layer at the scan interval, as the preview shows, and carries on into the next
layer of the same material. With a correlation time of 0 the rate noise
averages out of the thickness completely.

**Page 2: Parameters Deviation.** Per material, add a **systematic** and
**random** shift to the real refractive index, plus a **systematic
inhomogeneity**. The lower table lets you **exclude** individual layers from
monitoring (they are then cut purely on time) and give each one an extra
relative thickness error. **Shutter delay** (mean and RMS, in seconds) models
the lag between the cut decision and the shutter actually closing.

**Page 3: Monitoring System.** Choose the measured **quantity** and
polarization (T or R, s/p/average), the **angle of incidence**, the **scan
interval** between spectrum readings, and the monitoring **band** (λ min, λ
max, and number of points). **Chip glass** is the witness chip the monitor
watches: it opens on the design substrate, and picking another material moves
the monitor signal onto that glass, for a witness that is not the same glass
as the part. The preview shows the ideal monitoring signal for the layer
selected in the tab strip.

**Page 4: Signal Errors.** Add **random noise** (percent of signal) and a
slow baseline **drift** to the monitor signal. The preview shows the noisy
signal for the selected layer.

**Page 5: Deposition Simulation.** Press **Start** to run one full
manufacturing experiment. The coating then plays back layer by layer on an
interactive timeline (play/pause, speed, scrub, layer ticks). The bar chart
compares the **estimated**, **actual**, and **target** thickness of the
current layer; the spectrum shows the theoretical guide curves (end, 80 %,
90 %) against the as-built curve. Once a layer is cut, its estimated bar is
what the monitor believes it deposited, which is the target unless the cut ran
late.

**Page 6: Resulting Performance.** Tabs show the **manufactured vs.
theoretical** spectrum, **relative** and **absolute** thickness-error bars per
layer, and tables of as-built **thicknesses** and **refractive indices**.

**How the monitor cuts a layer.** From 60 % of a layer's planned time on, the
monitor fits the thickness of the growing layer to every scan. Each fit scans
the whole range from zero to three times the target at a step finer than the
fringes of the monitoring band before it refines, so it needs no starting guess
and settles in the best-fitting fringe rather than the nearest one. A
tracker follows the layer's thickness and rate from these fits, weighting each
fit by how well its scan pins the thickness, and the shutter closes where the
tracked thickness reaches the target, between scans if need be. Without noise
every layer ends on target at any scan interval. Each fit is made over the
monitor's own estimate of the layers below, not over what the chamber really
deposited, so an error in one layer carries into the fits of the next ones the
way it does in a real chamber. An excluded layer enters that model at its
target.

The coating side that is deposited, and the way the resulting spectrum is
scored, follow the surface mode set in the
[Design Editor](/design/design-editor/), shown as a badge on the window. The
in-chamber monitor signal is read through the whole witness chip: the growing
coating on its front face and its bare back face, added incoherently, the way
a spectrophotometer aimed through the chamber actually sees it. A bare chip of
n = 1.52 glass reads 91.8 %, not the 95.7 % of the coated surface alone. The chip hangs in the chamber, so the signal is read with air above the growing coating whatever medium the design is embedded in.

## How to read it

Page 6 is the verdict. If the manufactured curve hugs the theoretical one and
the error bars are small, the design is robust to the monitoring conditions
you set. Large thickness errors on a particular layer point to a layer that is
hard to monitor at the chosen wavelength or strategy, a candidate for a
different monitoring wavelength, tighter rate control, or a more tolerant
redesign. Because every run uses fresh random draws, run it a few times (or
re-run page 5) to see the spread of outcomes rather than trusting a single
realization.

## References

- Tikhonravov & Trubetskov, *Appl. Opt.* **44**, 6877 (2005), computational
  manufacturing as a bridge between design and production.
- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Ch. 12.
