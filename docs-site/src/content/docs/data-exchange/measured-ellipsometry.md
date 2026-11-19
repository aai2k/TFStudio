---
title: Measured Ellipsometry
description: Import a measured Ψ and Δ pair from a spectroscopic ellipsometer, compare it against the design, and export measured or calculated Ψ/Δ as CSV.
ribbonIcon: measured-ellipsometry
---

Measured Ellipsometry brings a spectroscopic ellipsometer's $\Psi$ and $\Delta$ into a design: **Import** reads the pair from an instrument file and stores it on the design, **Export** writes the imported curves or the design's calculated $\Psi$ and $\Delta$ to CSV. These curves live apart from the photometric ones in [Measured Spectra](/data-exchange/measured-spectra/) because they have no percent scale and no polarization to choose, mean nothing without an angle, and carry a $\Delta$ sign that differs between instruments. A pair imported here is what [n,k Characterization](/data-exchange/nk-characterization/) reads.

<!-- shot: measured-ellipsometry | Ψ and Δ at 70° of an as-built 500 nm TiO2 film on BK7 read from CSV and added to the design -->
![Measured Ellipsometry](/screenshots/measured-ellipsometry.png)

## Computed quantities

- The preview plots the column being configured, or a curve on the design when its card is clicked.
- On [Ellipsometry](/analysis/ellipsometry/) the curves and any fit targets are drawn over the design's $\Psi$ and $\Delta$, in the $\Delta$ convention that plot shows.
- A fit target scores the design's $\Psi$ or $\Delta$ against the measured points, $\Delta$ the short way round the circle.

## What kind of measurement this takes

