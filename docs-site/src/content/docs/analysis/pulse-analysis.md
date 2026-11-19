---
title: Pulse Analysis
description: An ultrashort pulse off or through the coating, against the shortest pulse its spectrum allows.
ribbonIcon: pulse-analysis
---

Pulse Analysis sends a short laser pulse off or through the coating and draws what comes out, beside the **Fourier-limited pulse (FLP)**: the shortest pulse the same spectrum can make, with every frequency arriving together. A dispersive mirror is judged by how close its output comes to that pulse. A GDD curve cannot show this on its own: ripple that looks small on the curve is what puts structure on the side of a short pulse.

<!-- shot: pulse-analysis | chirped mirror in reflection, 20 fs Gaussian at 800 nm with the GDD from target, time view with the delay removed, output over the FLP -->
![Pulse Analysis](/screenshots/pulse-analysis.png)

## Computed quantities

- In the time view, intensity scaled so the FLP peaks at 1: the output's peak reads as the fraction of the ideal it reaches, losses included. A dashed curve is the chirped input, drawn when its chirp changes its shape.
- In the spectrum view, the input and output spectra on one scale, and on the right axis the GDD over all bounces. With a chirped input a dashed curve is the GDD that would undo the chirp; where the two lie on each other the pulse comes out compressed.
- Under the plot: FLP and output durations, output peak against the FLP, the delay and the residual GDD. **Results** adds the RMS width, the output peak against its own transform limit, the energy out, the residual TOD, the spectral widths and the time-bandwidth product.

The peak against the transform limit compares the output with the shortest pulse its own spectrum could make, so it shows what is left to compress rather than what the coating took out of the spectrum.

## Controls and settings

**Time / Spectrum**, **T / R** and **Pol** pick the view; **avg** is an unpolarized pulse, its s and p halves going through separately and their intensities adding. **Delay removed** lays the output over the input; **Absolute** puts it where it really leaves the coating.

**Settings**, the pulse:

