---
title: Needle Variation
description: Insert thin "needle" layers where they lower the merit function, then refine every thickness.
ribbonIcon: needle
---

**Needle Variation** grows a design by putting thin layers, **needles**, where they lower the merit function, refining every thickness, and repeating until no needle helps. Where a needle helps comes from the **needle function** P: how fast the merit function would fall if a vanishingly thin layer of a pool material were slipped in at a given depth. **Needle Automatic** runs the loop on its own; **Needle Manual** lets you put in one needle by hand. Both use the same material pool and the same scan.

## Needle Automatic

<!-- shot: needle | a finished Needle Automatic run on a multilayer target: the readout, MF Trend falling over the generations, Accepted Improvements and Top Designs -->
![Needle Variation](/screenshots/needle.png)

![Flow chart of a Needle Automatic run. After Run, the merit rows are prepared and, if ticked, the smart starting design is chosen. Each cycle resamples the band rows, checks that a layer can still be added, scans the needle function, refines batches of K candidates and accepts the best one that lowers the MF by 0.01 %, after trying it without the layers parked on the floor. The run ends at Target MF, at Max layers, or when it is needle-optimal a second time; the first time, it goes on from a thicker copy of the design.](/diagrams/needle-automatic.svg)

A generation counts only when it lowers the MF by at least 0.01 %, the fall at which each refinement inside it stops too: smaller gains would fill the layer budget with needles that stay about a nanometre thick. A needle has to go into film that is already there, so a thin stack runs out of places before it runs out of improvement; the first time the run is needle-optimal it refines copies two, four, eight and sixteen times thicker and goes on from the lowest, as a **Thicker start** row. If the run never beats the design it had before that, it ends on that design.

## Needle Manual

<!-- shot: needle-manual | P-function profile of a multilayer design with two pool materials, a point below zero picked, the Insertion Preview with d_new and the OMF now and after -->
![Needle Variation](/screenshots/needle-manual.png)

Click a point below zero to pick its position and material. **Apply insertion** puts the needle in at **d_new**, which starts where the same line search as Needle Automatic puts it. With **Refine after insert** on, SQP then refines the stack for up to **Refine iterations** steps, with the `MNT` and `MXT` rows in force. The plot shows every point it computed, including splits that would leave part of a layer below **Min thickness**.

## Computed quantities

- **P**, the needle function: the slope ∂MF/∂d of the merit function for a needle of one pool material at one depth, as its thickness d goes to zero. Below zero, a needle there lowers the MF.
- **MF**: the merit function of the [Merit Function Editor](/design/merit-function-editor/); **OMF**, the same without the thickness rows `TT`, `STR`, `MNT` and `MXT`.
- **ΔMF**: in Accepted Improvements, the change from the best design before the row. **TOT**: the total physical thickness, nm.
- **Top Designs**: the generations that no other generation beats on both layer count and MF.

## Controls and settings

**Run**, **Stop**, **Reset**, **Best**, **Clear history**: Stop pauses, and the next Run carries on in the same run. Reset undoes the last Run press. Best puts the lowest-MF generation on the design, as **Restore** does for any row. Clear history forgets the rows and keeps the design.

**Candidate materials**: the pool of materials Needle is allowed to insert. The pool starts with only the materials of the design's layers ticked, front and back; the substrate and the media are listed under **This design** but unticked, and no other catalog is ticked. **All / Clear** select or empty the pool in one click. Once you change the pool, the window keeps your choice for every design, except that each design's substrate and media stay unticked until you tick them on that design; a pool emptied with **Clear** starts again from the design's own materials the next time the window opens.

**Max layers**: no new cycle starts once the stack holds this many layers. 60 by default.

**Target MF**: stop once the MF falls below this value; 0 runs until the design is needle-optimal.

**Smart starting design**: start from the best of the design and the quarter- and half-wave antireflection designs built from the pool, each refined first. Off by default.

