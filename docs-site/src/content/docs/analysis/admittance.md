---
title: Admittance Diagram
description: The admittance of a coating as it is built up layer by layer at one wavelength, and the reflection coefficient that goes with it.
ribbonIcon: admittance
---

The Admittance Diagram builds the coating up on the substrate one layer at a time, at one wavelength and angle, and plots the optical admittance of what has been built so far. Every layer draws an arc from where the layer below it ended, and where the last arc stops fixes the reflectance. A reflectance curve tells you what a coating does; this diagram shows which layer does what.

<!-- shot: admittance | quarter-wave mirror on glass in the Y plane, front side, s+p at normal incidence, Results open -->
![Admittance Diagram](/screenshots/admittance.png)

## Computed quantities

Optical admittance is the ratio of the magnetic to the electric field along the layers, in units of the admittance of free space. At normal incidence it equals the refractive index: air at 1, glass at 1.52. An absorbing material, $n - ik$, sits below the real axis.

- **$\eta_s$** (square): the substrate's admittance, where the path starts.
- **$Y_0$** (diamond): the admittance at the outer surface of the finished coating, where the path ends.
- **$\eta_0$** (cross): the incident medium's admittance. The path has to end on it for zero reflectance.
- **$\Gamma$**: the amplitude reflection coefficient for light from the incident medium. $|\Gamma|^2$ is the reflectance and the angle of $\Gamma$ the phase change on reflection.

Arcs are numbered as in the [Design Editor](/design/design-editor/), L1 on the substrate; hover the dot at an arc's end for its value. A layer of zero thickness draws nothing and keeps its number.

## Controls and settings

**Plane**: the same path as admittance **Y** or as reflection coefficient **Γ**. Use Γ for a mirror, whose admittance runs far off the Y plot.

**Polarization**: **s+p** draws s solid and p dashed, since a locus has no average of the two.

**Side**: **Front** is seen from the incident medium, **Back** from the exit medium.

**Settings**: **Wavelength (nm)** follows the design's reference wavelength and resets to it when you switch designs, 550 nm on a design without one. **AOI (°)** runs from 0 to 89.

**Range warning**: a ⚠ badge appears when the wavelength lies outside a material's data range, with a button that moves $\lambda$ to the nearest wavelength every material covers.

**Environment**: on a design with more than one [environment](/design/environments/), **Current** follows the environment the Design Editor shows, a numbered one holds the window on it even while it is switched off, and **All** draws every environment that is on in its own color, with the table rows led by their environment. The choice is not saved with the design.

**Plot**: Re and Im keep one scale, so circles stay round. The wheel zooms about the pointer and dragging pans. The Y plane opens on $\eta_s$, $\eta_0$ and the arcs near them, so a mirror's outer arcs need a zoom out.

**Results**: one row per layer boundary from $\eta_s$ out to $\eta_0$. The $\Gamma$ on a layer's row is the reflection coefficient the coating would have if it ended with that layer.

## Loci in the Y and Γ planes

A layer without absorption draws a circle centred on the real axis, clockwise as it thickens. A quarter wave is half a circle, from $Y'$ on the real axis to $n^2/Y'$. A half wave is a full circle back to its start, which is why it changes nothing at its own wavelength. An absorbing layer spirals in toward its own admittance $n - ik$, because a thick absorbing layer looks to the light like the bulk material.

![Admittance locus of a two-layer V-coat on glass at 550 nm. From the glass at 1.52, a thin ZnS layer draws a short arc upward and the MgF₂ layer swings clockwise round most of a circle, ending exactly on air at 1. A dashed circle through the glass marks the reflectance of bare glass.](/diagrams/admittance-vcoat.svg)

An antireflection coating has to bring the path onto $\eta_0$. In this V-coat the thin ZnS layer moves the admittance just far enough that the MgF₂ circle from there passes through air at 1. Points of equal reflectance lie on circles around $\eta_0$, like the dashed one through bare glass: inside it a coating reflects less than bare glass, outside it more.

![The same five-layer quarter-wave mirror in both planes. In Y each half circle is larger than the last, and the fifth runs off the plot to Y₀ = 30.6. In Γ the same path is a chain of clockwise half circles spiralling out toward the dotted unit circle, ending at Y₀ close to it.](/diagrams/admittance-mirror.svg)

