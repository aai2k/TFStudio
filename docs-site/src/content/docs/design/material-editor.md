---
title: Material Editor
description: "Browse, import and create optical materials: the n(λ), k(λ) data every coating layer uses."
ribbonIcon: material-editor
---

The **Material Editor** is where you manage every refractive-index source
TFStudio knows about. Each material provides a refractive index `n(λ)` and an
extinction coefficient `k(λ)`; absorbing materials have `k > 0`. Every dropdown
in the app that asks you to pick a material reads from here.

Materials are grouped into catalogs by source:

| Catalog          | Source                                                                  | Editable          |
| ---------------- | ----------------------------------------------------------------------- | ----------------- |
| **Built-in**     | A curated set of 16 common optical materials.                           | Read-only         |
| **AGF**          | Zemax `.agf` files placed in your TFStudio materials folder.            | Via the file      |
| **User**         | Materials and catalogs you create inside TFStudio.                      | Yes               |
| **RefractiveIndex** | Materials you import from the refractiveindex.info database.          | Yes               |

The left panel holds a catalog selector, a search box, and the material list;
the right panel shows the selected material. Built-in and AGF materials show
read-only details (properties, dispersion formula, tabulated data, and an n/k
chart); user and imported materials open in an editable form.

## Settings

**Catalog selector**: choose a single catalog or **All**. The selector shows
each catalog's material count, and beneath it sit the actions for managing the
selected catalog.

**Search**: filter the list by name (case-insensitive). The filter respects
the catalog you have selected.

**Import AGF**: load a Zemax `.agf` glass file as a new catalog. AGF files
store internal transmittance versus wavelength; TFStudio converts that to
`k(λ)` automatically. AGF files you place in your TFStudio materials folder are
also picked up automatically when the app starts.

**Import .lm / .sub**: load optical material-library files. You choose which
catalog the parsed materials are added to, or create a new one.

**Browse RII**: open the refractiveindex.info browser to pick from the online
database (an internet connection is needed the first time you fetch a
material). The material is added to your chosen user catalog and then lives
locally.

**New Catalog**: create an empty user catalog to organize your own materials.

**Duplicate**: copy the selected catalog (from any source) into a new,
editable user catalog. **Copy to catalog** copies a single material into a user
catalog, which is the way to make an editable variant of a read-only material.

## Creating a material

Open a user catalog and choose **New material**, then pick a data type:

1. **Tabular**: paste or type a `λ, n, k` table. You can paste directly from a
   spreadsheet (Ctrl+V), and the grid supports keyboard navigation, sorting and
   per-cell editing.
2. **Formula**: choose a dispersion formula (Sellmeier, Cauchy, Conrady,
   Schott, Herzberger and other standard forms), enter its coefficients, and
   optionally add a `λ, k` table for absorption. The formula is rendered in
   full so you can confirm the convention.

A live n/k chart updates as you edit, and the wavelength range you set bounds
where the material is valid.

TFStudio evaluates every tabulated `n` and `k` column with shape-preserving
PCHIP interpolation. The curve passes through every supplied point and stays
inside the values of each bracketing pair, so a non-negative `k` table cannot
acquire optical gain from interpolation overshoot. Outside the tabulated range,
the nearest endpoint value is held constant. PCHIP defines the values between
measurements; it does not add measured information that is absent from the
table.

### Smooth dispersion fit

An editable tabular material can store an explicit smooth fit for calculations
that need higher derivatives. Transparent materials can use Cauchy or a one-
to three-term Sellmeier model for `n`; `k` uses a non-negative Urbach form when
the table contains enough positive values, otherwise it remains zero. Metals
can use a coupled Drude or Drude-Lorentz dielectric model, which fits `n` and
`k` together. The fit uses the material's stated wavelength range, never the
range of an analysis window.

Choose **Fit** or **Refit** to calculate it. TFStudio shows RMS and maximum
residuals for both `n` and `k`, plus a residual plot. Inspect those errors before
using the model. The fit is not created silently. It is stored on the material,
travels with an embedded user material, and is removed automatically when its
source table changes. Built-in materials remain read-only; copy one to a user
catalog before fitting a different representation.

## How to read it

For a built-in or imported material, the n/k chart shows the real index `n`
(left axis) and, when present, the extinction coefficient `k` (right axis,
dashed). The properties panel lists the d-line index, Abbe number, density and
wavelength range when the source provides them, and the dispersion formula and
coefficients when the material is formula-based. A material with a flat,
zero `k` is non-absorbing across the plotted range.

Catalogs are saved to your TFStudio materials folder and persist between
sessions, so an imported or hand-built material is available the next time you
open the app.

## References

- M. N. Polyanskiy, refractiveindex.info (public-domain dispersion data).
- F. N. Fritsch and J. Butland, "A Method for Constructing Local Monotone Piecewise Cubic Interpolants," *SIAM Journal on Scientific and Statistical Computing* **5**, 300-304 (1984).
- A. D. Rakić et al., "Optical properties of metallic films for vertical-cavity optoelectronic devices," *Applied Optics* **37**, 5271-5283 (1998), [doi:10.1364/AO.37.005271](https://doi.org/10.1364/AO.37.005271).
- Beer–Lambert relation for extinction from internal transmittance: `k(λ) = −λ / (4π d) · ln τ_int(λ)`.
