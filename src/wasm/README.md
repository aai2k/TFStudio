# TFStudio WASM TMM kernel

Near-native Transfer Matrix Method kernel that accelerates the optimizer's
per-evaluation throughput. **Orthogonal to the worker pool**: the
pool adds cores, WASM makes each worker's TMM faster — they multiply.

All orchestration (worker pool, DLS/DE/CG/SA/needle/GE state machines, operand
and merit-function logic) stays in JavaScript. This module is *only* the inner
TMM arithmetic, ported line-by-line from `src/utils/thinFilmMath.js`, which
remains the behavioural oracle.

## Files

| File | Role |
|------|------|
| `tmm_kernel.c` | C port of `tmm()`, batched spectrum, `tmmThicknessJacobian()`, needle scan, `tmmThicknessHessian()` |
| `build.sh` / `build.ps1` | Emscripten build (also runs the equivalence test) |
| `tmm_kernel.wasm` | **Build artifact — generated, not committed** |

The JS loader + automatic fallback lives in `src/utils/tmmWasm.js`.

## Building

The `.wasm` is **not** checked in; produce it with a one-time Emscripten install.

1. Install Emscripten (https://emscripten.org/docs/getting_started/downloads.html):
   ```
   git clone https://github.com/emscripten-core/emsdk && cd emsdk
   ./emsdk install latest && ./emsdk activate latest && source ./emsdk_env.sh
   ```
2. From the project root:
   ```
   npm run build:wasm
   ```
   This emits `src/wasm/tmm_kernel.wasm` and runs
   `tests/wasm_tmm_equivalence.mjs`, which checks the kernel against the JS
   reference within a tight float64 tolerance.

Until the `.wasm` exists (or if instantiation fails), TFStudio transparently
falls back to the pure-JS TMM — nothing breaks, you just don't get the speedup.

## Why not bit-identical?

The kernel is IEEE-754 float64 throughout — same precision as the JS code. The
only divergence from the JS path is the libm `sin`/`cos`/`exp`/`atan2`
implementation (Emscripten's musl vs. V8's fdlibm), which differs at ~1 ULP.
Over a full stack this stays well below 1e-12 relative — far under any physical
or convergence tolerance — but it is *not* the last-ULP bit-identicality that
the JS worker-vs-serial equivalence tests assert. WASM is therefore a separate,
feature-flagged path validated by its own tolerance-based test; the existing
bit-identical JS tests are untouched.

## ABI (exports)

All buffers are caller-owned `f64` arrays in WASM linear memory (allocate with
the exported `malloc`, free with `free`). pol: `0 = s`, `1 = p`.

- `tmm_one(λ, θ_deg, pol, n0_re, n0_im, ns_re, ns_im, layersPtr, N, outPtr)`
  — `layers` = N×[n_re,n_im,d]; `out` = [R,T,A].
- `tmm_spectrum(lambdasPtr, nLam, n0Ptr, nsPtr, matNKPtr, thickPtr, N, θ_deg, RsPtr,TsPtr,AsPtr, RpPtr,TpPtr,ApPtr)`
  — batched over a λ grid, both polarizations; `matNK` layout `[layer][λ][re,im]`.
- `tmm_jacobian(λ, θ_deg, pol, n0_re,n0_im, ns_re,ns_im, layersPtr, N, dRddPtr, dTddPtr, dAddPtr, basePtr)`
  — exact analytic thickness derivatives; `base` = [R,T,A].
- `tmm_needle_scan(...)` — analytic needle P-function scan over gaps + intra-layer splits.
- `tmm_hessian(λ, θ_deg, pol, n0_re,n0_im, ns_re,ns_im, layersPtr, N, dRddPtr, dTddPtr, dAddPtr, d2RddPtr, d2TddPtr, d2AddPtr, basePtr)`
  — exact analytic thickness **second** derivatives (full N×N, row-major, symmetric)
  + the first derivatives; for the bounded-SQP / Newton inner refiner. ~20–30×
  the JS `tmmThicknessHessian` (the dense Hessian was the un-accelerated hot spot
  that throttled SQP in synthesis). Validated to ~1e-12 vs JS in
  `tests/wasm_hessian_equivalence.mjs`.