In a quarter-wave mirror each pair of layers scales the admittance by $(n_H/n_L)^2$, up after a ZnS layer and down after an MgF₂ one, so in Y the half circles soon leave any frame. In Γ the same path spirals out toward the unit circle, here to $|\Gamma| = 0.94$, $R = 88\,\%$. In the Γ plane:

- The centre is $\eta_0$: no reflection.
- The distance from the centre is $\sqrt{R}$; the dotted unit circle is total reflection.
- Left of the centre on the real axis the admittance is above $\eta_0$ and the phase change on reflection is 180°; right of it, 0.
- Layers still draw clockwise circular arcs, joined with no break at the interfaces.

At an angle the s admittances fall and the p admittances rise, the incident medium's included: in air at 45°, $\eta_0$ is 0.707 for s and 1.414 for p, so the two loci aim at different points.

## Theory

Each layer $r$ has a complex index $N_r = n_r - i k_r$, a tilted admittance and a phase thickness (Macleod, Eqs. 2.113 and 2.114):

$$
\begin{aligned}
n_0 \sin\theta_0 &= N_r \sin\theta_r \\
\eta_r &= N_r \cos\theta_r && \text{s-polarization} \\
\eta_r &= N_r / \cos\theta_r && \text{p-polarization} \\
\delta_r &= \frac{2\pi N_r d_r \cos\theta_r}{\lambda}
\end{aligned}
$$

$\theta_0$ is the AOI, $n_0$ the index of the incident medium, $d_r$ the physical thickness and $\lambda$ the wavelength, both in nm. $\eta_s$ and $\eta_0$ come from the same expressions.

One layer takes the admittance $Y'$ at its inner face to $Y$ at its outer face, the characteristic matrix applied to $(1,\ Y')$ with $Y = C/B$ (Eq. 2.113, Section 3.2):

$$
Y = \frac{Y' \cos\delta_r + i\,\eta_r \sin\delta_r}{\cos\delta_r + i\,(Y'/\eta_r) \sin\delta_r}
$$

The path starts at $Y' = \eta_s$ and steps out layer by layer to $Y_0$; each arc is this expression with $\delta_r$ growing from zero to its full value.

For a layer without absorption below the critical angle, $\eta_r$ and $\delta_r$ are real. With $Y = x + iy$ and the start point $Y' = \alpha + i\beta$, eliminating $\delta_r$ gives Eq. 3.3:

$$
x^2 + y^2 - x\,\frac{\alpha^2 + \beta^2 + \eta_r^2}{\alpha} + \eta_r^2 = 0
$$

a circle centred on the real axis at $(\alpha^2 + \beta^2 + \eta_r^2)/2\alpha$ through the start point, traced clockwise. Its two real-axis crossings multiply to $\eta_r^2$, which is the quarter-wave rule. With absorption $\delta_r$ is complex, the circle becomes a spiral, and $Y$ tends to $\eta_r$ as the layer thickens.

The reflection coefficient follows from the admittance (Eq. 2.112):

$$
\Gamma = \frac{\eta_0 - Y}{\eta_0 + Y}, \qquad R = |\Gamma|^2
$$

For a transparent incident medium this maps $\eta_0$ to the centre of the Γ plane, the right half of the Y plane, where every passive stack lies, into the unit circle, and circles to circles. It is Macleod's reflection circle diagram (Section 3.4.5): the stack is built up in the final incident medium, so the path has no break at an interface. The circle of constant reflectance $R$ in the Y plane, centred at $\eta_0(1 + R)/(1 - R)$ with radius $2\eta_0\sqrt{R}/(1 - R)$ (Eq. 3.5), becomes the circle of radius $\sqrt{R}$ about the centre of the Γ plane.

The window uses Macleod's sign convention: an index enters as $n - ik$ with the $k \ge 0$ of the material's data, so an absorbing substrate starts below the real axis, as in the book's figures. The table and the CSV carry the same signs.

The substrate counts as infinitely thick, so $Y_0$ and $\Gamma$ describe the coated surface alone. On the back side the exit medium takes the place of the incident medium.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Section 2.6, pp. 42–44 (Eqs. 2.112–2.114): the characteristic matrix, tilted admittances and phase thicknesses.
- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Section 3.2, pp. 66–70 (Eqs. 3.1–3.5): admittance loci and circles of constant reflectance.
- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Section 3.4.5, pp. 84–87: reflection circle diagrams.
