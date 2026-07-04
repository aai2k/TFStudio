---
title: Inhomogeneities & Interlayers
description: Model graded transition layers between materials and see how a non-step interface changes your spectrum.
ribbonIcon: inhomogeneities
---

Deposition never produces a perfectly abrupt boundary between two materials —
there is always a thin region where the index grades from one to the other.
Inhomogeneities lets you insert such a graded transition at any interface in your
stack and see what it does to the spectrum. Each transition is sliced into many
thin sub-layers whose index is mixed linearly from one material to the next along
the chosen profile, and the graded stack is evaluated and overlaid against the
original step-interface design. The interlayers are a preview only: your design
is not changed.

The window configures the interfaces for the surface mode set in the
[Design Editor](/design/design-editor/) — the front stack, the back stack, or
both for total.

## Settings

**λ range / step** — the wavelength grid, in nanometres.

**AOI / pol** — angle of incidence and polarization (s, p, or averaged).

**T+R+A / T / R / A** — which channel(s) to plot.

Each interface in the stack is listed by the two media it joins. Tick an
interface to add a graded interlayer there, then set:

**Thickness** — the depth of the transition region, in nanometres. The
interlayer is added at the interface; the host layers keep their own thicknesses.

**Profile** — the shape of the index grade across the transition: **linear**,
**parabolic**, **invParabolic**, **exponential**, or **sigmoid**.

**Slices** — how many thin sub-layers the transition is divided into for the
calculation. Around 10–20 is usually enough; more slices give a smoother grade.

**Clear all** removes every interlayer.

## How to read it

The chart is in **percent**. Each channel is drawn twice: the original
step-interface design as a faint dotted line, and the graded version as a solid
line on top. Comparing the two shows what the real, non-abrupt interfaces cost
you — typically softened stopband edges and shifted passband ripple. If your
design has a Specification, a live verdict in the toolbar tells you whether the
graded design still passes. The toolbar also reports how many interlayers are
active and their combined thickness.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., §16 (inhomogeneous
  layers).
