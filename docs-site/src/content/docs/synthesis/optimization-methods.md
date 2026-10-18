---
title: Optimization Methods
description: "Every refinement and synthesis algorithm in TFStudio: what each does, when to pick it, and what a grand cross-optimizer benchmark found."
---

TFStudio ships a full toolbox of optimizers. This page explains what each one
is, when to reach for it, and summarizes the benchmark we ran across every
method to set the defaults.

There are two fundamentally different jobs:

- **Refinement**: *fixed structure*, move only the layer **thicknesses**
  to minimize the merit function. Never adds or removes layers.
- **Synthesis**: *changes the structure*: inserts, removes, splits or
  merges layers to find a better topology.

All methods minimize **exactly the same merit function** (the operand set
from the [Merit Function Editor](/design/merit-function-editor/)) and
honor the **surface mode** set in the [Design Editor](/design/design-editor/)
(front_only / back_only / both_independent / symmetric).

---

## Refinement methods

Pick the method from the dropdown in the [Refinement](/synthesis/refinement/)
window. They split into **local** (follow the merit-function slope down
from your current design) and **global** (search broadly, gradient-free).

### Local refiners

| Method | What it is | Best for |
| ------ | ---------- | -------- |
| **Sequential QP (SQP)** ⭐ default | Bounded Newton step with the thickness limits (see below) as **hard constraints** (box-QP, exact bound satisfaction, no penalty tuning). | **The default.** Holds a min-thickness as a hard limit, and was far ahead of the other local refiners on the hardest constrained case of the benchmark. No local refiner wins every case, so when SQP stalls, try CG or Try all, keep best. |
| **Damped Least Squares (DLS)** | Levenberg–Marquardt, the classic thin-film least-squares refiner. QR-solved damped step, exact analytic Jacobian. | The robust classic; called after every synthesis step. Close to the best without a min-thickness, well behind with one. |
| **Conjugate Gradient (CG)** | Polak–Ribière⁺ gradient-only method (Nocedal & Wright §5.2), exact analytic ∇MF, projected backtracking line search. | Polishing a decent design. The best local refiner on the beam splitter and the three-line bandpass of the benchmark, with and without a min-thickness; the preferred inner refiner for Needle. |
| **Newton** | Second-order. Exact analytic Hessian (JᵀJ + curvature) when scoring a single side; Gauss-Newton (JᵀJ) for full-filter (Both / symmetric). | A quadratic endgame in the fewest iterations: small stacks, near the minimum, when you want the last digits. |
| **Newton-CG** | Truncated Newton, matrix-free; solves the Newton step with inner CG using Hessian-vector products (no dense Hessian). | **Second-order steps without forming the Hessian.** Best of the local refiners on the unconstrained multi-passband case. |

**Thickness limits.** No method has a built-in maximum layer thickness: a layer can grow as thick as the merit function asks, which is what half-wave layers in the infrared and thick cavity spacers need. For an upper limit, add an `MXT` row in the [Merit Function Editor](/design/merit-function-editor/); for a manufacturing floor, an `MNT` row. SQP holds `MNT` and `MXT` as hard limits, so no step leaves them. The other methods carry them as penalty terms in the merit function, which stay at zero while the limit holds. Every method also keeps each layer at or above a minimum thickness: 1 nm in Refinement, the **Min thickness** setting in the synthesis windows. DLS, Newton and Newton-CG hold a layer on that floor for as long as the merit pushes it thinner and release it as soon as the merit pulls it back, so the step is spent on the layers that can move.

### Global refiners

