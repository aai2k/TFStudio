/**
 * Shared report engines: material resolution, mode-aware geometry, and the TMM
 * spectrum sweeps that every section-data computation builds on. Reuses the same
 * validated engines the analysis windows use, so the report sees identical n,k
 * and identical spectra.
 */

import {
  evaluateSpectrum, evaluateSpectrumBack, evaluateSpectrumTotal,
} from '../../physics/thinFilmMath.js';
import { resolveEvalMode } from '../../physics/optimizer.js';
import { getMaterialById } from '../../materials/catalogManager.js';
import { getMaterial } from '../../materials/materialDatabase.js';

// ── Material resolution ─────────────────────────────────────────────────────
// Mirrors the helper used by every analysis window so the report sees the same
// n,k as the live tools.
export function resolveMaterial(id) {
  if (!id) return getMaterial('Air');
  return getMaterialById(id) || getMaterial(id) || getMaterial('Air');
}

export function materialName(id) {
  return resolveMaterial(mediumId(id))?.name || mediumId(id) || '—';
}

// A medium field may be a plain id string ('Air') or an object { material }.
export function mediumId(m) {
  if (m && typeof m === 'object') return m.material;
  return m;
}

// ── Geometry helpers (mode-aware) ───────────────────────────────────────────

export function frontLayersWithMat(design) {
  return (design.frontLayers || [])
    .filter(l => l.thickness > 0)
    .map(l => ({ material: resolveMaterial(l.material), thickness: l.thickness }));
}
export function backLayersWithMat(design) {
  return (design.backLayers || [])
    .filter(l => l.thickness > 0)
    .map(l => ({ material: resolveMaterial(l.material), thickness: l.thickness }));
}

/** Evaluation mode for a design: 'front' | 'back' | 'total'. */
export function designEvalMode(design) {
  return resolveEvalMode(design);
}

// ── Spectrum sweep (per-AOI series) ─────────────────────────────────────────
// Returns { lambda:[…], series:[{ theta, R,T,A, Rs,Ts,As, Rp,Tp,Ap }] }.
// Shape is identical to OpticalEvaluation's so a section can reuse the curves.
export function buildSpectrum(design, opts = {}) {
  const {
    lambdaStart = 400, lambdaEnd = 800, lambdaStep = 2, pol = 'avg',
  } = opts;
  // Accept either a `thetas` list (multi-AOI) or a single `aoi` (wizard option).
  const thetas = (opts.thetas && opts.thetas.length) ? opts.thetas
               : (opts.aoi != null ? [opts.aoi] : [0]);
  const evalMode = designEvalMode(design);

  const incMat  = resolveMaterial(mediumId(design.incidentMedium));
  const subMat  = resolveMaterial(design.substrate?.material);
  const exitMat = resolveMaterial(mediumId(design.exitMedium));
  const subThk  = design.substrate?.thickness ?? 1.0;
  const front   = frontLayersWithMat(design);
  const back    = backLayersWithMat(design);

  const series = [];
  let lambda = null;
  for (const theta of (thetas?.length ? thetas : [0])) {
    const p = { lambdaStart, lambdaEnd, lambdaStep, theta, polarization: pol };
    let r;
    if (evalMode === 'back')        r = evaluateSpectrumBack(p, exitMat, subMat, back);
    else if (evalMode === 'total')  r = evaluateSpectrumTotal(p, incMat, subMat, exitMat, front, back, subThk);
    else                            r = evaluateSpectrum(p, incMat, subMat, front);
    if (!lambda) lambda = r.lambda;
    series.push({
      theta,
      R: r.R, T: r.T, A: r.A,
      Rs: r.Rs, Ts: r.Ts, As: r.As,
      Rp: r.Rp, Tp: r.Tp, Ap: r.Ap,
    });
  }
  return { lambda: lambda || [], series, evalMode };
}

// Interpolating R|T(λ) fraction function from a fine TMM sweep — used for
// colorimetry (which samples on its own 5 nm CMF/SPD grid).
export function buildResponseFn(design, characteristic = 'R', pol = 'avg', theta = 0) {
  const evalMode = designEvalMode(design);
  const incMat  = resolveMaterial(mediumId(design.incidentMedium));
  const subMat  = resolveMaterial(design.substrate?.material);
  const exitMat = resolveMaterial(mediumId(design.exitMedium));
  const subThk  = design.substrate?.thickness ?? 1.0;
  const front   = frontLayersWithMat(design);
  const back    = backLayersWithMat(design);
  const params  = { lambdaStart: 380, lambdaEnd: 780, lambdaStep: 1, theta, polarization: pol };

  let res;
  if (evalMode === 'back')       res = evaluateSpectrumBack(params, exitMat, subMat, back);
  else if (evalMode === 'total') res = evaluateSpectrumTotal(params, incMat, subMat, exitMat, front, back, subThk);
  else                           res = evaluateSpectrum(params, incMat, subMat, front);

  const arr = characteristic === 'T' ? res.T : res.R;
  const lam0 = res.lambda[0], n = res.lambda.length;
  const dl = n > 1 ? (res.lambda[n - 1] - lam0) / (n - 1) : 1;
  return (lam) => {
    if (n === 0) return 0;
    if (lam <= lam0) return arr[0] ?? 0;
    if (lam >= res.lambda[n - 1]) return arr[n - 1] ?? 0;
    const f = (lam - lam0) / dl, i = Math.floor(f), t = f - i;
    return (arr[i] ?? 0) * (1 - t) + (arr[i + 1] ?? 0) * t;
  };
}
