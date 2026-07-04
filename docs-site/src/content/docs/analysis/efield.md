---
title: Electric Field Evaluation
description: The |E(z)|² standing-wave profile through the stack.
ribbonIcon: efield
---

The Electric Field window plots the squared field amplitude `|E(z)|²` against
depth through the coating at a chosen wavelength. It shows **where light
intensity concentrates inside the stack** — the key piece of information for
laser-damage-threshold analysis, since the layer carrying the highest field is
usually the one that fails first under a high-power beam. It also makes it clear
why a particular layer's thickness matters so much to performance.

The field is normalized so that the incident intensity is 1, shown as 100 %. It
combines the forward- and backward-travelling waves at every depth, matched
across each layer boundary. In a high-reflectance mirror the field in the
incident medium can reach 400 %, because the incident and reflected waves add
nearly in phase.

## Settings

**Wavelength** — the single wavelength at which the standing-wave profile is
computed, in nm. It defaults to the design's reference wavelength.

**AOI** — the angle of incidence in degrees.

**Polarization** — s, p, or their average. At oblique incidence s and p give
different profiles, so compare them when working at an angle.

**Side** — profile the **front** coating or the **back** coating. Each side
shows that coating's standing wave on the substrate, evaluated from its own
incident medium; the substrate is the exit medium.

## How to read it

The horizontal axis is physical depth in nanometres; vertical dotted lines and
the colored bands mark the layer boundaries and materials. Peaks of `|E(z)|²`
are field anti-nodes and troughs are nodes. For laser-damage work, the layer
containing the highest in-material field is the bottleneck — lowering the field
there raises the damage threshold. In a well-designed mirror the anti-nodes sit
preferentially in the more robust material, which is part of why mirrors
tolerate high power.

The readout reports the peak field, the layer count and the total physical
thickness, and the data table lists the field versus depth for the curves on
screen. Reading the field against the
[Refractive Index Profile](/analysis/refractive-index-profile/) shows which
layer the standing-wave peak lands in.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Ch. 3 (Eqs. 3.5–3.6) — fields in thin films.
