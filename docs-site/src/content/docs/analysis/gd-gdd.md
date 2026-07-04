---
title: Group Delay / GDD
description: Spectral phase and its derivatives — diagnostics for chirped mirrors and ultrafast coatings.
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

**Quantity** — choose which curve to plot: phase φ, GD, GDD, or TOD.

**Reflection / Transmission** — take the phase from the reflected (R) or
transmitted (T) wave.

**Polarization** — s or p.

**Side** — take the phase from the **front** coating or the **back** coating.
Each coating is evaluated on its own, so a part with a chirped mirror on one
face and a different coating on the other can be inspected one side at a time.

**Wavelength range and step** — the span and sampling interval of the plot, in
nm. Use a fine step (0.2 nm or smaller) before trusting GDD and TOD near sharp
spectral features, because each higher derivative amplifies sampling noise.

**AOI** — the angle of incidence in degrees.

**Reference wavelength** — when shown, the phase curve is shifted so it reads
zero at this wavelength. This is a constant offset and only affects the phase
plot; GD, GDD and TOD are derivatives and are unchanged.

## How to read it

For a chirped mirror, GD should follow the target ramp across the band and GDD
should hold the intended (usually negative) value to compensate pulse
dispersion. A clean, smooth curve indicates a well-resolved phase; if GDD or TOD
shows unphysical spikes near a sharp feature, the wavelength step is too coarse
— refine it until the spikes disappear.

The data table lists the phase and its derivatives against wavelength for
export.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Ch. 11 (Eq. 11.17) — ultrafast coatings.
- S. Diddams & J.-C. Diels, *J. Opt. Soc. Am. B* **13**, 1120 (1996).
