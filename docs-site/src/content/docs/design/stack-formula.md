---
title: Stack Formula
description: Generate a whole layer stack from a compact symbolic formula like Air | (HL)^4 H | Glass.
ribbonIcon: stack-formula
---

**Stack Formula** generates a complete layer stack from a compact symbolic
expression — the shorthand a coating engineer already thinks in. You type a
formula, watch the parsed stack and its spectrum preview update live, then apply
it to the design.

```
Air | (HL)^4 H | Glass             9-layer quarter-wave HR mirror
Glass | 2H 1.5L H L (HL)^3 | Air   matching layers + quarter-wave stack
Air | 0.5H L H 0.5L | Sub          fractional quarter-waves
Air | Hi Lo Hi Lo Med | Glass      custom symbols
```

## The formula language

A formula reads `incident-medium | layers | exit-medium`, with the coating
written between the two bars.

- **Symbols** `H`, `L` and `M` default to the high-, low- and medium-index
  materials at the active reference wavelength. You can map your own symbols to
  any material (for example `Hi → TiO2`, `Lo → SiO2`, `Med → Al2O3`).
- **Coefficients** are quarter-wave multipliers at the reference wavelength:
  `2H` is a half-wave of the high material, `0.5L` an eighth-wave of the low.
  A bare symbol is one quarter-wave.
- **Repeat groups** `(...)^n` expand the enclosed layers n times.
- **`@λ`** on a medium overrides the reference wavelength used for the
  conversion.

## Settings

**Reference wavelength** — the wavelength at which the quarter-wave
coefficients are converted to physical thickness.

**Symbol assignments** — a list mapping each symbol used in the formula to a
material. `H`/`L`/`M` are pre-filled; any unknown symbol you type is surfaced
automatically with a material picker, and you can add, rename or remove rows.

**Incident / Substrate / Exit media** — the media that bound the coating. The
front coating is bounded by the incident medium and the substrate; the back
coating by the substrate and the exit medium.

**Start from substrate** — reads the formula from the substrate outward instead
of from the incident medium inward.

**Apply to side** — choose whether the formula populates the front coating, the
back coating, or both. (A symmetric design always writes the front and mirrors
it to the back.)

## How to read it

As you type, the right-hand panel lists the parsed layers with their material,
quarter-wave value and physical thickness, along with the layer count and total
thickness, and plots the resulting T and R spectrum with the reference
wavelength marked. A parse error is flagged at the character where it occurs and
the preview blanks until you fix it.

When the formula is valid, apply it with **Append** (add the layers to the end
of the current stack), **Replace** (overwrite the active design's stack), or
**New design** (create a fresh design from the formula). A classic mirror or
anti-reflection coating built this way is a clean quarter-wave starting point
to hand to [Refinement](/synthesis/refinement/) or
[Needle](/synthesis/needle/). The stack that the formula generates lands in the
[Design Editor](/design/design-editor/), and the formula is kept with the
design so any design can be written back to a formula later.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., §3.1 (quarter-wave optical thickness notation), Ch. 5 (quarter-wave stacks).
