---
title: n,k Characterization
description: Derive a film's refractive index, extinction coefficient and thickness from a measured R/T spectrum or a measured Ψ/Δ pair, and save the result as a material.
ribbonIcon: nk-characterization
---

**n,k Characterization** turns a measurement of a witness sample into a
material. Give it either a transmittance and reflectance pair from a
spectrophotometer, or a Ψ and Δ pair from an ellipsometer, and it returns the
film's n(λ), k(λ) and thickness, ready to save into a catalog and use in a
design.

Import the measurement first: R and T in
[Measured Spectra](/data-exchange/measured-spectra/), Ψ and Δ in
[Measured Ellipsometry](/data-exchange/measured-ellipsometry/). The **T / R**
and **Ψ / Δ** buttons at the left of the toolbar pick which kind of measurement
the run uses, and each mode offers only the curves that belong to it.

:::caution[One film, one substrate]
The model is a single film on a substrate. A sample with a second layer under
the film, an intentional interlayer or a thick thermal oxide, is not what this
window solves, and fitting one as a single film returns a film that does not
exist. The residual is what tells you: a sample the model cannot describe leaves
degrees of residual in Δ rather than hundredths.
:::

## Settings

| Setting | What it does |
| --- | --- |
| **Index model** | Cauchy or Sellmeier for a dielectric, Drude or Drude-Lorentz for a metal. The number of terms is chosen from the data. |
| **Sample** | Whether the measurement saw the substrate's back face (`slab`) or a coating on a semi-infinite substrate. Photometry only; an ellipsometer sees the coated surface alone. |
| **Substrate** and its thickness | The substrate the film sits on. It has to be right: an error here goes straight into k. |
| **Δ convention** | Ellipsometry only. Must match what the imported file carries. |
| **λ range** | The part of the measurement to fit. |
| **Film** | Solve for the thickness, or hold it. |

### The Film setting

**Hold** keeps the thickness exactly as typed and fits only n and k. Use it when
the thickness is known from a profilometer or a quartz monitor.

**Solve** fits the thickness too, and the number in the box is still read. What
it is used for depends on the measurement:

- A transmittance with interference fringes carries the thickness in the fringe
  spacing. That is read first, and the typed value is ignored.
- Anything else, which includes **every ellipsometric fit** and a reflectance on
  its own, has no fringe spacing to read. The typed value is then the centre of
  the thickness search, and the search covers half to one and a half times it.

So under Solve, a Ψ/Δ fit needs a starting thickness good to about a third. Put
500 nm in the box for a 100 nm film and the right answer is outside the searched
range: the fit will still converge, on a different film, with a small residual
and no complaint. A design open next to the window seeds the box from its own
single layer, which is usually what you want and occasionally is not.

## What you get back

### The plot

Three views, chosen from the toolbar.

**n and k** shows the fitted model as two lines, and the per-wavelength solve as
two sets of dots. The dots are the answer to a different question: at each
measured wavelength, holding the fitted thickness, the two measured values are
solved directly for n and k with no dispersion model imposed. For an R and T
pair that is the classic pair extraction. It is the independent check on the
model: where the dots sit on the lines, the smooth model is describing the
measurement; where they wander off it, it is not.

Two properties of the dots are worth knowing. Only wavelengths the solve
actually reached are drawn, and the results table counts them. And a wavelength's
own pair of measurements has more than one (n, k) that reproduces it at a given
thickness, so the solve is started from the fitted model to pick the root beside
it. That does not pull the dots toward the model: they still have to reproduce
the measurement exactly, so a model that is wrong is left standing away from
them.

**Fit** plots the measurement against what the fitted film calculates.
**Residual** plots the difference, which is where a systematic error shows
itself as structure rather than noise.

### The table

Beside the thickness and the model, the table reports the residual per channel,
in the units of that channel: absolute for T and R, degrees for Ψ and Δ. This is
the first number to read. It says whether the model reproduces the measurement
at all, and no warning substitutes for it.

The rest is there to say how much of the answer the measurement determined:

- **Smallest k this measurement resolves.** Single-pass absorptance is 4πkd/λ,
  so the instrument's own accuracy puts a floor under k. An extracted k below
  this line is describing the instrument, not the film.
- **Wavelengths solved.** How many points the per-wavelength solve reached.
- **Strongest parameter correlation.** Thickness and index enter a measurement
  largely as the product n·d. When there is too little structure to separate
  them, the residual stays small, the spreads grow, and this goes to one. A
  correlation near 1 with a small residual means the measurement did not pin
  the answer, whatever the residual says.

### Warnings

A warning names a condition a source calls wrong. Anything that is a matter of
degree is a number in the table instead.

- **The extracted k rises toward longer wavelengths.** A film absorbs at its
  band edge, in the ultraviolet, so k should fall as wavelength rises. Macleod
  shows two ways to produce the opposite, an inhomogeneous film fitted as a
  homogeneous one and a photometric scale error, and both recalculate the input
  perfectly while describing the wrong film. Treat it as Macleod does: with deep
  suspicion.
- **The fitted n rises toward longer wavelengths** on a film that absorbs
  nowhere in the range. Usually at an end of the range, where the fringes run
  out and the measurement stops fixing the index.
- **The fitted n or k leaves the values a real film can have.** For k this is
  the absorption model running away rather than an unusual film; do not save
  that material.
- **The measured R and T add to more than one**, which is a calibration fault.
- **k was fitted from a reflectance alone.** Reflectance barely responds to
  absorption, so that value is not measured.

## Saving the result

**Save as material** writes the fit into a catalog, stored the way a fitted
tabular material is stored: the analytic model, with a sampled table behind it.
Nothing downstream needs to know it came from a measurement.

**Save and open design** additionally builds a design holding this film on the
substrate and evaluation mode it was characterized on, carrying the measured
curves it was fitted to. That design reproduces the measurement, which makes it
the natural place to check the fit against anything else in the application.

**Export** writes the model and the per-wavelength points side by side as CSV,
with a column saying which points were solved.

## Method

Four steps, in this order, because each supplies what the next needs.

1. The transmittance fringe envelopes give a first index and, from the fringe
   positions, a thickness. Closed form, no starting guess. With no fringes to
   read, a constant-index scan takes its place and the thickness comes from the
   Film setting.
2. At each trial thickness, n and k are solved outright at every measured
   wavelength.
3. The thickness whose extracted index wanders least is kept, and a dispersion
   model is fitted to its n and k. A film's index is a smooth function of
   wavelength; extracted at the wrong thickness it is not, and picks up an
   oscillation at the fringe period. That is the signal being minimised.
4. Model and thickness are refined together against the measurement through the
   exact transfer-matrix calculation, which is the only step that sees the
   sample geometry, angle of incidence and polarization.

Steps 1 to 3 exist to put step 4 in the right place. A fringed spectrum has one
solution per interference order and the residual cannot tell them apart, so
starting anywhere is not an option.

Reference throughout: H. A. Macleod, *Thin-Film Optical Filters*, 5th ed.,
"Measurement of the Optical Properties".
