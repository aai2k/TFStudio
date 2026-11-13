---
title: Inhomogeneities & Interlayers
description: Model graded transition layers between materials and see how a non-step interface changes your spectrum.
ribbonIcon: inhomogeneities
---

Deposition never produces a perfectly abrupt boundary between two materials.
There is always a thin region where the index grades from one to the other.
Inhomogeneities lets you insert such a graded transition at any interface in your
stack and see what it does to the spectrum. Each transition is sliced into many
thin sub-layers whose index is mixed linearly from one material to the next along
the chosen profile, and the graded stack is evaluated and overlaid against the
original step-interface design. The interlayers are a preview only: your design
is not changed.

The window configures the interfaces for the surface mode set in the
[Design Editor](/design/design-editor/): the front stack, the back stack, or
both for total.

## Settings

**λ range / step**: the wavelength grid, in nanometres.

**AOI**: angle of incidence.

**T / R / A**: which curves to draw, with **avg**, **s** and **p** inside each.
Every polarization is computed together, so switching one on adds a curve rather
than replacing the averaged one, and costs nothing.

**Environment**: on a design with more than one [environment](/design/environments/), the **Environment** droplist in the row under the plot says which one the spectra are computed in. **Current** follows the environment the Design Editor and the ribbon show; an environment picked by its number and name holds the window on that one, even while it is switched off. The interlayers are one list for the design, at the interfaces of its layer list, the same in every environment: in the environment shown each one grades between the materials that meet there in that environment's coating, which is computed on its own **Other side** and under its own cone. The **Interfaces** strip names the incident medium, the substrate and the exit medium of the environment shown. The material range notice reads the environment shown, and the specification verdict judges the design with its interlayers in every environment that is on. The choice belongs to this window and is not saved with the design.

## Interfaces

The **Interfaces** strip below the plot lists every interface in the stack by
the two media it joins. Tick one to add a graded interlayer there, then set:

**Thickness**: the depth of the transition region, in nanometres. The
interlayer is added at the interface; the host layers keep their own thicknesses.

**Profile**: the shape of the index grade across the transition: **linear**,
**parabolic**, **invParabolic**, **exponential**, or **sigmoid**.

**Slices**: how many thin sub-layers the transition is divided into for the
calculation. Around 10–20 is usually enough; more slices give a smoother grade.

**Clear all** removes every interlayer.

## How to read it

The chart is in **percent**. Each channel is drawn twice: the original
step-interface design as a faint dotted line, and the graded version as a solid
line on top. Comparing the two shows what the real, non-abrupt interfaces cost
you: typically softened stopband edges and shifted passband ripple. If your
design has a Specification, a live verdict in the Results strip tells you whether
the graded design still passes. The Interfaces strip header reports how many
interlayers are active and their combined thickness.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., §16 (inhomogeneous
  layers).
