---
title: Variator
description: Sliders for each layer thickness, the substrate thickness and each material's n and k, with the spectrum redrawn as you drag.
ribbonIcon: variator
---

The Variator shows which parameter of a design matters. Drag a slider and the spectrum redraws at once over the unmoved design. The thickness sliders move the design itself, so every open window follows them; the n and k sliders act on the Variator's preview alone.

<!-- shot: variator | the 550 nm bandpass with its spacer 2 nm thicker and TiO2 0.01 higher in index, solid curves over the dotted unmoved design and the bandpass target, preview narrowed to 450-660 nm -->
![Variator](/screenshots/variator.png)

## Computed quantities

T and R in percent of the moved design (solid) and of the design before any slider moved (dotted), on the evaluation surface set in the [Design Editor](/design/design-editor/), averaged over s and p and over the design's cone of incidence when it has one. The gap between the two is the effect of the sliders. The header says **modified** while any slider is off zero.

## Controls and settings

| Slider | Range | Step |
|---|---|---|
| Layer thickness, one per front and back layer | down to 0, up by the layer's thickness or 20 nm, whichever is more | 0.1 nm |
| Substrate thickness | ± half the thickness, at least ± 0.5 mm | 0.01 mm |
| Δn per material | ± 0.5 | 0.001 |
| Δk per material | ± 0.1 | 0.0005 |

Layer sliders carry the Design Editor's layer number, the material and the thickness they start from. On a symmetric design the back mirrors the front and has no sliders of its own. The material sliders cover every material in the design, the incident medium, substrate and exit medium included.

**×** on a row or a double-click on its slider sets it back to zero; **Revert** sets every slider back and restores the design.

**λ** range and **AOI** set the preview, **Targets** draws the merit function's targets, and **Show baseline overlay** the dotted curves.

## Undo and the baseline

- The first thickness move puts down one undo step, so one Ctrl+Z takes back the whole session.
- The sliders stay where they were when you switch to another window and back.
- If the design changes some other way, by Ctrl+Z or an edit in another window, the Variator takes the design as it now is for its baseline and sets the thickness sliders to zero. The n and k sliders keep their values, since they are not part of the design.

## Theory

Each slider adds to the value the session started from:

```
d′ = max(0, d + Δd)
n′(λ) = n(λ) + Δn
k′(λ) = max(0, k(λ) + Δk)
```

The offsets are the same at every wavelength, so the shape of the material's dispersion is kept. Both curves come from the characteristic matrix of the stack (Macleod, Section 2.6), as in [Optical Evaluation](/analysis/optical-evaluation/). How far a curve moves for a small slider move shows how tightly that layer or material has to be held in the coater (Macleod, Section 13.7).

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Section 2.6, pp. 42–44: the characteristic matrix of an assembly of thin films.
- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Section 13.7, pp. 514–524: tolerances and errors in layer thickness.
