---
title: Optimization Methods
description: "How each refinement method moves the layer thicknesses, shown on one merit map, and the update rule each one uses."
---

Refinement moves the thicknesses of a fixed stack to lower the merit function; synthesis changes the layers themselves. Every method lowers the same merit function, the rows of the [Merit Function Editor](/design/merit-function-editor/), and works in every surface mode of the [Design Editor](/design/design-editor/).

## The map in the figures

Each figure is the merit function of a two-layer antireflection coating on BK7, MgF₂ facing the air over Ta₂O₅, with one `RGT` row holding R at 0 % from 450 to 650 nm. Every point is one design, and the paler the colour, the lower its merit. Each method starts from 160 nm of MgF₂ on 200 nm of Ta₂O₅ and runs as the [Refinement](/synthesis/refinement/) window runs it. Two layers make only a weak antireflection coating; the case is here because two thicknesses fit on a flat map.

## Merit, slopes and bounds

```
residuals   r_p = √w_i · m_i / σ_i              one per row; a range target (TGT, RGT, AGT) gives
                                               one per sampled wavelength, √(w_i q_s) · m_s
merit       MF = √( Σ_p r_p² / W )              W = Σ w_i over the rows that score
Jacobian    J_pk = ∂r_p / ∂d_k                  from the layer matrices; central differences for a row without one
gradient    g = ∇MF = Jᵀr / (W · MF)
Hessian     H = JᵀJ + Σ_p r_p ∇²r_p             JᵀJ alone where the curvature is not available
```

m_i is how far row i misses its target, w_i its weight and σ_i its scale, as in the Merit Function Editor; m_s is the miss at sample s of a band and q_s its trapezoid weight. H has its curvature term when the merit is scored on one side alone, in one environment, with no cone, and with no math, color, ellipsometry, field or curve-block row and no row with a σ of its own (dB, phase, group delay).

```
floor       d_k ≥ 1 nm; no upper limit unless an MXT row sets one
MNT, MXT    hard limits in SQP; penalty rows of the merit in every other method, zero while the limit holds
held layer  a layer on a bound whose slope pushes it out sits out the step (DLS, Newton, Newton-CG, Trust-region Newton)
step span   |Δd_k| ≤ s_k = λ_max / (2 |ñ_k(λ_max)|)   (DLS, Newton, Newton-CG, SQP, CG's first probe)
```

λ_max is the longest wavelength the merit samples. A layer a half wave thicker gives the same R and T at that wavelength (Macleod, Eq. 2.111), so the slopes a step is built on say nothing past s_k. Locked layers never move.

## Refinement methods

### Sequential QP

The default. Each step minimizes a quadratic model of the merit inside a box made of the 1 nm floor, the `MNT` and `MXT` rows and the step span, so no step leaves a thickness limit.

![Sequential QP from the start at 160 nm MgF₂, 200 nm Ta₂O₅: a few short moves into the nearest valley, near 97 nm MgF₂ and 249 nm Ta₂O₅.](/diagrams/optimization/refine-sqp.gif)

```
model    q(Δ) = ½ Δᵀ(H + μ |diag H|) Δ + (Jᵀr)ᵀΔ
box      lo_k ≤ d_k + Δ_k ≤ hi_k,  |Δ_k| ≤ s_k          lo, hi from 1 nm and the MNT and MXT rows
solve    primal active set; at its pass cap, the lower of its point and the Cauchy point;
         μ × 10 while the matrix is not positive definite, at most 12 times, then one DLS step
accept   MF(d + Δ) < MF(d):  μ ← max(0.3μ, 10⁻⁶);  otherwise μ ← min(10μ, 10⁸)      μ₀ = 10⁻³
stop     μ = 10⁸;  MF < 10⁻⁷;  Max iter (200)
```

### Damped Least Squares

Each step solves the linearized least-squares problem for all residuals at once, with a damping term that shortens the step until the merit falls (Levenberg-Marquardt).

![Damped Least Squares from the same start: the first step overshoots the valley floor, the next ones are shorter, and it stops near 97 nm MgF₂, 249 nm Ta₂O₅.](/diagrams/optimization/refine-dls.gif)

```
step     [ J ; √(λM) ] Δ = [ −r ; 0 ] by QR,  M = diag(JᵀJ)        the same Δ as (JᵀJ + λM) Δ = −Jᵀr
         Δ scaled down so that no |Δ_k| > s_k
accept   MF(d + Δ) < MF(d):  λ ← max(λ/2, 10⁻⁸);  otherwise λ ← min(5λ, 10⁸)        λ₀ = 10⁻²
stop     λ = 10⁸;  MF < 10⁻⁷;  after an accepted step, the actual and the predicted fall of Σr² both ≤ √ε
         with the actual ≤ 2 × the predicted, or ‖M^½ Δ‖ ≤ √ε ‖M^½ d‖;  Max iter (500)
```

