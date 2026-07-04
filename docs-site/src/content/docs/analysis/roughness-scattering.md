---
title: Roughness / Scattering
description: Estimate scatter loss from interface roughness and see the specular R and T that survive it.
ribbonIcon: roughness
---

Real interfaces are never perfectly smooth, and the residual roughness scatters
a little light out of the specular beam. Roughness / Scattering estimates that
loss as the Total Integrated Scatter (TIS) and shows you the specular R and T
that remain after it. You give each interface an RMS roughness σ; the tool treats
the interfaces as uncorrelated, combines them into an effective roughness
σ_eff (where σ_eff² is the sum of the individual σ²), and computes the scatter
fraction at every wavelength.

The analysis runs for the surface mode set in the
[Design Editor](/design/design-editor/). Front uses the front-stack interfaces,
back uses the back-stack interfaces, and total sums the roughness across both
stacks.

## Settings

**λ range / step** — the wavelength grid, in nanometres.

**AOI / pol** — angle of incidence and polarization (s, p, or averaged).

**ppm / frac** — the units for the TIS axis: parts per million or fraction.

**Roughness model** — choose **Uniform σ** to apply the same roughness to every
interface, or **Per-interface** to set each one individually in the table. In
uniform mode a single σ field and slider drive every interface; in per-interface
mode each interface is listed (named by the two media it separates) with its own
σ.

**Reset** clears all roughness back to zero.

## How to read it

The chart overlays two things on different axes. The left axis, in **percent**,
shows the specular R and T after scatter loss as solid lines, with the ideal
(zero-roughness) R and T drawn faintly dotted behind them so you can see how much
the roughness costs. The right axis shows TIS(λ) on its own ppm or fraction
scale.

Scatter loss rises sharply toward short wavelengths — TIS scales as 1/λ² — so a
roughness that is harmless in the infrared can be serious in the ultraviolet. The
toolbar reports the effective roughness σ_eff and the number of interfaces
contributing to it, and the sidebar summarizes TIS at the band edges.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., §16 (Eq. 16.30).
- H. E. Bennett & J. O. Porteus, *J. Opt. Soc. Am.* **51**, 123 (1961).
