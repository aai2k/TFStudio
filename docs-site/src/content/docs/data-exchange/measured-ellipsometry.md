---
title: Measured Ellipsometry
description: Import a measured Ψ and Δ pair from a spectroscopic ellipsometer, compare it against the design, and export measured or calculated Ψ/Δ as CSV.
ribbonIcon: measured-ellipsometry
---

The **Measured Ellipsometry** window brings a spectroscopic ellipsometer's
Ψ and Δ into a design. **Import** reads the pair from an instrument file and
stores it on the design; **Export** writes either your imported curves or the
design's own calculated Ψ/Δ to CSV.

Ellipsometric curves live apart from the photometric ones in
[Measured Spectra](/data-exchange/measured-spectra/), and for good reason: they
carry no percent scale, there is no polarization to choose, they mean nothing
without an angle of incidence, and their Δ carries a sign convention that
differs between instruments. A Ψ/Δ pair imported here is what
[n,k Characterization](/data-exchange/nk-characterization/) reads to derive a
film's constants.

## What kind of measurement this takes

**Reflection ellipsometry on an isotropic sample.** Ψ and Δ are defined here
from the reflected amplitude ratio,

```
ρ = r_p / r_s = tan(Ψ) · exp(i Δ)
```

which is the same definition [Ellipsometry](/analysis/ellipsometry/) computes
the design's own curves from. So a measurement imports and fits when it is a
Ψ and Δ pair, in degrees, against wavelength, taken in reflection at a stated
angle.

These are outside that, and none of them is read:

| Not supported | What to do instead |
| --- | --- |
| **Transmission ellipsometry.** The model is the reflected pair; a measurement made through the sample is a different quantity. | Measure the same sample in reflection. |
| **Generalised or Mueller-matrix ellipsometry**, and any anisotropic or depolarising sample. | Nothing here covers it. The film is isotropic. |
| **Is, Ic and Ic′**, the native quantities a phase-modulated ellipsometer writes. | Export the measurement as Ψ and Δ from the instrument's own software. |
| **tan Ψ and cos Δ** rather than degrees. Some exports write these under headings that say `PSI` and `DELTA`. | Convert to degrees before importing. The window detects the Δ column and warns rather than fitting them. |
| **An angle sweep at one wavelength.** | Curves here are functions of wavelength. Use [Ellipsometry](/analysis/ellipsometry/) in angular mode to compare a design against one. |

Which instrument exports have been read end to end, and which have not, is in
[Ellipsometry files](/data-exchange/spectrum-file-formats/#ellipsometry-files).

## Import

Press **Open file…** and pick a file. What the importer reads, and which
instrument exports have been checked against it, is on the
[Ellipsometry file formats](/data-exchange/spectrum-file-formats/#ellipsometry-files)
section of the formats page.

### Measurement conditions

Set these before adding a curve. They are stored on each curve and can be
corrected afterwards on the curve's own card.

- **Angle of incidence.** The angle the instrument measured at, and the one
  setting a Ψ/Δ pair cannot be read without. At normal incidence there is no
  p-versus-s distinction left to measure, so any film gives Ψ = 45° and
  Δ = 180° and the pair says nothing about the coating. A fit refuses a curve
  that arrives at 0°.

  The window starts at 70°, which is where most fixed-angle instruments sit,
  near the principal angle of silicon. If the file states its angle it is read
  from the file instead; many do not, so check it.

- **Δ convention.** Two are offered:

  | Setting | What it means |
  | --- | --- |
  | **Azzam–Bashara** | What measurement files carry. This is the default and the one to leave alone unless you know otherwise. |
  | **360° − Δ** | Δ with the opposite sign, for data written in the other time convention. Ψ is the same either way. |

  The same choice appears in
  [Ellipsometry](/analysis/ellipsometry/) for the calculated curves, and the two
  have to agree or the comparison is meaningless. If an imported Δ looks like a
  mirror image of the design's, this is the setting to change.

- **Incidence side.** Which face of the sample the beam entered.

### Configuring the columns

The panel reports what was parsed and lets you correct it before anything is
added: the wavelength unit, which column to take, whether it is Ψ or Δ, and the
curve's name. The preview beside it plots the column you are configuring, and
goes back to a curve on the design when you click one.

**Ψ and Δ are told apart from the values, not from the column order.** Ψ is the
arctangent of a magnitude ratio, so it cannot leave 0 to 90 degrees, while Δ
runs over a full turn. A column that goes above 90 or below zero is therefore
Δ and cannot be Ψ. Where that settles nothing the file order stands, and one
click swaps them. A column the file names `Psi` or `Delta` is taken at its word.

**Add this column** adds the one you configured. **Add all typed columns** adds
every column that has a quantity, which is what a two-column Ψ/Δ file wants.

### What is on the design

Curves are grouped by angle and side, because a fit needs both halves of one
measurement. A group missing its partner says so rather than sitting in a flat
list looking usable. Each card carries the curve's colour, name, quantity,
angle, side, Δ convention and point count, and all of them stay editable.

A Δ column that never leaves −1 to 1 is flagged. At least one instrument writes
tan Ψ and cos Δ under headings that say `PSI` and `DELTA`; read as degrees those
numbers are legal and the mistake is invisible, so the window says so instead of
letting a fit run on them. Convert such a file to degrees before importing it.

## Export

**Measured** writes the curves on the design, with a checkbox per curve.

**Calculated from the design** writes the design's own Ψ and Δ over a wavelength
range and step you choose, at an angle you choose. Use it to hand a target to an
instrument's own software, or to produce a reference file. Δ is written in the
convention selected in the Import tab, which is stated under the button.

The X axis of either export can be nanometres, micrometres, or photon energy in
eV.

## A round trip worth doing once

Exporting a design's calculated Ψ/Δ and importing it straight back is the
quickest way to satisfy yourself that the conventions on both sides line up. Fit
it in [n,k Characterization](/data-exchange/nk-characterization/) and you should
get the film you started from, with a residual near zero. A 500 nm TiO₂ layer
put through that loop comes back at 499.9 nm with residuals of 0.008° in Ψ and
0.05° in Δ. If your own loop does not close, the Δ convention or the angle of
incidence is the first thing to check.
