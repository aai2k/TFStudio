---
title: Spectrum File Formats
description: "What the measured-spectrum importer reads: delimited text in any common layout, JCAMP-DX, and the instrument quirks it handles automatically."
ribbonIcon: spectrum-exchange
---

This page answers one question: **will TFStudio read the file my instrument
writes?** For almost every UV/Vis/NIR spectrophotometer the answer is yes,
because the importer reads the shapes real instruments produce rather than one
tidy ideal. Import happens in the
[Measured Spectra](/data-exchange/measured-spectra/) window.

## Delimited text

Any `λ, value` table, whatever the extension: `.csv`, `.txt`, `.asc`, `.dat`,
`.dpt`, `.ttt`, and the rest.

| Detected automatically | Values it handles |
| --- | --- |
| Delimiter | Comma, semicolon, tab, or runs of spaces |
| Decimal separator | Point or comma. `400,5;88,51` reads correctly |
| Wavelength unit | Nanometres, micrometres, or wavenumber in cm⁻¹ |
| Quantity | Transmittance, reflectance, absorptance |
| Y scale | Fraction, percentage, or absorbance |

Everything detected can be overridden before you add the curve, so a file that
declares nothing still imports in two clicks.

### Headers

Instruments rarely put one clean row of column names above the numbers. These
layouts are read as intended:

- **A settings block before the data.** Header lines that look like numbers, as
  PerkinElmer writes them, do not become part of the spectrum.
- **A marker line.** `#DATA`, `>>>>>Begin Spectral Data<<<<<` and similar say
  where the header ends, and the data is taken from after it.
- **Names on one line, units on the next.** `Wave ; Sample ; Reflectance` above
  `[nm] ; [counts] ; [%]` names each column and reads each column's own unit,
  so a percentage in one column does not set the scale of its neighbours.
- **A commented-out header.** A leading `;`, `#` or `//` is a marker, not a
  column.
- **Quoted names.** `"Wavelength nm.","R%"` imports as reflectance.
- **Either spelling of a percentage.** `%T` and `T%` both mean transmittance.

### Rows

- **A label at the start of every row**, as reflectometers often write, is
  recognised and dropped: `uR 402.5238 0.0 0.237728 0.01` is one data row.
- **Rows with no value** are left out and counted, so a file that alternates a
  reading with a blank line tells you how many rows it lost rather than
  silently halving the measurement.
- **Descending wavelengths** are sorted on the way in.
- **A trailing statistics block** after the data is ignored.

### Several samples in one file

Software that measures a batch writes one wavelength column per sample:

```
AR_front,,AR_back,
Wavelength (nm),%T,Wavelength (nm),%T
400.00,88.51,400.00,87.90
```

The repeated wavelength columns are recognised as sample boundaries rather than
offered as curves, and each measurement is named after the sample it belongs
to. Import one column with **Add to design**, or all of them with **Add all
curves**.

## JCAMP-DX

The IUPAC spectroscopy standard, `.dx` and `.jdx`, read and written. It carries
its own units and quantity, so it imports without configuration. Compound
`LINK` files import every block as a separate curve. Both the fixed-format
`XYDATA` compressions and the `XYPOINTS` pair list are supported.

Export writes JCAMP-DX in the same wavelength unit and Y scale you choose for
CSV, which makes a TFStudio curve loadable in any spectroscopy package.

## Instruments this has been checked against

Real exports from these have been read end to end: PerkinElmer (both the PEDS
ASCII format and JCAMP-DX), Shimadzu UV-Probe, Agilent Cary, Filmetrics,
Avantes AvaSoft, Ocean Optics, and reflectometer and ellipsometer text formats.

If yours is not on the list it will very probably still import, because the
list is instruments that were tested rather than instruments that work. A file
that does not import, or imports as the wrong quantity, is worth
[reporting](https://github.com/aai2k/TFStudio/issues) with the file attached.

## What it does not read

- **Binary instrument files.** PerkinElmer `.sp`, Cary `.BSW`, Galactic `.SPC`,
  Bruker OPUS, and the Avantes `.TRM` and `.ROH` families. Every one of these
  has an ASCII or JCAMP-DX export in its own software; use that.
- **Ellipsometry data.** Ψ and Δ files parse as a table, but the pair is not yet
  read as an ellipsometric measurement.
- **Detector counts.** A column of raw counts imports as a spectrum and is
  scaled as though it were a percentage. Pick the column your instrument
  reports as R or T, not the raw signal, dark, or reference columns.
