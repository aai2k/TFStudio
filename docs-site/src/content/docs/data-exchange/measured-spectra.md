---
title: Measured Spectra
description: Import measured R/T/A spectra, compare them against the design, fit the design to them, and export design or measured curves to CSV or JCAMP-DX.
ribbonIcon: spectrum-exchange
---

Measured Spectra connects the design to the spectrophotometer. **Import** a measured R, T or A curve from an instrument file, compare it with the design on [Optical Evaluation](/analysis/optical-evaluation/), and **fit** the design's thicknesses to it; **Export** writes the computed design spectrum or the imported curves to a file. A typical use is checking a deposition run: where the measured trace leaves the predicted one shows how the coating departs from the design, and the fit turns that into the thicknesses that came out of the chamber.

<!-- shot: spectrum-exchange | a measured transmittance file being imported, the parse panel with its detected unit, column and scale, and the incoming curve previewed over the design's spectrum at its angle -->
![Measured Spectra](/screenshots/spectrum-exchange.png)

## Computed quantities

- On Optical Evaluation each curve shows as a dotted line with open circles, colored by R, T or A.
- While importing, the preview plots the incoming curve over the design's spectrum at the curve's angle, so a misplaced measurement shows before it is added.
- A fit target reports the RMS difference between design and measurement in the curve's units, or in dB for a fit made in dB.

## Controls and settings

Curves belong to the design selected in the project explorer and are saved with the project; another design shows its own curves, and an opened file waits for you to come back. With no design selected the window asks for one.

### Importing a curve

**Import Spectrum** reads a file; what it accepts is on [Spectrum File Formats](/data-exchange/spectrum-file-formats/). For a text table the panel shows what it detected and lets you change it: wavelength unit, column, quantity, Y scale and name. Then the conditions the file leaves unsaid, each worth checking, since a wrong one spoils a fit without looking wrong:

- **Angle of incidence**, asked when any column has none, and applied to all of them. A near-normal accessory is usually 6 or 8°, not 0.
- **Polarization**: **Average**, s or p. Not asked for absorptance, which has none; a column headed Rs or Tp keeps its own.

A measurement is taken with the coated face toward the beam. **Add to design** adds the configured column; **Add all curves**, for a file with several data columns, adds them all, right for T and R side by side, wrong for a file with raw signal columns.

Each curve gets a card: name, **Curve color**, quantity, **Source scale**, angle and polarization, **Trim range** and **Visible**. Trimming moves the bounds used everywhere and keeps the points, so it can be widened again.

### Typing a curve, or changing its points

**New curve** opens the curve editor on an empty table, and **Edit** on a card opens it on that curve: the table on the left, the plot on the right over the design's spectrum at the curve's angle and polarization.

- **Columns**: the wavelength in nm, µm, cm⁻¹ or eV; each value column a quantity, T, R or A, and a unit: %, 0-1, dB, for T and R **dB loss** (a positive number of dB, as a loss curve or return loss is written), and for T optical density. The unit says what the numbers are; changing it does not rescale them. **+ Column** adds a value column and the bin removes one; each value column becomes a curve, so T and R or s and p can be typed side by side.
- **Cells**: click, Shift, drag and Ctrl select; typing replaces, a decimal comma reads as a point; Ctrl+C and Ctrl+V copy and paste, a block from a spreadsheet read as a file is imported; Delete removes rows, Backspace empties cells, Ctrl+Z undoes. Dragging the square at the selection's corner continues it: one number is copied, or counted by 1 with Ctrl, and two or more continue their best straight line, so 400 and 410 go on 420, 430.
- **Fill…** writes one value, an even step, or a run evenly spaced in log or in wavenumber. **Change…** scales by a percentage or maps V to a·V + b. **Smooth…** fits a polynomial of the order you set over the points you set either side (Savitzky-Golay), never on the wavelength column. **Resample…** puts every column onto a new step with the interpolation Fit uses. Each tool's panel follows the selection while open.
- A value above 100 % or below 0 is red. With **Drag points** on, a point dragged on the plot takes the value it is dropped at. **Y** sets the plot's range, or fits it with **Auto**.

**Apply** sorts by wavelength and adds or changes the curves. If fit targets were made from the edited curve, it offers to rebuild them from the new points with their grid, range, weight and scale. A curve typed in dB, dB loss or OD keeps that unit, and its card shows **Typed in dB** and so on under **Source scale** in place of Percent and Fraction. [Pulse Analysis](/analysis/pulse-analysis/) opens the same editor on a pulse spectrum, with intensity and spectral phase columns; Smooth and Resample unwrap a wrapped phase first.

### Export

**What to export**: **Design spectrum**, the computed T, R and A of the active design over a range and step, a list of angles and the channels, split into s and p if asked, on the active surface mode and without Optical Evaluation open; or **Measured curves**, the ticked ones. Both are written as CSV or JCAMP-DX. Measured curves also take a wavelength unit (nm, µm or cm⁻¹) and fraction or percent; a design spectrum is always written in nm and percent.

## Fitting the design to a measurement

**Fit…** on a card turns the measurement into a merit target, so [Refinement](/synthesis/refinement/) moves the design's thicknesses until the spectrum matches. It characterizes a coating whose recipe you know; recovering an unknown stack from intensity alone is not solvable.

- **Grid**: **Measured** uses every point and invents nothing, right for a dense, even scan and the default. **Thinned** keeps every Nth point (**Keep every**) plus the end. **Uniform** resamples onto an even step. Resampling a coarse scan adds no information; it evens the weighting, since the merit sums over points and an uneven scan leans the fit toward wherever the instrument took more readings. The resampling is shape-preserving, so it does not overshoot a steep edge past 100 %.
- **Fit in**: for transmittance, % or dB. In dB a 0.1 dB miss counts the same at −20 dB as at 0 dB, for a curve specified in dB such as a gain-flattening target; a point at or below 0 % has no dB value and is left out.
- **Fit range**, **Weight**, and **Add thickness constraints** with minimum and maximum thickness. **Clip to material data range** drops points where a material has no data rather than fitting against extrapolated n and k. **Merit function**: **Append** to the existing one, or **Replace** it.

**Create MF target** writes one row holding its own copy of the measurement, so it travels with the design and keeps working if the curve is changed or removed. Only **Enabled** and **Weight** can be edited, since the rest records a measurement taken. Optical Evaluation draws the target whether or not the curve is still there, and the Import tab offers to restore the curve. A fit in dB shows as **MCURVE dB** and restores as a transmittance curve.

## Theory

The target's value over its M points, with C the design's channel and C_j the measured value at λ_j:

```
RMS = √( (1/M) Σ_j (C(λ_j) − C_j)² )
in dB:   C → 10 log₁₀ C
```

For a run the row is expanded into one residual per point, so least squares sees the shape of the miss and not one number. **Uniform** and **Resample…** use the shape-preserving piecewise cubic of Fritsch and Carlson; **Smooth…** is the Savitzky-Golay least-squares polynomial.

## References

- McDonald & Wilks, *Appl. Spectrosc.* **42**, 151 (1988), the JCAMP-DX `XYDATA` / ASDF format (AFFN, PAC, SQZ, DIF, DUP).
- Fritsch & Carlson, *SIAM J. Numer. Anal.* **17**, 238 (1980), the shape-preserving interpolation used when resampling onto an even step.
- A. Savitzky and M. J. E. Golay, "Smoothing and differentiation of data by simplified least squares procedures," *Anal. Chem.* **36**, 1627-1639 (1964).
