---
title: Measured Ellipsometry
description: Import a measured Ψ and Δ pair from a spectroscopic ellipsometer, compare it against the design, and export measured or calculated Ψ/Δ as CSV.
ribbonIcon: measured-ellipsometry
---

Measured Ellipsometry brings a spectroscopic ellipsometer's Ψ and Δ into a design: **Import** reads the pair from an instrument file and stores it on the design, **Export** writes the imported curves or the design's calculated Ψ and Δ to CSV. These curves live apart from the photometric ones in [Measured Spectra](/data-exchange/measured-spectra/) because they have no percent scale and no polarization to choose, mean nothing without an angle, and carry a Δ sign that differs between instruments. A pair imported here is what [n,k Characterization](/data-exchange/nk-characterization/) reads.

<!-- shot: measured-ellipsometry | Ψ and Δ at 70° of an as-built 500 nm TiO2 film on BK7 read from CSV and added to the design -->
![Measured Ellipsometry](/screenshots/measured-ellipsometry.png)

## Computed quantities

- The preview plots the column being configured, or a curve on the design when its card is clicked.
- On [Ellipsometry](/analysis/ellipsometry/) the curves and any fit targets are drawn over the design's Ψ and Δ, in the Δ convention that plot shows.
- A fit target scores the design's Ψ or Δ against the measured points, Δ the short way round the circle.

## What kind of measurement this takes

Reflection ellipsometry on an isotropic sample: Ψ or Δ in degrees against wavelength, measured in reflection at a stated angle, with the definition the [Ellipsometry](/analysis/ellipsometry/) window uses ([Theory](#theory)). A thickness fit takes either curve alone; [n,k Characterization](/data-exchange/nk-characterization/) needs both halves of one measurement, since it solves for two unknowns at each wavelength.

| Not supported | Instead |
|---|---|
| **Transmission ellipsometry**, a different quantity from the reflected pair | Measure the sample in reflection. |
| **Generalised or Mueller-matrix ellipsometry**, an anisotropic or depolarising sample | Nothing here covers it; the film is isotropic. |
| **Is, Ic and Ic′**, the native output of a phase-modulated ellipsometer | Export Ψ and Δ from the instrument's software. |
| **tan Ψ and cos Δ**, sometimes written under headings `PSI` and `DELTA` | Convert to degrees first. A Δ column that never leaves −1 to 1 is flagged rather than fitted. |
| **An angle sweep at one wavelength** | Use [Ellipsometry](/analysis/ellipsometry/) in angular mode. |

Which instrument exports have been read end to end is under [Ellipsometry files](/data-exchange/spectrum-file-formats/#ellipsometry-files).

## Controls and settings

Curves belong to the design selected in the project explorer, as in Measured Spectra.

**Open file…** reads a file. The panel reports what was parsed and lets you set the wavelength unit, the column, Ψ or Δ, and the name. Ψ and Δ are told apart by value, not column order: Ψ cannot leave 0 to 90°, so a column outside that is Δ; a column named `Psi` or `Delta` is taken at its word, and one click swaps them. Then what the file may leave unsaid, kept on each curve and editable on its card:

- **Angle of incidence**, asked when a column has none. At normal incidence any film gives Ψ = 45° and Δ = 180°, so a fit refuses a curve at 0°. It starts at 70°, near silicon's principal angle, where most fixed-angle instruments sit.
- **Δ convention**: **Azzam–Bashara**, what measurement files carry and the default, or **360° − Δ** for data in the other time convention. It must agree with the [Ellipsometry](/analysis/ellipsometry/) window's choice; a Δ that looks like the design's mirror image means it does not.
- **Incidence side**, on a design coated on both faces: which face's coating was measured. A back-face curve is drawn on the back side of Ellipsometry and cannot be fitted yet.

**Add this column** adds the configured column; **Add all typed columns** adds every column with a quantity, as a two-column Ψ/Δ file wants. Each curve's card shows whether it is drawn, its color, which half it is, its name, angle, face, Δ convention, point count and range.

**New curve** and **Edit** open the curve editor of [Measured Spectra](/data-exchange/measured-spectra/#typing-a-curve-or-changing-its-points) with a Ψ and a Δ column in degrees, over the design's own Ψ or Δ at the curve's angle. A Ψ outside 0 to 90° is red, and Δ is smoothed and resampled unwrapped. A new curve arrives at normal incidence; set its angle and convention on its card after **Apply**.

**Export**: **Measured** writes the ticked curves. **Calculated from the design** writes the design's Ψ and Δ over a range, step and angle you choose, in the Δ convention set beside the button, apart from the Import tab's; instrument software reads Azzam–Bashara. The X axis is nm, µm or eV.

Exporting a design's calculated Ψ and Δ and fitting it back in n,k Characterization should return the film you started from with a residual near zero; if the loop does not close, check the Δ convention and the angle first.

## Fitting the design to a measurement

**Fit…** on a curve makes it a merit target, so [Refinement](/synthesis/refinement/) moves the thicknesses until the calculated Ψ or Δ matches, with the grid, range, weight and constraints of [Measured Spectra](/data-exchange/measured-spectra/#fitting-the-design-to-a-measurement). It characterizes a known stack; floating the index too is [n,k Characterization](/data-exchange/nk-characterization/).

- Each curve is fitted on its own as one row holding its points. Ψ alone fixes the thicknesses of a known stack over a spectral range, so does Δ, and a Δ at another angle is one more target; **Fit…** on each half adds both.
- The Δ convention travels with the row and is converted on the way into the merit function; the wrong one is out by tens of degrees.
- Ψ and Δ carry their own [unit scale](/design/operands/#unit-scale) against reflectance rows, set by what an ellipsometer resolves rather than by the 90° and 360° ranges.
- A uniform resample of Δ interpolates the unwrapped angle, so it never invents targets through 180° where the measurement crosses 360°.
- The fit is refused at normal incidence, and for a back-face curve, since Ψ and Δ are evaluated on the front stack and the design must be evaluated on its front.

Ellipsometry draws the targets whether or not the curves remain, and the Import tab offers to restore them.

## Theory

Ψ and Δ come from the ratio of the reflected p and s amplitudes:

```
ρ = r_p / r_s = tan Ψ · exp(i Δ)
Δ′ = 360° − Δ                         other time convention
r = ((Δ_design − Δ_meas + 180°) mod 360°) − 180°
```

Ψ is the arctangent of a magnitude ratio, so it stays within 0 to 90°, while Δ runs over a full turn; r is the Δ residual taken the short way round, so 359° against 1° misses by 2°.

## References

- R. M. A. Azzam and N. M. Bashara, *Ellipsometry and Polarized Light* (North-Holland, 1977): the definition of Ψ and Δ and the sign convention.
- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Section 14.2, pp. 544–560 (Eq. 14.17): ellipsometric parameters of a coating.
