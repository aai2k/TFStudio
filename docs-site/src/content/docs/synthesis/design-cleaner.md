---
title: Design Cleaner
description: Merge adjacent same-material layers and remove very thin layers, then optionally re-refine.
ribbonIcon: design-cleaner
---

**Design Cleaner** tidies what synthesis leaves behind: neighbouring layers of one material, and layers too thin for a coater to make. It merges the neighbours, removes the thin layers and repeats until the design is stable, since a removed middle layer can leave two layers of one material touching. It can then refine the result to win back merit the change cost.

<!-- shot: design-cleaner | a synthesized multilayer design with thin layers: Pending operations listing removals and merges, Before and After layer counts, MF before and MF after, and the Thin layers panel -->
![Design Cleaner](/screenshots/design-cleaner.png)

![Flow chart of Design Cleaner. On each side cleaned, neighbours of one material are merged and unlocked layers thinner than Remove below are removed; this repeats while a pass removes something, up to four passes, and a last merge follows. The window previews the result. Apply optionally refines the cleaned design with the chosen method, no layer below the threshold, and writes it as one undo step.](/diagrams/design-cleaner.svg)

Locked layers are never merged or removed, and a symmetric design gets the cleaned front mirrored onto its back.

## Computed quantities

- **Pending operations**: each layer that will be removed or merged into its neighbour.
- **Before** and **After**: the layer counts.
- **MF before** and **MF after**: the merit function of the [Merit Function Editor](/design/merit-function-editor/); **MF after** is the cleaned design before any refinement.
- **Thin layers**: the layers below the threshold now.

## Controls and settings

**Side**: on a design coated on both sides, which side is cleaned. **Front** or **Back** leaves the other side exactly as it is, **Both** (the default) cleans both. A design coated on one side, or a symmetric one, has no Side choice.

**Remove below**: layers thinner than this many nanometres are removed. 5 nm by default; raise it to your manufacturing minimum for the final pass.

**Merge same material**: combine neighbouring layers of one material into one. On by default.

**Re-optimize**: refine the cleaned design before **Apply** writes it. On by default.

**Method** and **Max iter**, in the **Settings** menu beside Apply: the refiner, Sequential QP by default, or Damped Least Squares, Conjugate Gradient, Newton or Newton-CG, for 1 to 500 steps (80 by default).

**Apply** and **Stop**: Apply writes the cleanup and the refinement as one undoable step. The refinement runs in the background, the strip under the controls shows its step and merit, and **Stop** applies the cleanup with the best thicknesses found so far. Switching to another design while it runs applies nothing.

## How it is computed

### Merging

Merging changes nothing optically. Two neighbouring layers of one material share the admittance $\eta$ and their phase thicknesses add, so their matrices (see [Needle](/synthesis/needle/#needle-function)) multiply to the matrix of one layer of the summed thickness:

$$
M(d_1)\,M(d_2) = M(d_1 + d_2), \qquad \delta = \frac{2\pi \tilde n d \cos\theta}{\lambda}
$$

R, T and the MF are therefore the same before and after a merge. Only removals move **MF after**.

### Removing and re-optimizing

$$
\begin{aligned}
& \text{removed:} && \text{unlocked layer } j \text{ with } d_j < \text{Remove below} \\
& \text{passes:} && \text{merge, remove; again while a pass removes a layer, at most 4; then merge} \\
& \text{refinement:} && \text{Method, at most Max iter steps,}\quad d_j \ge \max(\text{Remove below},\ 1\ \text{nm})
\end{aligned}
$$

The refinement uses every row of the merit function, its band rows sampled as a Refinement run samples them at launch, and no layer may go below the larger of the threshold and 1 nm, so a layer the cleaner kept cannot be refined back under it.

Tikhonravov et al. take a thin layer out by giving it the index of a neighbour, which keeps the total optical thickness; their design cleaning takes out one layer at a time, the one whose removal raises the merit least, until an allowed rise is used. Design Cleaner deletes every layer under the threshold with its thickness, without looking at the merit, and the refinement after it restores as much thickness as the merit wants. [Gradual Evolution](/synthesis/gradual-evolution/)'s **Consolidate on finish** is the one-layer-at-a-time removal judged by the merit.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Eq. 2.111 (layer matrix) and Chapter 3 (thin layers left by automatic design).
- A. V. Tikhonravov, M. K. Trubetskov and G. W. DeBell, *Appl. Opt.* **46**, 704 (2007): thin-layer removal and design cleaning.
- B. T. Sullivan and J. A. Dobrowolski, *Appl. Opt.* **35**, 5484 (1996): removing layers below a minimum thickness after refinement.
