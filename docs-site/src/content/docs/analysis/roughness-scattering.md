---
title: Roughness / Scattering
description: See how interface roughness changes the specular R and T of a design, and how much light it scatters out of the beams.
ribbonIcon: roughness
---

Real interfaces are never perfectly smooth. Roughness / Scattering replaces
every rough interface of the design with a thin transition layer and shows the
specular R and T that result next to those of the smooth design, together with
the light lost from the specular beams.

## Two kinds of roughness

Each interface gets an RMS roughness σ and one of two types.

**Short range**: roughness much finer than the wavelength. Light sees it as a
gradual change of index from one material to the next, so the interface becomes
a graded layer 2σ thick whose n and k run in a straight line from one material
to the other. It acts like a weak antireflection layer: R and T change, but no
light is lost.

**Long range**: roughness whose bumps are wider than the wavelength. It scatters
light out of the specular beams. The interface becomes one layer 2σ thick with
an index between the two materials and a small extinction coefficient that
stands for the scattered light. The loss then follows the field at each
interface the way absorption does: a reflector loses little in its
high-reflectance band, where the light never reaches the inner interfaces, and
far more in the dips on either side.

Both layers take their thickness from the layer beneath the interface, the one
deposited first, so the rest of the design stays where it was. The substrate is
never thinned, so the layer on the substrate adds its 2σ to the coating. A layer
thinner than the transition layer taken from it is set to zero thickness, and
the window says so. A layer that already has zero thickness is not in the
coating, so the layers on either side of it meet at one interface, which takes
the σ and type set for the interface on top of the layer beneath.

## Where the long-range model holds

The long-range layer comes from a calculation for:

- a single surface between two non-absorbing materials,
- light arriving at normal incidence,
- bumps that are wide compared with the wavelength,
- a roughness small enough that terms beyond (σ/λ)² do not matter.

Within those limits it gives the same drop in R and in T as scalar scattering
theory, for light arriving from either side. The window also applies it at
every interface of a multilayer and at any angle of incidence, which that
calculation does not cover, so read those results as an estimate. Next to an
absorbing material, a metal for example, only the real part of its index enters
the layer. When the angle of incidence is not zero and a long-range interface is
set, the window shows a note saying so.

## Settings

**λ range / step**: the wavelength grid, in nanometres.

**AOI**: angle of incidence.

**T / R**: which curves to draw, with **avg**, **s** and **p** inside each. Each
one is drawn twice, smooth and rough. Every polarization is computed together,
so switching one on adds a pair rather than replacing the averaged one.

**ppm / frac**: the units for the loss axis: parts per million or fraction.

The analysis runs for the surface mode set in the
[Design Editor](/design/design-editor/). Front roughens the front-coating
interfaces, back the back-coating interfaces, and total both, with the
substrate between them.

## Roughness

The **Roughness** strip below the plot is where σ and the type are set. Choose
**Uniform σ** to give every interface the same σ and type, or **Per-interface**
to set each one. In per-interface mode each interface is listed by the two media
it separates, with its own σ and a Short range / Long range choice. An interface
you have not edited keeps the uniform values.

**Reset** puts every interface back to σ = 1 nm, long range.

## How to read it

The left axis, in **percent**, shows the rough R and T as solid lines, with the
smooth R and T drawn faintly dotted behind them. The right axis shows the
specular loss, smooth R + T minus rough R + T, in ppm or as a fraction.

Short-range roughness on a non-absorbing design loses nothing, so its loss curve
stays at zero; its effect is the gap between the dotted and solid curves. For a
single surface the long-range loss grows as (σ/λ)², so a roughness that is
harmless in the infrared can matter in the ultraviolet. In an absorbing design
the transition layers change the absorption as well, and the loss curve includes
that change. Where a transition layer replaces part of an absorbing layer, the
loss can even fall below zero.

The Results strip opens the same spectrum wavelength by wavelength: smooth and
rough values for every curve that is switched on, and the loss.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., §16.
- C. K. Carniglia and D. G. Jensen, "Single-layer model for surface roughness",
  *Appl. Opt.* **41**, 3167 (2002).
