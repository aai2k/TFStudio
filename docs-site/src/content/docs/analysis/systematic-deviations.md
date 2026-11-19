---
title: Systematic Deviations
description: Apply a correlated thickness or index shift across the whole stack, then see or sweep its effect on the spectrum.
ribbonIcon: systematic-dev
---

Systematic Deviations answers what-if questions where every layer drifts the same way at once: all layers 2 % thick, the coater 5 nm long on every layer, or a material's index up by 0.05. Unlike [Monte Carlo](/analysis/error-analysis/), the error is correlated: one offset applied across the design, not an independent random draw per layer. The design itself is never changed.

<!-- shot: systematic-dev | 550 nm bandpass, Sweep mode, every layer scaled 0.98 to 1.02 in 41 steps, transmittance as a heat map -->

## Computed quantities

- **Single**: the deviated T, R or A in percent, solid over the unchanged spectrum drawn dotted (**baseline**). The gap between them is the cost of the deviation. On a design with a [specification](/design/specification/), a verdict says whether the deviated design still passes.
- **Sweep**: a heat map of one deviation parameter (vertical) against wavelength, colored by the channel in percent; **T+R+A** stacks three maps. A broad, slowly changing band means the design tolerates that error; a narrow, fast-changing one means it sits on a knife edge.

The surface mode set in the [Design Editor](/design/design-editor/) decides which coatings are deviated, shown as a badge.

## Controls and settings

**Single / Sweep**, the channel (**T+R+A**, **T**, **R**, **A**) and **baseline** sit on the row; **Settings** holds the **λ** range and step, the **AOI** and the polarization.

**Deviations** strip, in Single mode: **d × scale**, **d + offset** with its unit (**nm**, **OT**, **QW**, **FW**), **Δn** and **Δk**, once under **Global** and again per material under **Per-material**. The global values act on the coating layers only; the incident medium, substrate and exit medium keep their index, since a process running off nominal changes the films it grows. A per-material row lists every place its material appears, media included, so a per-material Δn is the way to shift a substrate glass on purpose; it also shifts any layer of that material. **Reset deviations** returns everything to no change.

In Sweep mode: **Sweep parameter** is any one of those controls, with **from**, **to** and **steps**; the range reseeds itself when you change the kind of parameter. **Run sweep** computes the map, varying only that parameter from the unchanged design. To combine a fixed deviation with a sweep, set the fixed part up in Single mode first.

**Environment**: on a design with more than one [environment](/design/environments/), **Current** follows the environment the Design Editor shows and a numbered one holds the window on it even while it is switched off. The deviation is made on the layer list and seen in that environment, through the thickness factor of each material there. A sweep is drawn in the environment it was run in. The choice is not saved with the design.

## Theory

For a layer of thickness d, index n and extinction coefficient k, with a global (g) and a per-material (m) part of each deviation:

```
d′ = max(0, d · s_g · s_m + o_g + o_m)
n′ = n + Δn_g + Δn_m
k′ = max(0, k + Δk_g + Δk_m)
```

An offset entered in optical units becomes nanometres layer by layer, with n the layer's index at the design's reference wavelength λ₀:

```
o[nm] = OT / n(λ₀) = QW · λ₀ / (4 n(λ₀)) = FW · λ₀ / n(λ₀)
```

so a 0.01 QW offset is a thicker step in a low-index layer than in a high-index one. A medium takes only its per-material Δn and Δk. The deviated stack is then computed as in [Optical Evaluation](/analysis/optical-evaluation/).

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Section 13.7, pp. 514–524: tolerances; Section 13.9, p. 527: systematic and random errors.
