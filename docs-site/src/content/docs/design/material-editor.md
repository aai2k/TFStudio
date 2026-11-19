---
title: Material Editor
description: "Browse, import and create optical materials: the n(λ), k(λ) data every coating layer uses."
ribbonIcon: material-editor
---

The Material Editor holds every source of refractive index TFStudio knows. Each material gives n(λ) and k(λ), k > 0 for an absorbing one, and every material picker in the app reads from here. Materials sit in catalogs by source:

| Catalog | Source | Editable |
|---|---|---|
| **Built-in** | 22 common optical materials. | Read-only |
| **AGF** | Zemax `.agf` files in the data folder's `Materials\agf` subfolder. | Through the file |
| **User** | Materials and catalogs you create. | Yes |
| **RefractiveIndex** | Materials imported from refractiveindex.info. | Yes |
| **This design** | The open design's materials; one that came inside a design file and that no catalog here holds is listed only here. | Read-only, **Copy to my catalog…** |

<!-- shot: material-editor | silver on its n & k page: the n and k chart over the data table -->

## Computed quantities

The chart shows n on the left axis and k dashed on the right. Under it, a wavelength you type gives n and k there, and a sampled table lists the curve. The properties panel gives the d-line index, Abbe number, density and range where the source states them, and a formula material's formula and coefficients. A smooth fit shows RMS and maximum residuals of n and k with a residual plot, and a Cauchy or Urbach fit each coefficient with its standard error.

## Controls and settings

**Catalog selector**: one catalog with its count, or **All catalogs**. **⋯** beside it: **Rename**, **Duplicate** and **Delete** for the selected catalog, **New empty catalog** and **New catalog from Zemax AGF**. **Search** filters by name within the selected catalog.

**Add** puts a material into one of your catalogs: **Blank material**, **From refractiveindex.info**, or **From TFCalc, Macleod or OptiLayer files**. A blank material goes into the selected catalog when it is yours, otherwise into your only catalog, one you pick, or a new **My catalog**. Its ID is made from the name at the first save and never changes, since designs refer to it. **Copy to my catalog** makes an editable copy of any material.

A material has two pages. **n & k** takes a data type:

