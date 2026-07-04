---
title: Filter Design
description: Build a multi-cavity Fabry-Perot bandpass prototype (DWDM, LWDM, or notch) in a few guided steps.
ribbonIcon: filter-design
---

The **Filter Design** wizard builds a multi-cavity bandpass prototype filter —
DWDM, LWDM, or a narrow notch — from a handful of physical parameters. It walks
you through choosing materials and a target shape, suggests a cavity count and a
matching prototype, and hands back a ready-to-refine design with the merit
operands already filled in.

The structure it generates is a symmetric stack of quarter-wave mirror blocks
separated by Fabry-Perot spacer cavities:

```
Substrate | M₁ S₁ M₂ S₂ … Mq Sq M(q+1) | (optional AR)
```

Each Mᵢ is a quarter-wave high-reflector block and each Sᵢ is a half-wave
spacer cavity. The outer and inner mirror blocks use slightly different layer
counts so that neither spacer boundary collapses into an inert full-wave layer.

## Steps

The wizard runs in six steps:

1. **Materials** — pick the high-index (H) and low-index (L) coating materials,
   and optionally the substrate, incident medium, and an oblique angle of
   incidence. Both materials should be effectively lossless at the design
   wavelength (the wizard warns if absorption is significant), because loss in a
   high-Q cavity badly reduces peak transmittance.

2. **Parameters** — set the centre wavelength λ₀, the passband half-width, and
   the stopband half-width. The shape factor (the ratio of the two) is shown
   live as you type, along with an ideal-target preview.

3. **Cavities** — the wizard recommends a cavity count from your shape factor;
   you can override it.

4. **Prototype** — choose from a table of candidate prototypes, each labelled by
   its mirror and spacer orders with an estimated bandwidth, and pick the row
   closest to your target.

5. **Refine the candidate** — a short integer search settles the chosen
   prototype's layer arrangement.

6. **Anti-reflection** — the design moves from the simplified embedded case to
   the real incident medium, adding an anti-reflection coating so the finished
   filter performs in air.

## How to read it

The preview plots transmittance on a finely sampled wavelength grid around λ₀ so
that the narrow passband renders clearly. Before refinement, a symmetric
N-cavity prototype shows N small ripples straddling λ₀ — this is the expected
Chebyshev-style response, not a fault; Refinement merges them into a flat top.

When you confirm, a new design is committed with the calculated stack and the
merit operands pre-filled in the
[Merit Function Editor](/design/merit-function-editor/): an averaged
transmittance target in the passband and averaged reflectance targets in the
stopbands. Run [Refinement](/synthesis/refinement/) next to finish the design.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Ch. 7 (Eq. 7.27) and §8.2.
- Tikhonravov & Trubetskov, *Appl. Opt.* **41**, 3036 (2002), §3.
