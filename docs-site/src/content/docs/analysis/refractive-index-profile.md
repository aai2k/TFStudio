---
title: Refractive Index Profile
description: n(z) and k(z), the index step profile of the stack at a chosen wavelength.
ribbonIcon: ri-profiler
---

The Refractive Index Profile draws the refractive index n and the extinction coefficient k as a step function of depth through the coating, at one wavelength. It shows the index contrast between layers at a glance, and confirms the stack is built from the materials you meant.

<!-- shot: ri-profiler | protected silver mirror, n and k both drawn, the silver's k standing out against the oxide overcoat -->
![Refractive Index Profile](/screenshots/ri-profiler.png)

## Computed quantities

- **n(z)** and **k(z)** of every layer at the chosen wavelength, against physical depth in nm from the outer surface. The height of a step is the layer's index; a tall step between neighbours is a strong interface, and a k step marks an absorbing layer.
- **Results** lists z, n and k, and exports them as CSV.

Reading the profile against the [Electric Field](/analysis/efield/) profile shows which layer carries the standing-wave peak.

## Controls and settings

**Quantity**: **n**, **k** or both on twin axes, k dashed.

**Side**: the **Front** or **Back** coating, each from its outer medium to the substrate, or **Total**: front coating, substrate and back coating end to end, the substrate drawn as a shortened middle section between two breaks so the layers stay readable.

**Settings**: **Wavelength (nm)**, which follows the design's reference wavelength. The materials are dispersive, so it moves the steps.

**Environment**: on a design with more than one [environment](/design/environments/), **Current** follows the environment the Design Editor shows, a numbered one holds the window on it even while it is switched off, and **All** draws every environment that is on in its own color. The layer bands are the first environment's, since a thickness factor moves the boundaries in the others. The choice is not saved with the design.

## Theory

Inside layer j the complex index is constant:

```
N(z) = n_j(λ) − i·k_j(λ)        z inside layer j
```

with n_j and k_j read from the material's data or formula at λ, and k ≥ 0 for an absorbing material in Macleod's convention. The layers are drawn at their physical thickness d_j; their optical thickness is n_j·d_j.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Section 2.2, p. 18: notation and the complex refractive index.
