---
title: n,k Characterization
description: Get n, k and thickness for one deposited film from measured R and T or from ellipsometric Ψ and Δ.
ribbonIcon: nk-characterization
---

n,k Characterization works out the optical constants of **one film on a known substrate** from a measurement of it: R and T from a spectrophotometer, or Ψ and Δ from an ellipsometer. The thickness is held at a value you know or fitted with the constants. The result is a material for designs that describes the film **your process deposits**, which is not a handbook material of the same chemical name.

<!-- shot: nk-characterization | n, k and thickness of a TiO2 film on 1 mm BK7 extracted with the Cauchy model from its transmittance and reflectance -->

## Computed quantities

| Tab or row | Shows |
|---|---|
| **n and k** | n on the left axis, k on the right; k and its axis disappear when absorption is below what the measurement resolves. Lines are the smooth model, which **Save as material** writes; points are n and k solved one wavelength at a time with the thickness held at its fitted value. |
| **Fit** | The measured curves and those calculated from the model: R and T in percent, or Ψ on the left and Δ on the right in degrees. |
| **Residual** | Calculated minus measured: percentage points for R and T (90.2 % against 90.0 % is +0.2), degrees for Ψ and Δ, Δ the short way round. |
| **RMS**, **max** | Per channel; R and T as fractions here, so 1e-3 is a tenth of a percentage point. A notice appears past 0.003 in R or T, three times the 0.1 % absolute a careful measurement reaches; Ψ and Δ have no accepted figure, so none. |
| **Wavelengths solved** | How many points came out. |
| **Strongest parameter correlation** | Near 1, two parameters trade against each other and a small residual fixes neither. |
| Thickness spread | From the fit alone, not your experimental uncertainty; none for a held thickness. |
| **Smallest k this measurement resolves** | Assumes 0.001 absolute accuracy in R and T, not read from your instrument, and not for ellipsometry. |

Points on the lines say the model suits the film; points drifting off in a pattern say it does not; missing or scattered points mean a weak or noisy measurement there. The points start from the model, so their agreement is a consistency check, not proof the answer is unique. On Fit, T matching while R misses, or Ψ while Δ misses, is not a fit; on Residual you want small and shapeless, and an offset, a wobble or a bump points to a wrong substrate, thickness, angle, polarization, Δ convention or model.

## Controls and settings

**T / R** or **Ψ / Δ** picks the measurement and its two curves, from [Measured Spectra](/data-exchange/measured-spectra/) or [Measured Ellipsometry](/data-exchange/measured-ellipsometry/). **Settings** holds the substrate and its thickness, and for ellipsometry the **Δ convention**. Each curve's angle and polarization come from its card; check them there, since a curve imported without an angle arrives at 0°, and Ψ and Δ at normal incidence are refused.

| Setting | When |
|---|---|
| **Cauchy** | A dielectric over a range where it does not absorb; start here for any oxide or fluoride. |
| **Sellmeier** | When Cauchy leaves a shape in the residual and the dispersion is set by one band outside the range. Riskier: on a high-index oxide by R/T it can settle on the wrong index and still look smooth. |
| **Drude-Lorentz (metal)** | Every metal; it reads the number of oscillators off the data. Gold over the visible needs several, aluminium none, and the Model row then says Drude. |
| **λ range** | The part both curves cover and you trust, inside the substrate's and the model's range. |

A finished run and a smooth curve are not evidence the model fits: read Fit and Residual. If a fit will not settle, change the model first. When testing models on a spectrum TFStudio exported, remember SiO2 (Malitson), MgF2 (Dodge) and BK7 (Schott) are Sellmeier formulas, so Sellmeier fits them exactly and says nothing about a real film.

**Film → Hold** fits n and k at the thickness typed. **Film → Solve** fits the thickness too: fringes in T give a start and a range; without them the range is half to one and a half times the value typed, so it must be right to about a third. Hold an opaque metal's thickness, since more metal reflects the same; a thickness kept that way is labelled assumed.

**Extract** runs from a second to a minute, longest for a metal with thickness solved on a fine grid; the row names the stage and time, and **Stop** ends it. **Save as material** puts the smooth model in a catalog; **Save and open design** also builds the fitted sample with the measured curves. **Export** writes CSV of the smooth model, the pointwise n and k and a flag marking points that solved; use a pointwise value only where the flag is 1, and the model only inside the fitted range.

