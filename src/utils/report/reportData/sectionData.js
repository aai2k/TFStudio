/**
 * Per-section data computations that reduce to tables/scalars: color, integral
 * values, qualifiers verdict, design summary, and the merit-operand list.
 */

import { colorReport } from '../../physics/colorimetry.js';
import { computeIntegralValueBatch, DEFAULT_INTEGRALS } from '../../physics/integralValues.js';
import { evaluateQualifiers, aggregateVerdict } from '../../synthesis/qualifiers.js';
import { designMaterialLookup } from '../../materials/designMaterials.js';
import { resolveColor } from '../../materials/catalogManager.js';
import { materialName, buildSpectrum, buildResponseFn } from './engines.js';

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
  const results = evaluateQualifiers(quals, design, designMaterialLookup(design));
  const verdict = aggregateVerdict(results);
  return { qualifiers: quals, results, verdict };
}

// ── Design summary (layer table + totals + materials) ───────────────────────
// Each layer carries the optical-thickness family at the reference wavelength:
//   OT   = n·d                 (optical thickness, nm)
//   QWOT = n·d / (λref/4)      (quarter-wave optical thickness, dimensionless)
//   FWOT = n·d / λref          (full-wave optical thickness, dimensionless)
export function designSummary(design) {
  const resolveMaterial = designMaterialLookup(design);
  const front = design.frontLayers || [];
  const back  = design.backLayers  || [];
  const lamRef = design.referenceWavelength ?? 550;
  const frontThk = front.reduce((s, l) => s + (l.thickness || 0), 0);
  const backThk  = back.reduce((s, l) => s + (l.thickness || 0), 0);

  // The display color is the same one the Design Editor and the analysis
  // plots use, so the stack diagram in the report matches the app.
  const colorOf = (id) => { try { return resolveColor(resolveMaterial(id)); } catch (_) { return '#999999'; } };

  const layerRow = (l, i) => {
    const d = l.thickness ?? 0;
    let nRef = NaN;
    try { const [nr] = resolveMaterial(l.material).getNK(lamRef); nRef = nr; } catch (_) {}
    const ot = isFinite(nRef) ? nRef * d : NaN;
    return {
      index: i + 1, materialId: l.material, material: materialName(design, l.material),
      color: colorOf(l.material),
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
    return { id, name: m?.name || id, n, k, color: colorOf(id) };
  });
  const substrateColor = colorOf(design.substrate?.material);

  return {
    name: design.name || '—',
    incidentMedium: materialName(design, design.incidentMedium),
    substrate: materialName(design, design.substrate?.material),
    substrateColor,
    substrateThickness: design.substrate?.thickness ?? null,  // mm
    exitMedium: materialName(design, design.exitMedium),
    referenceWavelength: lamRef,
    surfaceMode: design.surfaceMode || 'front_only',
    // Numbered as the Design Editor numbers them: layer 1 is next to the
    // substrate on both sides. Front layers are stored incident-side first, so
    // they are reversed here; back layers are stored substrate first.
    front: [...front].reverse().map(layerRow),
    back: back.map(layerRow),
    frontCount: front.length, backCount: back.length,
    frontThickness: frontThk, backThickness: backThk,
    totalThickness: frontThk + backThk,
    materials,
    notes: design.notes || '',
  };
}

// ── Merit-function operands (table only — no re-evaluation) ──────────────────
// A row also carries the arguments its own type reads instead of a wavelength
// band: the total-thickness comparison, a comment, or the rows a math operand
// references. References resolve to row numbers here because operand ids are
// opaque and the printed table has no other way to name a row.
export function meritOperandsSummary(design) {
  const operands = design.meritOperands || [];
  const rowNumberOf = new Map(operands.map((op, i) => [op.id, i + 1]));
  return operands.map((op, i) => ({
    index: i + 1,
    type: op.type || '—',
    lambdaStart: op.lambdaStart ?? null,
    lambdaEnd: op.lambdaEnd ?? null,
    aoi: op.aoi ?? 0,
    pol: op.pol || 'avg',
    target: op.target ?? null,
    weight: op.weight ?? 1,
    cmp: op.cmp || null,
    comment: op.comment || '',
    ref1: rowNumberOf.get(op.refId ?? op.refId1) ?? null,
    ref2: rowNumberOf.get(op.refId2) ?? null,
  }));
}
