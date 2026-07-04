---
title: Layer Sensitivity
description: See which layers are the most critical to manufacture accurately.
ribbonIcon: sensitivity
---

Layer Sensitivity shows **which layers are the most critical to make
accurately**. It nudges each layer's thickness by a small amount, measures
how much the optical performance changes, and ranks the layers by that
change. The layers at the top of the ranking are the ones that need the
tightest monitoring and process control.

## Settings

**Probe size** — how big a thickness change to test on each layer. Choose
**Relative** (a percentage of the layer's own thickness, 1 % by default —
the usual choice, since real errors scale with thickness) or **Absolute**
(a fixed amount in nanometres). The sign does not matter; the tool always
tests the same amount above and below nominal.

**Display** — show the result as a chart, a table, or both.

**Scale** — **Normalized** sets the most sensitive layer to 100 % and
scales the rest against it (the easiest way to compare layers), or
**Absolute** shows the raw change in merit on a logarithmic axis (use this
when one layer dominates and you want its true size).

The ranking is evaluated for the surface mode set in the
[Design Editor](/design/design-editor/) (front, back, both, or symmetric),
shown as a badge on the window.

## How to read it

Each bar is one layer. A tall bar means a small thickness error there
produces a large change in performance — a critical layer that needs a
tight tolerance. A short bar means the layer is forgiving. A design whose
bars are all about the same height is robust, with no single layer that can
ruin it.

Layers are numbered as in the Design Editor (layer 1 touches the
substrate), and locked layers are excluded. Sensitivity is measured against
the optical performance, so the ranking reflects the effect on the
spectrum.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., §13.7.
