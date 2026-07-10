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
