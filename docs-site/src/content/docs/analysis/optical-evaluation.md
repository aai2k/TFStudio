---
title: Optical Evaluation
description: Spectral reflectance, transmittance and absorptance of the active design.
ribbonIcon: optical-eval
---

Optical Evaluation plots **how your coating transmits, reflects and absorbs light across a wavelength range**. It is the window to check after every design change, and it draws the merit targets over the spectrum so you can see what the design is being optimized toward.

<!-- shot: optical-eval | 4-layer visible AR, R only against its 420-680 nm target band, vertical axis on Auto -->
![Optical Evaluation](/screenshots/optical-eval.png)

## Computed quantities

- **T**, **R** and **A** = $1 - R - T$, each for **s**, **p** and their average **avg**. For transparent materials A stays at zero.
- Read in **%**, as a fraction **0-1**, in **dB** ($10 \cdot \log_{10}$), or for T alone as optical density **OD** ($-\log_{10} T$).
- What is computed follows the evaluation mode set in the [Design Editor](/design/design-editor/), shown as a badge under the plot: **Front** is the front coating on the substrate, **Back** the back coating, **Total** the whole part through the substrate, which is what a spectrophotometer measures for a part coated on both faces. A second badge shows when the curves are averaged over a cone of incidence.

## Controls and settings

**T / R / A** switch the curves, each with **avg**, **s** and **p**.

**Targets** shows the merit rows over the spectrum: point targets as X markers, band and ramp targets as a dotted line over a tinted zone. **Edit** draws them on the plot instead of typing them into the [Merit Function Editor](/design/merit-function-editor/): drag a line for a target, a flat one becoming a band average and a sloped one a ramp; drag a target to move it; the delete tool removes one. Ends snap to a grid and to other targets' ends. Every edit is written to the merit function at once and is one undo step.

**Settings**:

- **AOI**: one or more angles. Each angle is its own set of curves, later ones drawn lighter. Click an angle to edit it.
- **Range and step**, in the axis unit, 400–800 nm in 0.5 nm steps by default. A coarse grid can step over a narrow dip.
- **Axis unit**: nm, µm, cm⁻¹, THz or eV, for the axis, the readout, the table and the CSV. In nm and µm the points are evenly spaced in wavelength, in the others evenly in that unit, as an FTIR spectrum is in wavenumber. Moving between the two groups keeps the number of points. The calculation always runs in vacuum wavelength.
- **Y**: **Auto**, or a minimum and maximum, and the unit.

**Environment**: on a design with more than one [environment](/design/environments/), **Current** follows the environment the Design Editor shows, a numbered one holds the plot on it even while it is switched off, and **All** draws every environment that is on in its own color. The targets drawn are the rows scored in the environment shown, or every row under All. The choice is not saved with the design.

**Results**: the curves on screen at the same points, with the first column in the axis unit. A CSV names a column by its unit, `T_dB` or `T_OD`, so a file opened later is not read as percentages. Spectra brought in through [Measured Spectra](/data-exchange/measured-spectra/) are drawn dotted with open circles over the prediction.

## Decibel and density axes

dB and OD draw the axis logarithmically, which is what a blocking specification needs: a stopband at 0.1 % is a flat line on the floor of a percent axis and a clear −30 dB on a dB axis. 10 dB of loss is one unit of density.

Decibels apply to T, R and A alike, since each is a fraction of the incident flux; absorptance gains the most, a 10 ppm loss reading −50 dB. Optical density is a quantity of transmittance only, so choosing OD draws the T curves alone. These are display choices: the computed values and the targets do not change.

The gridlines follow the span on screen, and both axes stop at OD 12 (−120 dB). A curve breaks off where it reaches zero: the absorptance of a transparent stack is only the rounding left by $1 - R - T$ and is not drawn. A target at zero, such as $R = 0$, has no place on a logarithmic axis and is not drawn until you return to a linear unit.

## Theory

For one coating, from the characteristic matrix $[B, C]$ of the stack on the substrate admittance $\eta_m$ (Macleod, Eqs. 2.123 and 2.125):

$$
\begin{aligned}
R &= \left| \frac{\eta_0 B - C}{\eta_0 B + C} \right|^2 \\
T &= \frac{4\,\eta_0 \operatorname{Re}(\eta_m)}{|\eta_0 B + C|^2} \\
A &= 1 - R - T
\end{aligned}
$$

with the tilted admittances and phase thicknesses of the [Admittance Diagram](/analysis/admittance/). **avg** is $(X_s + X_p)/2$ for each quantity.

**Total** adds the substrate incoherently, as a thick slab whose multiple reflections add in intensity, not amplitude:

$$
\begin{aligned}
P &= \exp\left( -\frac{4\pi k_s d_s}{\lambda \cos\theta_s} \right) \\
T &= \frac{T_f \cdot P \cdot T_b}{1 - R_f' \cdot R_b \cdot P^2} \\
R &= R_f + \frac{T_f \cdot T_f' \cdot P^2 \cdot R_b}{1 - R_f' \cdot R_b \cdot P^2}
\end{aligned}
$$

$T_f$, $R_f$ are the front coating seen from the incident medium and $T_f'$, $R_f'$ seen from inside the substrate, $R_b$, $T_b$ the back coating seen from the substrate, $P$ the substrate's internal transmittance for one pass of thickness $d_s$, each polarization summed apart (Macleod, Section 2.14).

$$
\begin{aligned}
T(\mathrm{dB}) &= 10 \cdot \log_{10} T \\
\mathrm{OD} &= -\log_{10} T
\end{aligned}
$$

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Section 2.9, pp. 47–51 (Eqs. 2.123–2.126): reflectance, transmittance and absorptance of an assembly.
- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Section 2.14, pp. 60–63: incoherent reflection at two or more surfaces.
- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Section 8.2.1 (Eq. 8.6): transmittance in decibels; Section 5.3: optical density.
