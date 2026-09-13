---
title: Material Dispersion
description: Phase, group delay, GDD, CDC and TOD for propagation through a bulk material.
ribbonIcon: material-dispersion
---

The Material Dispersion window calculates the delay added by one pass through a
chosen thickness of bulk material. It separates substrate or window dispersion
from coating dispersion and provides a closed-form check for the Total mode in
the [GD / GDD window](/analysis/gd-gdd/).

For thickness `d`, refractive index `n(ω)`, and angular frequency `ω`, the
reported propagation terms are:

```
GD  = (d/c) [n + ω dn/dω]
GDD = (d/c) [2 dn/dω + ω d²n/dω²]
TOD = (d/c) [3 d²n/dω² + ω d³n/dω³]
CDC = GDD·2πc/λ²
```

## Settings

**Material**: any material available to the active design and material
catalogs.

**Thickness**: single-pass propagation distance. Select nm, µm, or mm to use
film and substrate dimensions directly. For an opaque path, the warning badge on
the control row reports the maximum thickness that keeps the full selected range
evaluable.

**Quantity**: phase, GD, GDD, CDC, or TOD. CDC is the same group delay
dispersion taken against wavelength rather than angular frequency, in fs/nm,
which is how a telecommunications specification is written.

**Wavelength range**: the span plotted and exported. TFStudio selects the
sampling automatically because each wavelength is evaluated pointwise.

## Material models

Formula derivatives are exact for the stored coefficients. PCHIP derivatives
are exact for the cubic piece drawn through the supplied table, but higher
orders still describe that interpolation choice. PCHIP is continuous through
its first derivative; GDD and TOD can jump at table knots. The plot samples each
knot and draws the jump as a step through the value on each side of it, so the
curve is never cut there. A gap means the opposite, that the sample has no value:
a wavelength the thickness has masked, or one whose model cannot supply
third-order derivatives. The window's notice gives the reason.

Outside the material's data range the curve is still drawn, over a shaded band
naming the material and the range it does cover. A table holds the value in its
last row out there, so its index has no slope and the material adds no
dispersion at all: what is plotted in the band is the delay of a dispersionless
slab. A formula is extrapolated past the band it was fitted over and keeps
dispersing, which is a model outside its validity rather than an absence of one.
A user-created smooth fit is used only inside the validity range stored with the
material. The results table marks those rows with the material, so an exported
number is never silently an extrapolation, and narrowing the plotted range to
the covered span is one click on the notice.

For an absorbing material, k does not enter propagation phase directly. It
sets how much of the direct pulse survives. TFStudio masks wavelengths where
the selected thickness gives a field optical depth above 50, equivalent to
internal intensity transmission below exp(-100). Reporting a delay there would
describe the phase of a pulse that has been extinguished.

For reference, the bundled fused-silica Sellmeier model gives about 36.2
fs²/mm at 800 nm. This check is bulk propagation only and does not include
coating-interface phase.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Ch. 11.
- I. H. Malitson, "Interspecimen Comparison of the Refractive Index of Fused Silica," *Journal of the Optical Society of America* **55**, 1205-1209 (1965), [doi:10.1364/JOSA.55.001205](https://doi.org/10.1364/JOSA.55.001205).
- OptiLayer, "Material Dispersion", bulk-material phase and group-delay definitions.
