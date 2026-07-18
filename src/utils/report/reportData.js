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

import { designEvalMode, buildSpectrum } from './reportData/engines.js';
import {
  computeColor, computeIntegrals, computeQualifiers, designSummary, meritOperandsSummary,
} from './reportData/sectionData.js';
import {
  computeEllipsometrySpectrum, computeRiProfile, computeEField,
} from './reportData/profiles.js';

export {
  resolveMaterial, materialName, designEvalMode, buildSpectrum, buildResponseFn,
} from './reportData/engines.js';
export {
  computeColor, computeIntegrals, computeQualifiers, designSummary, meritOperandsSummary,
} from './reportData/sectionData.js';
export {
  computeEllipsometrySpectrum, computeRiProfile, computeEField,
} from './reportData/profiles.js';

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