1. **Tabular**: a λ, n, k table, typed or pasted from a spreadsheet, with a rule for the wavelengths between points ([below](#between-the-table-points)).
2. **Formula**: a dispersion formula with its coefficients and an optional λ, k table. The formulas are grouped by source under the source's own numbers: Zemax (Schott, Sellmeier, Herzberger, Conrady and the rest), the general series and OptiLayer forms, and the nine refractiveindex.info formulas. Cauchy, general Sellmeier and the series take as many terms as you add; a zero term is dropped on save.

The validity range at the top bounds where the material holds and what the chart spans.

**Mechanical** holds the constants used by [Stress](/analysis/stress/) and the temperature model of [Environments](/design/environments/):

| Constant | Unit | What it is |
|---|---|---|
| Young's modulus | GPa | Stiffness under tension. |
| Poisson's ratio | | Sideways contraction while it stretches. |
| Linear expansion | ppm/K | Growth per kelvin. |
| dn/dT | ppm/K | Change of index with temperature. |
| Intrinsic stress | MPa | The stress a film is deposited with, tensile positive. |
| Reference temperature | °C | The deposition temperature that stress refers to. |
| Surface energy | J/m² | What a fresh surface costs: what a crack or delamination pays. |

Both temperature coefficients are typed in ppm/K, as catalogs print them: 0.00000055 per kelvin is 0.55. An empty box means unknown, and each calculation says what it does without it. The constants travel with the material into a copy, a user catalog and a design file. An AGF glass arrives with its expansion, Young's modulus and Poisson's ratio.

Catalogs are saved in the data folder's `Materials` subfolder. **Refresh all**, the round arrows at the left of the title bar, reads catalog files and AGF files copied in while the app runs, and the project folders for design files changed outside TFStudio. Open windows compute again from what was read; optimizer, synthesis and fit runs are not repeated. Unsaved edits stay, unless their file was saved again since; then the file loads and Ctrl+Z brings the edits back.

## Materials inside a design

- A design refers to each material by catalog and ID, and its file keeps a copy of every material that is not built in. A catalog you create gets an ID of its own, so a same-named catalog on another computer is a different catalog.
- While a catalog here holds the material, the design computes with the catalog: an edit here changes every design using it, and the copy is updated when the design is saved.
- The copy is used only where no catalog here holds the material: a design from another computer, a deleted material or catalog, or a catalog here with a different material under the same ID. It is listed under **This design**; **Copy to my catalog…** makes an editable material of it under a new ID, and the design keeps its copy until you pick the new material for its layers.
- Where a catalog here has a different material under the same ID, that catalog's material is not offered for the design's layers. A deleted material's ID is never given to a new material in its catalog.
- A material TFStudio cannot compute, a formula with no evaluator or a table with no row holding both a wavelength and an n, is never given a stand-in index: the design lists it as unavailable and calculations stop until it is replaced. Saving keeps its definition as written.
- A formula is evaluated as written, with no floor under n. Where it gives no real, positive n, at a pole or where n² turns negative, the material has no index and a design gets no result at those wavelengths.

## Importing

**New catalog from Zemax AGF**: the internal transmittance an AGF file stores becomes k(λ) ([Theory](#theory)). A glass whose formula number TFStudio does not evaluate is left out and the import message names it; files picked up at startup have no window to report in, so import one by hand to see what was left out.

**From TFCalc, Macleod or OptiLayer files**, any mix in one pick:

| Program | Files |
|---|---|
| TFCalc | `.mat` from the `MATERIAL` and `SUBSTRAT` folders |
| Essential Macleod | `.tfx` from a materials database folder, or `.mtx` from File → Export → Material |
| OptiLayer | `.lm` and `.sub` |

- The dialog lists each material with its program and data type and previews the highlighted one; untick what you do not want and pick the catalog.
- TFCalc and Essential Macleod files do not record their wavelength unit. Nanometres are assumed, an Essential Macleod database's own setting is read when the `.tfx` sits in its folder, and a switch sets micrometres when the preview is in the wrong place.
- A formula keeps its form where TFStudio has it. The TFCalc forms it lacks (Hartmann, Drude and every k formula) are sampled to a table over the file's range. An Essential Macleod internal-transmittance table is left out and its k column used as it is; the compressed files of its materials library cannot be read.
- A table point with k below zero, the residue of the fit behind some tables, is imported as written and marked; every calculation reads k = 0 there, since negative k would be gain.

**From refractiveindex.info**: the online database, needing a connection the first time. A table page arrives with every row; a formula page arrives as that formula with its stated range and the page's k table, and is evaluated as the formula gives it outside that range. The browser plots or tables a page, reads n and k at a wavelength, and says where a formula page has no real n inside its range.

## Between the table points

Each tabulated n and k column carries its own rule for the wavelengths between points, set under the grid. The rule belongs to the material, so it reaches every calculation and travels with an embedded material. Outside the table both rules hold the nearest end value.

- **Shape-preserving cubic** (PCHIP), the default: passes through every point and stays inside the values of each bracketing pair, so a non-negative k table gains no overshoot, and it has a slope everywhere, which phase and dispersion need.
- **Linear**: straight lines between points. A material imported from TFCalc or Essential Macleod files keeps it, so an imported design gives the numbers it gave there. Its slope jumps at each point, and the GD/GDD window breaks its curves there.

Neither rule adds information the table lacks. Where the answer depends on the curvature of n(λ) between measurements, a smooth fit is the honest model.

## Smooth dispersion fit

An editable table can carry a smooth fit for calculations that need higher derivatives: Cauchy or a one- to three-term Sellmeier for n, with a non-negative Urbach k when the table has enough positive values and k = 0 otherwise, or for a metal a Drude or Drude-Lorentz model fitting n and k together.

- **Fit from** and **Fit to** set its range, apart from the validity range. It starts at the design's evaluation range where the table reaches; outside it the table is read. Where the fit ends inside the table, n and k step by the fit's residual there: the panel names the step, and the GD/GDD and Material Dispersion windows break their curves at it.
- A range over more than a decade of photon energy is reported, since no one model holds free electrons, an interband edge and the transparent region at once, and the design's range is offered with the residual it reaches.
- **Fit** or **Refit** calculates it. For a metal model the panel also reports a parameter left on one of its limits and an oscillator that moves n by less than the residual: neither measures the material.
- The fit is stored on the material, travels with it, and is removed when its table changes. Copy a built-in material to a user catalog to fit it.

## Theory

The fit models, λ in µm and E = 1.239841984 / λ in eV:

```
Cauchy:          n = A₀ + A₁/λ² + A₂/λ⁴ + …
Sellmeier:       n² = A + Σ_j B_j λ² / (λ² − C_j)
Urbach:          k = k₀ exp(k_b/λ + k_c λ)
Drude-Lorentz:   ε = ε∞ − E_p² / (E² + iΓE) + Σ_j f_j / (E_j² − E² − iγ_j E)
                 n + ik = √ε
```

The metal model is Rakić's Lorentz-Drude function with its signs conjugated for TFStudio's n + ik convention; Drude alone has no oscillator terms. A term is added only while it cuts the residual by a clear margin, so the fit follows the dispersion rather than the rounding of the table.

An AGF glass's internal transmittance τ over thickness d becomes, at each tabulated wavelength (Beer–Lambert):

```
k(λ) = −λ / (4π d) · ln τ(λ)
```

## References

- M. N. Polyanskiy, refractiveindex.info (public-domain dispersion data).
- F. N. Fritsch and J. Butland, "A Method for Constructing Local Monotone Piecewise Cubic Interpolants," *SIAM Journal on Scientific and Statistical Computing* **5**, 300-304 (1984).
- A. D. Rakić et al., "Optical properties of metallic films for vertical-cavity optoelectronic devices," *Applied Optics* **37**, 5271-5283 (1998), [doi:10.1364/AO.37.005271](https://doi.org/10.1364/AO.37.005271).