The predicted fall is 1 − ‖r + JΔ‖² / ‖r‖², and ε = 2.2·10⁻¹⁶: the stopping tests of MINPACK's lmder.

### Conjugate Gradient

Each step picks a direction from the slope and the previous direction, then takes the lowest merit it finds along that line.

![Conjugate Gradient from the same start: two line searches reach the valley near 97 nm MgF₂, 249 nm Ta₂O₅.](/diagrams/optimization/refine-cg.gif)

```
direction  β = max(0, gₖᵀ(gₖ − gₖ₋₁) / gₖ₋₁ᵀgₖ₋₁),  β = 0 every n steps (n free layers, at least 2)
           pₖ = −gₖ + β pₖ₋₁,  or −gₖ when gₖᵀpₖ ≥ 0
search     first α: where the first layer along p has moved by its span s_k, or 4 × the last α if shorter;
           halve α until MF(P(d + αp)) ≤ MF(d) + 10⁻⁴ gᵀ(P(d + αp) − d), go on halving while MF falls,
           keep the lowest;  P clamps to 1 nm
restart    a failed search is tried again along −g with a fresh first α;  after 12 steps in a row that each
           gain under 10⁻⁷ of MF, start again from the best point, at most 8 times
stop       ‖g‖ < 10⁻⁹;  4 failed searches in a row;  a plateau after a restart that gained under 10⁻⁷;
           MF < 10⁻⁷;  Max iter (600)
```

As the inner refiner of the synthesis windows, CG starts each search from a scan up to 2000 nm instead of the span and has no restarts.

### Newton

Each step solves the Newton equations with the full second derivative of the merit, damped until the matrix is positive definite.

![Newton from the same start: its first step reaches the 1 nm floor of MgF₂, then it follows the valley floor to 94 nm MgF₂, 121 nm Ta₂O₅.](/diagrams/optimization/refine-newton.gif)

```
step     (H + μ |diag H|) Δ = −Jᵀr by Cholesky;  μ × 10 until it factors, at most 12 times, then one DLS step;
         Δ scaled to the spans, the trial clamped to 1 nm
accept   MF falls:  μ ← max(0.3μ, 10⁻⁶);  otherwise μ ← min(10μ, 10⁸)        μ₀ = 10⁻³
stop     μ = 10⁸;  MF < 10⁻⁷;  Max iter (200)
```

### Newton-CG

Each step solves the Newton equations only roughly, by conjugate gradients inside a trust radius, with second derivatives taken from differences of the gradient, so the Hessian is never formed.

![Newton-CG from the same start: three steps to the valley near 97 nm MgF₂, 249 nm Ta₂O₅.](/diagrams/optimization/refine-newton-cg.gif)

```
model    m(p) = gᵀp + ½ pᵀHp,  ‖p‖ ≤ Δ;   Hv ≈ (∇MF(d + εv) − ∇MF(d)) / ε,  ε = 1.5·10⁻⁸ (1 + ‖d‖∞) / ‖v‖∞
solve    Steihaug CG, at most min(n, 25) iterations, to ‖residual‖ ≤ min(0.5, √‖g‖) ‖g‖, the radius
         or negative curvature;  p scaled to the spans
ratio    ρ = (MF(d) − MF(d + s)) / (−gᵀs − ½ sᵀHs),  s the move after clamping to 1 nm
radius   ρ < 0.25: Δ ← Δ/4;  ρ > 0.75 and ‖p‖ > 0.8Δ: Δ ← min(2Δ, 10⁴ nm);   Δ₀ = max(1, 0.1 (1 + ‖d‖∞)) nm
accept   ρ > 0.1 and MF falls
stop     6 steps in a row rejected or with ‖g‖ < 10⁻¹⁰;  MF < 10⁻⁷;  Max iter (200)
```

### Trust-region Newton

Each step minimizes a quadratic model of the merit within ± a trust radius of every thickness, and can put several layers onto the 1 nm floor at once. It is also the default refiner of Needle and Deep Synthesis, and a choice in Gradual Evolution and the Structural Optimizer.

![Trust-region Newton from the same start: a few steps to the valley near 97 nm MgF₂, 249 nm Ta₂O₅.](/diagrams/optimization/refine-trust-region.gif)

