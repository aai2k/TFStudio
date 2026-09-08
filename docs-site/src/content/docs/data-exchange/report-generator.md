---
title: Report
description: Assemble a document from blocks over one or several designs, then save it as a PDF or a single HTML file.
ribbonIcon: report-gen
---

The **Report** window builds the document you hand to a customer or file with a design. It is a docked window like the analysis windows: the block list on the left, the page on the right, and the page follows the design as you edit it. Every number comes from the same calculation engines as the analysis windows, so the report shows what the app shows.

Open it from the **Report** button on the **Production** ribbon tab.

## Blocks

A report is an ordered list of blocks. Each block is a table first, with an optional plot. Five blocks are in every new report: title, design facts with the stack diagram, layer table, materials, and notes. A template can switch them off but not remove them.

Other blocks come from the analysis windows: spectrum, color, integral values, group delay with GDD and TOD, ellipsometry, electric field and refractive index profile, plus the specification verdict, the merit function operands and a signature line. Add them with **Add block** at the bottom of the rail. A new block copies the settings its window shows right now, or that window's saved defaults if it has not been opened, so a range set once in Optical Evaluation is not typed again.

Two blocks reach into production. **Monte-Carlo** prints the last run made in the Monte-Carlo window for the design: the design curve, the mean over the trials, the corridor, the statistics per wavelength and the specification yield. It does not repeat the run; run it there again to refresh. **Monitoring worksheet** prints the witness-chip table from the Monitor Worksheet: one row per deposited layer with every column the window shows. The chip plan, the wavelengths, the chip glass and the monitor settings are the window's own for the design; change them there and the report follows.

Tick a block to include it, drag it to reorder, and open its gear to change its settings: range and step, angles, curves, plot size, and how often the table samples the curve. The spectrum block carries the Optical Evaluation window's own controls: the angle chips, the curves with their s and p components, the spectral unit, and the vertical scale (percent, fraction, dB or optical density) with its range. The gear also moves or removes the block.

## Layer table

The layer table lists number, material, thickness and QWOT. Layer 1 is next to the substrate, on both sides, and the page says so under the table. A long stack flows into side-by-side columns, so about 150 layers fit on one page. Switch on **n, OT, FWOT columns** for the full optical thickness family; it trades columns for width. **Group identical periods** merges a repeated period such as (H L) × 24 into one row. Only rows identical at the printed precision merge, so a refined stack whose thicknesses differ in the last digit prints every layer.

## Templates, document fields and branding

The **Template** list holds three: Design record, the default, with everything including the recipe; Customer report, with the specification first, no recipe and signature lines; and Comparison. Save your own block list with **Save as template**.

**Document** holds the fields that change per report: title, customer, document number, revision, date and designer. **Branding** holds what does not: company line, accent color, footer line, default designer and logo. Save the profile once and every report uses it.

## Several designs

Pick more than one design under **Designs** and the report becomes a comparison. The designs are lettered A, B, C and listed with their full names in a key under the masthead; tables, plot legends and recipe headings refer to them by letter, so a long name never widens a column. Facts, verdicts, integral values and color render as one table with a column per design, six designs to a table, the spectrum block draws every design on one plot, and the recipes sit side by side. Blocks without a comparison form render once per design.

## Export

The Export menu at the bottom right saves a PDF with a running header and footer and page numbers, saves a single self-contained HTML file, or copies every table as tab-separated text for a spreadsheet. Paper size is A4 or Letter, and the language of the document is chosen independently of the app's. Both have defaults under Settings, Analysis, Report.

Saved templates and the branding profile go to your TFStudio data folder.
