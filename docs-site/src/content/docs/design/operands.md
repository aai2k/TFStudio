---
title: Operand Reference
description: "Every merit-function operand: what it computes, the arguments it takes, the value it outputs, and how it drives the optimizer."
ribbonIcon: merit-function
---

This page is the complete catalog of **merit-function operands**. Each row in
the [Merit Function Editor](/design/merit-function-editor/) table is one
operand: a single number the optimizer reads, compared against a target.

## How an operand contributes to the merit function

The merit function (MF) is the **weighted root-mean-square of the residuals**:

```
MF = √( Σ_i  wᵢ · residualᵢ²  /  Σ_i wᵢ )
```

Note the weight `wᵢ` is applied **linearly** (not squared). In the
least-squares solver each residual enters as `√wᵢ · residualᵢ`, whose square is
`wᵢ · residualᵢ²`: consistent with the formula above.

The **residual** depends on the operand class:

| Class                              | Residual                         | Inert when satisfied? |
| ---------------------------------- | -------------------------------- | --------------------- |
| Equality (most optical operands)   | `value − target`                 | no (two-sided)        |
| One-sided ≥ (OPGT, ABGT, MNT, TMN…)| `max(0, target − value)`         | yes                   |
| One-sided ≤ (OPLT, ABLT, MXT, TMX…)| `max(0, value − target)`         | yes                   |
| Spectral target (TGT/RGT/AGT)      | the RMS deviation itself         | no                    |

"Inert when satisfied" means the operand drops out of the MF entirely once its
inequality holds, so it never fights the equality targets.

### Mixed-unit normalization

Most operands are fractions (T/R/A ∈ [0,1]), but **argmax/argmin-λ operands
produce a residual in nanometres**. In a single weighted RMS a 10 nm wavelength
miss (residual 10) would swamp a 1 % optical miss (residual 0.01) no matter how
the weights were set. To keep `weight` meaning *importance* rather than
*units*, each residual is divided by a per-type characteristic scale **σ**
before the RMS (a dimensionless, χ²-style sum):

```
MF = √( Σ wᵢ · (residualᵢ / σᵢ)²  /  Σ wᵢ )
```

| Operand class                       | σ          | Effect                                   |
| ----------------------------------- | ---------- | ---------------------------------------- |
| All fraction-unit (T/R/A, averages, integrals, worst-case, spectral-target RMS, math) | **1**      | unchanged, pure-optical MFs are identical to before |
| Argwave (`MXW*` / `MNW*`, nm)       | **500 nm** | 5 nm wavelength miss ≈ 1 % optical miss  |
| Thickness (`TT`, `MNT`, `MXT`, nm)  | **1** (raw nm) | kept "hard": a violated manufacturing bound still dominates and is fixed first |
| Ellipsometry `PSI` / `DEL` (deg)    | **90 / 180** | ~1° miss ≈ 1 % optical miss              |
| Group delay `GD*` / `GDD*` (fs, fs²)| **50**     | a ~0.5 fs / fs² miss ≈ 1 % optical miss   |
| Third-order dispersion `TOD*` (fs³) | **500**    | a ~5 fs³ miss ≈ 1 % optical miss          |
| `TANPSI`, `COSDEL`, `EFMX` (O(1))   | **1**      | already comparable to an optical fraction |

A purely optical merit function is therefore numerically unchanged; only merit
functions that **mix wavelength-valued and optical operands** rebalance.

## Common columns

Every operand row exposes the same columns; their **meaning changes with the
operand type** (the column header updates to match the focused row):

