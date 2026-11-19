---
title: Monte Carlo
description: See how random manufacturing errors blur your spectrum and what yield you can expect against the design Specification.
ribbonIcon: error-analysis
---

Monte Carlo answers a practical question: if your coater deposits every layer with a realistic random error, how much does the spectrum move, and how often does the result still pass your Specification? Each trial is a copy of the design with fresh random errors in every layer; the window draws the spread of the trials and, against a specification, the yield.

<!-- shot: error-analysis | 200 trials of 1 % thickness error on the 8-layer 400-1000 nm AR, seed 1, the corridor and the yield against its specification, Errors strip folded -->

## Computed quantities

- **Theoretical** spectrum of the unchanged design (solid), **mean** over the trials (dotted), and the corridor **mean ± k·σ** (shaded), in percent; optionally the **min/max** envelope of all trials.
- **Yield**, on a design with a [specification](/design/specification/): the share of trials that pass every requirement, with its 95 % interval, and a red chip with the fail rate of each requirement that fails.
- **View trials…**: per-environment yields, the requirements and the layers most often behind a failure, and every trial with its Δd, Δn and Δk. **Load thicknesses into design** copies one trial onto the design, as one undo step.

A wide corridor means the design is sensitive to manufacturing error. The mean can sit off the theoretical curve where the spectrum is curved: the mean reflectance at an antireflection minimum drifts upward, because every error raises R there.

## Controls and settings

**T / R / A**, and in **Settings** the **λ** range and step, **AOI** and polarization. The trials run off the window's thread; **Stop** ends a run and keeps the trials counted so far. The surface mode set in the [Design Editor](/design/design-editor/) decides which coatings get errors.

**Errors** strip:

- **#trials**, 200 by default. The corridor's noise falls as 1/√N.
- **seed**: empty draws afresh and **Run** fills it in, so the same seed and settings repeat the same trials. Not saved with the design.
- **Distribution**: **Gaussian** (the value is σ), **Uniform** (a hard bound ±B) or **Truncated** (a bell clipped at ±B). The two bounded ones relabel the fields ± and turn on the envelope.
- **σ abs / σ rel**: thickness error in nm and in % of each layer's thickness. They add.
- **σ Re(n) / σ Im(n)**: index errors. k cannot go below zero, so on a layer with k = 0 the Im(n) error only adds absorption.
- **per-material**: one index error per material instead of per layer, a material drift rather than monitoring scatter.
- **keep n·d**: ties the thickness error to the index error so the optical thickness at the reference wavelength stays constant. With thickness errors alone it cancels them.
- **corridor**: k in mean ± k·σ, the corridor's width, display only.

**Environment**: on a design with more than one [environment](/design/environments/), **Current** follows the environment the Design Editor shows and a numbered one holds the window on it even while it is switched off. A trial draws one set of errors, and each environment sees its own coating with the same errors, so switching shows another environment's spread from the same trials. A trial passes when it passes in every environment it is judged in. The choice is not saved with the design.

## Theory

For layer j of thickness d_j, each trial draws (Macleod, Section 13.7):

```
Δd_j ~ D(σ_d,j),     σ_d,j = σ_abs + (σ_rel / 100) · d_j
Δn_j ~ D(σ_n),       Δk_j ~ D(σ_k),       k + Δk ≥ 0
keep n·d:            d_j′ = d_j · n_j / (n_j + Δn_j)      n_j at λ₀
```

D is the distribution: normal with standard deviation σ; uniform on [−B, B], whose RMS is B/√3; or normal with σ = B/3 clipped at ±B, whose RMS is 0.987·B/3. Over N trials C_i(λ):

```
C̄(λ)  = (1/N) Σ C_i(λ)
σ²(λ) = 1/(N − 1) Σ (C_i(λ) − C̄(λ))²
```

The mean moves off the theoretical value by about `½ C″ σ²` where C has curvature C″ against the error, which is the upward drift at a minimum.

The yield p̂ = passes / N comes with the Wilson score interval, z = 1.96 for 95 %:

```
( p̂ + z²/2N  ±  z √( p̂(1 − p̂)/N + z²/4N² ) ) / (1 + z²/N)
```

Two runs whose intervals overlap may differ only by chance; more trials narrow the interval.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Section 13.7, pp. 514–524: tolerances and random errors in layer thickness.
- E. B. Wilson, "Probable inference, the law of succession, and statistical inference," *Journal of the American Statistical Association* **22**, 209-212 (1927).
