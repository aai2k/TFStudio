---
title: Material Editor
description: Browse, import and create optical materials — the n(λ), k(λ) data every coating layer uses.
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

**Catalog selector** — choose a single catalog or **All**. The selector shows
each catalog's material count, and beneath it sit the actions for managing the
selected catalog.

**Search** — filter the list by name (case-insensitive). The filter respects
the catalog you have selected.

**Import AGF** — load a Zemax `.agf` glass file as a new catalog. AGF files
store internal transmittance versus wavelength; TFStudio converts that to
`k(λ)` automatically. AGF files you place in your TFStudio materials folder are
also picked up automatically when the app starts.

**Import .lm / .sub** — load optical material-library files. You choose which
catalog the parsed materials are added to, or create a new one.

**Browse RII** — open the refractiveindex.info browser to pick from the online
database (an internet connection is needed the first time you fetch a
material). The material is added to your chosen user catalog and then lives
locally.

**New Catalog** — create an empty user catalog to organize your own materials.

**Duplicate** — copy the selected catalog (from any source) into a new,
editable user catalog. **Copy to catalog** copies a single material into a user
catalog, which is the way to make an editable variant of a read-only material.

## Creating a material

Open a user catalog and choose **New material**, then pick a data type:

1. **Tabular** — paste or type a `λ, n, k` table. You can paste directly from a
   spreadsheet (Ctrl+V), and the grid supports keyboard navigation, sorting and
   per-cell editing.
2. **Formula** — choose a dispersion formula (Sellmeier, Cauchy, Conrady,
   Schott, Herzberger and other standard forms), enter its coefficients, and
   optionally add a `λ, k` table for absorption. The formula is rendered in
   full so you can confirm the convention.

A live n/k chart updates as you edit, and the wavelength range you set bounds
where the material is valid.

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

- M. N. Polyanskiy, refractiveindex.info — public-domain dispersion data.
- Beer–Lambert relation for extinction from internal transmittance: `k(λ) = −λ / (4π d) · ln τ_int(λ)`.
