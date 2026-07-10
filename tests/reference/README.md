# Cross-tool validation — TFStudio vs independent third-party codes

This folder validates the TFStudio optical engine against **numbers computed by a
different code**, not against another copy of the same math. It complements
`tests/correctness_benchmark.mjs` (closed-form / analytic oracles): that proves
the engine matches the *equations*; this proves it matches an *independent
implementation of them*, digit for digit.

## What runs

| File | Role |
|------|------|
| `gen_reference_tmm.py` | Generates `reference_tmm.json` using Steven Byrnes' `tmm` package. |
| `reference_tmm.json` | Committed reference numbers (so the JS check runs without Python). |
| `cross_tool_validation.mjs` | Feeds byte-identical inputs into TFStudio and diffs. |

```bash
# regenerate the reference (optional; needs: pip install tmm numpy)
python tests/reference/gen_reference_tmm.py
# run the comparison (no Python needed — uses the committed JSON)
node tests/reference/cross_tool_validation.mjs
```

## The independent oracle

**Steven Byrnes, `tmm`** — MIT-licensed, peer-reviewed (S. J. Byrnes,
*Multilayer optical calculations*, arXiv:1603.02720), a community-standard
transfer-matrix package written by a different author in Python. It uses the
**same complex-index convention as TFStudio** (ñ = n + ik, k > 0 for loss), so
the inputs are byte-identical and only the *math* is under test — there is no
material-data confound.

## Result

335/335 checks pass. Worst-case disagreement vs `tmm`, by quantity, across
7 coating cases (AR, dielectric mirror, oblique multilayer, absorbing film,
metal film, bare metal, Gires–Tournois mirror):

| Quantity | Worst Δ vs tmm |
|----------|----------------|
| R, T, A (98 points, s & p, 0–60°) | 1.6 × 10⁻¹⁵ |
| \|r\|² vs R | 1.3 × 10⁻¹⁵ |
| Ψ (ellipsometry) | 2.1 × 10⁻¹⁴ deg |
| Δ (ellipsometry, after +180° convention map) | 8.5 × 10⁻¹⁴ deg |
| \|E\|² field profile | 3.3 × 10⁻¹⁶ |
| Group delay (through a GTI resonance) | 1.9 × 10⁻³ fs |

### Two documented convention relations (not errors)

- **Ellipsometry Δ:** `Δ_TF = Δ_tmm + 180°` at every point. TFStudio follows
  Macleod Eq. 16.2 (Δ = φ_p − φ_s ± 180°, the Woollam/Nebraska convention);
  `tmm` uses the opposite p-sign. Ψ is convention-free and matches directly.
- **Group delay:** `GD_TF = −GD_tmm`. `tmm` uses the exp(+iωt) time convention;
  TFStudio uses exp(−iωt) (conjugate-Macleod) and negates the phase so GD comes
  out physically positive. That absolute sign is independently pinned correct by
  the matched-slab analytic oracle in `tests/gd_sign_slab.mjs` (GD = +n·d/c).

## OptiLayer (reference of record) — DONE

`optilayer_validation.mjs` (TFStudio) and `optilayer_tmm_check.py` (tmm)
reproduce a real fabricated design from `reference/For spectrophotometer/`:

    air │ ZrO2P 46.429 nm │ SiO2P 199.251 nm │ K8 3 mm │ (bare back) air

using the **user's own catalog-"p" materials** (ZrO2P / SiO2P, byte-identical to
OptiLayer's tables) and K8 from the LZOS catalogue (refractiveindex.info). The
`.res` files are OptiLayer 8.18n transmittance (Ta, %); front coated, back bare.

Result vs OptiLayer Ta:

| Design | RMS (400–850 nm) | max |
|--------|------------------|-----|
| single ZrO2P layer (01.res) | 0.02 % | 0.02 % |
| 2-layer AR (02.res)         | 0.13 % | 0.27 % @ 434 nm |

Key findings (why this is a *math* pass despite a 0.1 % residual):
- **TFStudio ≡ tmm to ~1e-13** on this design (`inc_tmm`, incoherent substrate +
  bare back) — two independent codes, identical inputs. Both land the *same*
  0.13 % from OptiLayer, so the residual is **not** a TFStudio bug.
- The residual **changes sign** with wavelength — the signature of a small
  dispersion/substrate-data difference, not missing physics. Single-pass (no
  substrate internal reflections) would be 0.4–0.6 % low and one-sided, so
  OptiLayer *does* use full multiple reflections (as TFStudio does).
- At 500 nm both coatings are exactly tabulated (no interpolation): residual
  0.093 %, attributable to the K8 substrate model (LZOS vs OptiLayer's K8).
- **Ellipsometry @ 60°** (`photo_*.jpg`): Ψ min ~10°@450, peak ~44°@720, and the
  sharp Δ wrap all match. OptiLayer uses the **Azzam–Bashara Δ** convention
  (= TFStudio's Δ toggle). The Δ-wrap wavelength differs ~8 nm — a hypersensitive
  feature (~3 nm per 1 nm SiO₂ thickness); TFStudio and tmm agree there to <0.1°.

## OpenFilters

OpenFilters (`reference/OpenFilters-master`, Larouche & Martinu, Appl. Opt. 47,
C219, 2008) ships its calculation core (`abeles/`) as Python-2 with implicit
relative imports; it does not import under Python 3 without a port. Porting it
here was declined deliberately — a hand-port could reproduce the engine's own
assumptions and defeat the purpose. Byrnes `tmm` (also peer-reviewed, Python 3,
MIT) fills the independent-oracle role and is integrated above.