| Column        | Optical / band / integral / worst-case | Argwave (MXW*/MNW*) | Constraints (MNT/MXT) | Total thickness (TT) | Math (OPGT…PROD) |
| ------------- | -------------------------------------- | ------------------- | --------------------- | -------------------- | ---------------- |
| **λ / Start** | start wavelength (nm)                  | band start (nm)     | first layer index     | comparison (≤ ≥ =)   | referenced Op #  |
| **End**       | end wavelength (nm), band types only   | band end (nm)       | last layer index      | n/a                  | second Op # (pair ops) |
| **AOI (°)**   | angle of incidence                     | AOI                 | n/a                   | n/a                  | inherited from ref |
| **Pol**       | `avg` / `s` / `p`                      | pol                 | n/a                   | n/a                  | inherited from ref |
| **Target**    | desired value (see units below)        | desired λ (nm)      | bound (nm)            | total (nm)           | desired value (ref units) |
| **Weight**    | relative importance (linear)           | weight              | weight                | weight               | weight           |
| **Current**   | live computed value                    | computed λ (nm)     | min/max layer (nm)    | Σ thickness (nm)     | computed value   |
| **% of MF²**  | row's share of the weighted squared residual | same | same | same | same |

**Units:** T/R/A-valued operands store the target as a fraction in `[0,1]` and
display it as a percentage. Wavelength, layer-index, and thickness operands use
raw numbers (nm or count). Math operands inherit the unit of the row they
reference.

The final column uses the same definition for every row. If the merit function is nonzero, its percentages sum to 100%. If every row is exactly met, every contribution is zero. Disabled and unevaluable rows show a dash. Hover the cell to see the row's residual in its own unit, labelled as a difference, constraint slack, or RMS deviation as appropriate.

**Polarization** (`avg`/`s`/`p`) is chosen by the *Pol* column, not baked into
the type code. `avg` is the unweighted mean of s and p, `(Cs + Cp) / 2`.

**AOI / Snell:** the angle is the angle of incidence in the incident medium;
the internal substrate angle is derived from the real part of the refractive
index.

---

## Optical: single wavelength

Evaluated at exactly one wavelength (`λ / Start`).

| Type | Computes              | Target unit | Output    |
| ---- | --------------------- | ----------- | --------- |
| `T`  | Transmittance at λ    | %           | T ∈ [0,1] |
| `R`  | Reflectance at λ      | %           | R ∈ [0,1] |
| `A`  | Absorptance at λ      | %           | A ∈ [0,1] |

Residual: `value − target` (two-sided). Legacy files may contain the
polarization-suffixed forms `TS/TP/RS/RP/AS/AP`; they still evaluate (the
suffix sets the polarization) but are no longer offered in the dropdown; use
the *Pol* column instead.

## Optical: band average (single target)

Sampled on a uniform grid across `[λStart, λEnd]` (~2 nm spacing, clamped to
13…201 points), then **averaged to one number**.

| Type  | Computes                    | Target unit | Output         |
| ----- | --------------------------- | ----------- | -------------- |
| `TAV` | Mean T over the band        | %           | mean T ∈ [0,1] |
| `RAV` | Mean R over the band        | %           | mean R ∈ [0,1] |
| `AAV` | Mean A over the band        | %           | mean A ∈ [0,1] |

Residual: `mean − target` (two-sided). **`TAV/RAV/AAV` are pure averages**:
one target = the average level over the whole band. For a per-wavelength target
line use the spectral-target operands below.

## Spectral target: flat or linear ramp

A per-wavelength **target line** across the band. `Target` holds two values
entered as `start→end` (e.g. `50→50` for a flat 50 % line, `0→100` for a
ramp). Sampled on a density-based grid (~2 nm, the same density as band
averages); set `rampPoints` to override.

| Type  | Computes                        | Target unit | Output                        |
| ----- | ------------------------------- | ----------- | ----------------------------- |
| `TGT` | RMS deviation of T from line    | % (start→end) | RMS deviation (≥ 0)         |
| `RGT` | RMS deviation of R from line    | % (start→end) | RMS deviation (≥ 0)         |
| `AGT` | RMS deviation of A from line    | % (start→end) | RMS deviation (≥ 0)         |

