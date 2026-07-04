---
title: Report Generator
description: Build a polished multi-section HTML or PDF report — the deliverable you hand a customer or file with a design.
ribbonIcon: report-gen
---

The **Report Generator** builds a production-quality document that gathers the
analyses you choose — the kind of artifact a coating engineer hands to a
customer or files in a design package. The output is a self-contained **HTML or
PDF** file, available in **English or Russian**, and it reuses the same
validated calculation engines as the analysis windows, so every number in the
report matches what you see in the app.

Open it from the **Report** button in the Information ribbon group, or from
**File → Export Report**. It runs as a 6-step wizard.

## Settings

**Step 1 — Scope.** Report on the current design, or on several designs as a
**comparison** report. This step also holds the cover-page fields: title,
customer, project, designer, date, and an optional logo.

**Step 2 — Sections.** Tick the sections to include and reorder them with the
▲ / ▼ buttons. Available sections include the cover, design summary (layer
table and totals), optical evaluation, color, refractive-index profile, |E|²
field profile, ellipsometry (Ψ/Δ), integral values, the qualifiers verdict,
merit operands, and free-text notes.

**Step 3 — Options.** Per-section settings: wavelength and angle-of-incidence
ranges, which curves (T / R / A) and data tables to include, the color
illuminant, optional `n / OT / QWOT / FWOT` layer columns, and tabulated
material n,k. Sections that need no options are skipped here.

**Step 4 — Language.** Generate the report in English or Russian; this sets
all headings, axis labels, and table headers.

**Step 5 — Output.** Choose a single self-contained **HTML** file or a
print-quality **PDF**. This step also manages **presets** — save the current
report configuration under a name and reload it later.

**Step 6 — Preview & Generate.** A live preview of the finished report; press
generate to export it.

Plots are drawn as inline vector graphics, so the report looks identical in the
preview, in the saved HTML, and in the PDF. Presets and an optional cover logo
are stored in your `Documents\TFStudio` folder.

## How to read it

The generated report is the deliverable, not an analysis tool — read it the way
your customer will. Use the comparison scope when you want one document that
puts several candidate designs side by side. Because the report pulls its
numbers straight from the same engines as the
[Optical Evaluation](/analysis/optical-evaluation/),
[Color Evaluation](/analysis/color-evaluation/), and
[Integral Values](/analysis/integral-values/) windows, the values are exactly
what those windows show; if something looks off, check the per-section options
(wavelength range, angle, illuminant) rather than expecting the report to
differ from the app.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed.
