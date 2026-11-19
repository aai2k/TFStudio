---
title: Ellipsometry Evaluation
description: Ψ and Δ, the amplitude-ratio and phase quantities an ellipsometer measures, predicted for the design.
ribbonIcon: ellipsometry
---

The Ellipsometry window computes the ellipsometric angles $\Psi$ and $\Delta$ of the active design, the two numbers an ellipsometer reports. Use it to **predict what your instrument should see** for a coating, or to compare against a measurement. Only reflection off an isotropic sample is modelled; transmission, generalized and Mueller-matrix ellipsometry are outside it.

<!-- shot: ellipsometry | 100 nm SiO2 on silicon at 65°, spectral sweep 400-800 nm, Ψ and Δ on -->
![Ellipsometry Evaluation](/screenshots/ellipsometry.png)

## Computed quantities

- **Ψ**, in degrees on the left axis, 0 to 90°: $\tan\Psi$ is the ratio of the p to the s reflection amplitude.
- **Δ**, in degrees on the right axis, 0 to 360°: the phase difference between the p and s reflections.

Measured $\Psi$ and $\Delta$ added in [Measured Ellipsometry](/data-exchange/measured-ellipsometry/) are drawn over the spectral sweep, dotted with hollow points, on the side they were measured on and with $\Delta$ moved into the convention the window shows.

## Controls and settings

**Ψ / Δ**: show or hide each curve; the last one shown cannot be switched off.

**Settings**: **Mode** sweeps wavelength (**Spectral**) at a fixed **AOI (°)**, 65° by default, or the angle of incidence (**Angular**) at a fixed **λ (nm)**, which follows the design's reference wavelength. **Side** picks the front or back coating; each is one coherent reflection off its own face. **Δ convention** is **Azzam–Bashara**, the sign an ellipsometer writes and the default, or **360° − Δ** for data written in the other time convention. $\Psi$ is the same in both.

**Range warning**: a ⚠ badge appears when the sweep reaches outside a material's data range.

**Environment**: on a design with more than one [environment](/design/environments/), **Current** follows the environment the Design Editor shows, a numbered one holds the window on it even while it is switched off, and **All** draws every environment that is on in its own color, $\Psi$ solid and $\Delta$ dashed, with the table giving each environment its own $\Psi$ and $\Delta$ columns. The choice is not saved with the design.

**Results**: $\Psi$ and $\Delta$ against the swept variable.

## Ψ and Δ of a coating

A bare dielectric gives $\Delta = 180^\circ$ below its Brewster angle and 0° above it, with $\Psi$ falling to 0 at Brewster; a bare absorbing surface gives $\Delta = 90^\circ$ at its principal angle in the Azzam–Bashara convention. These are useful checks of a measurement's sign. A film adds oscillations in $\Psi$ and $\Delta$ with wavelength.

This window is a forward calculation. To recover thicknesses or optical constants from a measurement, fit it from [Measured Ellipsometry](/data-exchange/measured-ellipsometry/).

## Theory

$r_s$ and $r_p$ are the amplitude reflection coefficients of the stack for s and p light, $r = (\eta_0 - Y) / (\eta_0 + Y)$, with the tilted admittances and the surface admittance $Y$ of the [Admittance Diagram](/analysis/admittance/). Then (Macleod, Eq. 14.17):

$$
\begin{aligned}
\rho &= \tan\Psi \cdot e^{i\Delta} \\
\tan\Psi &= \lvert r_p\rvert / \lvert r_s\rvert \\
\Delta &= \varphi_p - \varphi_s + 180^\circ
\end{aligned}
$$

$\varphi_s$ and $\varphi_p$ are the phase changes on reflection in Macleod's convention, $N = n - ik$. The 180° turns the p coefficient built from $\eta_p = N / \cos\theta$ into the sign ellipsometry uses, so that the result is the Azzam–Bashara $\Delta$. **360° − Δ** is its complex conjugate, the same sample in the other time convention. $\Delta$ is wrapped into 0 to 360°, so a measured value of −12° plots at 348°.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Section 14.2, pp. 544–560 (Eq. 14.17): the ellipsometric parameters in reflection and transmission.
- H. G. Tompkins and E. A. Irene, *Handbook of Ellipsometry* (William Andrew, 2005).
