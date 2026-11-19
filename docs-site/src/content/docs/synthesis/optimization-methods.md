---
title: Optimization Methods
description: "How each refinement method moves the layer thicknesses, shown on one merit map, and the update rule each one uses."
---

Refinement moves the thicknesses of a fixed stack to lower the merit function; synthesis changes the layers themselves. Every method lowers the same merit function, the rows of the [Merit Function Editor](/design/merit-function-editor/), and works in every surface mode of the [Design Editor](/design/design-editor/).

## The map in the figures

Each figure is the merit function of a two-layer antireflection coating on BK7, MgF₂ facing the air over Ta₂O₅, with one `RGT` row holding R at 0 % from 450 to 650 nm. Every point is one design, and the paler the colour, the lower its merit. Each method starts from 160 nm of MgF₂ on 200 nm of Ta₂O₅ and runs as the [Refinement](/synthesis/refinement/) window runs it. Two layers make only a weak antireflection coating; the case is here because two thicknesses fit on a flat map.

## Merit, slopes and bounds

| | Formula | Note |
| --- | --- | --- |
| residuals | $r_p = \sqrt{w_i}\, m_i / \sigma_i$ | one per row; a range target (TGT, RGT, AGT) gives one per sampled wavelength, $\sqrt{w_i q_s}\, m_s$ |
| merit | $\mathrm{MF} = \sqrt{\sum_p r_p^2 / W}$ | $W = \sum w_i$ over the rows that score |
| Jacobian | $J_{pk} = \partial r_p / \partial d_k$ | from the layer matrices; central differences for a row without one |
| gradient | $g = \nabla\mathrm{MF} = J^T r / (W \cdot \mathrm{MF})$ | |
| Hessian | $H = J^T J + \sum_p r_p \nabla^2 r_p$ | $J^T J$ alone where the curvature is not available |

$m_i$ is how far row $i$ misses its target, $w_i$ its weight and $\sigma_i$ its scale, as in the Merit Function Editor; $m_s$ is the miss at sample $s$ of a band and $q_s$ its trapezoid weight. $H$ has its curvature term when the merit is scored on one side alone, in one environment, with no cone, and with no math, color, ellipsometry, field or curve-block row and no row with a $\sigma$ of its own (dB, phase, group delay).

