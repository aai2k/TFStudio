---
title: Group Delay / GDD
description: Spectral phase and its derivatives for chirped mirrors and ultrafast coatings.
ribbonIcon: gd-gdd
---

The GD/GDD window computes the spectral phase of a coating in reflection or transmission and its derivatives against angular frequency. These say how the coating delays and spreads the parts of an optical pulse, which is what chirped mirrors and other ultrafast coatings are designed on.

<!-- shot: gd-gdd | 750-900 nm chirped mirror, GDD in reflection over 700-950 nm with a flat -30 fs² target drawn across its band -->
![Group Delay / GDD](/screenshots/gd-gdd.png)

## Computed quantities

- **Phase φ**, in degrees: the phase change on reflection or transmission, unwrapped along wavelength and set to zero at the reference wavelength.
- **GD**, group delay, in fs: how long the coating holds a pulse.
- **GDD**, group-delay dispersion, in fs²: how that delay changes across the spectrum, which is what spreads a short pulse.
- **CDC**, chromatic dispersion coefficient, in fs/nm: GDD per nm of wavelength instead of per rad/fs, with the sign of GDD. The fibre dispersion $D = d\tau/d\lambda$ of a data sheet, per kilometre, has the opposite sign; a coating has no length.
- **TOD**, third-order dispersion, in fs³: the asymmetry GDD leaves, which puts structure on one side of a pulse.

## Controls and settings

**Quantity**, **T / R**, **Pol** and **Side** pick the curve. **avg** is the mean of the s and p values.

**Targets** overlays the enabled GD, GDD and TOD merit rows that match the curve shown: point rows as markers, flatness rows as a level across their band. Phase rows are not drawn, since the phase shown carries an arbitrary offset, and CDC has no row of its own; write it as a GDD target.

**Edit** draws targets on the plot in place of typing them into the [Merit Function Editor](/design/merit-function-editor/): click for a target at one wavelength, drag across a band for a flatness target at the level you release on, drag a line or its end to move it, or use the delete tool. A drawn target takes the quantity, response, polarization and angle shown. Edit is off for phase, for CDC and on the side the merit function does not score.

**Settings**: **AOI (°)**, the **λ** range, the vertical range (**Auto** or fixed), and **Ref λ (nm)**, the wavelength the phase is set to zero at; the tick shows or hides its line. The reference moves the phase curve only, not its derivatives. Below them the window says how the curve was sampled and which dispersion model each material used.

**Range warning**: where a wavelength lies outside a material's data range the curve is drawn over a shaded band naming the material, and the table marks those rows. A table holds its end value there, so that material adds no dispersion in the band; a formula is extrapolated. The badge offers to narrow the range to what every material covers.

**Environment**: on a design with more than one [environment](/design/environments/), **Current** follows the environment the Design Editor shows, a numbered one holds the window on it even while it is switched off, and **All** draws every environment that is on in its own color, the targets of every environment with it. The choice is not saved with the design.

## Sampling and table knots

There is no step to set. The window picks the wavelengths itself and adds samples around sharp features, such as the GD spike beside a reflection minimum. **Auto** leaves such spikes out of the vertical range when they would flatten the rest of the curve, and the badge counts the samples left outside.

A tabulated material is interpolated by a shape-preserving cubic (PCHIP), smooth in value and slope but not in curvature, so GDD and TOD step at each table point. A table read point to point steps in GD too. Exactly on a table point the window shows the mean of the two sides, as a symmetric difference would, and the table writes that wavelength as two rows, λ− and λ+, one for each side. A fitted dispersion formula removes the steps.

A GD feature beside a deep reflection minimum is real but carries little energy in reflection; it matters when the coating is used in transmission.

## Theory

With $\varphi(\omega)$ the phase change on reflection or transmission in Macleod's convention:

$$
\begin{aligned}
\mathrm{GD} &= -\frac{d\varphi}{d\omega} && [\text{fs}] \\
\mathrm{GDD} &= -\frac{d^2\varphi}{d\omega^2} && [\text{fs}^2] \\
\mathrm{TOD} &= -\frac{d^3\varphi}{d\omega^3} && [\text{fs}^3] \\
\mathrm{CDC} &= \mathrm{GDD} \cdot \frac{2\pi c}{\lambda^2} && [\text{fs/nm}]
\end{aligned}
$$

With these signs a coating that holds a pulse longer has a positive GD, and the coating's GDD adds to a medium's $L\,d^2\kappa/d\omega^2$ as in Macleod's Eq. 11.19. The derivatives are exact, not differences: each layer's index and phase thickness are carried with their first three derivatives in $\omega$ through the characteristic matrices of the [Admittance Diagram](/analysis/admittance/), and GD, GDD and TOD come from the logarithmic derivative of $r$ or $t$. A formula material is differentiated exactly; a table gives the derivative of its interpolating curve. Phase unwrapping is used only to draw the phase curve.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Section 11.2, pp. 414–425 (Eqs. 11.17–11.19): group delay and its dispersion in ultrafast coatings.
- J. R. Birge and F. X. Kärtner, "Efficient analytic computation of dispersion from multilayer structures," *Applied Optics* **45**, 1478-1483 (2006), [doi:10.1364/AO.45.001478](https://doi.org/10.1364/AO.45.001478).
- S. Diddams and J.-C. Diels, *Journal of the Optical Society of America B* **13**, 1120 (1996).
