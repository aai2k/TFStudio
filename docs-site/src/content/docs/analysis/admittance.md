---
title: Admittance Diagram
description: The optical admittance locus through the stack — design intuition at a glance.
ribbonIcon: admittance
---

The Admittance Diagram traces a path through the complex admittance plane as you
walk from the substrate outward through each layer of the front coating. Every
layer draws an arc, and the point where the path ends fixes the reflectance at
that wavelength. Reading the shape of the locus is a classic way to build
intuition about how a stack works — whether it matches the coating to the
incident medium, builds up a high reflectance, or sits somewhere in between.

At one wavelength and angle of incidence, the diagram starts at the substrate
admittance and applies each layer's transfer in turn. The final endpoint is the
front-surface admittance `Y`, from which the reflectance follows as
`R = |(η₀ − Y) / (η₀ + Y)|²`, where `η₀` is the admittance of the incident
medium.

## Settings

**Wavelength** — the single wavelength at which the locus is drawn, in nm.
Admittance is a single-wavelength concept, so only one value is evaluated at a
time. It defaults to the design's reference wavelength.

**AOI** — the angle of incidence in degrees.

**Polarization** — s, p, or their average. At oblique incidence the s and p
loci differ; at normal incidence they coincide.

**Side** — trace the **front** coating (from the incident medium) or the
**back** coating (from the exit medium). Each coating is its own locus on the
substrate, so the two sides are drawn independently.

## How to read it

Each arc is one layer, labelled L1, L2, … from the substrate outward, and
colored by material. A few shapes recur:

- A **quarter-wave layer** sweeps a half-circle arc.
- A path that walks **toward `η₀`** (marked η₀) is matching the coating to the
  incident medium — an antireflection design. An endpoint sitting exactly on
  `η₀` means zero reflectance at that wavelength.
- A **tight orbit far from `η₀`** is a high-reflectance stack.

The substrate admittance (η_s), the incident-medium admittance (η₀), and the
final admittance (Y₀) are marked, and the panel lists the numeric admittances
plus the per-layer endpoints. Pair this with the
[Electric Field](/analysis/efield/) view to see which layer carries the
standing-wave peak at the same wavelength.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., §2.4 and §4.1 — admittance locus.