| | Formula | Note |
| --- | --- | --- |
| floor | $d_k \ge 1\ \text{nm}$ | no upper limit unless an MXT row sets one |
| MNT, MXT | | hard limits in SQP; penalty rows of the merit in every other method, zero while the limit holds |
| held layer | | a layer on a bound whose slope pushes it out sits out the step (DLS, Newton, Newton-CG, Trust-region Newton) |
| step span | $\lvert\Delta d_k\rvert \le s_k = \lambda_{\max} / (2\,\lvert\tilde n_k(\lambda_{\max})\rvert)$ | (DLS, Newton, Newton-CG, SQP, CG's first probe) |

$\lambda_{\max}$ is the longest wavelength the merit samples. A layer a half wave thicker gives the same R and T at that wavelength (Macleod, Eq. 2.111), so the slopes a step is built on say nothing past $s_k$. Locked layers never move.

## Refinement methods

### Sequential QP

The default. Each step minimizes a quadratic model of the merit inside a box made of the 1 nm floor, the `MNT` and `MXT` rows and the step span, so no step leaves a thickness limit.

![Sequential QP from the start at 160 nm MgF₂, 200 nm Ta₂O₅: a few short moves into the nearest valley, near 97 nm MgF₂ and 249 nm Ta₂O₅.](/diagrams/optimization/refine-sqp.gif)

| | Formula | Note |
| --- | --- | --- |
| model | $q(\Delta) = \tfrac12\, \Delta^T (H + \mu\,\lvert\operatorname{diag} H\rvert)\,\Delta + (J^T r)^T \Delta$ | |
| box | $\mathrm{lo}_k \le d_k + \Delta_k \le \mathrm{hi}_k,$<br>$\lvert\Delta_k\rvert \le s_k$ | $\mathrm{lo},\ \mathrm{hi}$ from 1 nm and the MNT and MXT rows |
| solve | | primal active set; at its pass cap, the lower of its point and the Cauchy point; $\mu \times 10$ while the matrix is not positive definite, at most 12 times, then one DLS step |
| accept | | $\mathrm{MF}(d + \Delta) < \mathrm{MF}(d):\ \mu \leftarrow \max(0.3\mu,\, 10^{-6});$ otherwise $\mu \leftarrow \min(10\mu,\, 10^{8})$ $\mu_0 = 10^{-3}$ |
| stop | | $\mu = 10^{8};$ $\mathrm{MF} < 10^{-7};$ Max iter (200) |

### Damped Least Squares

Each step solves the linearized least-squares problem for all residuals at once, with a damping term that shortens the step until the merit falls (Levenberg-Marquardt).

![Damped Least Squares from the same start: the first step overshoots the valley floor, the next ones are shorter, and it stops near 97 nm MgF₂, 249 nm Ta₂O₅.](/diagrams/optimization/refine-dls.gif)

| | Formula | Note |
| --- | --- | --- |
| step | $\begin{bmatrix} J \\ \sqrt{\lambda M} \end{bmatrix} \Delta = \begin{bmatrix} -r \\ 0 \end{bmatrix},$<br>$M = \operatorname{diag}(J^T J)$ | by QR the same $\Delta$ as $(J^T J + \lambda M)\,\Delta = -J^T r$ $\Delta$ scaled down so that no $\lvert\Delta_k\rvert > s_k$ |
| accept | | $\mathrm{MF}(d + \Delta) < \mathrm{MF}(d):\ \lambda \leftarrow \max(\lambda/2,\, 10^{-8});$ otherwise $\lambda \leftarrow \min(5\lambda,\, 10^{8})$ $\lambda_0 = 10^{-2}$ |
| stop | | $\lambda = 10^{8};$ $\mathrm{MF} < 10^{-7};$ after an accepted step, the actual and the predicted fall of $\sum r^2$ both $\le \sqrt{\varepsilon}$ with the actual $\le 2 \times$ the predicted, or $\lVert M^{1/2}\Delta\rVert \le \sqrt{\varepsilon}\,\lVert M^{1/2} d\rVert;$ Max iter (500) |

The predicted fall is $1 - \lVert r + J\Delta\rVert^2 / \lVert r\rVert^2$, and $\varepsilon = 2.2 \cdot 10^{-16}$: the stopping tests of MINPACK's lmder.

### Conjugate Gradient

Each step picks a direction from the slope and the previous direction, then takes the lowest merit it finds along that line.

![Conjugate Gradient from the same start: two line searches reach the valley near 97 nm MgF₂, 249 nm Ta₂O₅.](/diagrams/optimization/refine-cg.gif)

| | Formula | Note |
| --- | --- | --- |
| direction | $\beta = \max\!\left(0,\ \dfrac{g_k^T (g_k - g_{k-1})}{g_{k-1}^T g_{k-1}}\right),$ | $\beta = 0$ every $n$ steps ($n$ free layers, at least 2) $p_k = -g_k + \beta\, p_{k-1},$ or $-g_k$ when $g_k^T p_k \ge 0$ |
| search | | first $\alpha$: where the first layer along $p$ has moved by its span $s_k$, or $4 \times$ the last $\alpha$ if shorter; halve $\alpha$ until $\mathrm{MF}(P(d + \alpha p)) \le \mathrm{MF}(d) + 10^{-4}\, g^T (P(d + \alpha p) - d)$, go on halving while MF falls, keep the lowest; $P$ clamps to 1 nm |
| restart | | a failed search is tried again along $-g$ with a fresh first $\alpha$; after 12 steps in a row that each gain under $10^{-7}$ of MF, start again from the best point, at most 8 times |
| stop | | $\lVert g\rVert < 10^{-9};$ 4 failed searches in a row; a plateau after a restart that gained under $10^{-7};$ $\mathrm{MF} < 10^{-7};$ Max iter (600) |

As the inner refiner of the synthesis windows, CG starts each search from a scan up to 2000 nm instead of the span and has no restarts.

### Newton

Each step solves the Newton equations with the full second derivative of the merit, damped until the matrix is positive definite.

![Newton from the same start: its first step reaches the 1 nm floor of MgF₂, then it follows the valley floor to 94 nm MgF₂, 121 nm Ta₂O₅.](/diagrams/optimization/refine-newton.gif)

| | Formula | Note |
| --- | --- | --- |
| step | $(H + \mu\,\lvert\operatorname{diag} H\rvert)\,\Delta = -J^T r$ | by Cholesky; $\mu \times 10$ until it factors, at most 12 times, then one DLS step; $\Delta$ scaled to the spans, the trial clamped to 1 nm |
| accept | | MF falls: $\mu \leftarrow \max(0.3\mu,\, 10^{-6});$ otherwise $\mu \leftarrow \min(10\mu,\, 10^{8})$ $\mu_0 = 10^{-3}$ |
| stop | | $\mu = 10^{8};$ $\mathrm{MF} < 10^{-7};$ Max iter (200) |

### Newton-CG

Each step solves the Newton equations only roughly, by conjugate gradients inside a trust radius, with second derivatives taken from differences of the gradient, so the Hessian is never formed.

![Newton-CG from the same start: three steps to the valley near 97 nm MgF₂, 249 nm Ta₂O₅.](/diagrams/optimization/refine-newton-cg.gif)

| | Formula | Note |
| --- | --- | --- |
| model | $m(p) = g^T p + \tfrac12\, p^T H p,$<br>$\lVert p\rVert \le \Delta;$<br>$Hv \approx \dfrac{\nabla\mathrm{MF}(d + \varepsilon v) - \nabla\mathrm{MF}(d)}{\varepsilon},$<br>$\varepsilon = 1.5 \cdot 10^{-8}\, (1 + \lVert d\rVert_\infty) / \lVert v\rVert_\infty$ | |
| solve | | Steihaug CG, at most $\min(n, 25)$ iterations, to $\lVert\text{residual}\rVert \le \min(0.5, \sqrt{\lVert g\rVert})\,\lVert g\rVert$, the radius or negative curvature; $p$ scaled to the spans |
| ratio | $\rho = \dfrac{\mathrm{MF}(d) - \mathrm{MF}(d + s)}{-g^T s - \tfrac12\, s^T H s},$ | $s$ the move after clamping to 1 nm |
| radius | | $\rho < 0.25:\ \Delta \leftarrow \Delta/4;$ $\rho > 0.75$ and $\lVert p\rVert > 0.8\Delta:\ \Delta \leftarrow \min(2\Delta,\, 10^{4}\ \text{nm});$ $\Delta_0 = \max(1,\, 0.1\,(1 + \lVert d\rVert_\infty))\ \text{nm}$ |
| accept | | $\rho > 0.1$ and MF falls |
| stop | | 6 steps in a row rejected or with $\lVert g\rVert < 10^{-10};$ $\mathrm{MF} < 10^{-7};$ Max iter (200) |

### Trust-region Newton

Each step minimizes a quadratic model of the merit within $\pm$ a trust radius of every thickness, and can put several layers onto the 1 nm floor at once. It is also the default refiner of Needle and Deep Synthesis, and a choice in Gradual Evolution and the Structural Optimizer.

![Trust-region Newton from the same start: a few steps to the valley near 97 nm MgF₂, 249 nm Ta₂O₅.](/diagrams/optimization/refine-trust-region.gif)

| | Formula | Note |
| --- | --- | --- |
| model | $q(s) = g^T s + \tfrac12\, s^T H s$<br>$1\ \text{nm} \le d_k + s_k,$<br>$\lvert s_k\rvert \le \Delta$ | for $F = \tfrac12 \lVert r\rVert^2,$ $g = J^T r;$ |
| step | | the Cauchy point along the projected $-g$, then at most $2n + 5$ minor iterates: CG on the layers off a bound and a projected search with sufficient decrease 0.01 |
| ratio | $\rho = \dfrac{F(d) - F(d + s)}{-q(s)}$ | |
| radius | | $\rho < 0.25:\ \Delta \leftarrow \Delta/4;$ $\rho > 0.75$ with $s$ on the edge: $\Delta \leftarrow \min(2\Delta,\, 500\ \text{nm});$ $\Delta_0 = 20\ \text{nm}$ |
| accept | $\rho > 10^{-4}$ | |
| stop | | predicted fall $< 10^{-15} F;$ $F = 0;$ an accepted step whose actual and predicted fall are $\le 10^{-10} F;$ a step or radius $\le 10^{-10}\,(10^{-10} + \lVert d\rVert_\infty);$ MF down by under 0.01 % over the last 6 steps; Max iter (200) |

### DLS multi-start

Runs Damped Least Squares from $N$ copies of the start, each with every free thickness scaled at random, and keeps the lowest merit.

![DLS multi-start: twenty restarts from perturbed copies of the start end in several valleys; the best ends near 94 nm MgF₂, 121 nm Ta₂O₅.](/diagrams/optimization/refine-dls-multi.gif)

| | Formula | Note |
| --- | --- | --- |
| start $j$ | $d_{k,j} = \max(1\ \text{nm},\ d_k (1 + f (2u - 1))),$<br>$f = \text{Perturb } {\pm}\text{\%} / 100,$<br>$j = 1 \ldots N$ | $u$ uniform in $[0, 1)$ from restart $j$'s own stream of the Seed, ($N = \text{Restarts};$ 20 and 30 % by default) |
| run | | Damped Least Squares from each start with Max iter (500), several at once on the CPU threads |
| keep | | the restart with the lowest MF |

### Differential Evolution

Keeps a population of designs. Each generation builds a trial for every member from the difference of two other members and keeps it when it scores at least as well.

![Differential Evolution: ten designs spread around the start and gather in the valley near 94 nm MgF₂, 121 nm Ta₂O₅.](/diagrams/optimization/refine-de.gif)

| | Formula | Note |
| --- | --- | --- |
| population | $\mathrm{NP} = \max(10, 5n);$ | member 1 is the start, the others $d_k (1 + 0.5 (2u - 1)),$ at least 1 nm |
| mutation | $v = x_{r_1} + F (x_{r_2} - x_{r_3}),$ | $r_1, r_2, r_3$ distinct and $\ne i,$ $F = 0.7$ |
| crossover | | $\text{trial}_k = v_k$ when $u < \mathrm{CR}$ or $k = k_\text{rand},$ otherwise $x_{i,k};$ $\mathrm{CR} = 0.9;$ clamped to 1 nm |
| selection | | the trial replaces $x_i$ when $\mathrm{MF}(\text{trial}) \le \mathrm{MF}(x_i);$ a generation's trials all come from the old population |
| stop | | no new best in 60 generations; $\mathrm{MF} < 10^{-7};$ Max iter (250) |

With four or more free layers and more than two CPU threads, each generation's trials are scored on several workers at once, with the same result.

### Simulated Annealing

Each sweep tries random moves of every thickness. It keeps a move that lowers the merit, and one that raises it with a probability that falls as the temperature drops (Macleod, Eq. 3.33).

![Simulated Annealing: the walk crosses several valleys while the temperature is high, then settles near 94 nm MgF₂, 121 nm Ta₂O₅.](/diagrams/optimization/refine-sa.gif)

| | Formula | Note |
| --- | --- | --- |
| move | $d'_k = d_k + \max(1\ \text{nm},\ f d_k) \cdot N(0, 1),$<br>$f = \max(0.01,\ 0.15\, T / T_0);$ | clamped to 1 nm |
| accept | | $\Delta\mathrm{MF} \le 0,$ or $u < \exp(-\Delta\mathrm{MF} / T)$ |
| sweep | | $\max(8, 2n)$ moves, then $T \leftarrow 0.95\,T$ |
| $T_0$ | | the mean $\Delta\mathrm{MF}$ of the uphill moves among 20 trial moves from the start ($f = 0.15$), divided by $-\ln 0.8$ |
| stop | | $T < 10^{-7};$ no new best in 100 sweeps; $\mathrm{MF} < 10^{-7};$ Max iter (400) |

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
