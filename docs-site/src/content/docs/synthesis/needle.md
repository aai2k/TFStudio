---
title: Needle Variation
description: Insert thin "needle" layers where they improve the merit function, then refine.
ribbonIcon: needle
---

**Needle Variation** improves a design by inserting infinitesimally thin
"needle" layers at the spot where they help most, then refining the result.
To find that spot, it scans every position in the stack with every candidate
material and computes how the merit function would change if a needle of a
given material were inserted there — a quantity known as the P-function. The
most promising position and material win, the needle goes in at a finite
thickness, and a refinement pass settles the new stack. The cycle repeats
until no insertion improves the design any further.

There are two versions in the ribbon. **Needle Automatic** runs the whole
scan-insert-refine loop on its own until it reaches needle-optimality.
**Needle Manual** shows you the same P-function scan as a plot and lets you
click the position and material to insert a single needle by hand — useful for
testing a topology idea, seeding a layer where you know one belongs, or
stepping through synthesis one insertion at a time. Both share the same
candidate-material pool and the same underlying scan.

## Settings

**Candidate materials** — the pool of materials Needle is allowed to insert.
**All / Clear** select or empty the pool in one click. This pool is shared by
Needle Automatic, Needle Manual, and Gradual Evolution.

**Max layers** — an upper limit on how many layers the design may grow to.

**Target MF** — stop once the merit function reaches this value (0 means run
to convergence).

The advanced section exposes the synthesis tuning:

**Needle scale (nm)** — the thickness step used when probing candidate
positions.

**dMin (nm)** — the minimum inserted thickness and the floor used during
refinement (1 nm by default). Keep it at the synthesis default while
synthesizing; raise it to your manufacturing minimum only in a later
Refinement and [Design Cleaner](/synthesis/design-cleaner/) pass, so you don't
hold synthesis back with a manufacturable floor too early.

**Refine iterations** — how many refinement steps run after each insertion.

**Inner refiner** — which method refines the stack after each insert. The
default is **Conjugate Gradient**, which keeps the design "loose" so the next
scan can still find improving needles. See
[Optimization Methods](/synthesis/optimization-methods/) for the alternatives.

**Candidate search** — how thoroughly each step explores the improving
candidates (fast, balanced, or thorough), trading speed against quality.

Minimum and maximum thickness limits are ignored during synthesis; re-enable
them by running [Refinement](/synthesis/refinement/) afterwards. The surface
mode set in the Design Editor is honoured for every mode, not just the front.

## How to read it

The window shows a live preview of the design as needles go in, a **scan plot**
of the P-function versus position for the top candidate materials (the deepest
dip marks the best place to insert), and a per-cycle merit history. When you
click Done the final design is committed to the active design.

Needle can stall when the topology change it needs is a thick spacer rather
than a thin needle; [Gradual Evolution](/synthesis/gradual-evolution/) escapes
those cases with its forced-insertion step, so a common pattern is a few Needle
cycles, then Gradual Evolution, then Needle again.

## References

- Sullivan & Dobrowolski, *Appl. Opt.* **35**, 5484 (1996).
- Tikhonravov et al., *Appl. Opt.* **35**, 5493 (1996).
- Tikhonravov et al., *SPIE* **4829** (2003).
