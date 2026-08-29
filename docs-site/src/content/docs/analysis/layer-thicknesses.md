---
title: Layer Thicknesses
description: Every layer of a coating as a bar, in physical or optical thickness units, colored by material.
ribbonIcon: layer-thicknesses
---

The Layer Thicknesses window draws the chosen coating as a bar chart: one bar
per layer, layer number on the horizontal axis, thickness on the vertical axis,
each bar in its material's color. It is the quickest way to take in the shape of
a design's thickness sequence: the taper of a chirped mirror, the thin spacers a
needle run has inserted, or a layer that came out of refinement far thicker than
its neighbours. The Design Editor lists the same numbers, but a list does not
show shape.

Layers are numbered from the substrate, matching the Design Editor. When the
stack uses more than one material, the legend above the plot names each
material's color.

## Settings

**Units**: what the bars read in.

- **nm**: physical thickness `d`.
- **OT**: optical thickness `n·d`, in nm.
- **QW**: quarter-wave optical thickness `4·n·d/λ₀`. A classic quarter-wave
  layer reads exactly 1.
- **FW**: full-wave optical thickness `n·d/λ₀`.

The optical units read each material's index at the wavelength `λ₀`, set in the
settings panel. It defaults to the design's reference wavelength, so the values
agree with the Design Editor's QW column.

**Side**: the **front** or the **back** coating.

## How to read it

In QW units a quarter-wave stack is a row of bars at 1, and any departure from
it stands out at a glance: half-wave cavities read 2, and the graded ends of a
broadband design fall away from 1. In physical units the same plot shows where
the deposition time goes.

The data table lists every layer with all four readings side by side, and
exports as CSV.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., §3.1 (quarter- and half-wave optical thicknesses).
