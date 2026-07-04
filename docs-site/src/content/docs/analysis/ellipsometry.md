---
title: Ellipsometry Evaluation
description: Ψ and Δ — the amplitude-ratio and phase quantities an ellipsometer measures.
ribbonIcon: ellipsometry
---

The Ellipsometry window computes the ellipsometric angles Ψ and Δ for the active
design — the amplitude-ratio and phase-shift quantities that an ellipsometer
reports. Use it to **predict what your instrument should see** for a given
coating, so you can compare a simulated curve against a measured one or plan a
measurement.

The angles come from the complex reflectance ratio between p- and s-polarized
light:

```
ρ = r_p / r_s = tan(Ψ) · exp(i Δ)
```

You can sweep either wavelength at a fixed angle, or angle of incidence at a
fixed wavelength.

## Settings

**Mode** — sweep over wavelength (spectral) or over angle of incidence
(angular).

**Side** — evaluate the front coating or the back coating. Ellipsometry models a
single coherent reflection off one face, so each side is treated independently.

**Wavelength range and step** (spectral mode) — the span and sampling interval
of the sweep, in nm.

**AOI** (spectral mode) — the fixed angle of incidence, in degrees. The default
of 65° is a common ellipsometer angle near the Brewster region of typical
substrates.

**Wavelength** (angular mode) — the fixed wavelength for an angle sweep.

**AOI range and step** (angular mode) — the span and sampling interval of the
angle sweep, in degrees.

## How to read it

Ψ is plotted on the left axis (0–90°) and Δ on the right axis (0–360°). Ψ
encodes the ratio of the p and s reflection amplitudes, and Δ their phase
difference. In an angle sweep, the substrate's Brewster angle shows up as a
sharp step in Δ, which makes a useful calibration check.

The data table lists Ψ and Δ against the swept variable for export. This window
is a forward calculation: to recover layer thicknesses from a measured Ψ and Δ,
use Refinement with targets set on those quantities.

## References

- H. G. Tompkins & E. A. Irene, *Handbook of Ellipsometry* (William Andrew, 2005).
- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., p. 553 (Eq. 16.2).
