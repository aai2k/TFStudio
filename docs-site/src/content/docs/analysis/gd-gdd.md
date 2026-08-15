---
title: Group Delay / GDD
description: Spectral phase and its derivatives, the diagnostics for chirped mirrors and ultrafast coatings.
ribbonIcon: gd-gdd
---

The GD/GDD window computes the spectral phase of a coating and its derivatives
with respect to frequency: the group delay (GD), group-delay dispersion (GDD),
and third-order dispersion (TOD). These are the quantities you tune when
**designing mirrors and coatings for ultrafast lasers**, where controlling how
different frequencies are delayed is as important as controlling reflectance.

The phase is taken from the complex reflection or transmission coefficient, and
the derivatives follow as:

```
φ(ω) = arg(r)  or  arg(t)
GD  = −dφ/dω     [fs]
GDD = −d²φ/dω²   [fs²]
TOD = −d³φ/dω³   [fs³]
```

## Settings

**Quantity**: choose which curve to plot: phase φ, GD, GDD, or TOD.

**Reflection / Transmission**: take the phase from the reflected (R) or
transmitted (T) wave.

**Polarization**: s or p.

**Side**: take the phase from the **front** coating or the **back** coating.
Each coating is evaluated on its own, so a part with a chirped mirror on one
face and a different coating on the other can be inspected one side at a time.

**Wavelength range and step**: the span and sampling interval of the plot, in
nm. The transfer matrix is evaluated on that exact wavelength grid. The
derivative weights use each sample's actual angular frequency, so GD, GDD and
TOD remain derivatives with respect to ω. Check important features at more than
one step and trust them only when their position and value converge. A smaller
step reduces truncation error for a smooth material model, but it amplifies
roundoff and cannot make a tabulated PCHIP material smoother than C1 at its
tabulated wavelengths.

**AOI**: the angle of incidence in degrees.

**Reference wavelength**: when shown, the phase curve is shifted so it reads
zero at this wavelength. This is a constant offset and only affects the phase
plot; GD, GDD and TOD are derivatives and are unchanged.

## How to read it

For a chirped mirror, GD should follow the target ramp across the band and GDD
should hold the intended (usually negative) value to compensate pulse
dispersion. A clean, smooth curve indicates a well-resolved phase; if GDD or TOD
shows spikes, compare several steps before interpreting them. A resolved feature
converges. Spikes that move or grow can instead come from a reflection or
transmission zero, a material-table interpolation knot, or floating-point
cancellation.

The data table lists the phase and its derivatives against wavelength for
export.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Ch. 11 (Eq. 11.17), ultrafast coatings.
- S. Diddams & J.-C. Diels, *J. Opt. Soc. Am. B* **13**, 1120 (1996).
