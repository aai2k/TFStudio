---
title: Color Evaluation
description: CIE chromaticity, Lab and color readouts — what your coating looks like to the eye.
ribbonIcon: color-eval
---

Color Evaluation turns a coating's spectrum into a perceived color. It takes the
reflectance or transmittance across the visible range, weights it by a standard
observer and illuminant, and reports where the result sits on the CIE
chromaticity diagram along with a color swatch and a full set of color-space
values. Use it to predict the visible appearance of a coating — the tint of an
antireflection film, the hue of a decorative mirror, or how a filter shifts
color with viewing angle.

The spectrum is sampled across 380–780 nm and fed through the standard
colorimetric integral, so the color matches the curves shown in
[Optical Evaluation](/analysis/optical-evaluation/).

## Settings

**Characteristic** — compute the color of reflected (R) or transmitted (T)
light.

**Polarization** — average, s, or p. Average is the usual choice for unpolarized
illumination.

**AOI** — the viewing angle in degrees. Sweep this to see how an iridescent
coating shifts color with incidence.

**Observer** — the CIE color-matching functions: the 1931 2° observer for small
fields or the 1964 10° observer for larger fields.

**Illuminant** — the light source the color is computed under: daylight (D65,
D50), incandescent (A), and equal-energy (E).

**Step** — the wavelength sampling interval in nm for the color integral. A
finer step improves accuracy on coatings with sharp spectral features.

**Exposure** — the brightness of the color swatch only. By default the swatch is
scaled against a perfect white reflector, so a very dim reflection — such as the
residual color of a strong antireflection coating — renders almost black even
when its hue is highly saturated. Raise the exposure (×10 up to ×1000) or choose
**Fit hue** to rescale the swatch and reveal the hue at full brightness. The
numeric readout does not change; only the swatch is re-exposed. This mirrors what
the eye sees when the coating reflects a bright source instead of a dim scene.

The evaluation surface (front, back, or total) is set in the
[Design Editor](/design/design-editor/) and shown as a badge on the window.

## How to read it

The chromaticity diagram shows the spectral locus (the horseshoe of pure
colors), the Planckian white points, and a marker for your coating. A marker
near the white point means a near-neutral, colorless coating; a marker pulled
toward an edge of the locus means a strong, saturated tint. The swatch renders
the same result as an approximate on-screen color.

Because the swatch is referenced to a perfect white reflector, a dim reflection
looks dark or black even when the chromaticity marker sits far out toward the
locus: the color is genuinely there, but there is little reflected light to carry
it. Use the **Exposure** setting to bring that hue up to a visible brightness
without changing the reported values.

The numeric panel reports the full set of standard descriptors: tristimulus
X, Y, Z; xy and u′v′ chromaticity; CIE L\*a\*b\* and L\*u\*v\* with their
chroma and hue angles; dominant wavelength and purity; and correlated color
temperature (CCT) with its offset from the Planckian locus (Duv). For
industrial color matching, a color difference of ΔE ≤ 1 is generally taken as
the threshold of a just-noticeable difference.

## References

- CIE 15:2004 — *Colorimetry*, 3rd ed.
- Sharma, Wu, Dalal, *Color Res. Appl.* **30**, 21 (2005) — CIEDE2000.
- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., §12.2 (Eqs. 12.1–12.5).
