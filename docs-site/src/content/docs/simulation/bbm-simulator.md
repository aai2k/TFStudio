---
title: Broadband Monitoring Simulator
description: Simulate making your coating under a broadband optical monitor, then see the as-built spectrum and where the errors come from.
ribbonIcon: bbm-simulator
---

The Broadband Monitoring Simulator is a six-page wizard that deposits the design under an in-chamber broadband spectrophotometer: layer by layer, with rate jitter, index drift and signal noise, letting the simulated monitor decide when to cut each layer. It ends on the as-built spectrum beside the design, so you see how well the design survives production. Pages 1 to 4 set the conditions, page 5 runs one experiment and plays it back, page 6 gives the result.

<!-- shot: bbm-simulator | one simulated deposition of the 550 nm bandpass with the default rates and signal noise, on Resulting Performance: the as-built transmittance against the design -->
![Broadband Monitoring Simulator](/screenshots/bbm-simulator.png)

## Computed quantities

- **Deposition Simulation** (page 5): a timeline with play, pause, speed, scrub and layer ticks; for the current layer the **estimated**, **actual** and **target** thickness as bars, and the spectrum against the guide curves at 80 %, 90 % and the end of the layer. Once a layer is cut, its estimated bar is what the monitor believes it deposited, the target unless the cut ran late.
- **Resulting Performance** (page 6): the manufactured spectrum against the theoretical one, **relative** and **absolute** thickness error per layer, and tables of as-built thicknesses and refractive indices.

A manufactured curve on top of the theoretical one with small error bars means the design survives these conditions. A large error on one layer marks a layer hard to monitor in this band, a candidate for another band, tighter rate control or a more tolerant design. Each run draws fresh errors, so run it a few times to see the spread.

## Controls and settings

| Page | Sets |
|---|---|
| 1 **Deposition Rates** | Per material **Mean rate, Å/s**, **RMS, Å/s** and **Corr. time, s**. The preview draws a rate trace; **Randomize and update** draws another. The rate wanders within a layer at the scan interval and carries on into the next layer of the same material. |
| 2 **Parameters Deviation** | Per material **Re(n) Syst. Dev.**, **Re(n) Random Dev.** and **Syst. Inh. (%)**; the inhomogeneity is listed with the results but does not change the deposited layer. Per layer **Exclude** from monitoring with a **Relative Thickness Error, %**: an excluded layer ends at its target plus that error, whatever the rate did. **Mean shutter delay** and **Shutter delay RMS**, in s, between the cut decision and the shutter closing, added to every layer. |
| 3 **Broadband Monitoring System** | Quantity and polarization (T or R; avg, s or p), **Incidence angle**, **Scan interval**, the band (**Wavelength min**, **max**, **Points**) and **Chip glass**, the witness the monitor watches, the design substrate to start with. The preview shows the ideal signal for the layer picked in the tab strip. |
| 4 **Signal Errors** | **Random Errors, %** of the signal and a slow **Drift, % per 1000 s**, with the noisy signal previewed. |
| 5 **Deposition Simulation** | **Start** runs the experiment; **Restart**, **Stop** and **Time multiplier rate**. |

The coating side deposited, and how the result is scored, follow the surface mode in the [Design Editor](/design/design-editor/), shown as a badge.

## How the monitor cuts a layer

- From 60 % of a layer's planned time, every scan the monitor fits the thickness of the growing layer. Each fit scans 0 to 3 times the target at a step finer than the band's fringes before refining, so it needs no starting guess and lands in the best-fitting fringe rather than the nearest.
- A tracker follows thickness and rate from these fits, weighting each by how well its scan pins the thickness, and the shutter closes where the tracked thickness reaches the target, between scans if need be. Without noise every layer ends on target at any scan interval.
- Each fit uses the monitor's own estimate of the layers below, not what was really deposited, so an error carries into the fits of later layers as in a real chamber. An excluded layer enters that estimate at its target.
- The signal is read through the whole witness chip: the growing coating on its front, the bare back face, added incoherently, with air above the coating whatever medium the design is embedded in. A bare chip of $n = 1.52$ reads 91.8 %, not the 95.7 % of its coated surface alone.

## Theory

The rate of each material is an Ornstein–Uhlenbeck process about its mean $\bar r$, with RMS $\sigma$ and correlation time $\tau$, and a layer grows by the integral of the rate:

$$
\begin{aligned}
\mathrm{d}x &= -\frac{x}{\tau}\,\mathrm{d}t + \sigma \sqrt{\frac{2}{\tau}}\,\mathrm{d}W, \qquad r = \bar r + x \\
d(t) &= \int r\,\mathrm{d}t
\end{aligned}
$$

Both are drawn together at each step, so a layer's thickness noise does not depend on the scan interval; with $\tau = 0$ the rate noise averages out of the thickness entirely. A layer's index is $n + \Delta n_\text{syst} + \Delta n_\text{rand}$, one random draw per material and run. At each scan the monitor fits

$$
\hat d = \arg\min_d \sum_\lambda \left( S_\text{meas}(\lambda) - S_\text{model}(\lambda; d) \right)^2
$$

over the band, $S$ being T or R of the witness chip with the layers below at their estimated thicknesses, and the shutter delay adds $r \cdot t_\text{delay}$ after the cut.

## References

- A. V. Tikhonravov and M. K. Trubetskov, "Computational manufacturing as a bridge between design and production," *Appl. Opt.* **44**, 6877 (2005).
- D. T. Gillespie, "Exact numerical simulation of the Ornstein-Uhlenbeck process and its integral," *Phys. Rev. E* **54**, 2084 (1996).
- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Chapter 13, p. 471: production methods and optical monitoring.
