---
title: Material Dispersion
description: Phase, group delay, GDD, and TOD for propagation through a bulk material.
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
```

## Settings

**Material**: any material available to the active design and material
catalogs.

**Thickness**: single-pass propagation distance. Select nm, µm, or mm to use
film and substrate dimensions directly. For an opaque path, the footer reports
the maximum thickness that keeps the full selected range evaluable.

**Quantity**: phase, GD, GDD, or TOD.

**Wavelength range**: the span plotted and exported. TFStudio selects the
sampling automatically because each wavelength is evaluated pointwise.

## Material models

The footer names the formula, PCHIP table, or saved fit used for each value.
Formula derivatives are exact for the stored coefficients. PCHIP derivatives
are exact for the cubic piece drawn through the supplied table, but higher
orders still describe that interpolation choice. PCHIP is continuous through
its first derivative; GDD and TOD can jump at table knots. The plot leaves gaps
at those jumps instead of connecting unrelated one-sided values. A user-created
smooth fit is used only inside the validity range stored with the material.
Points outside a model range are blank and the window reports how many were
omitted.

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
