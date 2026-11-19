---
title: Integral Values & Characteristics
description: Weighted spectral averages such as Tvis, Tsol, TUV and TNIR, with standard or custom light sources and detectors.
ribbonIcon: integral-values
---

Integral Values condenses a spectrum into the weighted averages spec sheets quote: visible transmittance, solar reflectance and so on. Each row averages T, R or A over a band, weighting every wavelength by a light source times a detector response. The figures follow the design's [evaluation mode](/design/evaluation-modes/); for the usual whole-part figures, evaluate the design as the total system.

<!-- shot: integral-values | ZnS/Ag/ZnS heat mirror over 300-2500 nm, Tsol selected with T(λ) drawn against the AM1.5G weighting -->

## Computed quantities

| Row | Weighting | Band |
| --- | --- | --- |
| Tvis, Rvis, Avis | D65 × photopic V(λ) | 380–780 nm |
| Tsol, Rsol, Asol | AM1.5G solar | 300–2500 nm |
| TUV, RUV | flat | 300–380 nm |
| TNIR, RNIR | flat | 780–2500 nm |

Each row gives the average as a fraction and in percent, and the unweighted minimum and maximum of the channel in the band with the wavelengths they occur at, for worst-case checks such as T ≥ 99 % across the band. The chart shows the selected row's channel with its normalized weighting, so you can see which part of the spectrum carries the average.

## Controls and settings

**λ range / step**: the grid the spectrum is sampled on. A row is integrated over its whole band, never over the part the grid happens to cover: a row whose band the grid does not span reads **n/a**, with the span covered shown beside it. The default 300–2500 nm covers every built-in row.

**AOI / pol**: the angle of incidence and s, p or their average.

**+ Custom integral…** defines a row of your own: a **Name**, the **Channel** (T, R or A), a **Source** (D65, D50, A, AM1.5G, equal-energy E, a blackbody at a temperature you set, or a table), a **Detector** (V(λ), flat or a table) and a **Band**. The name follows the choices, such as T·D65·V(λ), until you type in it. A table source or detector opens the [curve editor](/data-exchange/measured-spectra/#typing-a-curve-or-changing-its-points), which reads wavelengths in nm, µm, cm⁻¹ or eV. The pencil on a custom row edits it and the trash removes it. Custom rows are saved and restored automatically; an operand already built from one in the [Merit Function Editor](/design/merit-function-editor/) keeps the values it was built with.

**Environment**: on a design with more than one [environment](/design/environments/), **Current** follows the environment the Design Editor shows, a numbered one holds the window on it even while it is switched off, and **All** lists every integral in each environment that is on and draws the selected row's channel in each environment's color. The choice is not saved with the design.

## Photopic rows and the grid

With D65 and the CIE 1931 2° observer, Tvis is the luminance factor: a perfect white reads 100 %. The photopic rows are integrated on the λ grid like every other row, with the CIE tables interpolated onto it, so a feature narrower than the step is missed. For the Tvis of a narrow notch, set a step well below the notch width.

## Theory

For channel C (T, R or A), source S and detector D over the band λ₁ to λ₂:

```
C̄ = ∫ C(λ) S(λ) D(λ) dλ  /  ∫ S(λ) D(λ) dλ
```

Both integrals are taken by the trapezoidal rule on the window's λ grid, with S and D interpolated linearly from their tables. The grid always ends on the end wavelength, a step that does not divide the range adding one shorter last interval. With S = D65 and D = ȳ(λ), C̄ is the luminance factor Y/100 of Macleod's Eq. 12.2.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Section 12.2, pp. 457–463 (Eq. 12.2): the luminance factor.
- ASTM G173-03, Standard Tables for Reference Solar Spectral Irradiances.
- CIE 15:2004, *Colorimetry*.
