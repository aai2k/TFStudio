---
title: Gradual Evolution (GE)
description: Needle optimization with a forced structural step each time it stalls, to get out of local minima.
ribbonIcon: gradual
---

**Gradual Evolution** grows a design the way [Needle Variation](/synthesis/needle/) does and adds one thing: when no needle helps any more, it changes the structure on purpose and carries on. Its main move, the **forced step**, puts a thin layer at the entrance or the exit of the stack; the merit usually rises for a moment, and the needles that follow use the extra thickness to take it lower than before. That is how it gets out of a local minimum that needles alone cannot leave. It keeps the best design it has seen and ends on it.

<!-- shot: gradual | a finished Gradual Evolution run on a multilayer target: the readout with GE steps, MF Trend with the forced steps as triangles, Accepted Improvements with Needle, GE and Clean rows, and Top Designs -->

![Flow chart of a Gradual Evolution run. After Run, the merit rows are prepared and the starting design is scored or refined. Each cycle resamples the band rows and runs a needle phase on each scanned side; a candidate that beats the working design is accepted. When none does, the design without its parked layers is kept if it is a new best; otherwise the run takes a structural step: a forced floor-thick layer at either end, freeing a layer, or with Deep search a perturbation of the best design. The run ends when the best MF is below Target MF, when the GE steps are used up, or when nothing is left to try, and the best design is then consolidated.](/diagrams/gradual-evolution.svg)

A forced layer of the same material as the outer layer it lands on only thickens that layer, and the refining that follows can take it straight back. When that happens and no new best came of it, the same step is not taken again on the same structure until a new best. Freeing a layer is tried once per run for each structure it leaves; a Deep search restart opens both again. With **Surface** at **Both**, both faces are scanned, the one with fewer layers first.

## Computed quantities

- **MF** and **OMF**: as in [Needle](/synthesis/needle/#computed-quantities). Gradual Evolution keeps the `MNT` and `MXT` rows in its MF, so a layer held below an `MNT` row costs merit.
- **GE steps**: the structural steps taken so far, forced steps, freed layers and perturbations.
- **Type** of a row in Accepted Improvements: **Start** or **Seed**, the starting design; **Needle**, a needle that stays as a layer of its own; **Refine**, a needle that joined a neighbour of its material and so only changed thicknesses, folded into the row before it when that row is the run's own Needle or Refine row; **GE**, a forced step as it left the design; **Clean**, parked layers dropped, a freed layer or the consolidation at the end; **Perturb**, a Deep search restart.
- **ΔMF**, **TOT** and **Top Designs**: as in Needle. MF Trend marks the forced steps as triangles.

## Controls and settings

**Run**, **Stop**, **Reset**, **Best**, **Clear history**, **Restore** and **Candidate materials**: as in [Needle](/synthesis/needle/#controls-and-settings).

**Max layers**: the most layers the design may hold. Reaching it does not end the run: only needles that fit are taken, and freeing a layer comes before a forced step. 50 by default.

**Target MF**: stop once the best MF falls below this value; 0 runs until the GE steps are used up or nothing is left to try.

**Min thickness (nm)**: the floor every layer is held at, the thickness of a forced layer, the thinnest a needle starts, and the smallest part a split layer may leave. It follows the strictest `MNT` row, or 15 nm without one, until you type a value for the design.

**Smart starting design**: start from the best of the design and the quarter- and half-wave antireflection designs built from the pool, each refined first. It acts only with **Thick-seed handling** at **Refine seed**.

**Deep search**: when nothing is left to try, restart from the best design with every unlocked thickness perturbed, within 10 % after a new best and twice as far each time nothing better comes, up to 80 %. **Max GE cycles** then does not apply: the run ends at the **Target MF** or on **Stop**.

**Refine iter / gen**: the refinement each candidate insertion gets, in two passes, the second with half the steps; at most 15 steps a pass with Preserve bulk. 30 by default.

**Max GE cycles**: how many structural steps the run may take in all. 16 by default.

**Synthesis refiner**: the method that refines between steps; **Conjugate Gradient** by default for Gradual Evolution. See [Optimization Methods](/synthesis/optimization-methods/).

**Candidate search**, **Needle sensitivity** and **Threads**: as in Needle.

**Thick-seed handling**: **Preserve bulk + gentle refine** (the default) scores the starting design without refining it and caps each pass at 15 steps, so the needles divide the bulk of a thick starting layer; **Refine seed** refines it first and each step in full.

**Consolidate on finish** and **Consolidate tol, %**: whether a run that ends on its own cleans the best design, and how far the MF may rise above its lowest value for a layer to go (5 % by default).

A `PPEF` row, and any math row that reads it, is left out as in Needle; a [Refinement](/synthesis/refinement/) run afterwards brings the peak-to-peak error down.

## How it is computed

### Merit and needle function

The needle function P, its averaging over polarization, angle and cone, and the line search for a needle's starting thickness are those of [Needle](/synthesis/needle/#needle-function), with the probe needle at 0.5 nm. The scan and the choice of a forced layer use the optical merit OMF; the refinement and every comparison use the MF.

### Steps and acceptance

```
needle accept:   MF_cand < MF_work − 10⁻⁹
refinement:      N, then ⌊N/2⌋ steps after a needle;  N = Refine iter / gen,
                 or min(Refine iter / gen, 15) with Preserve bulk
parked layers:   d_j = d_min,  ∂MF/∂d_j > 0,  not locked;  dropped when MF_without < MF_best
forced step:     a layer of d_min, material a, at position 0 or N_L; the pair with the lowest OMF
freeing:         take out the layer j with the lowest MF after the rest is refined (N steps)
perturbation:    d_j → max(d_min, d_j · (1 + s·u)),  u uniform in [−1, 1],  s = 0.1, 0.2, 0.4, 0.8
consolidation:   take out the layer j with the lowest MF_without, while MF_without ≤ (1 + tol) · MF_lowest
```

MF_work is the working design, which a forced step can leave worse than MF_best, the best so far; d_min is **Min thickness** and N_L the number of layers on the side. A perturbation is refined with the full **Refine iter / gen**, and its random numbers come from a fixed seed, so a run replays the same way.

Tikhonravov et al. raise the total optical thickness after each needle optimization with an algorithm of their own and stop at a layer-count or thickness limit. Here the forced step is Sullivan and Dobrowolski's layer added at the entrance or exit, gradual evolution in its basic form (Macleod), and **Max layers** frees a layer instead of ending the run. Their thin-layer removal and design cleaning keep the total optical thickness by giving the removed layer a neighbour's index; here freeing and consolidation take the layer out with its thickness, and refinement restores what the merit wants. Deep search is basin hopping (Wales and Doye).

## References

- A. V. Tikhonravov, M. K. Trubetskov and G. W. DeBell, *Appl. Opt.* **46**, 704 (2007): gradual evolution with needle optimization, thin-layer removal and design cleaning.
- B. T. Sullivan and J. A. Dobrowolski, *Appl. Opt.* **35**, 5484 (1996): layers added at the entrance or exit when needles stall.
- A. V. Tikhonravov, M. K. Trubetskov and G. W. DeBell, *Appl. Opt.* **35**, 5493 (1996): the needle optimization technique.
- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Chapter 3 (automatic design: gradual evolution and the needle variation method).
- D. J. Wales and J. P. K. Doye, *J. Phys. Chem. A* **101**, 5111 (1997): basin hopping.
