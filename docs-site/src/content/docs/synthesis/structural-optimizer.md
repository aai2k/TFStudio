---
title: Structural Optimizer
description: Restructure the stack by adding, removing, splitting, merging or perturbing layers, with a simulated-annealing accept.
ribbonIcon: structural
---

The **Structural Optimizer** changes the structure of a design: it adds, removes, splits, merges or perturbs layers, refines each changed design and picks the one to carry on from with a simulated-annealing rule. A worse design can be taken too, with a chance that shrinks as the run cools, and that is what lets it leave a local minimum. Because it can change the number and order of layers, it reaches designs that [Refinement](/synthesis/refinement/), which keeps the structure, and [Needle](/synthesis/needle/) and [Gradual Evolution](/synthesis/gradual-evolution/), which only add layers, may not. The design on screen is always the best one found.

<!-- shot: structural | a finished Structural Optimizer run on a multilayer antireflection target: the control bar with Iter, T, Acc and Best, MF Trend with the best and current curves, Accepted Improvements with Add, Split and Remove rows, and Top Designs -->
![Structural Optimizer](/screenshots/structural.png)

![Flow chart of a Structural Optimizer run. After Run, the merit rows are prepared and the starting design is refined. Each iteration resamples the band rows and sets the temperature, makes K proposals, needle insertions and random mutations, refines and scores each one, then moves the chain to the lowest move when it beats the best design, or else to the first move that passes a Metropolis test. The run ends when the best MF is below Target MF, when the iterations are used up, or when no new best has come for P iterations; with Deep search on it reheats from the best design instead and goes on.](/diagrams/structural-optimizer.svg)

