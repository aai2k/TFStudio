---
title: Pulse Analysis
description: An ultrashort pulse off or through the coating, against the shortest pulse its spectrum allows.
ribbonIcon: pulse-analysis
---

Pulse Analysis sends a short laser pulse off or through the coating and draws what comes out. Beside it is the **Fourier-limited pulse (FLP)**: the shortest pulse the same spectrum can make, with every frequency arriving together. A dispersive mirror is judged by how close its output comes to that pulse, and a GDD curve cannot show this on its own: the ripple that looks small on the curve is what puts structure on the side of a short pulse.

## Settings

**Time / Spectrum**: the pulse against time, or its spectrum against wavelength.

**Reflection / Transmission**: the pulse reflected by the coating or transmitted through it.

**Polarization**: s, p, or the average. The average is an unpolarized pulse: its s and p halves go through the coating separately and their intensities add.

**Delay removed / Absolute** (time view): with the delay removed the output is moved back and laid over the input, so the shapes compare directly, and the delay is given as a number. Absolute puts the output at the time it really leaves the coating.

The **Settings** panel holds the pulse and the geometry.

**Spectrum**: **Model** builds the spectrum from a shape. **Table** uses a measured or typed spectrum that the design holds.

**Shape**: **Gaussian** or **sech²**, set by **Duration**, the intensity FWHM of the transform-limited pulse in fs; the spectral width it implies is shown beside it. **Super-Gaussian** is set by its spectral **FWHM** in nm and an **Order**: 2 is a Gaussian, and a higher order flattens the top of the spectrum.

**Load file…** reads a text table into the [curve editor](/data-exchange/measured-spectra/#typing-a-curve-or-changing-its-points): wavelength in the first column, intensity in the second and, when present, the spectral phase in radians in the third. Check the columns and rows there, delete what is not the pulse, and **Apply**. **Edit…** opens the design's spectrum again, or an empty table to type or paste one into. The spectrum is kept with the design and saved in the project.

Wavelength can be in nm, µm, cm⁻¹ or eV. Against nm or µm the intensity is read as a spectrometer records it, per unit wavelength, and converted to intensity per unit frequency, which is what a pulse is built from; against cm⁻¹ or eV it is per unit frequency already. Every row is read as light with the phase given, so a spectrometer's dark baseline left in the table joins the pulse: delete those rows, or set the baseline to zero.

The phase has the sign of GDD: a phase curving upward against frequency is a positive GDD, long wavelengths first. A phase written wrapped into one turn is unwrapped; a phase that spans more than a turn is read as written. Its value and slope at the centre wavelength only set where the pulse sits in time, and are left out. **Apply** sets the centre wavelength to the spectrum's centroid in frequency.

**Centre λ**: the carrier wavelength. A model spectrum is centred on it. A spectrum from the design does not move with it: there it is the point the typed GDD and TOD and the spectrum's own phase are taken about, and the spectrum's centroid is shown beside it. Selecting another design with a spectrum moves it to that spectrum's centroid.

**GDD, TOD**: the input pulse's own chirp, in fs² and fs³, added to whichever spectrum it has. Positive GDD is the chirp glass gives: the long wavelengths arrive first. **From target** sets GDD to the design's GDD target per bounce, times the number of bounces, with the sign reversed: the chirp the coating was designed to remove.

**Side**: **Front** or **Back** is that coating on its own, as in the [GD/GDD window](/analysis/gd-gdd/). **Whole part**, in transmission only, adds one pass through the substrate at the thickness set in the design and the back coating. The substrate's own dispersion is usually far larger than a coating's, so a transmitted short pulse is only described properly with it included.

**AOI**: angle of incidence in degrees, in the incident medium.

**Bounces**: how many times the pulse meets the coating, or with **Whole part** how many times it passes through the part. Dispersive mirrors are specified by their GDD per bounce and the number of bounces; each bounce applies the coating's full response once more.

## How the values are calculated

The full complex response is applied at every wavelength. Nothing is reduced to GD and GDD, so the effect of ripple and of higher-order phase is in the result.

Durations are full widths at half maximum of intensity, measured between the outermost half-maximum points, so a satellite above half the peak counts. The delay is the shift of the pulse's centre of gravity. Residual GDD and TOD are the output's own, averaged across its spectrum with the spectral intensity as weight. All three come from exact derivatives of the coating's phase, the same ones the GD/GDD window plots.

If the output does not fit in the longest time span the calculation can hold, a notice says the curve and the numbers are not reliable. With **Whole part**, only the first pulse out of the part is drawn. Light reflected back and forth inside the substrate leaves later by the substrate's round trip, and the notice gives that time.

Outside a material's data range the spectrum view shades the band and the notice names the material, as in the other analysis windows.

## How to read it

In the time view the intensity is scaled so the FLP peaks at 1. The output's peak then reads directly as the fraction of the ideal peak it reaches, losses included. A dashed curve is the chirped input; it is drawn only when the input's own chirp changes its shape. A well-matched mirror brings the output back over the FLP. Structure on one side of the output, or small satellite pulses, comes from GDD ripple and TOD the coating leaves behind.

In the spectrum view the input and output spectra share one scale, so the output shows what reflection or transmission took away. On the right axis is the GDD over all bounces: the coating's, or with **Whole part** the part's, substrate included. When the pulse carries a chirp, a dashed curve beside it is the GDD that would undo that chirp; where the two curves lie on each other across the spectrum, the net GDD is zero and the pulse comes out compressed. The GDD axis takes its range from the bulk of the curve, as in the GD/GDD window. Samples where the response passes near zero and almost no light is left can fall off it, and a notice counts them.

The line under the plot gives the FLP and output durations, the output peak against the FLP, the delay, and the residual GDD. **Results** lists every number with CSV export: the durations, the RMS width, the output peak against its own transform limit, the energy that comes out, the residual TOD, the spectral widths and the time-bandwidth product. The peak against the transform limit compares the output with the shortest pulse its own spectrum could make, so it shows what is left to compress rather than what the coating took out of the spectrum. With s and p averaged, a delay between the two lowers it as well.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Ch. 11, Eqs. 11.7, 11.8 and 11.17.
- J. R. Birge and F. X. Kärtner, "Efficient analytic computation of dispersion from multilayer structures," *Applied Optics* **45**, 1478-1483 (2006), [doi:10.1364/AO.45.001478](https://doi.org/10.1364/AO.45.001478).
- F. X. Kärtner, *Ultrafast Optics*, MIT 6.977 lecture notes, §2.8.