| Method | What it is | Best for |
| ------ | ---------- | -------- |
| **DLS multi-start** | Runs DLS from **N** randomly-perturbed starts, keeps the best. | Escaping shallow local minima around a known-decent design. |
| **Differential Evolution (DE)** | Storn & Price (1997) population search, gradient-free; runs in parallel across your CPU cores. | **Poor / unknown starting point**, multimodal targets. |
| **Simulated Annealing (SA)** | Kirkpatrick (1983), accepting uphill moves with probability `exp(−ΔMF/T)`, then cooling. | Rugged merit surfaces where you need to climb out of deep wells. |
| **Try all, keep best** | Runs every method from the same start and keeps the lowest MF (DLS multi-start last, as it's the slowest). | When you don't want to choose and would rather let TFStudio pick the winner. |

> **All methods work in all surface modes.** Newton / Newton-CG / SQP use
> the full analytic Hessian for a single side and Gauss-Newton for coupled
> full-filter evaluation, with no silent fallback.

---

## Synthesis methods

These change the *number* of layers. See each tool's page for details.

| Tool | What it does | Default inner refiner |
| ---- | ------------ | --------------------- |
| **[Needle](/synthesis/needle/)** | Inserts infinitesimal "needle" layers where the **P-function** says the merit improves, then refines. | **CG**, which keeps the design "loose" so the scan keeps finding improving needles (a heavier refiner over-refines and the loop stops early). |
| **[Gradual Evolution](/synthesis/gradual-evolution/)** | Needle optimization wrapped in an outer loop that **forces** a needle in (even uphill) to escape local minima. | **CG**, which does not stall on demanding multi-passband targets the way a least-squares refiner can, and the forced step escapes the minimum it lands in. |
| **[Structural Optimizer](/synthesis/structural-optimizer/)** | Randomly **add / remove / split / merge / perturb** layers with a simulated-annealing accept. | **CG**. Best **layer-efficiency** in the benchmark. |

The per-tool inner refiner is selectable; the defaults above are
benchmark-confirmed on real designs.

---

## How to choose

```
One method for most designs?       → SQP   (the default)
No min-thickness, want the classic?→ DLS
Decent design to polish?           → CG    (or Newton-CG)
Near the minimum, want last digits?→ Newton-CG  (or Newton on small stacks)
Hard min-thickness to respect?     → SQP   (handles bounds natively)
Bad / unknown start, multimodal?   → DE    (or SA on a rugged surface)
Too few layers for the target?     → Synthesis: Needle → GE → Structural
Not sure?                          → Try all, keep best
```

A reliable full workflow:

> **Synthesize unconstrained → Refine with your min-thickness on → [Design Cleaner](/synthesis/design-cleaner/) → Refine again.**

---

## The grand benchmark

To set the defaults and the guidance on this page, we ran every method across a
fixed set of representative designs (a broadband anti-reflection coating, a
50/50 beam splitter, a three-line bandpass, a shortpass edge filter, and a
demanding multi-passband filter) and measured the final merit function, the
run time, and the resulting layer count, both unconstrained and with a
realistic minimum-thickness limit.

### What it found

- **No local refiner wins every case.** SQP, the **default**, treats a min-thickness as a hard box constraint and was far ahead on the hardest constrained case, the multi-passband with a 40 nm floor (MF 0.235 where the others reached 0.51 to 0.56). CG was the best local refiner on the beam splitter and the three-line bandpass, with and without the floor; with it, CG reached MF 0.009 on the beam splitter where SQP stopped at 0.067. DLS, Newton and SQP tied on the shortpass edge.
- **The global refiners escape local minima**: on the broadband AR, DE reached MF 0.012 and DLS multi-start 0.008, where plain DLS stopped at 0.118.
- **Synthesis wins raw MF**: tools that grow layers (Needle / GE) reach
  lower merit than any fixed-structure refiner, given enough layers.
- **Structural Optimizer gives the best layer-efficiency**: the lowest MF
  *per layer*.
- **The `dMin` 1 ↔ 40 trade-off is real and visible**: `dMin = 1 nm` lets
  synthesis reach a lower MF (more, thinner layers); a manufacturable floor
  raises MF but yields a buildable stack. Synthesize at `dMin = 1`, then
  enforce your real floor in a Refinement + Cleaner pass.
- **Constraint behavior is tool-specific and deliberate:** **Needle ignores
  MNT** by design (an MNT penalty would wipe every improving candidate),
  **GE respects MNT**, and Structural / Refinement respect it via the
  penalty.

## Speed

Two things make every method faster without changing its results:

- **Parallel processing**: multi-start refinement, Differential Evolution,
  and synthesis candidate searches spread their work across your CPU cores,
  so they stay responsive on large designs.
- **Hardware-accelerated math**: the core optical calculation runs through
  an optimized engine (on by default; *Settings → Performance*), giving a
  large speed-up on every optimization.

---

## References

- K. Levenberg, *Quart. Appl. Math.* **2**, 164 (1944); D. Marquardt,
  *J. SIAM* **11**, 431 (1963), DLS / Levenberg–Marquardt.
- J. Nocedal & S. Wright, *Numerical Optimization*, 2nd ed., §5.2 (CG),
  Ch. 6–7 (Newton / truncated Newton), Ch. 18 (SQP).
- R. Storn & K. Price, *J. Global Optim.* **11**, 341 (1997), Differential Evolution.
- S. Kirkpatrick, C. D. Gelatt, M. P. Vecchi, *Science* **220**, 671 (1983), Simulated Annealing.
- A. V. Tikhonravov et al., *Appl. Opt.* **35**, 5493 (1996) & **46**, 6936 (2007), needle / gradual evolution.
- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Ch. 9 & §13 (synthesis & refinement overview).
