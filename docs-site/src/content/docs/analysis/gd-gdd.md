---
title: Group Delay / GDD
description: Spectral phase and its derivatives for chirped mirrors and ultrafast coatings.
ribbonIcon: gd-gdd
---

The GD/GDD window computes the spectral phase of a coating and its derivatives
with respect to angular frequency: group delay (GD), group-delay dispersion
(GDD), and third-order dispersion (TOD). These quantities describe how a
coating delays different parts of an optical pulse.

The phase comes from the complex reflection or transmission coefficient:

```
φ(ω) = arg(r)  or  arg(t)
GD  = -dφ/dω       [fs]
GDD = -d²φ/dω²     [fs²]
TOD = -d³φ/dω³     [fs³]
```

## Settings

**Quantity**: phase φ, GD, GDD, or TOD.

**Reflection / Transmission**: take the phase from the reflected or transmitted
complex amplitude.

**Polarization**: the average of s and p, s, or p. The average uses the same
per-polarization arithmetic mean as the matching merit operand.

**Side**: evaluate the **front** coating or the **back** coating.

**Wavelength range**: the span plotted and exported, in nm. TFStudio chooses the
sampling automatically and adds local samples around pronounced reflection or
transmission minima. There is no derivative or sampling step to tune.

**AOI**: angle of incidence in degrees, measured in the incident medium.

**Reference wavelength**: shifts the displayed phase to zero at the selected
wavelength. This constant offset does not change GD, GDD, or TOD.

**Targets**: shows enabled GD, GDD, or TOD merit-function targets that match
the selected reflection or transmission response, polarization, and AOI.
Point operands appear as X markers. Flatness operands show their target level
and wavelength band. Phase targets are not overlaid because the displayed
phase may have an arbitrary reference offset. Current phase-dispersion merit
operands evaluate the front coating normally and the back coating for a
back-only design, so their overlays appear only on the side they score.

## How the values are calculated

GD, GDD, and TOD are evaluated point by point through third-order Taylor
arithmetic in the characteristic matrix. The derivatives come from the complex
logarithmic derivative of `r` or `t`; phase unwrapping is used only to draw the
phase curve. TFStudio uses `n + ik` with an `exp(-iωt)` time factor, then applies
the conjugate-Macleod convention once so a material transit time is positive,
with the same sign as the Material Dispersion window.

Formula materials are differentiated exactly. A tabulated material gives the
exact derivative of its shape-preserving PCHIP curve. PCHIP is C1: GD is
continuous, while higher derivatives can show finite steps at table knots and
TOD is especially sensitive to how sparse data is represented. For coating
reflection and transmission, both tabulated `n` and `k` contribute to this
continuity limit. GDD and TOD plots leave gaps at their knot jumps, and the
warning badge on the control row names the table models involved. A saved
smooth fit replaces the table only inside its stated validity range and is
named there too.
Wavelengths outside any material model range are left blank with a reason
instead of treating a clamped endpoint as non-dispersive data.

## How to read it

For a chirped mirror, GD should follow the target ramp across the band and GDD
should hold the intended value used for pulse compensation. A narrow positive
or negative GD feature beside a reflection zero is expected phase behavior.
Read it with the coefficient magnitude: little reflected energy occupies a
deep reflectance minimum, although the same feature can matter when the coating
is used in transmission.

The data table lists phase and all three derivatives against wavelength for
export.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Ch. 11, Eq. 11.17.
- J. Birge and F. X. Kärtner, "Efficient analytic computation of higher-order dispersion from optical interferometers," *Applied Optics* **45**, 1478-1483 (2006), [doi:10.1364/AO.45.001478](https://doi.org/10.1364/AO.45.001478).
- S. Diddams and J.-C. Diels, *Journal of the Optical Society of America B* **13**, 1120 (1996).
