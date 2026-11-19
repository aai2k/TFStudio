---
title: Layer Thicknesses
description: Every layer of a coating as a bar, in physical or optical thickness units, colored by material.
ribbonIcon: layer-thicknesses
---

Layer Thicknesses draws a coating as one bar per layer, colored by material. It shows the shape of a thickness sequence that a list hides: the taper of a chirped mirror, the thin layers a needle run has inserted, or one layer that refinement made far thicker than its neighbours.

<!-- shot: layer-thicknesses | chirped mirror in QW at its 700 nm reference wavelength, the chirp reading as a taper -->
![Layer Thicknesses](/screenshots/layer-thicknesses.png)

## Computed quantities

- **nm**: physical thickness $d$.
- **OT**: optical thickness $n \cdot d$, in nm.
- **QW**: quarter waves, $4 \cdot n \cdot d / \lambda_0$. A quarter-wave layer reads 1, a half-wave cavity 2.
- **FW**: full waves, $n \cdot d / \lambda_0$.

Layers are numbered from the substrate, as in the [Design Editor](/design/design-editor/), and a layer of zero thickness keeps its number. **Results** lists every layer in all four units.

## Controls and settings

**Units** and **Side** pick what the bars show. **Settings** holds **λ₀**, the wavelength the optical units read each index at; it follows the design's reference wavelength, so QW agrees with the Design Editor's QW column.

**Environment**: on a design with more than one [environment](/design/environments/), **Current** follows the environment the Design Editor shows and a numbered one holds the window on it even while it is switched off. Each bar is the layer as that environment deposits it, with the thickness factor of its material and the change its temperature makes, and the optical units read that material's index there. The choice is not saved with the design.

## Theory

With $n$ the real part of the layer's index at $\lambda_0$:

$$
\begin{aligned}
\mathrm{OT} &= n \cdot d \\
\mathrm{QW} &= \frac{4 \cdot n \cdot d}{\lambda_0} \\
\mathrm{FW} &= \frac{n \cdot d}{\lambda_0} \\
\delta &= \frac{2\pi \cdot n \cdot d}{\lambda_0} = \frac{\pi}{2} \cdot \mathrm{QW}
\end{aligned}
$$

$\delta$ is the phase thickness at $\lambda_0$ at normal incidence. A layer with $\mathrm{QW} = 1$ has $\delta = \pi/2$ and turns the admittance from $Y'$ to $n^2/Y'$; a layer with $\mathrm{QW} = 2$ is a half wave, which at $\lambda_0$ changes nothing and is called an absentee layer (Macleod, Section 3.1).

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Section 3.1, pp. 65–66: quarter- and half-wave optical thicknesses.
