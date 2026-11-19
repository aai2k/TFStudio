---
title: Stack Formula
description: Build a layer stack from quarter-wave shorthand such as (H L)^8 H, with its layers and spectrum shown as you type.
ribbonIcon: stack-formula
---

Stack Formula builds a coating from the quarter-wave shorthand coating engineers write by hand. It opens with the design's front coating written in that shorthand; type a formula, check the layers and the spectrum it gives, then write it into the design.

```
(H L)^8 H          17-layer quarter-wave mirror
0.5H L H 0.5L      fractional quarter waves
LHLHL6HLHLH        a run of single letters with a 6H spacer
Hi Lo Hi Lo Med    your own symbols
```

<!-- shot: stack-formula | (H L)^8 H typed over the open quarter-wave mirror, the 17 layers listed with QWOT and thickness, T and R drawn, before Replace -->
![Stack Formula](/screenshots/stack-formula.png)

## Computed quantities

- The layers in [Design Editor](/design/design-editor/) numbering, each with its material, QWOT at λ₀ and physical thickness d (nm), plus the layer count and the total thickness.
- T and R in percent at normal incidence, averaged over s and p, from 0.5 λ₀ to 1.75 λ₀ with λ₀ marked. The coating sits on the substrate taken as semi-infinite, so the back surface is left out. For the back coating it is seen from the exit medium.

A formula that does not parse shows its error and the character position where it was found, and the preview stays blank until it is fixed.

## Controls and settings

**Reference λ₀ (nm)**: the wavelength at which a coefficient turns into a thickness.

**Symbol → material**: assigns a material to each symbol. The rows come filled in from the design's materials ranked by index at λ₀, H the highest and L the lowest, or as H, L, M for TiO2, SiO2 and Al2O3 on an empty design. A symbol the formula uses but nobody assigned gets a new row with a material picker. A material name such as SiO2 or BK7 works without a symbol.

**Start from substrate**, on by default: the first layer written is the one on the substrate. Off, the first layer written faces the incident medium.

**Incident medium**, **Substrate** and **Exit medium** set the media; **Apply to** picks **Front**, **Back** or **Both**. On a symmetric design the formula goes on the front and the back mirrors it.

**Append** puts the layers on the outside of the existing coating, **Replace** writes them over the coating and sets the media and λ₀, and **New design** makes a design from the formula in the selected project folder. Append and Replace are one undo step, and the formula is kept with the design.

## Formula syntax

- A **coefficient** before a symbol is the layer's optical thickness in quarter waves at λ₀: `2H` is a half wave of H, `0.5L` an eighth wave of L. A bare symbol is one quarter wave.
- `(...)^n` repeats the group n times. Groups can nest.
- Single-letter symbols can run together, with whole-number coefficients inside the run: `LHLHL6HLHLH` reads `L H L H L 6H L H L H`. Multi-letter symbols and material names stay separated by spaces.
- A formula holds the layers alone. The incident medium, substrate and exit medium are set in the media fields, and a formula written with `|` media is refused.

## Theory

A layer of coefficient c and index n(λ₀) has (Macleod, Section 3.1):

```
d = c · λ₀ / (4 · n(λ₀))
QWOT = 4 · n(λ₀) · d / λ₀ = c
```

with n the real part of the material's index at λ₀. A material with no index at λ₀, past a pole of its dispersion formula, has no quarter wave there, and the formula is refused rather than built 0 nm thick. At λ₀ a quarter-wave layer of admittance η turns an admittance Y into η²/Y and a half-wave layer leaves it unchanged, which is why stacks written this way are easy to reason about.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Section 3.1, pp. 65–66: quarter- and half-wave optical thicknesses and the H, M, L notation.
