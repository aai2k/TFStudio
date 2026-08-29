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

## Ellipsometry files

A Ψ and Δ pair is imported in
[Measured Ellipsometry](/data-exchange/measured-ellipsometry/), not in Measured
Spectra, and everything above about delimiters, decimal separators and headers
applies to it. Three things are specific to these files.

**The X axis may be photon energy.** Ellipsometry software often works in eV.
An axis is read as eV only when the header says so, never from the numbers: an
eV axis and a micrometre axis span the same range, so a guess would convert
silently and be invisible afterwards.

**Which column is Ψ and which is Δ** is decided from the values rather than the
order, because vendors disagree about the order. Ψ is the arctangent of a
magnitude ratio and cannot leave 0 to 90 degrees, so a column that goes above 90
or below zero is Δ. Either can be overridden in one click.

**The angle of incidence** is read from a header line that names it (`AOI 70`,
`Angle of incidence 70`), or from a data column named the same way, in which
case a file that repeats its wavelengths once per angle is split into one Ψ/Δ
pair per angle. A file that states its angle in neither place imports at the
angle set in the panel, so check it.

### What has been checked

| Instrument and layout | Result |
| --- | --- |
| **SENTECH SpectraRay.** `; WAVELENGTH <angle> <angle>` header, then λ, Ψ, Δ | Imports. Columns typed from the values. The angle appears only as a column heading, so set it in the panel. |
| **ADAP.** `SE PSI DELTA` header with a separate `AOI` line | Imports, angle read from the header. This exporter writes tan Ψ and cos Δ under headings that say `PSI` and `DELTA`; the Δ column is detected and the window says so. Convert to degrees before fitting. |
| **J.A. Woollam WVASE, spectroscopic.** Unit line, then λ, angle, Ψ, Δ | λ, Ψ and Δ import. In this export the angle column carries no name, so it is offered as a curve instead of splitting the file by angle: set the angle by hand, or name that column `AOI` first. |
| **J.A. Woollam WVASE, single wavelength.** `Angle of Incidence, Psi, Delta` | Not read. This is an angle sweep at one wavelength; the window's curves are functions of wavelength. |
| **Accurion.** `#` name row and `#` unit row, angle and λ as columns, Δ before Ψ | Not read. The wavelength is the third column, and the importer takes the first column as the axis. |

Any other delimited file holding a wavelength, a Ψ and a Δ should import: those
five are what could be obtained to check against, not the limit of what works.
A file that does not import is worth
[reporting](https://github.com/aai2k/TFStudio/issues) with the file attached.

A file being readable is not the same as its measurement being one TFStudio
models. Reflection ellipsometry on an isotropic sample is what these curves
mean, and transmission ellipsometry, Mueller-matrix data, and an instrument's
native Is/Ic/Ic′ are not read at all: see
[what kind of measurement the window takes](/data-exchange/measured-ellipsometry/#what-kind-of-measurement-this-takes).

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
- **Detector counts.** A column of raw counts imports as a spectrum and is
  scaled as though it were a percentage. Pick the column your instrument
  reports as R or T, not the raw signal, dark, or reference columns.