**Needle δ (nm)** (**Probe δ** in Needle Manual): the probe needle for the rows P has no exact slope for, and for the cases where the exact scan does not run. 0.5 nm by default.

**Min thickness (nm)**: the thinnest a needle starts, the floor during refinement, and the smallest part a split layer may leave; 1 nm by default. Keep it there while synthesizing and raise it to your manufacturing minimum only in a later Refinement and [Design Cleaner](/synthesis/design-cleaner/) pass, so a manufacturable floor does not hold synthesis back. A note under the field shows when an `MNT` row differs.

**Refine iter / gen**: the most refinement steps after each insertion. 60 by default.

**Synthesis refiner**: the method that refines after each insertion; **Trust-region Newton** by default for Needle, which ended lower than Conjugate Gradient on most of the benchmark's cases. See [Optimization Methods](/synthesis/optimization-methods/).

**Candidate search**: how many batches a cycle tries before the design counts as needle-optimal: **Fast** one, **Balanced** two (the default), **Thorough** all.

**Needle sensitivity**: drop candidates whose predicted fall is under 1 %, 5 % or 15 % of the strongest in the scan; **Off** by default. It trims the list before the batches are taken.

**Threads**: how many candidates a batch holds and refines at once; the result depends on it.

**Profile pts / layer**, **Side**, **Refine after insert**, **Refine iterations**: Needle Manual's points inside each layer (16), the face it scans when **Surface** is **Both**, and the refinement after an insertion (on, 80 steps).

Needle Automatic leaves out the `MNT` and `MXT` rows, so run [Refinement](/synthesis/refinement/) afterwards; Needle Manual leaves them out of its scan and starting thickness only. A `PPEF` row, and any math row that reads it, is left out too: its gradient comes from only the two wavelengths where the error is highest and lowest, and the needle search stalls on that. A note under **Settings** says so, and a Refinement run afterwards brings the peak-to-peak error down.

## How it is computed

### Merit function

```
MF = √( Σ_i  w_i · (r_i / σ_i)²  /  W )
```

r_i is the miss of row i, w_i its weight, σ_i its scale and W the weight sum. The scan and the starting-thickness search use the OMF; the refinement and the 0.01 % rule use the MF. On a design with [environments](/design/environments/), MF² is the mean of the environments' MF², and the scan adds up their slopes the same way.

### Needle function

In TFStudio's convention ñ = n + ik, exp(−iωt) (see the [conventions](/#conventions-used-throughout-this-manual)), the layer matrix is Macleod's Eq. 2.111 with the sign of i reversed:

```
M_j = [ cos δ_j            −i sin δ_j / η_j ]        δ_j = 2π ñ_j d_j cos θ_j / λ
      [ −i η_j sin δ_j     cos δ_j          ]

[B; C] = M_1 M_2 ⋯ M_N [1; η_m]

ρ = (η_0 B − C) / (η_0 B + C)        τ = 2 η_0 / (η_0 B + C)
R = |ρ|²                             T = Re(η_m) / Re(η_0) · |τ|²
```

A needle of material a at depth z splits the stack into the matrix product above it, Pre(z), and the vector below it, Post(z); for small thickness d its matrix is the identity plus d times its derivative:

```
[B; C](d) = Pre(z) · M_a(d) · Post(z)        M_a(d) = I + d · G_a + O(d²)

G_a = [ 0              −i Q_a / η_a ]        Q_a = 2π ñ_a cos θ_a / λ
      [ −i η_a Q_a     0            ]

∂[B; C]/∂d = Pre(z) · G_a · Post(z)
```

```
∂ρ/∂d = 2 η_0 (C ∂B − B ∂C) / (η_0 B + C)²
∂τ/∂d = −τ (η_0 ∂B + ∂C) / (η_0 B + C)
∂R/∂d = 2 Re(ρ* ∂ρ/∂d)        ∂T/∂d = 2 Re(η_m) / Re(η_0) · Re(τ* ∂τ/∂d)
∂A/∂d = −∂R/∂d − ∂T/∂d
```

