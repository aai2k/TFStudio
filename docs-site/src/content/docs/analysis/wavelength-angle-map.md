---
title: Wavelength vs Angle
description: Map T, R or A over wavelength and angle of incidence at once, as a heatmap or a 3D surface.
ribbonIcon: wavelength-angle-map
---

Wavelength vs Angle answers **how far the coating drifts when the light stops
arriving straight on**. It computes one quantity over a wavelength range and an
angle range together and draws the result as a colour map, so a passband edge
that walks 30 nm between 0° and 45° is one picture rather than ten overlaid
spectra.

The map recomputes whenever the design changes. There is nothing to press.

## Settings

**Quantity**: **T**, **R** or **A**, on the control row.

**Polarization**: **avg**, **s** or **p**. At normal incidence the three agree;
they separate as the angle grows, and the s / p split is often the thing being
looked for.

**Render**: **Heatmap** draws the map flat, which is the easier one to read a
number off. **3D** draws the same grid as a rotatable surface, which shows the
shape of a peak better than a colour ramp does.

In the settings panel:

**λ**: the wavelength range and the step between columns.

**Angle**: the angle-of-incidence range and the step between rows. The window
opens on 0 to 60°, and takes anything up to 89°.

**Colors**: the colorscale. Turbo by default, with Jet, Viridis, Cividis and
others to pick from.

The grid size is shown under the ranges. Both step sizes are yours to set, and a
fine grid over a thick stack takes longer, so start coarse and tighten once the
region of interest is clear.

The map is computed for the surface mode set in the
[Design Editor](/design/design-editor/), shown as a badge next to the results.

## How to read it

Read across a row for the spectrum at one angle, and down a column for how one
wavelength behaves as the light tilts. Anything that runs diagonally is a
feature moving with angle; anything vertical is a feature that stays put.

Features move toward shorter wavelengths as the angle grows. A layer's phase
thickness at oblique incidence is 2π·*nd*·cos θ/λ, where θ is the angle inside
the layer rather than the angle of incidence. That leaves an apparent optical
thickness of *nd*·cos θ, so the stack looks thinner the further it is tilted,
and every wavelength-dependent feature in it shifts down with it. That is why
an edge filter specified at normal incidence lands short of its target in a
converging beam, and why a bandpass filter is often designed slightly long so a
tilt brings it onto wavelength.

The **Results** strip below the plot holds the grid as numbers, one row per
wavelength and angle pair, and **Export** writes it to CSV. The chart's own
toolbar exports the picture as PNG or SVG.

For a single angle at full spectral detail, use
[Optical Evaluation](/analysis/optical-evaluation/); for a map over something
other than angle, such as a layer thickness, use the
[Plot Engine](/analysis/plot-engine/) surface, which this window is built on.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., §9.2 (Eq. 9.2, tilted thicknesses).
