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
Ψ or a Δ, in degrees, against wavelength, taken in reflection at a stated
angle. A thickness fit takes either curve on its own;
[n,k Characterization](/data-exchange/nk-characterization/) needs both halves
of one measurement, because it solves for two unknowns at every wavelength.

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

An opened file belongs to the design selected in the project explorer. Select
another design and the window shows that design's curves and nothing of the
file; come back and the file is where you left it. With no design selected
there is nothing to import into, and the button is off.

### Configuring the columns

The panel reports what was parsed and lets you correct it before anything is
added: the wavelength unit, which column to take, whether it is Ψ or Δ, and the
curve's name. The preview beside it plots the column you are configuring, and
goes back to a curve on the design when you click one. Drag the divider
between the panel and the plot to give either one more room.

Below the name come the things a file may leave unsaid. They are stored on the
curve when it is added and stay editable on its card afterwards.

- **Angle of incidence**, asked only when the file leaves a column without
  one, and covering every such column because **Add all typed columns** adds
  them too. It is the one setting a Ψ/Δ pair cannot be read without: at normal
  incidence there is no p-versus-s distinction left to measure, so any film
  gives Ψ = 45° and Δ = 180° and the pair says nothing about the coating. A
  fit refuses a curve that arrives at 0°. The field starts at 70°, which is
  where most fixed-angle instruments sit, near the principal angle of silicon.

- **Δ convention**, asked once the file holds a Δ column, because no file
  states it. Two are offered:

  | Setting | What it means |
  | --- | --- |
  | **Azzam–Bashara** | What measurement files carry. This is the default and the one to leave alone unless you know otherwise. |
  | **360° − Δ** | Δ with the opposite sign, for data written in the other time convention. Ψ is the same either way. |

  The same choice appears in
  [Ellipsometry](/analysis/ellipsometry/) for the calculated curves, and the two
  have to agree or the comparison is meaningless. If an imported Δ looks like a
  mirror image of the design's, this is the setting to change.

- **Incidence side**, asked only for a design coated on both faces: which
  face's coating the measurement belongs to. A back-face curve is drawn on the
  back side of [Ellipsometry](/analysis/ellipsometry/) and cannot be fitted
  yet. Its card keeps the setting whatever the design carries later, so a curve
  marked as the back one can always be put back on the front.

**Ψ and Δ are told apart from the values, not from the column order.** Ψ is the
arctangent of a magnitude ratio, so it cannot leave 0 to 90 degrees, while Δ
runs over a full turn. A column that goes above 90 or below zero is therefore
Δ and cannot be Ψ. Where that settles nothing the file order stands, and one
click swaps them. A column the file names `Psi` or `Delta` is taken at its word.

**Add this column** adds the one you configured. **Add all typed columns** adds
every column that has a quantity, which is what a two-column Ψ/Δ file wants.

### What is on the design

Each curve is one card: whether it is drawn, its colour, which half it is and
its name on the first line, and under them the angle it was measured at, the
face it belongs to when the design has two coated faces, the sign a Δ was
written in, and its point count and range. Everything stays editable. Click a
card to see that curve in the preview.

A Δ column that never leaves −1 to 1 is flagged. At least one instrument writes
tan Ψ and cos Δ under headings that say `PSI` and `DELTA`; read as degrees those
numbers are legal and the mistake is invisible, so the window says so instead of
letting a fit run on them. Convert such a file to degrees before importing it.

## Fitting the design to a measurement

**Fit…** on a curve turns it into a merit-function target, so
[Refinement](/synthesis/refinement/) can adjust the design's thicknesses until
its calculated Ψ or Δ matches what you measured. It is the same step
[Measured Spectra](/data-exchange/measured-spectra/#fitting-the-design-to-a-measurement)
offers for a reflectance or transmittance curve, with the same grid choices,
range, weight and thickness constraints, and it is characterization of a stack
you already know the recipe for, not recovery of an unknown one. Letting the
index float alongside the thicknesses is what
[n,k Characterization](/data-exchange/nk-characterization/) does.

Curves are fitted one at a time, and each becomes one row in the
[Merit Function Editor](/design/merit-function-editor/) holding its own copy of
the sampled points. Ψ alone is a legitimate target: over a spectral range it
determines the thicknesses of a known stack. So is Δ alone, and a Δ measured
at another angle is simply another target. To fit both halves of one
measurement, press **Fit…** on each; the rows add up in the merit function.

What is different from a photometric fit:

- **The Δ convention travels with the target.** The row stores the sign its
  file was written in and converts on the way into the merit function, so a
  pair imported as Azzam–Bashara scores against the design's Δ in the same
  sign. The wrong convention is out by tens of degrees, not by fractions.
- **Δ is scored the short way round.** A design at 359° against a target of 1°
  is two degrees away, not 358, so a target sitting next to the 0°/360° wrap
  does not pull the optimizer the long way round.
- **Ψ and Δ carry their own scale** against reflectance targets sharing the
  table, set from what a spectroscopic ellipsometer resolves rather than from
  the 90° and 360° ranges. See
  [Operand reference](/design/operands/#mixed-unit-normalization).
- **A uniform resample of Δ** interpolates the unwrapped angle, so a resampled
  grid never invents targets passing through 180° where the measurement
  crosses 360°.

The fit is refused at normal incidence, where Ψ and Δ say nothing about the
film, and for a curve measured on the back face: Ψ and Δ are evaluated on the
front stack alone, and the design has to be evaluated on its front side too.

[Ellipsometry](/analysis/ellipsometry/) draws the targets whether or not the
design still holds the curves behind them, in whichever Δ convention the plot
is showing, and the Import tab offers to restore the curves from the targets,
as Measured Spectra does.

## Export

**Measured** writes the curves on the design, with a checkbox per curve.

**Calculated from the design** writes the design's own Ψ and Δ over a wavelength
range and step you choose, at an angle you choose. Use it to hand a target to an
instrument's own software, or to produce a reference file. Δ is written in the
convention chosen beside the button; an instrument's software reads
Azzam–Bashara. That choice is the export's own: it does not change the
convention an opened file is read under, which is on the Import tab.

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
