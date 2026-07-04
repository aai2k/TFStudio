---
title: Gradual Evolution (GE)
description: Needle optimization wrapped in an outer loop that forces insertions to escape local minima.
ribbonIcon: gradual
---

**Gradual Evolution** is the most capable synthesis tool. It runs needle
optimization to local optimality, then deliberately **forces** a needle
insertion even when that briefly raises the merit function, and refines the
new state. Forcing an uphill step is what lets the design climb out of a local
minimum that plain needle insertion cannot escape. It keeps a running record of
the best design seen, so at the end the lowest-merit result is restored and you
can review the whole series of designs it passed through.

Each outer cycle runs an inner needle pass to needle-optimality, forces in the
best available needle regardless of whether the merit goes up, refines, then
prunes sub-threshold layers and merges adjacent same-material layers. This
repeats for the number of cycles you set.

## Settings

**Candidate materials** — the pool of materials Gradual Evolution may insert.
**All / Clear** select or empty the pool in one click.

**Max layers** — an upper limit on how many layers the design may grow to.

**Target MF** — stop once the merit function reaches this value (0 means run
all cycles).

The advanced section exposes the synthesis tuning:

**Refine iterations** — how many refinement steps run after each forced
insertion.

**dMin (nm)** — the insertion floor and prune threshold. Gradual Evolution can
push below the minimum thickness limit during its forced step, which is part of
how it escapes a tight minimum.

**GE cycles** — the number of outer cycles (needle-opt plus a forced step);
typically 20–60.

**Inner refiner** — which method refines the stack between steps. See
[Optimization Methods](/synthesis/optimization-methods/) for the choices.

**Candidate search** — how thoroughly each step explores improving candidates
(fast, balanced, or thorough).

**Seed mode** — whether to refine the starting stack first or preserve its bulk
before growing, which matters when you begin from a thick seed design.

## How to read it

The **design series** is a sortable table of every accepted state, each with
its merit function and layer count. The **Pareto chart** plots merit against
layer count — look for the knee, where adding more layers stops buying much
improvement, rather than chasing the absolute minimum merit. **Best** restores
the all-time-best design, and you can **Restore** any earlier state from the
series.

You may sometimes see only needle rows in the series and no forced-step rows.
That is expected: Gradual Evolution only forces a step once the inner needle
loop is exhausted, so as long as ordinary needle insertions keep improving the
design, it stays inside that loop.

A larger candidate pool (three to six materials) often beats simply allowing
more layers. In `both_independent` surface mode it grows both sides as it goes.

## References

- Tikhonravov et al., *Appl. Opt.* **46**, 6936 (2007).
- Sullivan & Dobrowolski, *Appl. Opt.* **35**, 5484 (1996).
