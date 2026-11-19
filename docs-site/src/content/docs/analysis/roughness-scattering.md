---
title: Roughness / Scattering
description: See how interface roughness changes the specular R and T of a design, and how much light it scatters out of the beams.
ribbonIcon: roughness
---

Real interfaces are never perfectly smooth. Roughness / Scattering replaces every rough interface of the design with a thin transition layer and shows the specular R and T that result beside those of the smooth design, with the light lost from the specular beams.

<!-- shot: roughness | quarter-wave mirror with 1 nm of long-range roughness on every interface, rough R and T over smooth, specular loss in ppm -->
![Roughness / Scattering](/screenshots/roughness.png)

## Computed quantities

- **R** and **T** in percent, rough as solid lines over smooth as faint dotted ones.
- **Specular loss** on the right axis, in ppm or as a fraction: smooth $R + T$ minus rough $R + T$.

Short-range roughness on a non-absorbing design loses nothing; its effect is the gap between the dotted and solid curves. Long-range loss follows the field at each interface the way absorption does: a reflector loses little in its high-reflectance band, where the light never reaches the inner interfaces, and far more in the dips either side. In an absorbing design the transition layers change the absorption too, and where one replaces part of an absorbing layer the loss can fall below zero.

## Controls and settings

**T / R** with **avg**, **s** and **p**, each drawn smooth and rough. **ppm / frac** sets the loss axis.

**Settings**: the **λ** range and step, and the **AOI**.

**Roughness** strip: **Uniform σ** gives every interface one rms roughness $\sigma$ and type; **Per-interface** sets each interface, listed by the two media it separates, with its own $\sigma$ and **Short range** or **Long range**. **Reset** puts every interface back to $\sigma = 1$ nm, long range. The interfaces follow the evaluation mode set in the [Design Editor](/design/design-editor/): front, back, or both with the substrate between.

**Environment**: on a design with more than one [environment](/design/environments/), **Current** follows the environment the Design Editor shows and a numbered one holds the window on it even while it is switched off. $\sigma$ and the type are one list for every environment; in the one shown each transition layer sits between the materials that meet there. The choice is not saved with the design.

## Short and long range

**Short range** is roughness much finer than the wavelength. Light sees it as a gradual change of index, so the interface becomes a graded layer $2\sigma$ thick with $n$ and $k$ running in a straight line from one material to the other, a weak antireflection layer that loses nothing.

**Long range** is roughness whose bumps are wider than the wavelength and scatter light out of the specular beams. The interface becomes one homogeneous layer $2\sigma$ thick with an index between the two materials and a small $k$ that stands for the scattered light.

Both layers take their thickness from the layer beneath the interface, the one deposited first, so the rest of the design stays where it was. The substrate is never thinned, so the layer on it adds its $2\sigma$ to the coating. A layer thinner than the transition taken from it is set to zero, and the window says so. A face with no layers keeps its smooth bare surface.

The long-range layer is derived for one surface between transparent materials at normal incidence, with $\sigma$ small enough that terms past $(\sigma/\lambda)^2$ do not count. The window applies it at every interface of a multilayer, at any angle and over a cone, and says so in a note when it does: read those results as an estimate. Next to an absorbing material only the real part of its index enters.

## Theory

Short range, between materials a and b over a layer of thickness $2\sigma$, sliced as in [Inhomogeneities](/analysis/inhomogeneities/):

$$
N(s) = (1 - s) \cdot N_a + s \cdot N_b \qquad 0 \le s \le 1 \text{ across the layer}
$$

Long range, the single layer of Carniglia and Jensen (Eqs. 16, 42, 43), the same as Macleod's Eq. 16.32:

$$
\begin{aligned}
d &= 2\sigma \\
n^2 &= \frac{n_a^2 + n_b^2}{2} \\
k &= \frac{\pi (n_a - n_b)^2 (n_a + n_b)\, d}{4 n \lambda}
\end{aligned}
$$

On one surface this reproduces the specular changes of scalar scattering theory to terms in $(\sigma/\lambda)^2$, for light from either side:

$$
\begin{aligned}
\Delta R &= -R_0 \left( \frac{4\pi n_a \sigma}{\lambda} \right)^2 \\
\Delta T &= -T_0 \left[ \frac{2\pi (n_a - n_b)\, \sigma}{\lambda} \right]^2
\end{aligned}
$$

so the loss of one surface grows as $(\sigma/\lambda)^2$, and a roughness harmless in the infrared can matter in the ultraviolet. The transition layers then enter the stack as ordinary layers, computed as in [Optical Evaluation](/analysis/optical-evaluation/).

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Section 16.5, pp. 623–628 (Eq. 16.32): scattering and roughness as a transition layer.
- C. K. Carniglia and D. G. Jensen, "Single-layer model for surface roughness", *Appl. Opt.* **41**, 3167 (2002).
