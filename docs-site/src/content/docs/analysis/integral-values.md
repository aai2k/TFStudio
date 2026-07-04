---
title: Integral Values & Characteristics
description: Weighted spectral averages such as Tvis, Tsol, TUV and TNIR, with standard or custom light sources and detectors.
ribbonIcon: integral-values
---

Integral Values condenses a whole spectrum into the single weighted-average
numbers that spec sheets quote — visible transmittance, solar reflectance, and
so on. For each weighting it averages T(λ), R(λ) or A(λ) over a wavelength band,
weighting each wavelength by a light source times a detector response. Alongside
the built-in standards you can build your own integral from any source, detector
and band. These figures describe the filter as a whole, so they follow the
design's [evaluation mode](/design/evaluation-modes/) — the front surface, the
back surface, or the complete front–substrate–back system — shown by the `Eval`
badge in the window. For the usual whole-part figures such as solar or photopic
transmittance, evaluate the design as the total system.

## Settings

**λ range / step** — the wavelength grid the spectrum is sampled on, in
nanometres. It should be wide enough to cover the bands of every integral you
want to read.

**AOI / pol** — angle of incidence and polarization (s, p, or averaged).

The **custom-integral builder** lets you add your own weighted average:

**Channel** — whether to average T, R or A.

**Source** — the illuminant: D65, D50, illuminant A, AM1.5G solar, equal-energy
E, a blackbody at a temperature you set, or a custom table. A blackbody exposes a
temperature field; a custom source opens a small table editor where you type or
paste the source spectrum.

**Detector** — the observer or sensor response: the photopic curve V(λ), a flat
response, or a custom table.

**Band** — the wavelength range (in nm) over which the average is taken.

**Add** registers the integral as a new row. Custom rows are editable in place —
you can rename them and adjust the channel and band directly in the table — and
removable. Custom integrals are saved and restored automatically.

The custom-table editor accepts pasted or imported CSV/TSV (two columns: λ in nm
and the weighting value); header rows, blank lines and `#` comment lines are
ignored.

## How to read it

Each row shows the weighted average both as a fraction and as a **percent**,
plus the unweighted minimum and maximum of the channel within the band (with the
wavelengths where they occur) — useful for worst-case checks like "T ≥ 99 % across
the band". Selecting a row draws the overlay chart on the right: the chosen
channel in percent together with the normalized weighting curve, so you can see
which part of the spectrum dominates the average. The minimum and maximum are
marked on the chart.

A note on the visible figures: Tvis matches the photopic luminance only when the
source is D65 and the detector is the CIE 1931 2° observer; a perfect white reads
100 %.

## References

- ASTM G173-03 — Standard Tables for Reference Solar Spectral Irradiances.
- CIE 15:2004 — *Colorimetry*.
- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., §12.2.
