---
title: Layer Sensitivity
description: Which layers are the most critical to make accurately, ranked by how far the optical merit moves when each one alone is off in thickness.
ribbonIcon: sensitivity
---

Layer Sensitivity shows **which layers are the most critical to make accurately**. It makes one layer at a time thicker and thinner by a small step, measures how far the optical merit function moves, and ranks the layers by that change. The merit is the one in the [Merit Function Editor](/design/merit-function-editor/), so the ranking is for the targets you set.

<!-- shot: sensitivity | bandpass design ranked against its bandpass target, table filling the window, Chart open below it -->
![Layer Sensitivity](/screenshots/sensitivity.png)

## Computed quantities

- **Δd**: the thickness step applied to each layer, in nm.
- **|ΔOMF|**: the mean change of the optical merit function when that layer alone is made thicker and thinner by $\Delta d$. The OMF leaves out the manufacturability rows `MNT`, `MXT`, `TT` and `STR`, so a layer near a thickness bound is not ranked high for that reason.
- **Sens. (%)**: $|\Delta\mathrm{OMF}|$ as a percentage of the largest one in the design.
- **Rank**: 1 for the layer with the largest $|\Delta\mathrm{OMF}|$, the one that needs the tightest monitoring.
- **Spec @ ±Δd**: on a design with a [specification](/design/specification/), whether every requirement still passes with all layers at once made thicker by $\Delta d$, and with all of them made thinner.

## Controls and settings

**Normalized % / Absolute |ΔOMF|**: the chart's vertical axis, the largest bar at 100 % or the raw merit change on a logarithmic axis.

**Settings**: **Perturbation** is **Relative**, a **Δd / d** in percent of each layer's own thickness (1 % by default, since real thickness errors scale with thickness), or **Absolute**, one **Δd** in nm for every layer. **include locked** adds the layers locked in the Design Editor, which are otherwise left out.

The badge on the row shows the surface mode set in the [Design Editor](/design/design-editor/); the layers probed are the ones that mode evaluates.

**Environment**: on a design with more than one [environment](/design/environments/), **Current** probes the merit of the environment the Design Editor shows and a numbered one holds the window on it even while it is switched off. **All** probes the optical merit over every environment that is on, combined as $\mathrm{OMF}^2 = \frac{1}{N} \sum \mathrm{OMF}_k^2$, $N$ counting the environments that hold an optical row. Each probe changes the layer list's thickness, which an environment sees as $f\,(d \pm \Delta d)$, $f$ the thickness factor of the material there. The choice is not saved with the design.

When a merit row has a Step of its own, the ranking first appears at the default step, faded and marked ≈, and is replaced when the ranking at the rows' own Steps is ready.

## Ranking

A tall bar means a small thickness error in that layer costs a lot of performance; a short bar means the layer is forgiving. A design whose bars are all about the same height has no single layer that can ruin it. Layers are numbered as in the Design Editor, F1 and B1 being the front and back layers on the substrate.

## Theory

For layer $j$ of thickness $d_j$:

$$
\begin{aligned}
\Delta d_j &= p\, d_j / 100 && \text{Relative}, \quad p = \Delta d / d \ \text{in \%} \\
\Delta d_j &= \Delta d && \text{Absolute} \\
|\Delta\mathrm{OMF}|_j &= \frac{|\mathrm{OMF}(d_j + \Delta d_j) - \mathrm{OMF}_0| + |\mathrm{OMF}(d_j - \Delta d_j) - \mathrm{OMF}_0|}{2} \\
\mathrm{Sens}_j &= 100 \cdot \frac{|\Delta\mathrm{OMF}|_j}{\max_k |\Delta\mathrm{OMF}|_k}
\end{aligned}
$$

$\mathrm{OMF}_0$ is the merit of the design as it is; a thinned layer stops at 0 nm and every other layer keeps its thickness. The OMF is the weighted RMS of the optical rows' residuals $\Delta_i$, $\mathrm{OMF} = \sqrt{\sum w_i \Delta_i^2 / \sum w_i}$, each residual as the [Operand Reference](/design/operands/) defines it. Band rows are sampled on the unchanged design's wavelength grid for every evaluation, so a change in merit comes from the thickness and not from the grid.

The two one-sided changes are averaged rather than a derivative taken because of where a design usually sits. About the design,

$$
\mathrm{OMF}(d_j \pm \Delta d) - \mathrm{OMF}_0 \approx \pm g_j\, \Delta d + \tfrac{1}{2} H_{jj}\, \Delta d^2
$$

with $g_j$ the slope and $H_{jj}$ the curvature along layer $j$. A refined design sits at a minimum, where every $g_j$ is close to zero, so a central difference would rank the layers by what is left of the optimizer's convergence. The mean of the two magnitudes keeps $\tfrac{1}{2} H_{jj}\, \Delta d^2$, which is what a deposition error costs at a minimum, and reduces to $|g_j|\, \Delta d$ on a design that has not been refined.

In symmetric mode probing a front layer also moves its mirror image on the back.

This is the per-layer sensitivity Baumeister introduced for filter tolerancing (Macleod, Section 13.7), taken over the merit function rather than one spectral curve. For random errors in every layer at once, use [Monte Carlo](/analysis/error-analysis/).

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Section 13.7, pp. 514–524: tolerances and the sensitivity of filter performance to errors in single layers.