- **Spectrum**: **Model** builds it from a shape, **Table** uses a spectrum the design holds.
- **Shape**: Gaussian or sech², set by the **Duration** of the transform-limited pulse, or super-Gaussian, set by its spectral **FWHM** and **Order** (2 is the Gaussian; higher is flatter on top, with side lobes in time).
- **Table**: **Load file…** reads a text table into the [curve editor](/data-exchange/measured-spectra/#typing-a-curve-or-changing-its-points), **Edit…** opens the design's spectrum or an empty table. The spectrum is saved with the design.
- **Centre λ**: the carrier. A model spectrum is centred on it; a table spectrum does not move, and its centroid is shown beside.
- **GDD, TOD**: the input's own chirp. Positive GDD is the chirp glass gives, long wavelengths first. **From target** sets GDD to minus the design's GDD target per bounce times the bounces: the chirp the coating was designed to remove.

**Settings**, the geometry: **Side** is the **Front** or **Back** coating alone, or in transmission the **Whole part**, adding one pass through the substrate and the back coating, whose dispersion is usually far larger than a coating's. **AOI** in the incident medium. **Bounces**: how many times the pulse meets the coating or passes through the part.

**Environment**: on a design with more than one [environment](/design/environments/), **Current** follows the environment the Design Editor shows and a numbered one holds the window on it even while it is switched off. The pulse meets that environment's coating; the pulse itself is the same in every environment. The choice is not saved with the design.

**Notices**: when the output does not fit in the longest time span the calculation can hold, a notice says the numbers are not reliable. With **Whole part** only the first pulse out of the part is drawn, and the notice gives the round-trip time of the light reflected inside the substrate.

## Pulse shapes and table files

Each model shape is symmetric in frequency about the centre, with no phase of its own. $\Delta\omega$ is the angular frequency less the carrier's, the intensity is per unit frequency, and the time-bandwidth product is FWHM in time times FWHM in $\nu = \omega/2\pi$.

| Shape | Set by | Spectral intensity | Transform-limited intensity | Time-bandwidth product |
|---|---|---|---|---|
| **Gaussian** | Duration $\tau$ | $\exp\left(-\tau^2 \cdot \Delta\omega^2 / (4 \ln 2)\right)$ | $\exp\left(-4 \ln 2 \cdot t^2/\tau^2\right)$ | 0.441 |
| **sech²** | Duration $\tau$ | $\operatorname{sech}^2\left(\pi \cdot T_0 \cdot \Delta\omega / 2\right)$ | $\operatorname{sech}^2(t/T_0)$, $\tau = 1.763 \cdot T_0$ | 0.315 |
| **Super-Gaussian** | FWHM $W$, order $p$ | $\exp\left(-\ln 2 \cdot (2 \cdot \lvert\Delta\omega\rvert / W)^p\right)$ | no closed form | 0.441 at $p = 2$, rising with $p$ |

A table file holds wavelength (nm, µm, cm⁻¹ or eV, from the header or told from the numbers), relative intensity, and optionally phase in rad, read as the [Spectrum File Formats](/data-exchange/spectrum-file-formats/#delimited-text) page describes:

```
Wavelength (nm)	Intensity	Phase (rad)
760	34.8	2.938
780	462.5	0.620
800	1000	0
820	452.6	0.432
840	53.3	1.416
```

Intensity against nm or µm is per unit wavelength and is converted to per unit frequency. Between rows it is interpolated in frequency without overshoot, and outside the first and last rows there is no light, so delete a spectrometer's dark baseline rows. The phase has the sign of GDD; a wrapped phase is unwrapped, and its value and slope at the centre are left out, as they only move the pulse in time. **Apply** sets the centre λ to the spectrum's centroid.

## Theory

The output spectrum is the input times the coating's full complex response, once per bounce, with nothing reduced to GD and GDD:

$$
\begin{aligned}
\tilde E_\text{out}(\omega) &= \tilde E_\text{in}(\omega) \cdot H(\omega)^N \\
\Phi_\text{out}(\omega) &= \Phi_\text{in}(\omega) + N \cdot \arg H(\omega) \\
I(t) &= \left| \int \tilde E(\omega)\, e^{-i\Delta\omega \cdot t}\, d\omega \right|^2
\end{aligned}
$$

$H$ is $r$ in reflection, and in transmission $t$ scaled so that $|H|^2 = T$; for **Whole part** it is the front coating, one pass through the substrate and the back coating. $\arg H$ has the sign whose derivative is the coating's group delay, as in the [GD / GDD window](/analysis/gd-gdd/). The FLP is the same $|\tilde E_\text{in}|$ with a flat phase.

$$
\begin{aligned}
\text{delay} &= \frac{\int |\tilde E_\text{out}|^2 \cdot \frac{d\Phi_\text{out}}{d\omega}\, d\omega}{\int |\tilde E_\text{out}|^2\, d\omega} \\
\mathrm{GDD}_\text{res} &= \frac{\int |\tilde E_\text{out}|^2 \cdot \frac{d^2\Phi_\text{out}}{d\omega^2}\, d\omega}{\int |\tilde E_\text{out}|^2\, d\omega}
\end{aligned}
$$

The delay is the shift of the intensity centroid, which by Parseval's theorem equals the spectrally weighted group delay. Delay, GDD and TOD come from exact derivatives of the phase. Durations are full widths at half maximum between the outermost half-maximum points, so a satellite above half the peak counts.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Section 11.2, pp. 414–425 (Eqs. 11.7, 11.8 and 11.17): pulses and phase in ultrafast coatings.
- J. R. Birge and F. X. Kärtner, "Efficient analytic computation of dispersion from multilayer structures," *Applied Optics* **45**, 1478-1483 (2006), [doi:10.1364/AO.45.001478](https://doi.org/10.1364/AO.45.001478).
- F. X. Kärtner, *Ultrafast Optics*, MIT 6.977 lecture notes, §2.8.
