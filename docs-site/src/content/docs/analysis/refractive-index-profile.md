---
title: Refractive Index Profile
description: n(z) and k(z), the index step profile of the stack at a chosen wavelength.
ribbonIcon: ri-profiler
---

The Refractive Index Profile draws the refractive index `n(z)` and extinction
coefficient `k(z)` as a step function of depth through the front coating. It is a
structural view of the design rather than an optical one: it makes the actual
index contrast between layers visible at a glance, which is a quick way to
confirm the stack is built from the materials you intended and to see how strong
the high/low index alternation is.

Each layer's dispersive `n` and `k` are evaluated at the chosen wavelength and
laid out from the incident medium through the layers to the substrate.

## Settings

**Wavelength**: the wavelength at which each material's index is sampled, in nm.
It defaults to the design's reference wavelength. Because the materials are
dispersive, changing it shifts the index values.

**Quantity**: plot the refractive index `n`, the extinction coefficient `k`, or
both together on twin axes.

**Side**: profile the **front** coating, the **back** coating, or the **total**
structure. Front and back each lay their layers out from the incident medium
through to the substrate. **Total** is a structural view of the whole part: the
front coating, the substrate and the back coating laid end to end in one
continuous profile; because the substrate is far thicker than the coatings it is
drawn as a compressed middle section, with a break on either side, so the coating
layers stay readable.

**Environment**: on a design with more than one [environment](/design/environments/), the **Environment** droplist in the row under the plot says which one the profile is computed in. **Current** follows the environment the Design Editor and the ribbon show. An environment picked by its number and name holds the window on that one, even while it is switched off. **All** draws every environment that is on, its `n` and `k` in its own color from the window's Palette in Preferences > Analysis, `k` still dashed when both are drawn, with a legend above the plot naming them. The layer bands and boundaries are the first environment's, since a thickness factor moves them in the others. The depth axis runs on to the thickest stack, and in the **Total** view each part is given the room of its thickest environment, so the substrate starts at the same place in all of them. The readout names each curve's environment, and the table and the CSV start each row with its environment and list each environment's rows in turn. The material range notice reads the materials of every environment shown. The choice belongs to this window and is not saved with the design.

## How to read it

The horizontal axis is physical depth in nanometres; colored bands and dotted
lines mark the layer boundaries and materials. The height of each step is the
index of that layer, so tall contrast between neighbouring steps means a strong
optical interface. A non-zero `k` step flags an absorbing layer.

The readout reports the index range, the layer count, and both the physical and
optical total thickness, and the data table lists `n` and `k` versus depth.
Reading this against the [Electric Field](/analysis/efield/) profile shows which
layer carries the standing-wave peak.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., §2.2 (refractive index conventions).
