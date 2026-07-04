---
title: History
description: Browse and jump to any previous state of the active design.
ribbonIcon: history
---

The **History** window lists every recorded state of the active design and lets
you jump to any of them. It is the same per-design timeline that backs Ctrl+Z
and Ctrl+Y, shown as a clickable list — a generalized undo/redo. Click any row
and the design returns to that exact state; the past and future are rebuilt
around your choice so undo and redo keep working from there.

States are listed newest first, and the current state is highlighted.

## How to read it

| Column     | Meaning                                       |
| ---------- | --------------------------------------------- |
| **#**      | Position in the timeline.                      |
| **State**  | Whether the row is the oldest state, an earlier (undo) state, the **current** state, or a later (redo) state. |
| **Layers** | Layer count at that snapshot.                  |
| **MF**     | Merit-function value at that snapshot.         |

The Layers and MF columns let you spot where the design changed and how the
merit moved — for example, the moment a synthesis run added layers and dropped
the merit. A row with no operands defined shows a dash for MF.

The timeline holds up to 50 states per design and is saved with the project, so
your history is still there the next time you open the app. Refinement, Needle
and Gradual Evolution each add a single checkpoint when they start and stream
their iterations as previews, so one Ctrl+Z reverts a whole run rather than
stepping back through every iteration.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Ch. 13 (iterative refinement of multilayer designs).
