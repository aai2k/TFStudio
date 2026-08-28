---
title: Measured Spectra
description: Import measured R/T/A spectra, compare them against the design, fit the design to them, and export design or measured curves to CSV or JCAMP-DX.
ribbonIcon: spectrum-exchange
---

The **Measured Spectra** window connects your design to the spectrophotometer.
**Import** a measured reflectance, transmittance, or absorptance curve from an
instrument file, compare it against the design on
[Optical Evaluation](/analysis/optical-evaluation/), and **fit** the design's
thicknesses to it. **Export** writes either the computed design spectrum or
your imported curves to a portable file. The window is split into **Import**
and **Export** tabs.

## Import

Press **Import Spectrum** and pick a file. What the importer accepts, and the
instrument quirks it handles on its own, is on the
[Spectrum File Formats](/data-exchange/spectrum-file-formats/) page.

### Measurement conditions

Set these before importing, because the file almost never states them and a
wrong value poisons a fit without ever looking wrong:

- **Angle of incidence**: the angle the instrument measured at. A near-normal
  accessory is usually 6 or 8 degrees, not 0.
- **Polarization**: average, s, or p.
- **Side**: which face of the sample was illuminated.

Every imported curve carries its own copy of these, and you can correct them
afterwards on the curve itself.

### Confirming the parse

For a text table the panel shows what was detected and lets you override it:
the wavelength unit, which column to take, the quantity, the Y scale, and the
curve's name. The preview beside it plots the incoming curve against the
design's own spectrum, evaluated at that curve's angle and side, so you can see
before committing whether the measurement sits where the design sits.

**Add to design** adds the column you configured. **Add all curves** appears
for a file with several data columns and adds every one of them, which is what
you want for a file holding T and R side by side, and not what you want for a
file that also carries raw signal columns.

### Editing a curve

An imported curve is stored on the design and **persists with the project**.
Each one gets a card in the window where you can rename it, change its colour,
retype it, correct the source scale, correct the measurement conditions, and
**trim** its wavelength range. Trimming is not destructive: it moves the bounds
used everywhere else and the points stay in the file, so you can widen it again.

On Optical Evaluation the curves appear as dotted lines with open-circle
markers, coloured by R / T / A. The checkbox on the card hides one without
removing it.

## Fitting the design to a measurement

**Fit…** on a curve card turns that measurement into a merit-function target,
so [Refinement](/synthesis/refinement/) can adjust the design's thicknesses
until the computed spectrum matches what you measured. This is characterization
of a coating you already know the recipe for; it is not recovering an unknown
stack from an arbitrary spectrum, which is not solvable from intensity alone.

### Which points to fit

- **As measured** uses the measured points as they are and invents nothing.
  Correct when the scan is dense and evenly spaced, and the default.
- **Every Nth point** uses measured points only, thinned. Use it when a very
  dense scan slows a run down for no gain.
- **Even step** interpolates onto a wavelength step you choose.

Interpolating a coarse scan onto a fine grid **adds no information**. The
reason to resample is uniformity, not density: the merit function sums over its
points, so an unevenly sampled scan quietly weights the fit toward wherever the
instrument happened to take more readings. Interpolation is shape-preserving,
so it will not overshoot at a steep band edge and ask the optimizer to chase a
reflectance above 100 %.

You can also narrow the wavelength range, set the weight the fit carries
against the rest of the merit function, and add minimum and maximum layer
thickness constraints in the same step. **Append** adds the target to the merit
function you already have; **replace** clears it first.

### The target it creates

The fit becomes a single row in the
[Merit Function Editor](/design/merit-function-editor/) holding its own copy of
the measurement, so it travels with the design and keeps working if the curve
is later changed or removed. Only its **Enabled** switch and **Weight** can be
edited: the rest describes a measurement that was taken, not a target you
choose. The value it reports is the RMS difference between design and
measurement, in the same units as the curve.

The target is refused if the curve was measured on a side the design is not
evaluated on, rather than quietly fitting the wrong spectrum. If a curve runs
past the wavelengths your materials have data for, the target is clipped to
what can be evaluated and the dialog says so.

Optical Evaluation draws the target whether or not the design still holds the
curve behind it. Loading a saved merit function into another design therefore
shows what it fits to; if you want the measurement back as a curve you can
edit, the Import tab offers to restore it.

## Export

A **What to export** chooser picks the source:

- **Design spectrum**: the *computed* T / R / A of the active design. Set the
  wavelength start, end and step, an angle-of-incidence list, the channels, and
  whether to split s and p (absorptance has no s/p split). It follows the
  active surface mode and works without Optical Evaluation open.
- **Measured curves**: the curves you imported. Tick the ones to write.

For either source, choose the **format** (CSV or JCAMP-DX), the **wavelength
unit** (nm, µm, or cm⁻¹) and whether Y is written as a **fraction or a
percentage**.

## How to read it

The typical use is validating a deposition run: import the spectrophotometer
trace and compare it against the predicted curve. Where the two diverge tells
you how the as-built coating departs from the design, and fitting turns that
difference into the layer thicknesses that actually came out of the chamber.

## References

- McDonald & Wilks, *Appl. Spectrosc.* **42**, 151 (1988), the JCAMP-DX
  `XYDATA` / ASDF format (AFFN, PAC, SQZ, DIF, DUP).
- Fritsch & Carlson, *SIAM J. Numer. Anal.* **17**, 238 (1980), the
  shape-preserving interpolation used when resampling onto an even step.
