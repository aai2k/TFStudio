---
title: Layer Thicknesses
description: Every layer of a coating as a bar, in physical or optical thickness units, colored by material.
ribbonIcon: layer-thicknesses
---

Layer Thicknesses draws a coating as one bar per layer, colored by material. It shows the shape of a thickness sequence that a list hides: the taper of a chirped mirror, the thin layers a needle run has inserted, or one layer that refinement made far thicker than its neighbours.

<!-- shot: layer-thicknesses | chirped mirror in QW at its 700 nm reference wavelength, the chirp reading as a taper -->
![Layer Thicknesses](/screenshots/layer-thicknesses.png)

## Computed quantities

- **nm**: physical thickness d.
- **OT**: optical thickness n·d, in nm.
- **QW**: quarter waves, `4·n·d / λ₀`. A quarter-wave layer reads 1, a half-wave cavity 2.
- **FW**: full waves, `n·d / λ₀`.

Layers are numbered from the substrate, as in the [Design Editor](/design/design-editor/), and a layer of zero thickness keeps its number. **Results** lists every layer in all four units.

## Controls and settings

**Units** and **Side** pick what the bars show. **Settings** holds **λ₀**, the wavelength the optical units read each index at; it follows the design's reference wavelength, so QW agrees with the Design Editor's QW column.

**Environment**: on a design with more than one [environment](/design/environments/), **Current** follows the environment the Design Editor shows and a numbered one holds the window on it even while it is switched off. Each bar is the layer as that environment deposits it, with the thickness factor of its material and the change its temperature makes, and the optical units read that material's index there. The choice is not saved with the design.

## Theory

With n the real part of the layer's index at λ₀:

```
OT = n·d
QW = 4·n·d / λ₀
FW = n·d / λ₀
δ  = 2π·n·d / λ₀ = (π/2)·QW
```

δ is the phase thickness at λ₀ at normal incidence. A layer with QW = 1 has δ = π/2 and turns the admittance from Y′ to n²/Y′; a layer with QW = 2 is a half wave, which at λ₀ changes nothing and is called an absentee layer (Macleod, Section 3.1).

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Section 3.1, pp. 65–66: quarter- and half-wave optical thicknesses.
