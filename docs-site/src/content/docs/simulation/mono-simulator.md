---
title: Monochromatic Monitoring Simulator
description: Simulate making your coating under a single-wavelength monitor, with turning-point, level, or timed cut strategies per layer.
ribbonIcon: mono-simulator
---

The **Mono Simulator** is a 7-page wizard that simulates depositing your
design under an in-chamber **single-wavelength optical monitor**. It is the
monochromatic counterpart of the
[Broadband Monitoring Simulator](/simulation/bbm-simulator/) and shares the
same setup and playback; the difference is that each layer is cut from one
monitoring wavelength using one of three classic termination strategies.

You configure the deposition conditions and the per-layer monitoring plan on
the first five pages, run a single manufacturing experiment on page 6, and
read the resulting performance on page 7.

## Settings

**Page 1: Deposition Rates.** Per material, set the **mean rate** (nm/s),
the **RMS** fluctuation, and the **correlation time** governing how slowly the
rate drifts. The preview shows a sample rate-vs-time trace; **Randomize** draws
a new one.

**Page 2: Parameters Deviation.** Per material, add **systematic** and
**random** index shifts and a **systematic inhomogeneity**. The lower table
**excludes** chosen layers from monitoring: an excluded layer ends at its target
thickness plus the optional extra relative thickness error you give it, whatever
the rate did. **Shutter delay** (mean and RMS) models the cut lag.

**Page 3: Monitoring System.** Set the measured **quantity** and polarization,
the **angle of incidence**, the **scan interval**, and the number of
**confirm scans** a cut needs before it is accepted. **Chip glass** is the
witness chip the monitor watches: it opens on the design substrate, and picking
another material moves the monitor signal onto that glass, for a witness that
is not the same glass as the part. The preview plots the ideal signal versus
deposited thickness for the selected layer, with the cut point marked.

**Page 4: Monitoring Wavelengths.** The per-layer plan: for each layer choose
the **monitoring wavelength** and the termination **strategy**:

- **Turning point**: cut when the monitor signal reaches an expected extremum.
  The **order** column picks which extremum. While the signal is clean enough
  to show its curvature, the monitor forecasts the extremum from the last few
  readings and closes the shutter on it, between scans if need be. On a noisy
  signal it waits for the signal to turn back, and the cut runs a little past
  the extremum.
- **Level**: cut when the signal crosses a target level in the expected
  direction. The cut is armed only on the branch that holds the target, after
  the last extremum the model predicts before it, so a layer thicker than a
  quarter wave is not cut where the signal first passes the same level. An
  **order** of N, 2 or more, arms it after extremum N − 1 instead, so the order
  picks the branch here the way it picks the extremum for a turning cut; 1
  leaves the branch to the model. The monitor watches for the smoothed signal
  to reach the value the model gives it the **confirm scans** ahead of the
  target, works out the crossing time between scans, and closes the shutter on
  a timer that much later. The confirmation then costs no thickness, and a
  noiseless run ends on target at any scan interval. On a branch too short to
  hold the confirm scans, the cut runs late by the part that did not fit.
- **By time**: cut after a precomputed time, with no signal feedback. The time
  is the target thickness over the mean rate from page 1, and the layer grows
  at the rate the run actually has, so it ends thick or thin by the rate error.

The table opens at the reference wavelength. A layer within 6 % of a whole
number of quarter waves gets a turning cut when its signal on the chip, with
the design's layers beneath it, turns within 6 % of a quarter wave of the
layer's end; every other layer gets a level cut, and a layer that barely moves
the signal is cut by time.

**Auto λ (all)** picks, for every layer, the wavelength and strategy whose cut
is most precise. Quarter-wave layers keep the reference wavelength's turning
point, and its self-compensation, while the reversal is still detectable; once
a stopband saturates the signal, its layers are monitored outside the band,
and a layer no wavelength can serve is cut by time. **Set all** puts one
wavelength on the whole run, and the strategy dropdown beside it applies one
termination rule to every layer at once. Clicking a table row shows that
layer's ideal signal in the preview beside the table.

**Page 5: Signal Errors.** Add **random noise** (percent of the reading), the
monitor's **absolute noise** floor (percent of full scale, which does not
shrink with the signal), and a slow **drift** to the single-wavelength signal;
the preview shows the noisy signal for the selected layer.

**Page 6: Deposition Simulation.** Press **Start** to run one manufacturing
experiment, then play it back on the interactive timeline. The bar chart shows
the **estimated / actual / target** thickness of the current layer; the
spectrum shows the theoretical guide curves against the as-built curve.

**Page 7: Resulting Performance.** Tabs show the **manufactured vs.
theoretical** spectrum, per-layer **relative** and **absolute** thickness-error
bars, and tables of as-built **thicknesses** and **refractive indices**.

The deposited side and the way the resulting spectrum is scored follow the
surface mode set in the [Design Editor](/design/design-editor/), shown as a
badge on the window. The monitor signal is read through the whole witness chip:
the growing coating on its front face and its bare back face, added
incoherently, the way a transmittance monitor actually sees a chip in the
chamber. A bare chip of n = 1.52 glass reads 91.8 %, not the 95.7 % of the
coated surface alone. The chip hangs in the chamber, so the signal is read with air above the growing coating whatever medium the design is embedded in.

## How to read it

Match the strategy to the layer. When a layer's thickness is close to a
quarter-wave multiple at the monitoring wavelength, a turning point is precise
and direction-blind, so it is the natural choice. For other thicknesses, pick a
level cut at a wavelength where the signal slope is steep through the cut point,
which gives the best precision. On page 7, layers with large thickness errors
are the ones whose monitoring wavelength or strategy isn't serving them; try
the auto-wavelength suggestion or a different strategy, then re-run. Run the
experiment several times to see the spread rather than a single outcome.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Ch. 12.
- Tikhonravov & Trubetskov, *Appl. Opt.* **44**, 6877 (2005).
