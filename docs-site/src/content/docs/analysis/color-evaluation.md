---
title: Color Evaluation
description: CIE chromaticity, Lab and color readouts that show what your coating looks like to the eye.
ribbonIcon: color-eval
---

Color Evaluation turns a coating's spectrum into the color the eye sees: the tint of an antireflection film, the hue of a decorative mirror, or how a filter's color shifts with viewing angle. It weights R or T across 380–780 nm by an illuminant and a standard observer, plots the result on a CIE diagram, one point per angle joined in order, and gives every common color value.

<!-- shot: color-eval | refined four-layer AR in reflection, D65 and the 2° observer, angles 0 to 60° every 10° as a path on the x, y diagram, lines under the diagram showing each angle -->
![Color Evaluation](/screenshots/color-eval.png)

## Computed quantities

Every value comes from three numbers, X, Y and Z: the light reaching the eye weighted by the observer's three color-matching functions. Two spectra with the same X, Y and Z look the same color under that illuminant, however different their curves. Hover a value in the window for what it is.

| Value | What it is |
|---|---|
| X, Y, Z | Tristimulus values. Y follows the eye's sense of brightness alone. |
| Y (%) | Luminous reflectance or transmittance: the share of the light the eye sees. |
| x, y | Chromaticity, brightness taken out. |
| u′, v′ | The same on the CIE 1976 UCS diagram, where equal distances are closer to equal steps the eye sees. |
| u, v | CIE 1960 chromaticity, on which CCT is measured. |
| L\*, a\*, b\* | Lightness 0 to 100; a\* green to red, b\* blue to yellow, 0, 0 neutral. |
| C\*ab, hab | a\*, b\* as chroma (strength of tint) and hue angle, 0° red, 90° yellow, 180° green, 270° blue. |
| L\*, u\*, v\*, C\*uv, huv, suv | The same in CIE L\*u\*v\*, built on u′, v′; suv is chroma per unit lightness. |
| Hunter L, a, b | An older opponent scale, still named in some specifications. |
| λd, λc | Dominant wavelength, the spectral color that mixed with the white matches the coating; for a purple, which has none, the complementary wavelength. |
| Purity | Distance from the white toward the spectral locus, 0 % to 100 %. |
| CCT, Duv | Correlated color temperature, the nearest blackbody's in K, and the distance from the Planckian locus. Only colors near it have a CCT. |
| ΔE\*ab, ΔE00 | Difference between two colors; about 1 is often taken as the smallest difference seen side by side. |

A line per angle under the diagram gives a patch and x, y, Y, L\*, a\*, b\*, λd and purity, so the change with angle reads down each column.

## Controls and settings

**T / R**, **Polarization**, and **AOI** as a **List** or a **Range** (first, last, step), up to 91 angles.

**Observer**: CIE 1931 2° for a small field, CIE 1964 10° for a larger one. **Illuminant**: D65, D50, A or E; the same coating can look another color under another light. **Step**: the wavelength sampling of the integral; finer for sharp spectral features.

**Exposure**: **Fit hue**, the default, shows every color at full brightness so the hue of a dim reflection reads. **As is** scales against a perfect white reflector, so a strong AR's reflection shows almost black, which is how little light it carries. The numbers do not change. **Show**: wavelength marks, the illuminant's white point, the Planckian locus and the sRGB triangle.

**Targets** draws the merit function's `RCOL` or `TCOL` rows on the diagram of their own coordinates, a hollow diamond where a pair meets. **Edit** builds them by clicking the diagram: a target is two rows in the diagram's coordinates at the angle **AOI (°)** picks (**Nearest** takes the angle of the closest point); drag one to move it, or delete it. Targets can also come from the wizard's [Color preset](/design/merit-function-editor/#color-targets).

**Results**: **Table** shows one color space at a time (every space at once for a single angle), **Differences** each angle against the first (ΔL\*, Δa\*, Δb\*, ΔE\*ab, ΔE00), and **Color Patch** the patches beside the illuminant's white. **Export** writes everything to one CSV.

The evaluation surface comes from the [Design Editor](/design/design-editor/).

**Environment**: on a design with more than one [environment](/design/environments/), **Current** follows the environment the Design Editor shows, a numbered one holds the window on it even while it is switched off, and **All** rings and joins each environment's points in its own color; **Differences** then compares each environment with the first at the same angle. The choice is not saved with the design.

## Chromaticity diagrams

- **x, y**: the CIE 1931 diagram. The curved edge holds the pure colors of single wavelengths, the straight bottom edge the purples. A point near the white × is pale, one toward the edge strong, and its direction from the white is its hue. Brightness is left out.
- **u′, v′**: the same horseshoe stretched so equal distances are closer to equal visible steps.
- **a\*, b\***: the L\*a\*b\* plane at one lightness, white at the centre; the distance between two points is their ΔE\*ab.
- **C\*uv, huv** and **C\*ab, hab**: the L\*u\*v\* and L\*a\*b\* planes drawn round the white, rings of chroma and spokes of hue.

The fill shows each chromaticity as an sRGB screen shows it at full brightness; a color the screen cannot show is moved straight toward its white, keeping its dominant wavelength. The three lightness-plane tabs are drawn at the coating's highest L\* and framed to the coating, never tighter than ±5, so an AR's faint shift with angle fills the plot.

## Theory

With S the illuminant, R the coating's reflectance (or T) and x̄, ȳ, z̄ the observer's color-matching functions (Macleod, Eqs. 12.1–12.5):

```
X = 100 ∫ S R x̄ dλ / ∫ S ȳ dλ
Y = 100 ∫ S R ȳ dλ / ∫ S ȳ dλ
Z = 100 ∫ S R z̄ dλ / ∫ S ȳ dλ
x = X / (X + Y + Z),    y = Y / (X + Y + Z)
```

taken by the trapezoidal rule on the window's grid. Against the illuminant's white X_n, Y_n, Z_n (CIE 15:2004):

```
L* = 116 f(Y/Y_n) − 16
a* = 500 [ f(X/X_n) − f(Y/Y_n) ]
b* = 200 [ f(Y/Y_n) − f(Z/Z_n) ]
f(t) = t^(1/3)  for t > (6/29)³,   t / (3 (6/29)²) + 4/29  below
ΔE*ab = √(ΔL*² + Δa*² + Δb*²)
```

The dominant wavelength is where the line from the white through the coating's point meets the spectral locus, and purity is the coating's distance from the white over the locus's. CCT is the temperature of the nearest point of the Planckian locus in the CIE 1960 u, v plane, and Duv the distance to it. ΔE00 is the CIEDE2000 formula as Sharma, Wu and Dalal implement it.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Section 12.2, pp. 457–463 (Eqs. 12.1–12.11): color definition, chromaticity and dominant wavelength.
- CIE 15:2004, *Colorimetry*, 3rd ed.
- G. Sharma, W. Wu and E. N. Dalal, "The CIEDE2000 color-difference formula: implementation notes, supplementary test data, and mathematical observations", *Color Res. Appl.* **30**, 21 (2005).
