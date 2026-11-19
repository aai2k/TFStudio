---
title: Wavelength vs Angle
description: Map T, R or A over wavelength and angle of incidence at once, as a heatmap or a 3D surface.
ribbonIcon: wavelength-angle-map
---

Wavelength vs Angle answers **how far the coating drifts when the light stops arriving straight on**. It computes one quantity over a wavelength range and an angle range together and draws it as a color map, so a passband edge that walks 30 nm between 0° and 45° is one picture rather than ten overlaid spectra. The map recomputes whenever the design changes.

<!-- shot: wavelength-angle-map | quarter-wave mirror, R over 0-60° in 0.5° steps as a 3D surface, turned so the stopband's walk shows -->
![Wavelength vs Angle](/screenshots/wavelength-angle-map.png)

## Computed quantities

- **T**, **R** or **A** in percent at every wavelength and angle of the grid, for **avg**, **s** or **p**, in the surface mode set in the [Design Editor](/design/design-editor/) and under its cone of incidence.
- **Results** holds the grid as numbers, one row per wavelength and angle.

Read across a row for the spectrum at one angle, and down a column for how one wavelength behaves as the light tilts. A diagonal feature moves with angle; a vertical one stays put. The s and p maps agree at normal incidence and part as the angle grows.

## Controls and settings

**Quantity**, **Polarization**, and **Render**: **Heatmap** is flat and the easier to read a number off, **3D** a surface you can turn, which shows the shape of a peak better.

**Settings**: the **λ** range and step, the **Angle** range (0 to 60° at first, up to 89°) and step, and **Colors**. The grid size shows under the ranges; start coarse over a thick stack.

**Environment**: on a design with more than one [environment](/design/environments/), **Current** follows the environment the Design Editor shows and a numbered one holds the window on it even while it is switched off. The map is that environment's coating, media and cone. The choice is not saved with the design.

For a map over something other than angle, such as a layer thickness, use the [Plot Engine](/analysis/plot-engine/).

## Theory

At oblique incidence a layer's phase thickness is (Macleod, Eq. 9.2)

```
δ = 2π n d cos θ / λ
```

with θ the angle inside the layer. The layer looks thinner by cos θ, so every feature of the spectrum moves to shorter wavelengths as the light tilts. For a narrowband filter the peak follows

```
λ_θ = λ₀ · √( 1 − (n₀ sin θ₀ / n*)² )
```

with n* the effective index of the filter, `√(n_H n_L)` for a first-order cavity (Macleod, Section 8.2, Eq. 8.36). A higher n* shifts less. That is why an edge filter specified at normal incidence lands short in a converging beam, and why a bandpass filter is often made slightly long so a tilt brings it onto wavelength. The admittances change with angle too, which separates s from p; the map computes both exactly, as [Optical Evaluation](/analysis/optical-evaluation/) does.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Section 9.2 (Eq. 9.2): tilted thicknesses.
- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Section 8.2, pp. 276–285 (Eq. 8.36): the effect of varying the angle of incidence on narrowband filters.
