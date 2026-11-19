---
title: Monte Carlo
description: See how random manufacturing errors blur your spectrum and what yield you can expect against the design Specification.
ribbonIcon: error-analysis
---

Monte Carlo answers a practical question: if your coater deposits every layer with a realistic random error, how much does the spectrum move, and how often does the result still pass your Specification? Each trial is a copy of the design with fresh random errors in every layer; the window draws the spread of the trials and, against a specification, the yield.

<!-- shot: error-analysis | 200 trials of 1 % thickness error on the 8-layer 400-1000 nm AR, seed 1, the corridor and the yield against its specification, Errors strip folded -->
![Monte Carlo](/screenshots/error-analysis.png)

## Computed quantities

- **Theoretical** spectrum of the unchanged design (solid), **mean** over the trials (dotted), and the corridor **mean ± k·σ** (shaded), in percent; optionally the **min/max** envelope of all trials.
- **Yield**, on a design with a [specification](/design/specification/): the share of trials that pass every requirement, with its 95 % interval, and a red chip with the fail rate of each requirement that fails.
- **View trials…**: per-environment yields, the requirements and the layers most often behind a failure, and every trial with its $\Delta d$, $\Delta n$ and $\Delta k$. **Load thicknesses into design** copies one trial onto the design, as one undo step.

A wide corridor means the design is sensitive to manufacturing error. The mean can sit off the theoretical curve where the spectrum is curved: the mean reflectance at an antireflection minimum drifts upward, because every error raises R there.

## Controls and settings

**T / R / A**, and in **Settings** the **λ** range and step, **AOI** and polarization. The trials run off the window's thread; **Stop** ends a run and keeps the trials counted so far. The surface mode set in the [Design Editor](/design/design-editor/) decides which coatings get errors.

**Errors** strip:

- **#trials**, 200 by default. The corridor's noise falls as $1/\sqrt{N}$.
- **seed**: empty draws afresh and **Run** fills it in, so the same seed and settings repeat the same trials. Not saved with the design.
- **Distribution**: **Gaussian** (the value is $\sigma$), **Uniform** (a hard bound $\pm B$) or **Truncated** (a bell clipped at $\pm B$). The two bounded ones relabel the fields ± and turn on the envelope.
- **σ abs / σ rel**: thickness error in nm and in % of each layer's thickness. They add.
- **σ Re(n) / σ Im(n)**: index errors. k cannot go below zero, so on a layer with $k = 0$ the $\operatorname{Im}(n)$ error only adds absorption.
- **per-material**: one index error per material instead of per layer, a material drift rather than monitoring scatter.
- **keep n·d**: ties the thickness error to the index error so the optical thickness at the reference wavelength stays constant. With thickness errors alone it cancels them.
- **corridor**: $k$ in mean $\pm k \cdot \sigma$, the corridor's width, display only.

**Environment**: on a design with more than one [environment](/design/environments/), **Current** follows the environment the Design Editor shows and a numbered one holds the window on it even while it is switched off. A trial draws one set of errors, and each environment sees its own coating with the same errors, so switching shows another environment's spread from the same trials. A trial passes when it passes in every environment it is judged in. The choice is not saved with the design.

## Theory

For layer $j$ of thickness $d_j$, each trial draws (Macleod, Section 13.7):

$$
\begin{aligned}
\Delta d_j &\sim D(\sigma_{d,j}), & \sigma_{d,j} &= \sigma_\text{abs} + \frac{\sigma_\text{rel}}{100}\, d_j \\
\Delta n_j &\sim D(\sigma_n), & \Delta k_j &\sim D(\sigma_k), \quad k + \Delta k \ge 0 \\
\text{keep } n \cdot d\text{:} \quad & d'_j = d_j \frac{n_j}{n_j + \Delta n_j} && n_j \text{ at } \lambda_0
\end{aligned}
$$

$D$ is the distribution: normal with standard deviation $\sigma$; uniform on $[-B, B]$, whose RMS is $B/\sqrt{3}$; or normal with $\sigma = B/3$ clipped at $\pm B$, whose RMS is $0.987 B/3$. Over $N$ trials $C_i(\lambda)$:

$$
\begin{aligned}
\bar C(\lambda) &= \frac{1}{N} \sum_i C_i(\lambda) \\
\sigma^2(\lambda) &= \frac{1}{N - 1} \sum_i \left(C_i(\lambda) - \bar C(\lambda)\right)^2
\end{aligned}
$$

The mean moves off the theoretical value by about $\tfrac12 C'' \sigma^2$ where $C$ has curvature $C''$ against the error, which is the upward drift at a minimum.

The yield $\hat p = \text{passes} / N$ comes with the Wilson score interval, $z = 1.96$ for 95 %:

$$
\frac{\hat p + z^2/2N \pm z \sqrt{\hat p (1 - \hat p)/N + z^2/4N^2}}{1 + z^2/N}
$$

Two runs whose intervals overlap may differ only by chance; more trials narrow the interval.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Section 13.7, pp. 514–524: tolerances and random errors in layer thickness.
- E. B. Wilson, "Probable inference, the law of succession, and statistical inference," *Journal of the American Statistical Association* **22**, 209-212 (1927).