With an absorbing incident medium ∂A/∂d has one more term, in Im ∂ρ/∂d. Each row's slope follows by the chain rule the refinement uses for a layer thickness, and P is the slope of the merit:

```
P(z, a) = ∂MF/∂d at d = 0 = Σ_i  w_i · r_i · (∂r_i/∂d) / σ_i²  /  (W · MF)

predicted fall:   ΔMF ≈ P(z, a) · δ
```

This is the limit d → 0 of Sullivan and Dobrowolski's pre- and post-matrix needle, and the first coefficient P₁ of Tikhonravov et al.'s series ΔF = P₁(z, n)·Δ + P₂(z, n)·Δ² + …; every material at every position is its own candidate. Rows with no exact needle slope, such as phase, group delay and the ellipsometric rows, are compared with and without a needle of thickness δ. Where the exact scan does not run, on a bare substrate or with **Surface** at Front or Back and **Ignore other side** off ([Surface & Evaluation Modes](/design/evaluation-modes/)), P = (MF(δ) − MF(0)) / δ.

### Polarization, angle and cone

```
s:  η = ñ cos θ        p:  η = ñ / cos θ        n_0 sin θ_0 = ñ sin θ
```

η is in units of the free-space admittance and n_0 is the real index of the incident medium. A row averaging s and p, or scored over an illumination cone ([Design Editor](/design/design-editor/)), averages the slopes with the same weights it averages R, T or A. With **Surface** at **Both**, the slope goes through the incoherent sum of the two faces and the substrate, and with **Symmetric (back = front)** a needle goes into both faces, so the two slopes add.

### Starting thickness, refinement and acceptance

```
split layer:        f·d_h | needle | (1 − f)·d_h      f = k / 17,  k = 1 … 16
                    offered when f·d_h ≥ d_min and (1 − f)·d_h ≥ d_min
starting thickness: d_0 minimizes OMF(d) over d_min ≤ d ≤ max(4·d_min, 60 nm)
                    golden-section search to 0.5 nm; d_0 = d_min unless OMF(d_0) < OMF(d_min)
refinement stop:    k = N_iter,  or  (MF_(k−6) − MF_k) / MF_(k−6) < 10⁻⁴
accept:             MF_new < (1 − 10⁻⁴) · MF_best
parked layer:       d_j = d_min,  ∂MF/∂d_j > 0,  not locked
thicker start:      d_j → s · d_j for the unlocked layers,  s = 2, 4, 8, 16
```

d_h is the thickness of the layer being split, d_min is **Min thickness**, N_iter is **Refine iter / gen** and k counts refinement steps.

Tikhonravov et al. give a new layer whatever thickness lowers the merit most. Here the search stops at 60 nm: over a wide range the merit of a held stack has many minima, and a thick slab found that way can lower it while spoiling the design; refinement grows the needle afterwards. Sullivan and Dobrowolski remove the layers refinement leaves below a set thickness; a refiner with a floor parks them on it instead, so their removal is judged as Tikhonravov et al. judge it in gradual evolution: take them out, refine, and keep the result only if the merit is no worse.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Eq. 2.111 (layer matrix), Eqs. 2.123-2.125 (reflectance and transmittance), §2.6.4 (the two faces of a substrate), Chapter 3 (automatic design and the needle variation method).
- B. T. Sullivan and J. A. Dobrowolski, *Appl. Opt.* **35**, 5484 (1996): the numerical needle with pre- and post-matrices.
- A. V. Tikhonravov, M. K. Trubetskov and G. W. DeBell, *Appl. Opt.* **35**, 5493 (1996): the needle function and the synthesis loop.
- A. V. Tikhonravov, M. K. Trubetskov and G. W. DeBell, *Appl. Opt.* **46**, 704 (2007): total optical thickness and gradual evolution.
