---
title: Design Cleaner
description: Merge adjacent same-material layers and remove very thin layers, then optionally re-refine.
ribbonIcon: design-cleaner
---

**Design Cleaner** tidies up the structural clutter that synthesis tends to
leave behind: adjacent layers of the same material, and vanishingly thin
"ghost" layers that contribute nothing. It merges the same-material neighbours
into one layer, removes anything below your thickness threshold, and repeats
until the design is stable (a removed middle layer can leave two same-material
neighbours touching, which the next pass catches). You can then re-refine to
settle the merit function after the structure has changed.

Locked layers are never merged or removed.

## Settings

**Minimum thickness (nm)** — layers thinner than this are removed (typically
1–5 nm; raise it to your manufacturing minimum for a final pass).

**Merge adjacent** — combine neighbouring layers of the same material into a
single layer.

**Clean back** — apply the same cleanup to the back-surface stack.

**Re-optimize after** — run a Refinement pass on the cleaned design to recover
any merit lost to the structural change (on by default).

**Refine iterations** — how many refinement steps the post-clean pass runs
(default 80).

## How to read it

The **operations preview** lists exactly what will change before you commit —
for example removing a thin layer or merging one layer into its neighbour —
along with the merit function before and after. A separate **thin layers**
panel shows which layers are currently below the threshold, as a diagnostic
view. **Apply** performs the cleanup (and the optional refine) as a single
undoable step.

A good habit is two-stage cleanup: a first pass at the synthesis floor to drop
noise layers, then a second pass at your real manufacturing floor for the final
design. Symmetric designs mirror the cleaned front onto the back automatically.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., §13.