## Preparing the sample

**R/T**: coat one face of a known substrate polished on both faces, the other bare, the coated face toward the beam. The rear face is part of the calculation, and there is no setting that removes it. Measure absolute R and T over overlapping wavelengths, T through the whole sample; a ratio to bare glass, an optical density or data with the rear loss taken out is not this T. One film only: a second coating, an optically thick adhesion layer or a scattering sample is outside the model.

![One film on the front face of a glass slab polished on both faces. Light enters from the film side, R leaves off the coating, T leaves after the uncoated rear face, and the reflections bouncing inside the glass are part of what is calculated.](/diagrams/nk-photometry.svg)

- Each curve carries its own angle and polarization, from the normal; T at 0° and R at 8° fit together. Off normal set **s**, **p** or **average**, an equal mix of the two intensities.
- A ground back scatters rather than absorbs: on an integrating sphere in total mode the model still holds; a straight-through detector loses most of T. Light lost outside the port looks exactly like absorption: losing 1 % of T gives a transparent 500 nm film k ≈ 9e-4 at 550 nm, ten times the resolvable k, rising toward long wavelengths. **n and thickness survive a ground back; k does not.** A small wedge changes nothing.
- A measurement with the rear reflection suppressed (black glass with index fluid) cannot be fitted: the rear face is worth about four percentage points of R on glass, forty times photometric accuracy, and the window says so rather than return the wrong film. A stop that throws away part of the rear reflection does the same.
- To try the window on a known film, build it as a design and export its spectrum with the whole-slab (TOTAL) evaluation. A FRONT export has no rear face, which no instrument measures, and the window stops with **"These curves are of the coated surface alone"**.

![Polarized light hits the coated face at an angle from the normal, and the detector reads the change in polarization of the reflected beam.](/diagrams/nk-ellipsometry.svg)

**Ψ/Δ**: one uniform film on a known substrate, read from the coated side, with **no light back off the rear face**; clear glass sends rear reflections into any detector, so use what your instrument provides to kill them. Mixed rear reflections, depolarized data, roughness and extra surface layers are outside the model.

**Thickness**: below about a quarter wave of optical thickness at mid-range there is little for the fit to read, less still when the index is close to the substrate's. On BK7 with thickness fitted:

| Film | n | Thinnest by R/T | Thinnest by Ψ/Δ |
|---|---|---|---|
| MgF2 | 1.38 | 160 nm | 60 nm |
| SiO2 | 1.46 | 100 nm | 130 nm |
| Ta2O5 | 2.10 | 80 nm | 100 nm |
| TiO2 | 2.45 | 80 nm | 60 nm |

Ellipsometry reaches thinner films, and a low-index film on glass is the hard case: MgF2 barely changes R on BK7. Below these thicknesses several films reproduce the spectrum, and holding the thickness does not help, since a transparent film's R has a minimum at n = √n_s and an index either side gives the same R.

## Theory

The index is complex, N = n + ik. Inside the film the intensity falls as

```
I(z) = I₀ exp(−4π k z / λ)
```

so k is not the fraction a sample absorbs, which also depends on reflection and interference. A transparent dielectric coating material has n of about 1.35 to 2.6; a metal can have n well below 1.

For R/T the sample is the film on a finite substrate with a bare rear face, the passes through the glass combined in intensity as in [Surface & Evaluation Modes](/design/evaluation-modes/#theory). For Ψ/Δ it is the film on a semi-infinite substrate, ρ = r_p / r_s = tan Ψ exp(iΔ). The model's parameters and the thickness are fitted by least squares to the residuals at every wavelength; the pointwise n and k solve the two measured channels for the two unknowns at each wavelength with the thickness held.

A loss ΔT of transmitted light that is not absorption reads as an extinction of about

```
k ≈ ΔT · λ / (4π d)
```

which is also how the smallest resolvable k follows from a 0.001 accuracy in R and T.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Section 14.2, pp. 544–560: measurement of the optical properties of thin films; Section 5.1.1, p. 161: metallic layers and why a metal's k climbs with wavelength.
- A. D. Rakić et al., "Optical properties of metallic films for vertical-cavity optoelectronic devices," *Applied Optics* **37**, 5271-5283 (1998): the Lorentz-Drude model.
