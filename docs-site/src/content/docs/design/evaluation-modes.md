---
title: Surface & Evaluation Modes
description: The two controls that decide which coating is optimized and what every window evaluates.
---

A coated part can have a coating on each side, and "the performance" can mean
the front coating alone, the back coating alone, or the whole part together.
TFStudio settles both questions — *which coating you are designing* and *what
the numbers mean* — with just two controls in the [Design
Editor](/design/design-editor/). They are the single source of truth: every
other window (Optical Evaluation, the Specification, all the tolerance tools,
and the optimizers) follows them and shows a read-only badge of the result, so
two windows can never score the same design differently.

## The two controls

**Surface** — a `Front / Back / Both` dropdown. It chooses which coating you
are designing and which stack the optimizer is allowed to move. When **Both**
is selected, a **Symmetric (back = front)** sub-checkbox appears; ticking it
links the back coating to an exact mirror of the front, so both sides are
optimized together as one identical stack.

**Ignore other side** — a checkbox. When **checked**, the design is evaluated
as the active surface *alone*, sitting on a semi-infinite substrate with no
back-surface reflection — the standard idealization for designing a single
coating. When **unchecked**, the design is evaluated as the **whole physical
part**: front coating, finite substrate, and back coating, combined together.
The checkbox is disabled for **Both**, because two real coatings are always
evaluated as the full system.

A new design starts at **Front + Ignore other side** — you design one front
coating against air and a semi-infinite substrate, which is the most common
starting point.

## How the two controls combine

The Front and Back tabs in the layer table are always present, but the
*ignored* side's tab goes inactive — you cannot edit a coating you have told
the program to ignore. Its layers stay in the design, dormant, and return the
moment you clear the checkbox.

| Surface | Ignore other side | Front tab | Back tab | Optimizes | **Evaluates** |
| ------- | ----------------- | --------- | -------- | --------- | ------------- |
| Front   | off               | active    | active   | front     | **TOTAL**     |
| Front   | on *(default)*    | active    | inactive | front     | **FRONT** only |
| Back    | off               | active    | active   | back      | **TOTAL**     |
| Back    | on                | inactive  | active   | back      | **BACK** only  |
| Both    | — *(disabled)*    | active    | active   | both      | **TOTAL**     |
| Both + Symmetric | — *(disabled)* | active | inactive *(= front)* | both, linked | **TOTAL** |

"Front, don't ignore" and "Both" both evaluate the total part — the only
difference is what the optimizer is free to move. With Front selected the
optimizer moves only the front coating (any back coating is included but
fixed); with Both it also frees the back stack.

## The badges

Because the two controls live only in the Design Editor, every other window
shows what it is doing as a read-only badge:

- **`Eval: FRONT / BACK / TOTAL`** — appears in Optical Evaluation, Integral
  Values, the Specification, Color, Monte-Carlo, Systematic Deviations, Layer
  Sensitivity, the Variator, Inhomogeneities and Roughness/Scattering. It is the
  *same* value in all of them.
- **`Optimize: FRONT / BACK / BOTH / BOTH (sym)`** — appears additionally in
  the optimizer windows (Refinement, Needle Variation, Gradual Evolution,
  Manual Needle) to show which coating is being moved.

## How the substrate is handled

| Ignore other side | Substrate model | Back surface |
| ----------------- | --------------- | ------------ |
| Checked (single surface) | **Semi-infinite** — light exits into the substrate and never returns | None — no back-surface reflection |
| Unchecked (total) | **Finite and incoherent** — internal reflections combine as intensities | Real: the bare-substrate reflection, or the back coating if one exists |

A single-surface coating designed with "Ignore other side" is evaluated
exactly as the coating in isolation — the correct idealization for that task —
while clearing the checkbox folds in the real back surface to show what the
finished, two-sided part actually does.

These settings are stored on the design, so they save with the project and a
design reopens in the mode it was built in. Integral Values is a whole-part
figure and follows these modes too. The per-surface windows — group delay,
electric field, ellipsometry, the admittance diagram and the refractive-index
profile — instead carry their own **Front / Back** control, since each shows a
single coating on the substrate in isolation. The refractive-index profile adds
a **Total** option that lays the front coating, substrate and back coating out
as one continuous structural (n, k vs depth) profile.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., §2.6.4 (combining a coated substrate's two surfaces incoherently).
