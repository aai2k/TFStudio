# k-sign / ellipsometry validation designs

Two `.tfs` test designs for validating the absorbing-media fix in the analysis
windows (Ellipsometry, Admittance, E-field, GD/GDD). Copy them into your
projects folder, then open the same design in the **old release** and in the
**fixed build** and compare.

## Background

The analysis windows previously fed the complex index as `ñ = n − ik` into a
transfer-matrix engine that uses the `ñ = n + ik` (conjugate-Macleod, −i
off-diagonal) convention. That mixed convention produces **gain** for any
absorbing layer, so the four analysis windows were wrong whenever a stack
contained an absorbing film. The fix feeds `ñ = n + ik` consistently and adjusts
the ellipsometry Δ formula to keep the Woollam/Nebraska convention.

Note: a **bare** absorbing substrate does **not** discriminate the two builds —
there the feed-sign error and the Δ-formula error cancel and both builds are
correct. The bug only shows up with an absorbing **film** (propagation through
the absorber), which is why both designs below use thin silver films.

The plain **R / T / A spectrum** (Optical Evaluation) window was never affected
(it always used `+k`); use its values only as a "did the design load correctly"
check, not as an old-vs-new discriminator.

## References

- Silver n,k: P. B. Johnson and R. W. Christy, *Optical constants of the noble
  metals*, Phys. Rev. B **6**, 4370 (1972). (via refractiveindex.info)
- SiO₂ n: I. H. Malitson, J. Opt. Soc. Am. **55**, 1205 (1965).
- BK7: Schott optical glass catalog.
- Ellipsometry Δ convention (ρ = r_p/r_s = tanΨ·e^{iΔ}, N = n + ik, e^{−iωt}):
  H. Fujiwara, *Spectroscopic Ellipsometry: Principles and Applications*
  (Wiley, 2007).
- Transfer matrix / energy balance: H. A. Macleod, *Thin-Film Optical Filters*,
  5th ed.

Material n,k used (from the built-in library, @ 550 nm):
`Ag: n=0.0596, k=3.5974` · `SiO₂: n=1.4599, k=0` · `BK7: n=1.5185, k=0`.

The reference numbers below were computed with an independent transfer-matrix
implementation (not the app engine) and agree with the fixed build to the digits
shown.

## Design 1 — `validation_Ag20nm_on_BK7.tfs`

Air / **Ag 20 nm** / BK7 substrate. Semi-transparent silver film.

| Quantity (λ = 550 nm) | Fixed build (correct) | Old build (buggy) |
|---|---|---|
| Ellipsometry Ψ, AOI = 65° | **37.81°** | 38.49° |
| Ellipsometry Δ, AOI = 65° | **241.07°** | 117.97° |
| R (normal incidence) | 0.6836 | 0.6836 |
| T (normal incidence) | 0.2918 | 0.2918 |
| A (normal incidence) | 0.0246 | 0.0246 |

`R + T + A = 1` with `A ≥ 0` (a passive film cannot have gain).

## Design 2 — `validation_SiO2-Ag-SiO2_on_BK7.tfs`

Air / SiO₂ 50 nm / **Ag 20 nm** / SiO₂ 50 nm / BK7. Buried absorber
(metal–dielectric / induced-transmission style). Symmetric spacers, so layer
order is unambiguous.

| Quantity (λ = 550 nm) | Fixed build (correct) | Old build (buggy) |
|---|---|---|
| Ellipsometry Ψ, AOI = 65° | **42.68°** | 42.69° |
| Ellipsometry Δ, AOI = 65° | **264.62°** | 95.45° |
| R (normal incidence) | 0.5271 | 0.5271 |
| T (normal incidence) | 0.4344 | 0.4344 |
| A (normal incidence) | 0.0386 | 0.0386 |

## How to validate

1. **Load check (both builds):** Optical Evaluation at 550 nm, normal incidence,
   should show the R/T/A above. Confirms the design loaded and the material data
   is as expected. These do **not** change between builds.
2. **Ellipsometry (the quantitative discriminator):** set AOI = 65°, read at
   550 nm. The fixed build gives the **Δ (correct)** column; the old build gives
   **Δ (buggy)**. Ψ also shifts slightly for Design 1.
3. **E-field profile (the visual discriminator):** plot |E|² through the stack.
   In the fixed build the field **decays** inside the silver; in the old build it
   **grows** into the silver (unphysical gain).
4. **Admittance diagram:** the locus differs between builds; in the fixed build
   the absorbing-layer spiral converges (energy-conserving) and is drawn in
   Macleod's orientation.

If the fixed build matches the **"correct"** columns and the old build matches
the **"buggy"** columns, the fix is confirmed.
