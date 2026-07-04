/**
 * Report data layer.
 *
 * Pure, framework-free helpers that gather every numeric result a report
 * section can display, by reusing the SAME validated engines the analysis
 * windows use:
 *   - TMM spectrum     → thinFilmMath.evaluateSpectrum / …Back / …Total
 *   - CIE color        → colorimetry.colorReport
 *   - Integral values  → integralValues.computeIntegralValueBatch
 *   - Qualifiers verdict → qualifiers.evaluateQualifiers / aggregateVerdict
 *   - n(z) / |E|² profiles → thinFilmMath.computeRIProfile / computeEFieldProfile
 *
 * Nothing here touches React or the DOM, so it runs identically in the
 * renderer (live preview) and in a node test harness.
 */

import {
  evaluateSpectrum, evaluateSpectrumBack, evaluateSpectrumTotal,
  computeRIProfile, computeEFieldProfile, computeEllipsometry,
} from '../physics/thinFilmMath.js';
import { resolveEvalMode } from '../physics/optimizer.js';
import { getMaterialById } from '../materials/catalogManager.js';
import { getMaterial } from '../materials/materialDatabase.js';
import { colorReport } from '../physics/colorimetry.js';
import { computeIntegralValueBatch, DEFAULT_INTEGRALS } from '../physics/integralValues.js';
import { evaluateQualifiers, aggregateVerdict } from '../synthesis/qualifiers.js';

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
function mediumId(m) {
  if (m && typeof m === 'object') return m.material;
  return m;
}

// ── Geometry helpers (mode-aware) ───────────────────────────────────────────

