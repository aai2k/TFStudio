---
title: Variator
description: "Live sliders for what-if exploration: per-layer thickness, substrate, and per-material n/k."
ribbonIcon: variator
---

The **Variator** is a panel of sliders for exploring how sensitive a design is.
Drag any slider and the spectrum responds instantly: layer-thickness and
substrate sliders nudge the shared design, so every open window (Optical
Evaluation, Admittance, the electric-field and color tools) re-renders live,
while the Variator's own plot overlays the perturbed curve on a dotted baseline.
It is a fast, reversible way to see which parameter matters before you commit to
anything.

## Settings

**Per-layer thickness**: one slider per front and back layer, running from zero to twice the layer's baseline thickness, with at least 20 nm of room upward on a thin layer. In Symmetric mode the back coating mirrors the front and has no sliders of its own. The slider label shows the layer's material and baseline thickness.

**Substrate thickness**: nudges the substrate thickness in millimetres around
its baseline.

**Δn and Δk per material**: one pair of sliders per unique material in the
stack, applied as constant offsets to the dispersive `n(λ)` and `k(λ)`. These
stay **local to the Variator preview** (other windows keep showing the
unperturbed materials), and `k` is held at or above zero.

**Preview controls**: set the wavelength range and angle of incidence for the
plot, toggle the dotted baseline overlay, and show the merit-function targets
(when the design has any). The evaluation target (Front / Back / Total) is shown
as a read-only badge and follows the [Design Editor](/design/design-editor/).

**Revert**: zeros every slider and restores the original design. Each slider
row also has its own reset, and double-clicking a slider snaps it back to
baseline.

## How to read it

The solid R and T curves are the perturbed design; the dotted curves are the
untouched baseline, so the gap between them is exactly the effect of the
sliders you moved. The quickest use is a tolerance gut-check: jiggle one layer
and watch a stopband edge walk. If a small move shifts the spectrum a lot,
that layer needs tight process control.

Because the thickness and substrate sliders feed the shared design, the change is live everywhere, but it is non-destructive: the first thickness move sets one undo checkpoint, so a single Ctrl+Z (or **Revert**) returns the design to where it started. The sliders stay where you left them when you switch to another window and back. If the design changes some other way, by Ctrl+Z or an edit in another window, the Variator takes the design as it now is for its baseline and sets the thickness sliders back to zero.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., §13.7 (sensitivity of multilayer performance to thickness errors).
