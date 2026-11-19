---
title: Plot Engine
description: Plot any quantity the analysis windows compute against any other as the wavelength, the angle or a layer parameter changes, or map one quantity over two of them as a heatmap or a 3D surface.
ribbonIcon: plot-engine
---

The Plot Engine draws the numbers the other analysis windows compute against whatever you change. **2D** overlays any number of curves, each with its own settings: T at 0° in s beside T at 45° in p, the GDD of a chirped mirror against one layer's thickness, or Ψ against Δ as a layer grows. **Heatmap** and **3D** map one quantity over two variables, the merit function over two layer thicknesses among them. Each design keeps its own plots.

<!-- shot: plot-engine | merit function of the 4-layer visible AR over the thicknesses of layers 1 and 3, as a heatmap with its minimum in the middle -->

## Computed quantities

Each quantity is computed exactly as in its own window, so a point here is the number that window shows for the same settings.

| Quantity | Computed as in | Unit |
| --- | --- | --- |
| T, R, A | [Optical Evaluation](/analysis/optical-evaluation/) | % |
| Phase φ, GD, GDD, TOD of R or T | [Group Delay / GDD](/analysis/gd-gdd/) | °, fs, fs², fs³ |
| Ψ, Δ | [Ellipsometry Evaluation](/analysis/ellipsometry/) | ° |
| MF | [Merit Function Editor](/design/merit-function-editor/) | none |

T, R and A are averaged over the design's cone of incidence when it has one; the phase, the delays, Ψ and Δ are computed at a single angle, as their windows compute them. Δ is in the Azzam–Bashara convention. A map leaves out the phase itself, which is unwrapped along a line and has no single unwrapping over a grid.

## Controls and settings

**2D / Heatmap / 3D**: in 2D the row holds **Curves**, the list with **Add curve** at its top; in Heatmap and 3D it holds **Settings** for the one map.

Each 2D curve has:

- **Sweep**: what changes along the curve, **Wavelength (nm)**, **AOI (°)** or the thickness of one layer (L1 on the substrate; the back layers, B1 on the substrate, on a design coated on its back alone), with a **Range** and **Step**.
- **Fixed**: the λ and AOI the curve is read at, greyed where the curve does not read them.
- **X** and **Y**: the swept value or any quantity in the table, with its polarization and side (**Front**, **Back** or **Total**). A quantity on both axes traces one against the other: Ψ on X and Δ on Y, with the outer layer growing, is the path an in-situ ellipsometer follows. Ψ, Δ and a reflected phase belong to one surface and offer Front and Back only; **Total** on a transmitted phase or delay is the whole part, as in [Pulse Analysis](/analysis/pulse-analysis/).
- **Dash** and **Width**.

Curves compute again by themselves when the design or a curve changes. T, R, A, Ψ and Δ come back at once without a cone; the rest are computed in the background, with **Stop** on the row while they run and **Compute** to restart. A map is computed only when you press **Compute**, and a changed setting clears it.

**Settings** for a map: **Quantity (Z)**, its polarization and surface, an **X axis** and **Y axis** (wavelength, AOI or a layer thickness, each with a range and a number of **steps**), the fixed λ or AOI not on an axis, and **Colors**. The grid size is shown at the foot; start coarse.

**Environment**: on a design with [environments](/design/environments/), each curve and the map has its own **Environment** field. **Current** computes in the environment the Design Editor shows; a numbered one computes in that one, on or off, so T at the centre of a dome can sit beside T at its edge. A map is kept with the environment it was computed in and is cleared when its settings would compute in another.

## Reading curves and maps

In 2D each kind of quantity gets its own Y axis: T, R and A share one, Ψ and Δ share one, and the phase, GD, GDD and TOD get one each. A curve with a quantity on X can double back on itself, as a Ψ–Δ path does, and is read point by point.

MF along one thickness shows whether the design sits at the bottom of its valley; MF over two thicknesses is the landscape the optimizer searches, and shows whether a refined design sits in a real basin or has a better one nearby. A map of T or R over wavelength and AOI is the picture [Wavelength vs Angle](/analysis/wavelength-angle-map/) draws.

## Theory

MF is one number for the whole design, the merit of the [Merit Function Editor](/design/merit-function-editor/):

```
MF   = √( Σ w_i Δ_i² / Σ w_i )
MF²  = (1/N) Σ_k MF_k²          Current, over the N environments that are on
```

so on a curve it changes only along a layer's thickness, and a map of it needs a layer on both axes. Under one environment it is that environment's own MF_k. Band rows are sampled on environment 1's grid in every environment.

A layer thickness on an axis is the one the Design Editor shows. Each environment deposits that layer `f·d` thick, f the thickness factor of its material there times the change its temperature makes, so every curve crosses its environment's own value at the design's thickness.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Section 2.9, pp. 47–51: the quantities computed from the characteristic matrix.
