/**
 * Report data layer.
 *
 * Pure, framework-free helpers that gather every numeric result a report block
 * can display, by reusing the SAME validated engines the analysis windows use:
 *   - TMM spectrum     → thinFilmMath.evaluateSpectrum / …Back / …Total
 *   - CIE color        → colorimetry.colorReport
 *   - Integral values  → integralValues.computeIntegralValueBatch
 *   - Qualifiers verdict → qualifiers.evaluateQualifiers / aggregateVerdict
 *   - n(z) / |E|² profiles → thinFilmMath.computeRIProfile / computeEFieldProfile
 *   - Phase dispersion → phaseDispersion.createDesignPhaseDispersionEvaluator
 *   - Monitoring worksheet → monoSim.buildMonitorWorksheet
 *
 * A Monte-Carlo run is not repeated here: the block prints the last run the
 * Monte-Carlo window made for the design, handed in through `external`. The
 * monitoring worksheet is built on the chip plan and monitor settings the
 * Monitor Worksheet window holds for the design, handed in the same way.
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
import { computeGdGdd } from './reportData/dispersion.js';
import { computeWorksheet } from './reportData/worksheet.js';
import { withDefaults } from './blocks.js';

export {
  resolveMaterial, materialName, designEvalMode, buildSpectrum, buildResponseFn,
} from './reportData/engines.js';
export {
  computeColor, computeIntegrals, computeQualifiers, designSummary, meritOperandsSummary,
} from './reportData/sectionData.js';
export {
  computeEllipsometrySpectrum, computeRiProfile, computeEField,
} from './reportData/profiles.js';

// One computation per block type that needs one, taking the design, the
// block's settings and the external results. Blocks that only format the
// design (title, facts, layers, materials, notes, signatures) have no entry.
const COMPUTE = {
  spectrum:     (design, s) => buildSpectrum(design, {
    lambdaStart: s.lambdaStart, lambdaEnd: s.lambdaEnd, lambdaStep: s.lambdaStep, thetas: s.thetas,
  }),
  color:        (design, s) => computeColor(design, s),
  integrals:    (design, s) => computeIntegrals(design, { theta: s.theta, pol: s.polarization }),
  qualifiers:   (design) => computeQualifiers(design),
  merit:        (design) => meritOperandsSummary(design),
  riProfile:    (design, s) => computeRiProfile(design, { lambda: s.lambda ?? undefined }),
  efield:       (design, s) => computeEField(design, { lambda: s.lambda ?? undefined, theta: s.theta, pol: s.pol }),
  ellipsometry: (design, s) => computeEllipsometrySpectrum(design, {
    lambdaStart: s.lambdaStart, lambdaEnd: s.lambdaEnd, lambdaStep: s.lambdaStep, thetas: s.thetas,
  }),
  gdGdd:        (design, s) => computeGdGdd(design, s),
  worksheet:    (design, s, external) => computeWorksheet(design, external.worksheet?.(design)),
  monteCarlo:   (design, s, external) => external.monteCarlo?.(design) || { missing: true },
};

/**
 * Everything the enabled `blocks` need for one design.
 *
 * Results are keyed by block id, since two blocks of one type may carry
 * different settings. A failure is isolated to its block, so one bad section
 * never aborts the report.
 *
 * @param {object} design
 * @param {object[]} blocks
 * @param {object} [external]  what other windows hold: `monteCarlo(design)` returns
 *                             `{ result, settings }` from the window's last run, or null;
 *                             `worksheet(design)` returns the Monitor Worksheet window's values
 * @returns {{ summary: object, evalMode: string, blocks: Object<string, object> }}
 */
export function gatherDesignData(design, blocks, external = {}) {
  const data = { summary: designSummary(design), evalMode: designEvalMode(design), blocks: {} };
  for (const block of blocks) {
    if (!block.on) continue;
    const compute = COMPUTE[block.type];
    if (!compute) continue;
    try { data.blocks[block.id] = compute(design, withDefaults(block.type, block.settings), external); }
    catch (e) { data.blocks[block.id] = { error: e.message || String(e) }; }
  }
  return data;
}