```
model    q(s) = gᵀs + ½ sᵀHs   for F = ½‖r‖²,  g = Jᵀr;   1 nm ≤ d_k + s_k,  |s_k| ≤ Δ
step     the Cauchy point along the projected −g, then at most 2n + 5 minor iterates: CG on the layers
         off a bound and a projected search with sufficient decrease 0.01
ratio    ρ = (F(d) − F(d + s)) / (−q(s))
radius   ρ < 0.25: Δ ← Δ/4;  ρ > 0.75 with s on the edge: Δ ← min(2Δ, 500 nm);   Δ₀ = 20 nm
accept   ρ > 10⁻⁴
stop     predicted fall < 10⁻¹⁵ F;  F = 0;  an accepted step whose actual and predicted fall are ≤ 10⁻¹⁰ F;
         a step or radius ≤ 10⁻¹⁰ (10⁻¹⁰ + ‖d‖∞);  MF down by under 0.01 % over the last 6 steps;  Max iter (200)
```

### DLS multi-start

Runs Damped Least Squares from N copies of the start, each with every free thickness scaled at random, and keeps the lowest merit.

![DLS multi-start: twenty restarts from perturbed copies of the start end in several valleys; the best ends near 94 nm MgF₂, 121 nm Ta₂O₅.](/diagrams/optimization/refine-dls-multi.gif)

```
start j   d_k,j = max(1 nm, d_k (1 + f (2u − 1))),  u uniform in [0, 1) from restart j's own stream of the Seed,
          f = Perturb ±% / 100,  j = 1 … N  (N = Restarts;  20 and 30 % by default)
run       Damped Least Squares from each start with Max iter (500), several at once on the CPU threads
keep      the restart with the lowest MF
```

### Differential Evolution

Keeps a population of designs. Each generation builds a trial for every member from the difference of two other members and keeps it when it scores at least as well.

![Differential Evolution: ten designs spread around the start and gather in the valley near 94 nm MgF₂, 121 nm Ta₂O₅.](/diagrams/optimization/refine-de.gif)

```
population  NP = max(10, 5n);  member 1 is the start, the others d_k (1 + 0.5 (2u − 1)), at least 1 nm
mutation    v = x_r1 + F (x_r2 − x_r3),  r1, r2, r3 distinct and ≠ i,  F = 0.7
crossover   trial_k = v_k when u < CR or k = k_rand, otherwise x_i,k;  CR = 0.9;  clamped to 1 nm
selection   the trial replaces x_i when MF(trial) ≤ MF(x_i); a generation's trials all come from the old population
stop        no new best in 60 generations;  MF < 10⁻⁷;  Max iter (250)
```

With four or more free layers and more than two CPU threads, each generation's trials are scored on several workers at once, with the same result.

### Simulated Annealing

Each sweep tries random moves of every thickness. It keeps a move that lowers the merit, and one that raises it with a probability that falls as the temperature drops (Macleod, Eq. 3.33).

![Simulated Annealing: the walk crosses several valleys while the temperature is high, then settles near 94 nm MgF₂, 121 nm Ta₂O₅.](/diagrams/optimization/refine-sa.gif)

```
move     d'_k = d_k + max(1 nm, f d_k) · N(0, 1),  f = max(0.01, 0.15 T / T₀);  clamped to 1 nm
accept   ΔMF ≤ 0, or u < exp(−ΔMF / T)
sweep    max(8, 2n) moves, then T ← 0.95 T
T₀       the mean ΔMF of the uphill moves among 20 trial moves from the start (f = 0.15), divided by −ln 0.8
stop     T < 10⁻⁷;  no new best in 100 sweeps;  MF < 10⁻⁷;  Max iter (400)
```

The result is the lowest design met on the way, not the last one.

### Try all, keep best

Runs CG, DLS, Newton, Newton-CG, SQP, Trust-region Newton, DE, SA and DLS multi-start in turn, each from the same start with its own iteration budget, and keeps the lowest merit.

## Synthesis methods

These change the number of layers. See each tool's page.

| Tool | What it does | Default inner refiner |
| ---- | ------------ | --------------------- |
| **[Needle](/synthesis/needle/)** | Inserts thin "needle" layers where the **P-function** says the merit falls, then refines. | **Trust-region Newton**, which ended lower than CG on most of the benchmark's cases and grows the stack without collapsing it. |
| **[Gradual Evolution](/synthesis/gradual-evolution/)** | Needle optimization in an outer loop that **forces** a needle in, even uphill, to leave a local minimum. | **CG**, which does not stall on demanding multi-passband targets the way a least-squares refiner can. |
| **[Structural Optimizer](/synthesis/structural-optimizer/)** | Randomly **adds, removes, splits, merges or perturbs** layers with a simulated-annealing accept. | **CG**. Best **layer efficiency** in the benchmark. |

