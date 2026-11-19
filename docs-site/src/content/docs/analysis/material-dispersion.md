---
title: Material Dispersion
description: Phase, group delay, GDD, CDC and TOD for propagation through a bulk material.
ribbonIcon: material-dispersion
---

Material Dispersion computes what one pass through a chosen thickness of bulk material does to a pulse: its phase, group delay and the dispersion terms. Use it for the substrate, a window or any other glass in the beam, apart from the coatings, whose dispersion the [GD / GDD window](/analysis/gd-gdd/) gives. It needs no design.

<!-- shot: material-dispersion | GDD of 1 mm of fused silica from 400 to 1100 nm -->

## Computed quantities

The same five as the GD / GDD window, for the slab alone: **Phase** in degrees, **GD** in fs, **GDD** in fs², **CDC** in fs/nm and **TOD** in fs³. As a check, the built-in fused silica gives about 36.2 fs²/mm of GDD at 800 nm.

## Controls and settings

**Material**: any material in the design or the catalogs. **Quantity**: one of the five above.

**Settings**: **Thickness**, the single-pass path in nm, µm or mm, and the **λ** range. The sampling is chosen automatically.

**Notices**: where the λ range leaves the material's data, the curve is drawn over a shaded band naming the range it does cover, and the badge offers to narrow the plot to it. A table holds its end value out there, so the slab is drawn as dispersionless; a formula is extrapolated. Wavelengths with no value at all are gaps, and the badge gives the reason: an absorbing slab too thick for the pulse to survive, with the largest thickness that keeps the range evaluable, or a model that cannot give third derivatives.

## Table knots

A formula is differentiated exactly. A table is interpolated by a shape-preserving cubic (PCHIP), smooth in value and slope only, so GDD and TOD step at each table point; the plot draws the step through the value on each side, never a gap. A fitted dispersion formula is used only inside the validity range stored with it.

## Theory

For thickness d, index n(ω) and angular frequency ω:

```
φ   = −(d/c) ω n
GD  = (d/c) [n + ω dn/dω]
GDD = (d/c) [2 dn/dω + ω d²n/dω²]
TOD = (d/c) [3 d²n/dω² + ω d³n/dω³]
CDC = GDD · 2πc / λ²
```

These are −dφ/dω and its derivatives, the same signs as the coating terms, so the slab's GDD adds to a coating's as in Macleod's Eq. 11.19. The bracket in GD is the group index.

The extinction coefficient k does not enter the phase; it sets how much of the pulse survives. A wavelength is masked when the field optical depth `2π·k·d / λ` exceeds 50, an internal transmittance below e⁻¹⁰⁰, since a delay there would describe a pulse that no longer exists.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Section 11.2, pp. 414–425 (Eqs. 11.18–11.19): group-velocity dispersion of a medium and net GDD.
- I. H. Malitson, "Interspecimen Comparison of the Refractive Index of Fused Silica," *Journal of the Optical Society of America* **55**, 1205-1209 (1965), [doi:10.1364/JOSA.55.001205](https://doi.org/10.1364/JOSA.55.001205).
