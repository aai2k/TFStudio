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

**Side**: on a design coated on both sides, which side is cleaned. **Front**
cleans the front and leaves the back exactly as it is, **Back** cleans the
back and leaves the front, **Both** (the default) cleans both. The two sides
of a part are often coated in different runs, so one can be cleaned without
touching the other. A design coated on one side has no Side choice and is
cleaned on that side; a symmetric design has none either, since its back is
the mirror of its front.

**Remove below (nm)**: layers thinner than this are removed (typically
1–5 nm; raise it to your manufacturing minimum for a final pass).

**Merge same material**: combine neighbouring layers of the same material into
a single layer.

**Re-optimize**: run a Refinement pass on the cleaned design to recover any
merit lost to the structural change (on by default).

The **Settings** menu beside Apply holds the pass's own settings:

- **Method**: the refiner, Sequential QP, the Refinement window's default
  method, or Damped Least Squares, Conjugate Gradient, Newton or Newton-CG.
  These are the Refinement window's local methods; its multi-start, global and
  Try all runs are not offered.
- **Max iter**: how many refinement steps the pass runs (default 80).

## How to read it

The **operations preview** lists exactly what will change before you commit
(for example removing a thin layer or merging one layer into its neighbour),
along with the merit function before and after. A separate **thin layers**
panel shows which layers are currently below the threshold, as a diagnostic
view. **Apply** performs the cleanup (and the optional refine) as a single
undoable step. The refine runs in the background, so the app keeps responding
on a large design: the strip under the controls shows the step and the merit
reached, and **Stop** takes Apply's place, applying the cleanup with the best
thicknesses found so far. Switch to another design while it runs and nothing
is applied.

A good habit is two-stage cleanup: a first pass at the synthesis floor to drop
noise layers, then a second pass at your real manufacturing floor for the final
design. Symmetric designs mirror the cleaned front onto the back automatically.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., §13.
