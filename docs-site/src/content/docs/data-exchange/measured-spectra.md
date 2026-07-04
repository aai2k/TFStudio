---
title: Measured Spectra
description: Import measured R/T/A spectra as overlays to compare against your design, and export design or measured curves to CSV or JCAMP-DX.
ribbonIcon: spectrum-exchange
---

The **Measured Spectra** window connects your design to the spectrophotometer.
**Import** a measured reflectance, transmittance, or absorptance curve from an
instrument file and overlay it on
[Optical Evaluation](/analysis/optical-evaluation/) to compare prediction
against measurement; **export** either the computed design spectrum or your
imported curves to a portable file. The window is split into **Import** and
**Export** tabs.

## Settings

### Import

Two file families are supported:

- **Generic CSV / TXT / ASCII** (`.csv`, `.txt`, `.asc`) — plain `λ, value`
  tables. The delimiter (comma, semicolon, tab, or whitespace), header rows,
  and decimal-comma locale are detected automatically.
- **JCAMP-DX** (`.dx`, `.jdx`) — the self-describing IUPAC spectroscopy
  standard. It carries its own units and quantity, so it imports directly.
  Compound `LINK` files import every block.

For a generic table you confirm the parse before adding it:

- **Delimiter / column** — which column is the wavelength and which is the value.
- **X unit** — nm, µm, or cm⁻¹ (auto-detected; override if wrong).
- **Quantity** — T, R, or A.
- **Y scale** — percent or fraction; absorbance is converted to transmittance.
- **Preview** — a small plot of the parsed curve before you commit.

Imported curves are stored on the design and **persist with the project**. On
Optical Evaluation they appear as dotted lines with open-circle markers,
colored by R / T / A. Show, hide, or remove them from the Import tab.

### Export

A **"What to export"** chooser picks the source:

- **Design spectrum** — the *computed* T / R / A of the active design. Set the
  wavelength start / end / step, an angle-of-incidence list, the channels
  (T / R / A), and s / p (absorptance has no s/p split). It honors the active
  surface mode (front / back / total) and works without Optical Evaluation open.
- **Measured curves** — re-export the overlays you imported.

A **Format** toggle writes either **CSV** or **JCAMP-DX** for either source.

## How to read it

The typical use is validating a deposition run: import the spectrophotometer
trace and compare it directly against the predicted design curve on Optical
Evaluation. Where the measured and computed curves diverge tells you how the
as-built coating departs from the design. For an instrument that isn't directly
supported, export a CSV from its own software — the generic table importer
reads ordinary `λ, value` exports — and JCAMP-DX export makes a TFStudio curve
loadable in any spectroscopy tool.

## References

- McDonald & Wilks, *Appl. Spectrosc.* **42**, 151 (1988) — the JCAMP-DX
  `XYDATA` / ASDF format (AFFN, PAC, SQZ, DIF, DUP).
