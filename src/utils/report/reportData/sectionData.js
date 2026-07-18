/**
 * Per-section data computations that reduce to tables/scalars: color, integral
 * values, qualifiers verdict, design summary, and the merit-operand list.
 */

import { colorReport } from '../../physics/colorimetry.js';
import { computeIntegralValueBatch, DEFAULT_INTEGRALS } from '../../physics/integralValues.js';
import { evaluateQualifiers, aggregateVerdict } from '../../synthesis/qualifiers.js';
import { resolveMaterial, materialName, buildSpectrum, buildResponseFn } from './engines.js';

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