## How to choose

```
One method for most designs?        → SQP   (the default)
No min-thickness, want the classic? → DLS
Decent design to polish?            → CG    (or Newton-CG)
Near the minimum, want last digits? → Newton-CG  (or Newton on small stacks)
Hard min-thickness to respect?      → SQP   (holds MNT and MXT as hard limits)
Thin layers to fold onto the floor? → Trust-region Newton
Bad / unknown start, multimodal?    → DE    (or SA on a rugged surface)
Too few layers for the target?      → Synthesis: Needle → GE → Structural
Not sure?                           → Try all, keep best
```

A reliable full workflow:

> **Synthesize unconstrained → [Design Cleaner](/synthesis/design-cleaner/) at your min-thickness → Refine with your min-thickness on.**

Clean before the floor goes on: SQP lifts every layer thinner than the floor up to it, so a Cleaner pass after it finds nothing to take out.

## Benchmark

Every method was run on five designs (a broadband antireflection coating, a 50/50 beam splitter, a three-line bandpass, a shortpass edge filter and a demanding multi-passband filter), with and without a realistic minimum thickness.

- **No local refiner wins every case.** SQP, the default, was far ahead on the hardest constrained case, the multi-passband with a 40 nm floor (MF 0.235 where the others reached 0.51 to 0.56). CG was the best local refiner on the beam splitter and the three-line bandpass, with and without the floor; with it, CG reached MF 0.009 on the beam splitter where SQP stopped at 0.067. DLS, Newton and SQP tied on the shortpass edge.
- **The global refiners leave local minima**: on the broadband antireflection coating, DE reached MF 0.012 and DLS multi-start 0.008, where plain DLS stopped at 0.118.
- **Synthesis reaches the lowest merit**: the tools that grow layers (Needle, GE) go lower than any fixed-structure refiner, given enough layers.
- **The Structural Optimizer gives the lowest merit per layer.**
- **`dMin` 1 nm against 40 nm**: 1 nm lets synthesis reach a lower merit with more, thinner layers; a manufacturable floor raises the merit but gives a buildable stack. Synthesize at 1 nm, then enforce the real floor with a Cleaner pass and then Refinement.
- **Each tool treats MNT its own way:** Needle leaves it out (an MNT penalty would wipe out every improving candidate), GE respects it, Structural holds it as a hard floor on every layer, and Refinement holds it as a hard limit with SQP and as a penalty with the other methods.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Section 3.6, pp. 88-97 (automatic design: damped least squares p. 90, direction set methods and simulated annealing, Eqs. 3.32-3.33, p. 91, differential evolution p. 92); Eq. 2.111 (layer matrix).
- K. Levenberg, *Quart. Appl. Math.* **2**, 164 (1944); D. W. Marquardt, *J. SIAM* **11**, 431 (1963): damped least squares.
- J. J. Moré, B. S. Garbow and K. E. Hillstrom, *User Guide for MINPACK-1*, Argonne ANL-80-74 (1980): the lmder stopping tests.
- J. Nocedal and S. J. Wright, *Numerical Optimization*, 2nd ed.: Eq. 3.4 and Algorithm 3.1 (backtracking with sufficient decrease), Algorithm 4.1 (trust radius), Section 5.2 (Polak-Ribière conjugate gradients), Algorithm 7.2 (Steihaug CG), Sections 16.5 and 16.7 (active-set QP, Cauchy point).
- D. P. Bertsekas, *SIAM J. Control Optim.* **20**, 221 (1982): projected Newton methods, the held-layer rule.
- C.-J. Lin and J. J. Moré, *SIAM J. Optim.* **9**, 1100 (1999): the trust-region step with projected searches.
- A. N. Tikhonov, A. V. Tikhonravov and M. K. Trubetskov, *Comp. Maths. Math. Phys.* **33**, 1339 (1993): second-order methods in coating synthesis.
- R. Storn and K. Price, *J. Global Optim.* **11**, 341 (1997): differential evolution.
- S. Kirkpatrick, C. D. Gelatt and M. P. Vecchi, *Science* **220**, 671 (1983): simulated annealing.
- A. V. Tikhonravov, M. K. Trubetskov and G. W. DeBell, *Appl. Opt.* **35**, 5493 (1996) and **46**, 704 (2007): needle optimization and gradual evolution.
