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

An opened file belongs to the design selected in the project explorer. Select
another design and the window shows that design's curves and nothing of the
file; come back and the file is where you left it. With no design selected
there is nothing to import into, and the button is off.

### Confirming the parse

For a text table the panel shows what was detected and lets you override it:
the wavelength unit, which column to take, the quantity, the Y scale, and the
curve's name. The preview beside it plots the incoming curve against the
design's own spectrum, evaluated at that curve's angle, so you can see before
committing whether the measurement sits where the design sits.

Below the name come the conditions the file leaves unsaid, which is most of
them: a wrong value poisons a fit without ever looking wrong, so check each
one before adding the curve.

- **Angle of incidence**, asked when the file leaves any of its columns without
  one. It covers every such column, because **Add all curves** adds them too. A
  near-normal accessory is usually 6 or 8 degrees, not 0.
- **Polarization**: average, s, or p. Not asked for absorptance, which is what
  the sample keeps of everything that reached it and has no polarization to
  pick.

Every imported curve carries its own copy of these, and you can correct them
afterwards on the curve itself. A measurement is taken with the coated face
toward the beam; there is no setting for the other way round.

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

### Typing a curve, or changing its points

**New curve**, beside **Import Spectrum**, opens the curve editor on an empty table, and **Edit** on a curve card opens it on that curve's points. The points are in a table on the left and plotted on the right, over the design's own spectrum at the curve's angle and polarization. Drag the divider between them to give either side more room.

- **Columns.** Each value column has a quantity, T, R or A, and a unit: %, 0-1 or dB, and optical density for T. The unit says what the typed numbers are; changing it does not rescale them. The wavelength column takes nm, µm, cm⁻¹ or eV. Each value column becomes a curve of its own, so T and R, or s and p, can be typed side by side.
- **Selecting and typing.** Click, Shift-click or drag to select cells, and Ctrl-click to add one. Type to replace a value; a decimal comma reads as a decimal point. Ctrl+C and Ctrl+V copy and paste, a pasted value or row repeats over the selection, and a block pasted from a spreadsheet or a text file is read the way a file is imported, the table growing to hold it. Delete removes the rows of the selected cells and Backspace empties the cells. Ctrl+Z undoes. Drag the small square on the selection's bottom-right corner down or up to continue the selected values, the table growing as far down as you drag: one number is copied, or counted up or down by 1 with Ctrl held, and two or more continue the straight line that fits them best, so 400 and 410 go on 420, 430.
- **Fill** writes a constant, an even step, a logarithmic step or a step even in wavenumber down the selected cells. **Change** scales them by a percentage or by a·V + b.
- **Smooth** applies Savitzky-Golay smoothing to the selected values. **Resample** puts every column onto an even step with the interpolation Fit uses.
- A value above 100 % or below 0 is marked in red. With **Drag points** on, a point dragged up or down on the plot takes the value it is dropped at.

**Apply** sorts the rows by wavelength and adds the new curves, or changes the edited one, and from then on they are curves like any imported one. A new curve gets its angle and polarization on its card. If fit targets were made from the edited curve, Apply offers to rebuild them from the new points, keeping their grid, range, weight and scale.

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

For a transmittance curve, **Fit in** picks % or dB. In dB the target holds the points in dB and scores the fit in dB, so a 0.1 dB miss counts the same at −20 dB as at 0 dB. Use it for a curve specified in dB, such as a gain-flattening target. A point at or below 0 % has no dB value and is left out; the dialog says how many.

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

If a curve runs past the wavelengths your materials have data for, the target
is clipped to what can be evaluated and the dialog says so.

Optical Evaluation draws the target whether or not the design still holds the
curve behind it. Loading a saved merit function into another design therefore
shows what it fits to; if you want the measurement back as a curve you can
edit, the Import tab offers to restore it.

A fit made in dB shows in the table as **MCURVE dB**, reports its RMS difference in dB, and is restored as a transmittance curve.

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