Reflection ellipsometry on an isotropic sample: $\Psi$ or $\Delta$ in degrees against wavelength, measured in reflection at a stated angle, with the definition the [Ellipsometry](/analysis/ellipsometry/) window uses ([Theory](#theory)). A thickness fit takes either curve alone; [n,k Characterization](/data-exchange/nk-characterization/) needs both halves of one measurement, since it solves for two unknowns at each wavelength.

| Not supported | Instead |
|---|---|
| **Transmission ellipsometry**, a different quantity from the reflected pair | Measure the sample in reflection. |
| **Generalised or Mueller-matrix ellipsometry**, an anisotropic or depolarising sample | Nothing here covers it; the film is isotropic. |
| **Is, Ic and Ic′**, the native output of a phase-modulated ellipsometer | Export $\Psi$ and $\Delta$ from the instrument's software. |
| **$\tan\Psi$ and $\cos\Delta$**, sometimes written under headings `PSI` and `DELTA` | Convert to degrees first. A $\Delta$ column that never leaves −1 to 1 is flagged rather than fitted. |
| **An angle sweep at one wavelength** | Use [Ellipsometry](/analysis/ellipsometry/) in angular mode. |

Which instrument exports have been read end to end is under [Ellipsometry files](/data-exchange/spectrum-file-formats/#ellipsometry-files).

## Controls and settings

Curves belong to the design selected in the project explorer, as in Measured Spectra.

**Open file…** reads a file. The panel reports what was parsed and lets you set the wavelength unit, the column, $\Psi$ or $\Delta$, and the name. $\Psi$ and $\Delta$ are told apart by value, not column order: $\Psi$ cannot leave 0 to 90°, so a column outside that is $\Delta$; a column named `Psi` or `Delta` is taken at its word, and one click swaps them. Then what the file may leave unsaid, kept on each curve and editable on its card:

- **Angle of incidence**, asked when a column has none. At normal incidence any film gives $\Psi = 45^\circ$ and $\Delta = 180^\circ$, so a fit refuses a curve at 0°. It starts at 70°, near silicon's principal angle, where most fixed-angle instruments sit.
- **Δ convention**: **Azzam–Bashara**, what measurement files carry and the default, or **360° − Δ** for data in the other time convention. It must agree with the [Ellipsometry](/analysis/ellipsometry/) window's choice; a $\Delta$ that looks like the design's mirror image means it does not.
- **Incidence side**, on a design coated on both faces: which face's coating was measured. A back-face curve is drawn on the back side of Ellipsometry and cannot be fitted yet.

**Add this column** adds the configured column; **Add all typed columns** adds every column with a quantity, as a two-column $\Psi$/$\Delta$ file wants. Each curve's card shows whether it is drawn, its color, which half it is, its name, angle, face, $\Delta$ convention, point count and range.

**New curve** and **Edit** open the curve editor of [Measured Spectra](/data-exchange/measured-spectra/#typing-a-curve-or-changing-its-points) with a $\Psi$ and a $\Delta$ column in degrees, over the design's own $\Psi$ or $\Delta$ at the curve's angle. A $\Psi$ outside 0 to 90° is red, and $\Delta$ is smoothed and resampled unwrapped. A new curve arrives at normal incidence; set its angle and convention on its card after **Apply**.

**Export**: **Measured** writes the ticked curves. **Calculated from the design** writes the design's $\Psi$ and $\Delta$ over a range, step and angle you choose, in the $\Delta$ convention set beside the button, apart from the Import tab's; instrument software reads Azzam–Bashara. The X axis is nm, µm or eV.

Exporting a design's calculated $\Psi$ and $\Delta$ and fitting it back in n,k Characterization should return the film you started from with a residual near zero; if the loop does not close, check the $\Delta$ convention and the angle first.

## Fitting the design to a measurement

**Fit…** on a curve makes it a merit target, so [Refinement](/synthesis/refinement/) moves the thicknesses until the calculated $\Psi$ or $\Delta$ matches, with the grid, range, weight and constraints of [Measured Spectra](/data-exchange/measured-spectra/#fitting-the-design-to-a-measurement). It characterizes a known stack; floating the index too is [n,k Characterization](/data-exchange/nk-characterization/).

- Each curve is fitted on its own as one row holding its points. $\Psi$ alone fixes the thicknesses of a known stack over a spectral range, so does $\Delta$, and a $\Delta$ at another angle is one more target; **Fit…** on each half adds both.
- The $\Delta$ convention travels with the row and is converted on the way into the merit function; the wrong one is out by tens of degrees.
- $\Psi$ and $\Delta$ carry their own [unit scale](/design/operands/#unit-scale) against reflectance rows, set by what an ellipsometer resolves rather than by the 90° and 360° ranges.
- A uniform resample of $\Delta$ interpolates the unwrapped angle, so it never invents targets through 180° where the measurement crosses 360°.
- The fit is refused at normal incidence, and for a back-face curve, since $\Psi$ and $\Delta$ are evaluated on the front stack and the design must be evaluated on its front.

Ellipsometry draws the targets whether or not the curves remain, and the Import tab offers to restore them.

## Theory

$\Psi$ and $\Delta$ come from the ratio of the reflected p and s amplitudes:

$$
\begin{aligned}
\rho = r_p / r_s &= \tan\Psi \cdot \exp(i\Delta) \\
\Delta' &= 360^\circ - \Delta && \text{other time convention} \\
r &= \bigl((\Delta_\text{design} - \Delta_\text{meas} + 180^\circ) \bmod 360^\circ\bigr) - 180^\circ
\end{aligned}
$$

$\Psi$ is the arctangent of a magnitude ratio, so it stays within 0 to 90°, while $\Delta$ runs over a full turn; $r$ is the $\Delta$ residual taken the short way round, so 359° against 1° misses by 2°.

## References

- R. M. A. Azzam and N. M. Bashara, *Ellipsometry and Polarized Light* (North-Holland, 1977): the definition of $\Psi$ and $\Delta$ and the sign convention.
- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Section 14.2, pp. 544–560 (Eq. 14.17): ellipsometric parameters of a coating.
