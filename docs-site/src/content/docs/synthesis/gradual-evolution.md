---
title: Gradual Evolution (GE)
description: Needle optimization wrapped in an outer loop that forces insertions to escape local minima.
ribbonIcon: gradual
---

**Gradual Evolution** is the most capable synthesis tool. It runs needle optimization to local optimality, then deliberately **forces** a needle insertion even when that briefly raises the merit function, and refines the new state. Forcing an uphill step is what lets the design climb out of a local minimum that plain needle insertion cannot escape. It keeps a running record of the best design seen, so at the end the lowest-merit result is restored and you can review the whole series of designs it passed through.

Each outer cycle runs an inner needle pass to needle-optimality, forces in the best available needle regardless of whether the merit goes up, refines, then prunes sub-threshold layers and merges adjacent same-material layers. This repeats for the number of cycles you set. The wavelength grid the band targets are sampled on is sized from the design and grows with it during the run (see [Operand Reference](/design/operands/#optical-band-average-single-target)).

A forced layer of the same material as the outer layer it lands on only thickens that layer, and the refining that follows can take it straight back. When that happens, Gradual Evolution does not take the same step again on the same structure: the next forced step uses another material or the other end of the stack.

**Max layers** limits how many layers the design may hold; reaching it does not end the run. At the limit Gradual Evolution takes only needles that fit, and when none of them improves the design it frees a layer: it takes out the layer whose removal costs least, refines, and lets the needles place a layer somewhere better. Each freeing shows as a **Clean** row and is tried once per run for the structure it leaves. The run ends when it has used its **GE cycles**, reaches the **Target MF**, or has no forced step or freeing left to try. **Stop** ends it at any time and keeps the best design found.

**Deep search** keeps a run going when it has nothing left to try. Instead of ending, Gradual Evolution starts again from the best design with every unlocked thickness perturbed, refines it, and goes on from there with needles, forced steps and freeings. The first perturbation after a new best is small, within 10 % of each thickness; each one that finds nothing better is twice as large, up to 80 %, and then they start small again. Each shows as a **Perturb** row. With Deep search on, **GE cycles** does not apply: the run ends only when it reaches the **Target MF** or you press **Stop**, and the best design found is kept.

## Settings

**Candidate materials**: the pool of materials Gradual Evolution may insert. **All / Clear** select or empty the pool in one click.

**Max layers**: the most layers the design may hold (see above).

**Target MF**: stop once the merit function reaches this value (0 means run all cycles).

**Deep search**: keep searching until **Stop** or the **Target MF** (see above).

The advanced section exposes the synthesis tuning:

**Refine iterations**: the refinement each candidate insertion gets, in two passes, the second with half the steps. While the bulk of a thick seed is kept (**Seed mode**), a pass is at most 15 steps.

**dMin (nm)**: the insertion floor and prune threshold. Gradual Evolution can push below the minimum thickness limit during its forced step, which is part of how it escapes a tight minimum. A needle inside a layer is offered only where both parts of the split layer stay at or above the floor, and each layer is scanned at 16 positions. A layer that refinement drives down onto the floor is kept while needle insertions still improve the design. When they stop, before the forced step, Gradual Evolution refines the design without its layers on the floor and keeps that version only if it beats the best design so far; it shows as a **Clean** row in the series.

**GE cycles**: how many forced steps and freed layers the run may take in all; this is what ends a long run unless Deep search is on. Typically 20–60.

**Inner refiner**: which method refines the stack between steps. See [Optimization Methods](/synthesis/optimization-methods/) for the choices.

**Candidate search**: how thoroughly each step explores improving candidates (fast, balanced, or thorough).

**Seed mode**: whether to refine the starting stack first or preserve its bulk before growing, which matters when you begin from a thick seed design.

## How to read it

The **design series** is a sortable table of the designs the run recorded, each with its merit function and layer count. The **Pareto chart** plots merit against layer count. Look for the knee, where adding more layers stops buying much improvement, rather than chasing the absolute minimum merit. **Best** restores the all-time-best design, and you can **Restore** any earlier state from the series.

You may sometimes see only needle rows in the series and no forced-step rows. That is expected: Gradual Evolution only forces a step once the inner needle loop is exhausted, so as long as ordinary needle insertions keep improving the design, it stays inside that loop.

A **Needle** row is a needle that stays in the stack as a layer of its own. A needle of the same material as the layer next to it joins that layer, and the step only changes the thicknesses of the layers already there. Such a step updates the Needle or **Refine** row just before it when the run recorded that row since it last started or resumed; otherwise it shows as a Refine row of its own when it gives the best design so far, and has no row when it does not. A **GE** row shows the design as the forced step left it.

A larger candidate pool (three to six materials) often beats simply allowing more layers. In `both_independent` surface mode it grows both sides as it goes.

## References

- Tikhonravov, Trubetskov & DeBell, *Appl. Opt.* **46**, 704 (2007).
- Sullivan & Dobrowolski, *Appl. Opt.* **35**, 5484 (1996).
- Wales & Doye, *J. Phys. Chem. A* **101**, 5111 (1997).
