---
title: Refinement
description: Adjust layer thicknesses to minimize the merit function, with a choice of optimization methods.
ribbonIcon: refinement
---

**Refinement** moves your layer thicknesses to minimize the merit function.
It never adds or removes layers — only their thicknesses change. This is the
everyday workhorse: fast, robust, and the natural finishing pass after any
synthesis run or hand edit.

It minimizes the operand set you defined in the
[Merit Function Editor](/design/merit-function-editor/), using the method you
pick from a dropdown. The default is **SQP**, which treats a minimum
thickness as a hard limit, but you can switch to several other local and
global methods. The variables that move follow the surface mode set in the
[Design Editor](/design/design-editor/) (front, back, both, or symmetric), and
every method works in every mode.

For a description of each method and guidance on when to choose it, see
**[Optimization Methods](/synthesis/optimization-methods/)**.

## Settings

**Method** — the optimizer to run: SQP, Damped Least Squares, Conjugate
Gradient, Newton, Newton-CG, DLS multi-start, Differential Evolution,
Simulated Annealing, or **Try all — keep best**. Your choice is remembered
across designs.

**Max iter** — the most steps the optimizer may take. The run still stops
early when it converges, so this is just a cap. It defaults to a sensible
budget for the selected method.

**Restarts (N)** — for DLS multi-start only: how many randomly perturbed
starts to run before keeping the best (typically 4–8, or more for a tough
surface).

**Perturbation** — for DLS multi-start only: how much to jitter each layer's
thickness (as a percentage) at the start of every restart.

The surface mode and merit-evaluation mode in effect are shown as badges on
the window.

## How to read it

While the run is live you see the spectrum update and a running merit-function
readout (current value, best so far, and the starting value). The **MF trend**
chart plots the best merit found against iteration on a logarithmic axis — a
steadily falling curve that flattens out means the method has settled into a
minimum.

**Reset** returns to the thicknesses you had before the run, and a single undo
covers the whole run. The **History** panel keeps a snapshot of each run so you
can jump back to any earlier result.

A single-start run (N = 1) is usually enough to re-settle a hand-edited stack.
After a synthesis pass, a multi-start run helps confirm you have reached the
true local minimum rather than an improved-but-not-bottom point. Minimum and
maximum thickness limits are honoured here (they are deliberately relaxed
during Needle and Gradual Evolution synthesis).

## References

- K. Levenberg, *Quart. Appl. Math.* **2**, 164 (1944); D. Marquardt, *J. SIAM* **11**, 431 (1963).
- J. Nocedal & S. Wright, *Numerical Optimization*, 2nd ed.
- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., §13.
