---
title: Report
description: Assemble a document from blocks over one or several designs, then save it as a PDF or a single HTML file.
ribbonIcon: report-gen
---

Report builds the document you hand to a customer or file with a design: the block list on the left, the page on the right, following the design as you edit it. Every number comes from the same calculations as the analysis windows, so the report shows what the app shows. It opens from **Report** on the **Production** tab of the ribbon.

<!-- shot: report-gen | the design record of the 8-layer 400-1000 nm AR: block list on the left, the first page on the right -->
![Report](/screenshots/report-gen.png)

## Computed quantities

A report is an ordered list of blocks, each a table with an optional plot.

- In every report: title, design facts with the stack diagram, layer table, materials, and notes. A template can switch them off but not remove them.
- From the analysis windows: spectrum, color, integral values, group delay with GDD and TOD, ellipsometry, electric field, refractive index profile, the specification verdict, the merit function operands and a signature line.
- **Monte Carlo** prints the last run of the [Monte Carlo](/analysis/error-analysis/) window for the design, with its curves, statistics per wavelength and yield; it does not repeat the run.
- **Monitoring worksheet** prints the witness-chip table of the [Monitor Worksheet](/simulation/monitor-worksheet/), one row per layer, with that window's chip plan, wavelengths, chip glass and settings for the design.

The layer table lists number, material, thickness and QWOT, layer 1 next to the substrate on both sides. A long stack flows into side-by-side columns, about 150 layers to a page.

## Controls and settings

**Add block**, at the foot of the list, adds a block with the settings its window shows now, or its saved defaults if it has not been opened. Tick a block to include it and drag to reorder; its gear sets range and step, angles, curves, plot size and how densely the table samples the curve, and moves or removes it. The spectrum block carries Optical Evaluation's own controls: angle chips, curves with s and p, spectral unit, and the vertical scale (percent, fraction, dB or optical density) with its range.

Layer table: **n, OT, FWOT columns** adds the optical-thickness family, trading columns for width. **Group identical periods** merges a repeated period such as (H L) × 24 into one row; only rows identical at the printed precision merge, so a refined stack prints every layer.

**Template**: **Design record**, the default, with everything including the recipe; **Customer report**, specification first, no recipe, signature lines; and **Comparison**. **Save as template** keeps your own block list.

**Document**: the fields that change per report, title, customer, document number, revision, date and designer. **Branding**: what does not, company line, accent color, footer line, default designer and logo, saved once for every report. Templates and the branding profile are saved in your TFStudio data folder.

**Designs**: pick more than one and the report becomes a comparison. The designs are lettered A, B, C with their full names in a key under the masthead, so a long name never widens a column. Facts, verdicts, integral values and color become one table with a column per design, six to a table; the spectrum block draws every design on one plot, and recipes sit side by side. Blocks with no comparison form render once per design. With no design open the report covers only the designs picked.

**Export**, bottom right: a PDF with running header, footer and page numbers; one self-contained HTML file; or every table as tab-separated text for a spreadsheet. Paper size, A4 or Letter, and the document's language are set apart from the app's, with defaults under Preferences, Analysis, Report.