function frontLayersWithMat(design) {
  return (design.frontLayers || [])
    .filter(l => l.thickness > 0)
    .map(l => ({ material: resolveMaterial(l.material), thickness: l.thickness }));
}
function backLayersWithMat(design) {
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

// ── Color ───────────────────────────────────────────────────────────────────
export function computeColor(design, opts = {}) {
  const { characteristic = 'R', pol = 'avg', theta = 0,
          observer = '2', illuminant = 'D65', step = 5 } = opts;
  const Rfn = buildResponseFn(design, characteristic, pol, theta);
  return { characteristic, pol, theta, observer, illuminant,
           report: colorReport(Rfn, { observer, illuminant, step }) };
}

// ── Integral values (Tvis / Tsol / TUV / TNIR …) ────────────────────────────
export function computeIntegrals(design, opts = {}) {
  const { pol = 'avg', defs = DEFAULT_INTEGRALS } = opts;
  const theta = opts.theta ?? opts.aoi ?? 0;
  // Wide grid so every weighting band is covered (UV 280 → NIR 2500).
  const spec = buildSpectrum(design, {
    lambdaStart: 280, lambdaEnd: 2500, lambdaStep: 5, thetas: [theta], pol,
  });
  const s0 = spec.series[0] || { lambda: [], T: [], R: [], A: [] };
  const spectrum = { lambda: spec.lambda, T: s0.T, R: s0.R, A: s0.A };
  const values = computeIntegralValueBatch(spectrum, defs);
  return { defs, values, theta, pol };
}

// ── Qualifiers verdict ──────────────────────────────────────────────────────
export function computeQualifiers(design) {
  const quals = design.qualifiers || [];
  const results = evaluateQualifiers(quals, design, resolveMaterial);
  const verdict = aggregateVerdict(results);
  return { qualifiers: quals, results, verdict };
}

// ── Design summary (layer table + totals + materials) ───────────────────────
// Each layer carries the optical-thickness family at the reference wavelength:
//   OT   = n·d                 (optical thickness, nm)
//   QWOT = n·d / (λref/4)      (quarter-wave optical thickness, dimensionless)
//   FWOT = n·d / λref          (full-wave optical thickness, dimensionless)
export function designSummary(design) {
  const front = design.frontLayers || [];
  const back  = design.backLayers  || [];
  const lamRef = design.referenceWavelength ?? 550;
  const frontThk = front.reduce((s, l) => s + (l.thickness || 0), 0);
  const backThk  = back.reduce((s, l) => s + (l.thickness || 0), 0);

  const layerRow = (l, i) => {
    const d = l.thickness ?? 0;
    let nRef = NaN;
    try { const [nr] = resolveMaterial(l.material).getNK(lamRef); nRef = nr; } catch (_) {}
    const ot = isFinite(nRef) ? nRef * d : NaN;
    return {
      index: i + 1, material: materialName(l.material),
      thickness: d, locked: !!l.locked,
      n: nRef, ot, qwot: isFinite(ot) ? ot / (lamRef / 4) : NaN,
      fwot: isFinite(ot) ? ot / lamRef : NaN,
    };
  };

  const matIds = new Set();
  [...front, ...back].forEach(l => { if (l.material) matIds.add(l.material); });
  const materials = [...matIds].map(id => {
    const m = resolveMaterial(id);
    let n = NaN, k = NaN;
    try { const [nr, ni] = m.getNK(lamRef); n = nr; k = ni; } catch (_) {}
    return { id, name: m?.name || id, n, k };
  });

  return {
    name: design.name || '—',
    incidentMedium: materialName(design.incidentMedium),
    substrate: materialName(design.substrate?.material),
    substrateThickness: design.substrate?.thickness ?? null,  // mm
    exitMedium: materialName(design.exitMedium),
    referenceWavelength: lamRef,
    surfaceMode: design.surfaceMode || 'front_only',
    front: front.map(layerRow),
    back: back.map(layerRow),
    frontCount: front.length, backCount: back.length,
    frontThickness: frontThk, backThickness: backThk,
    totalThickness: frontThk + backThk,
    materials,
    notes: design.notes || '',
  };
}

// ── Ellipsometry spectrum Ψ(λ), Δ(λ) per AOI ────────────────────────────────
export function computeEllipsometrySpectrum(design, opts = {}) {
  const { lambdaStart = 400, lambdaEnd = 800, lambdaStep = 5 } = opts;
  const thetas = (opts.thetas && opts.thetas.length) ? opts.thetas
               : (opts.aoi != null ? [opts.aoi] : [65]);
  const n0mat = resolveMaterial(mediumId(design.incidentMedium));
  const nsmat = resolveMaterial(design.substrate?.material);
  const layerMats = (design.frontLayers || []).filter(l => l.material && l.thickness > 0);

  const lambda = [];
  for (let l = lambdaStart; l <= lambdaEnd + 1e-9; l += lambdaStep) lambda.push(Math.round(l * 1000) / 1000);

  const series = thetas.map(theta => {
    const psi = [], delta = [];
    for (const lam of lambda) {
      const n0 = n0mat.getNK(lam), ns = nsmat.getNK(lam);
      const layers = layerMats.map(l => ({ n: resolveMaterial(l.material).getNK(lam), d: l.thickness }));
      const e = computeEllipsometry(lam, theta, n0, ns, layers);
      psi.push(e.psi); delta.push(e.delta);
    }
    return { theta, psi, delta };
  });
  return { lambda, series };
}

// ── Refractive-index profile n(z) ───────────────────────────────────────────
export function computeRiProfile(design, opts = {}) {
  const lam = opts.lambda ?? design.referenceWavelength ?? 550;
  // getNK() returns a complex pair [re, im]; computeRIProfile wants { n, k }.
  const [n0n, n0k] = resolveMaterial(mediumId(design.incidentMedium)).getNK(lam);
  const [nsn, nsk] = resolveMaterial(design.substrate?.material).getNK(lam);
  const layers = (design.frontLayers || [])
    .filter(l => l.material && l.thickness > 0)
    .map(l => { const [nr, nk] = resolveMaterial(l.material).getNK(lam);
                return { n: nr, k: nk, d: l.thickness, name: materialName(l.material) }; });
  const prof = computeRIProfile({ n: n0n, k: n0k }, { n: nsn, k: nsk }, layers);
  return prof ? { lambda: lam, ...prof } : { lambda: lam, z: [], n: [], k: [], layerBounds: [] };
}

// ── Electric-field profile |E(z)|² ──────────────────────────────────────────
export function computeEField(design, opts = {}) {
  const lam = opts.lambda ?? design.referenceWavelength ?? 550;
  const theta = opts.theta ?? 0;
  const pol = opts.pol === 'p' ? 'p' : 's';
  // computeEFieldProfile takes complex pairs [re, im] directly from getNK().
  const n0 = resolveMaterial(mediumId(design.incidentMedium)).getNK(lam);
  const ns = resolveMaterial(design.substrate?.material).getNK(lam);
  const layers = (design.frontLayers || [])
    .filter(l => l.material && l.thickness > 0)
    .map(l => ({ n: resolveMaterial(l.material).getNK(lam), d: l.thickness }));
  const prof = computeEFieldProfile(lam, theta, pol, n0, ns, layers, 50);
  return { lambda: lam, theta, pol, ...prof };
}

// ── Merit-function operands (table only — no re-evaluation) ──────────────────
export function meritOperandsSummary(design) {
  return (design.meritOperands || []).map((op, i) => ({
    index: i + 1,
    type: op.type || '—',
    lambdaStart: op.lambdaStart ?? null,
    lambdaEnd: op.lambdaEnd ?? null,
    aoi: op.aoi ?? 0,
    pol: op.pol || 'avg',
    target: op.target ?? null,
    weight: op.weight ?? 1,
  }));
}

// ── Top-level gather: only computes what the section list asks for ──────────
// `sections` is the ordered list of section ids; `perSection` holds the
// per-section options chosen in the wizard. Each entry is computed lazily and
// failures are isolated so one bad section never aborts the whole report.
export function gatherDesignData(design, sections, perSection = {}) {
  const want = new Set(sections);
  const data = { summary: designSummary(design), evalMode: designEvalMode(design) };
  const guard = (fn) => { try { return fn(); } catch (e) { return { error: e.message || String(e) }; } };

  if (want.has('design-summary')) { /* already in summary */ }
  if (want.has('optical-eval'))
    data.spectrum = guard(() => buildSpectrum(design, perSection['optical-eval'] || {}));
  if (want.has('color-eval'))
    data.color = guard(() => computeColor(design, perSection['color-eval'] || {}));
  if (want.has('integral-values'))
    data.integrals = guard(() => computeIntegrals(design, perSection['integral-values'] || {}));
  if (want.has('qualifiers'))
    data.qualifiers = guard(() => computeQualifiers(design));
  if (want.has('merit-function'))
    data.merit = guard(() => meritOperandsSummary(design));
  if (want.has('ri-profile'))
    data.riProfile = guard(() => computeRiProfile(design, perSection['ri-profile'] || {}));
  if (want.has('efield'))
    data.efield = guard(() => computeEField(design, perSection['efield'] || {}));
  if (want.has('ellipsometry'))
    data.ellipsometry = guard(() => computeEllipsometrySpectrum(design, perSection['ellipsometry'] || {}));

  return data;
}