The **Current** column shows the RMS deviation directly; the residual *is* that
value (target is already folded in), so the optimizer drives it to zero. Use
these for beamsplitters (flat 50 %) and gradient / ramp filters.

:::note
Spectral targets sample at ~2 nm (matching band averages), clamped to
13…201 points. For an exceptionally steep edge, raise `rampPoints` for an even
finer fit.
:::

## Weighted integral (source × detector)

A band average weighted by `w(λ) = Source(λ) · Detector(λ)`:
`C̄ = Σ wᵢ·Cᵢ / Σ wᵢ`. The *λ / Start* cell is a **preset picker** (e.g.
photopic-weighted Tvis, solar-weighted Tsol); the band end is read-only and
driven by the preset.

| Type  | Computes                                  | Target unit | Output       |
| ----- | ----------------------------------------- | ----------- | ------------ |
| `TIW` | Source×detector weighted mean T           | %           | C̄ ∈ [0,1]   |
| `RIW` | Source×detector weighted mean R           | %           | C̄ ∈ [0,1]   |
| `AIW` | Source×detector weighted mean A           | %           | C̄ ∈ [0,1]   |

Residual: `C̄ − target` (two-sided). Source/detector specs are stored on the
operand (default D65 × photopic).

## Worst-case (band extremum)

Returns the **true extremum** of the spectrum over the band, sampled on a dense
~1 nm grid. The residual is one-sided, inert until the worst case violates the
spec.

| Type  | Computes                    | Spec it enforces       | Residual                |
| ----- | --------------------------- | ---------------------- | ----------------------- |
| `TMN` | Minimum T over band         | `min T ≥ target`       | `max(0, target − minT)` |
| `RMN` | Minimum R over band         | `min R ≥ target`       | `max(0, target − minR)` |
| `AMN` | Minimum A over band         | `min A ≥ target`       | `max(0, target − minA)` |
| `TMX` | Maximum T over band         | `max T ≤ target`       | `max(0, maxT − target)` |
| `RMX` | Maximum R over band         | `max R ≤ target`       | `max(0, maxR − target)` |
| `AMX` | Maximum A over band         | `max A ≤ target`       | `max(0, maxA − target)` |

Output is a real T/R/A value (0…100 %), never exceeding physical bounds. The
optimizer uses the single argmin/argmax wavelength as the subgradient.

## Argmax / argmin wavelength

Sample C(λ) over the band, find the extremum, and refine it with a 3-point
parabolic fit. **Output is the wavelength (nm)** at that extremum, not the
T/R/A value.

| Type   | Computes                        | Target unit | Output  |
| ------ | ------------------------------- | ----------- | ------- |
| `MXWT` | λ of maximum T over band        | nm          | λ (nm)  |
| `MXWR` | λ of maximum R over band        | nm          | λ (nm)  |
| `MXWA` | λ of maximum A over band        | nm          | λ (nm)  |
| `MNWT` | λ of minimum T over band        | nm          | λ (nm)  |
| `MNWR` | λ of minimum R over band        | nm          | λ (nm)  |
| `MNWA` | λ of minimum A over band        | nm          | λ (nm)  |

Residual: `λ_extremum − target` (two-sided, in nm). Use to pin a peak / notch
to a desired wavelength. The default seed target is the band midpoint.

:::caution
The residual is in **nanometres**, so a 10 nm miss is a much larger residual
than a 0.01 optical miss. When mixing argwave operands with optical operands in
one merit function, tune weights so the units are commensurate.
:::

## Phase / field operands

Quantities derived from the **complex amplitude coefficients** or the **internal
electric field** of the front coating, rather than an intensity T/R/A. They
carry physical units (degrees, femtoseconds, or normalized field), so they use
the per-type σ scales above and drive the optimizer through the finite-difference
Jacobian. These match the [Ellipsometry](/analysis/ellipsometry/),
[GD & GDD](/analysis/gd-gdd/) and [E-field](/analysis/efield/) analysis windows
on the front surface.