A needle insertion comes from the [needle](/synthesis/needle/#needle-function) scan of the current design and goes in at the thickness the line search of Needle gives it. Locked layers are never touched, and a run with nothing left to propose ends.

## Computed quantities

- **MF** and **OMF**: as in [Needle](/synthesis/needle/#computed-quantities). Each proposal is scored on every row, `MNT` and `MXT` included.
- **T**, **Acc** and **Reheat** on the control bar: the temperature of the accept test, the share of iterations whose move was taken, and the Deep search restarts so far.
- **Op** of a row in Accepted Improvements: **Start** or **Seed**, the starting design; **Add**, **Remove**, **Split**, **Merge** or **Perturb**, the change that made the new best, a reheat counting as Perturb. **Material** is the material the change added.
- **ΔMF**, **TOT** and **Top Designs**: as in Needle. MF Trend plots the best MF and the chain's current MF.

## Controls and settings

**Run**, **Stop**, **Reset**, **Best**, **Clear history** and **Restore**: as in [Needle](/synthesis/needle/#controls-and-settings).

**Material Pool**: the materials *Add* and *Split* may use, with **All / Clear**; it starts and is kept the way the Needle pool is.

**Mutations**: which kinds of change the search may use, defined under [Mutations](#mutations).

**Max iterations**: the most iterations to run. 80 by default.

**Target MF**: stop once the best MF falls below this value.

**Start temp T₀**: the starting temperature, relative to the MF: 0.1 lets a design 10 % worse through about one time in three at the start. 0.3 by default.

**Min thickness (nm)**: the thinnest a layer may be, for the layers the search adds, splits and refines. It starts from the strictest `MNT` row, or 1 nm without one, and is taken from it again when you switch designs; a note under the field shows when the two differ.

**Smart starting design**: start from the best of the design and the quarter- and half-wave antireflection designs built from the pool, each refined first. Off by default, since on other targets it holds the search in an antireflection design's basin.

**Deep search**: when no new best has come for $P$ iterations, restart from the best design with one to three mutations at three times the jitter and the temperature back at **T₀**. The run then ends only at the **Target MF**, at the **Time budget (min)** or on **Stop**.

**Synthesis refiner**: the method that refines each proposal; **Conjugate Gradient** by default. See [Optimization Methods](/synthesis/optimization-methods/).

**Jitter (%)**: how far *Perturb* moves each thickness, as a share of it. 15 % by default.

**Refine iter / step**: the refinement steps each proposal gets. 60 by default.

**Max added (nm)**: the largest thickness a randomly added layer starts at; needle insertions choose their own. 500 nm by default.

**Max layers**: the most unlocked layers the design may grow to. 80 by default.

**Threads**: how many proposals are refined together each iteration; the result depends on it. The default comes from the computer's cores, so a run repeats on another computer only at the same Threads.

**Time budget (min)**: with Deep search on, end after this many minutes; 0 runs until **Stop**.

**Random seed**: the mutations, the accept rolls and the reheats draw from it. Left empty, **Run** fills in a new seed and keeps it, so the same seed, design, settings and **Threads** repeat the run; the history marks each run with its seed.

The largest `MNT` target raises a lower **Min thickness** at Run, and the smallest `MXT` target caps every layer. A limit written for a few layers therefore applies to the whole stack here; finish with [Refinement](/synthesis/refinement/) and [Design Cleaner](/synthesis/design-cleaner/) to hold each limit on its own layers.

A `PPEF` row, and any math row that reads it, is left out as in Needle; a Refinement run afterwards brings the peak-to-peak error down.

## How it is computed

### Merit and refinement

Each proposal is refined on the merit rows less `MNT` and `MXT`, with every thickness between the floor $d_\text{min}$ and the ceiling $d_\text{max}$ those rows set, then tidied (neighbours of one material merged) and scored on every row, `MNT` and `MXT` included. That score is the MF the accept test and the history use. The needle insertions use the needle function and the starting-thickness search of [Needle](/synthesis/needle/#needle-function), at the sixteen points inside each layer that Needle scans, kept at the minima along the layer.

### Annealing

$$
\begin{aligned}
& \text{temperature:} && T_i = T_0 \cdot 0.005^{\,i / I} \\
& \text{accept:} && \text{MF}_\text{new} \le \text{MF}_\text{cur} \text{ always;}\quad \text{otherwise with probability } \exp\!\left(-\frac{\text{MF}_\text{new} - \text{MF}_\text{cur}}{\text{MF}_\text{cur} \cdot T_i}\right) \\
& \text{batch move:} && \text{the lowest move if } \text{MF}_\text{low} < \text{MF}_\text{best};\ \text{else the first move, in random order, that passes} \\
& \text{same design:} && \text{every layer within 0.5 nm of the current design, same materials: not a move} \\
& \text{fall back:} && \text{MF}_\text{cur} > 1.3 \cdot \text{MF}_\text{best} \ \to\ \text{the chain goes back to the best design} \\
& \text{stall:} && P = \max\!\left(15,\ \text{round}(\text{Max iterations} / 3)\right) \text{ iterations without a new best}
\end{aligned}
$$

$I$ is **Max iterations**. With Deep search, $i$ counts from the last reheat and $I = \max(40,\ \text{Max iterations})$. The accept test uses the relative rise of the MF, so $T_0$ means the same on a design whose MF is $10^{-4}$ as on one whose MF is 1.

### Mutations

$$
\begin{aligned}
& \text{odds:} && \text{add, split, perturb } 1;\ \text{remove, merge } 0.7 \\
& \text{add:} && \text{a pool material, unlike its neighbours where it can be, at a random position;} \\
& && \text{thickness uniform in } [d_\text{min},\ \text{Max added}] \\
& \text{remove:} && \text{layer } j \text{ with weight } 1 / (d_j + d_\text{min}) \\
& \text{split:} && \text{host of at least } 2 d_\text{min}, \text{ cut at 30 to 70 \%, another pool material between the parts,} \\
& && \text{thickness uniform in } [d_\text{min},\ \min(\text{Max added},\ d_\text{host} / 2)] \\
& \text{merge:} && \text{two neighbours} \to \text{one layer, the thicker one's material, } d_1 + d_2 \\
& \text{perturb:} && \text{every unlocked } d_j \to d_j \cdot (1 + \text{jitter} \cdot u),\quad u \text{ uniform in } [-1, 1] \\
& \text{reheat:} && \text{1 to 3 mutations of the best design, jitter} \cdot 3 \text{ (at most 60 \%)}
\end{aligned}
$$

Every thickness is then clamped to $[d_\text{min},\ d_\text{max}]$. A kind that cannot apply, such as a merge on a single layer, gives way to another kind drawn from the rest.

Kirkpatrick et al. accept on the absolute rise of the cost. Here it is the relative rise, because merit values differ by orders of magnitude between problems. For a batch of moves refined side by side, testing each in random order and taking the first that passes is the synchronous parallel annealing rule given by Delamarre and Virot, which Ferrero et al. show is equivalent to a serial chain. The run adds one rule to it: a move that beats the best design so far is always taken, so a batch does not throw away a lower design it found. Deep search is basin hopping (Wales and Doye).

## References

- S. Kirkpatrick, C. D. Gelatt and M. P. Vecchi, *Science* **220**, 671 (1983): simulated annealing and the Metropolis test.
- D. Delamarre and B. Virot, *RAIRO Rech. Opér.* **32**, 43 (1998), §4.4.2: parallel simulated annealing.
- E. E. Ferrero, A. B. Kolton and M. Palassini, *AIP Conf. Proc.* **1610**, 71 (2014): parallel annealing and the serial chain.
- D. J. Wales and J. P. K. Doye, *J. Phys. Chem. A* **101**, 5111 (1997): basin hopping.
- A. V. Tikhonravov and M. K. Trubetskov, *Appl. Opt.* **51**, 7319 (2012): modern design tools and a new paradigm in optical coating design.
- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Chapter 3 (automatic design, simulated annealing).
