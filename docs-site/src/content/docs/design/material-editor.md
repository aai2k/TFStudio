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

**Import material files**: load materials written by other coating programs,
any mix of them in one pick:

| Program          | Files                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------- |
| TFCalc           | `.mat` from the `MATERIAL` and `SUBSTRAT` folders                                        |
| Essential Macleod | `.tfx` from a materials database folder, or `.mtx` written by File → Export → Material |
| OptiLayer        | `.lm` and `.sub`                                                                        |

The import dialog lists every material it read with its program and data type
(table with its point count, or the formula in the program's own name), and
previews the highlighted one: formula and coefficients or the table rows, and
an n/k chart. Untick what you do not want, choose the catalog to add to, or
create a new one.

TFCalc and Essential Macleod files do not record their wavelength unit. The
dialog assumes nanometres, reads the unit from an Essential Macleod database's
own settings when the `.tfx` file sits in its database folder, and has a
switch to micrometres for when the preview shows the curve in the wrong place.

Formula materials keep their formula where TFStudio has the same form. The
TFCalc forms it lacks (Hartmann, Drude, and every k formula) are sampled onto
a table over the range the file states. An Essential Macleod
internal-transmittance table has no equivalent here and is left out; the `k`
column is imported as it is. The compressed files of the Essential Macleod
materials library cannot be read: open such a material in Essential Macleod
and save it into your database first.

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
   full so you can confirm the convention. The Cauchy and general Sellmeier
   forms take as many terms as you add; a term left at zero is dropped when
   the material is saved.

A live n/k chart updates as you edit, and the wavelength range you set bounds
where the material is valid and the span the chart shows. Under the chart,
type a wavelength to read `n` and `k` there, and a sampled table lists the
curve's numbers. The same probe and table sit under the chart of a read-only
material.

### Between the table points

A table says nothing about the wavelengths between its points, so every
tabulated `n` and `k` column carries a rule for reading it there. The control
under the grid offers two:

- **Shape-preserving cubic** (PCHIP), the default for a new material. The
  curve passes through every supplied point and stays inside the values of
  each bracketing pair, so a non-negative `k` table cannot acquire optical
  gain from interpolation overshoot, and it has a slope everywhere, which is
  what phase and dispersion calculations need.
- **Linear**, straight lines between the points. This is how Essential
  Macleod and TFCalc evaluate a table, and a material imported from either
  keeps it, so a design imported with such materials reproduces the numbers
  it produced there. The slope changes abruptly at each point; the GD/GDD
  window breaks its curves there rather than draw through the jump.

The rule belongs to the material, not to a window, so it reaches every
calculation made with it, travels with a material embedded in a design, and
is what the two programs disagree on between measured points. Neither rule
adds information the table does not hold: where the answer depends on the
curvature of `n(λ)` between measurements, a smooth dispersion fit is the
honest model. Outside the tabulated range both rules hold the nearest
endpoint value constant.

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