### Ellipsometry

Evaluated at one wavelength (`λ / Start`). Ψ and Δ come from the complex ratio
ρ = r_p / r_s = tan Ψ · e^{iΔ}, so they use **both** polarizations and the *Pol*
column does not apply.

| Type     | Computes                     | Target unit | Output          |
| -------- | ---------------------------- | ----------- | --------------- |
| `PSI`    | Ellipsometric Ψ at λ         | deg         | Ψ ∈ [0°, 90°]   |
| `DEL`    | Ellipsometric Δ at λ         | deg         | Δ ∈ [0°, 360°)  |
| `TANPSI` | tan Ψ (ellipsometer-native)  | none        | ≥ 0             |
| `COSDEL` | cos Δ (ellipsometer-native)  | none        | [−1, 1]         |

Residual: `value − target` (two-sided). Use `PSI`/`DEL` to match a measured
ellipsometric spectrum, or to force a specific reflection-phase relationship.

### Group delay & dispersion

Phase, group delay, GDD, and TOD come from the complex reflection or
transmission amplitude at exactly the requested wavelength. `DPR` and `DPT`
are the cyclic p-minus-s phase difference. The *Pol* column selects s or p;
`avg` is their mean for non-differential operands.

| Type | Computes | Target unit | Output |
| ---- | -------- | ----------- | ------ |
| `PR`, `PT` | Reflection or transmission phase at λ | deg | phase (deg) |
| `DPR`, `DPT` | p-minus-s differential phase at λ | deg | phase (deg) |
| `GD`, `GDT` | Reflection or transmission group delay at λ | fs | GD (fs) |
| `GDD`, `GDDT` | Reflection or transmission GDD at λ | fs² | GDD (fs²) |
| `TOD`, `TODT` | Reflection or transmission TOD at λ | fs³ | TOD (fs³) |
| `GDFLAT`, `GDTFLAT` | RMS deviation of GD from a flat level | fs | RMS deviation (≥ 0) |
| `GDDFLAT`, `GDDTFLAT` | RMS deviation of GDD from a flat level | fs² | RMS deviation (≥ 0) |
| `TODFLAT`, `TODTFLAT` | RMS deviation of TOD from a flat level | fs³ | RMS deviation (≥ 0) |

Point residuals are two-sided (`value - target`). Phase residuals wrap to the shortest difference in the range -180° to 180°. The `*FLAT` operands carry their RMS deviation directly, so the optimizer drives it to zero. In the merit table, **Current** for a flatness row is the arithmetic mean GD, GDD, or TOD across the band, which can be read directly against the target level. The RMS deviation used by the merit function remains in the contribution-cell tooltip. Every point operand uses the same analytic evaluator as the GD / GDD window; there is no nearby sample or finite-difference wavelength grid. These operands score the front coating normally and the back coating when the design surface mode is back-only. Total-system phase-dispersion operands are not defined. In Total merit mode, ordinary R and T operands score the complete element while phase, GD, GDD, and TOD operands in the same table keep scoring that one coating. The Merit Function Editor and Refinement window show this scope beside the table.

Analytic phase derivatives are evaluated only inside every participating
material model's stated wavelength range. An operand outside that range shows
**Error** in its Current cell; hover the row to see the material and reason.
Other rows continue to display, but MF and OMF remain unavailable and
Refinement will not start until every enabled target is valid.

### Electric-field peak

| Type   | Computes                                   | Target unit | Output |
| ------ | ------------------------------------------ | ----------- | ------ |
| `EFMX` | Peak normalized \|E\|² anywhere in coating | none        | ≥ 0    |

Evaluated at `λ / Start`; the *Pol* column selects s or p (`avg` takes the
larger of the two peaks, the damage-relevant one). Residual: `value − target`;
with the default target 0 it monotonically **minimizes** the peak field, the
usual laser-damage-threshold objective.

