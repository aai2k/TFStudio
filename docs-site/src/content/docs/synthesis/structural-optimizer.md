---
title: Structural Optimizer
description: Restructure the stack by adding, removing, splitting, merging or perturbing layers, with a simulated-annealing accept.
ribbonIcon: structural
---

The **Structural Optimizer** searches over the *structure* of a design rather
than just its thicknesses. Each step it randomly mutates the layer stack by
**adding, removing, splitting, merging,** or **perturbing** a layer,
re-refines the result, and decides whether to keep it using a
simulated-annealing rule. Because it can change the number and arrangement of
layers, it reaches designs that fixed-structure
[Refinement](/synthesis/refinement/) and even the insertion-based
[Needle](/synthesis/needle/) and [Gradual Evolution](/synthesis/gradual-evolution/)
tools cannot.

Each generation it proposes several mutations of the current design, refines
each one, and takes the best of the batch. A worse design may still be accepted
with a probability set by a temperature that cools as the run progresses, and this
is what lets the search climb out of a local minimum. The live design always
tracks the best result found, so stopping, resetting, or switching tabs always
leaves you on the best design. The wavelength grid the band targets are sampled
on is sized from the design and grows with it during the run (see
[Operand Reference](/design/operands/#optical-band-average-single-target)).

| Mutation | Effect |
| -------- | ------ |
| **Add**     | Insert a new layer (material from the pool) at a random position. |
| **Remove**  | Delete a layer. |
| **Split**   | Cut one layer into two. |
| **Merge**   | Combine adjacent layers. |
| **Perturb** | Jitter a layer's thickness. |

Locked layers are never touched, and thickness bounds are always respected.

## Settings

**Candidate pool**: the materials the *add* and *split* operators may use
(**All / Clear**).

**Mutation kinds**: toggles for which operators the search is allowed to use.

**Max iter**: the most generations to run.

**Target MF**: stop once the merit function reaches this value.

**T₀ (temperature)**: the starting annealing temperature. Higher values accept
more uphill moves early on, which widens the search.

**Jitter**: the thickness perturbation scale for the *perturb* operator.

**Refine iterations**: how many refinement steps are applied to each proposed
design.

**dMin**: the minimum thickness for layers that are added or split.

**Max add / Max layers**: caps on how far the design may grow.

**Parallel K**: how many proposals are refined together each generation.

**Inner refiner**: which method refines each proposal. See
[Optimization Methods](/synthesis/optimization-methods/) for the choices.

**Random seed**: the number the mutations, the accept rolls and the reheat
kicks draw from. Leave it empty and **Run** fills it with a new seed and keeps
it there, so running again with the same seed, design, settings and
**Parallel K** repeats the run. Clear the field to draw afresh. The history
marks each run with its seed.

The merit function's `MNT` and `MXT` rows hold during the search: the largest
`MNT` target raises **dMin**, and the smallest `MXT` target caps every layer,
both for the proposals and for their refinement. A limit written for a few
layers therefore applies to the whole stack here; finish with a
[Refinement](/synthesis/refinement/) and
[Design Cleaner](/synthesis/design-cleaner/) pass to hold each limit on its own
layers.

## How to read it

The **MF trend** chart plots both the best and the current merit against
generation, and an **accepted-improvements history** lists each new best
alongside the mutation that produced it. A **Pareto / Top-Designs** panel lets
you compare the best designs found. **Best** restores the global best at any
time.

The tool shines on designs with room to restructure (for example a multi-layer
anti-reflection coating); on a single-layer design there is nothing structural
to do, so use Refinement instead. A good pattern is to run it to discover a
better topology, then finish with Refinement at your manufacturing floor.

## References

- S. Kirkpatrick, C. D. Gelatt, M. P. Vecchi, *Science* **220**, 671 (1983).
- A. V. Tikhonravov & M. K. Trubetskov, *Appl. Opt.* **51**, 7319 (2012).
- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Ch. 9.