## Math operands (reference another row)

Math operands do **not** evaluate a TMM characteristic directly. They reference
one or two other rows by their stable Op # (via the *λ / Start* and *End*
picker cells) and compute a derived value. Target units are inherited from the
referenced row.

| Type   | Refs | Value           | Residual                  | Spec it enforces      |
| ------ | ---- | --------------- | ------------------------- | --------------------- |
| `OPGT` | 1    | `ref`           | `max(0, target − ref)`    | `ref ≥ target`        |
| `OPLT` | 1    | `ref`           | `max(0, ref − target)`    | `ref ≤ target`        |
| `OPVA` | 1    | `ref`           | `ref − target`            | `ref = target`        |
| `ABSO` | 1    | `|ref|`         | `|ref| − target`          | `|ref| = target`      |
| `ABGT` | 1    | `|ref|`         | `max(0, target − |ref|)`  | `|ref| ≥ target`      |
| `ABLT` | 1    | `|ref|`         | `max(0, |ref| − target)`  | `|ref| ≤ target`      |
| `DIFF` | 2    | `ref1 − ref2`   | `value − target`          | `ref1 − ref2 = target`|
| `SUMM` | 2    | `ref1 + ref2`   | `value − target`          | `ref1 + ref2 = target`|
| `PROD` | 2    | `ref1 · ref2`   | `value − target`          | `ref1 · ref2 = target`|

The reference is by **stable id**, so inserting, deleting or reordering rows
keeps the link. A reference to a deleted row renders red ("stale"). Cyclic
references evaluate to a neutral (zero-residual) value. This is the familiar
pattern where a target row references a measurement row by its operand number.

The Specification window's "Generate MF" emits, for each `≥`/`≤` spec, a
zero-weight measurement row (`TAV`, `TMN`, …) plus an `OPGT`/`OPLT` row that
references it, so the table reads "spec = 99 %, value = 99.5 %".

## Thickness operands

Act on **layer thicknesses**, not the spectrum.

| Type  | λ / Start  | End        | Computes                        | Target unit | Residual                                    |
| ----- | ---------- | ---------- | ------------------------------- | ----------- | ------------------------------------------- |
| `TT`  | comparison | n/a        | Σ of all active layer thicknesses | nm        | `≤`/`≥` one-sided, or `=` two-sided         |
| `MNT` | layer 1    | layer 2    | **min** thickness in layer range  | nm        | `max(0, target − minThk)` (≥ bound)         |
| `MXT` | layer 1    | layer 2    | **max** thickness in layer range  | nm        | `max(0, maxThk − target)` (≤ bound)         |

`MNT`/`MXT` layer ranges are **1-based layer indices**, clamped to the current
stack. A new constraint therefore covers layers 1 to 1000 by default: the end is
deliberately past any stack you start from, so the constraint keeps covering the
layers synthesis adds. During Needle / Gradual Evolution synthesis the thickness penalties are
suppressed (the dMin floor + post-refine + Cleaner enforce bounds instead);
they are active during Refinement.

## Comment / sentinel

| Type   | Effect                                                              |
| ------ | ------------------------------------------------------------------ |
| `BLNK` | Inert annotation row carrying free text; contributes nothing.      |
| `DMFS` | "Default merit function" sentinel marking a generated block start. |

A freshly added row is a `BLNK` placeholder so it can't silently inject a stray
target; pick the real type from the dropdown. Build and edit the operand table
in the [Merit Function Editor](/design/merit-function-editor/); the
source/detector presets used by `TIW`/`RIW`/`AIW` come from the
[Integral Values](/analysis/integral-values/) tool.

## References

- B. T. Sullivan, J. A. Dobrowolski, "Implementation of a numerical needle method for thin-film design," *Appl. Opt.* **35**, 5484 (1996).
- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., §2.6.4 (two-sided system), Ch. 13 (merit functions and tolerancing).
