/**
 * Phase dispersion of a coating for the report: phase, group delay, group delay
 * dispersion and third-order dispersion against wavelength, from the same
 * analytic evaluator the Group Delay window uses, on the block's own grid.
 */

import { createDesignPhaseDispersionEvaluator } from '../../physics/phaseDispersion.js';
import { unwrapPhase } from '../../physics/thinFilmMath.js';

function normalizeRadians(value) {
  return ((value + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
}

// The unpolarized value is the mean of s and p; the phase is averaged on the
// circle so a wrap between the two does not land halfway round.
function averagePolarizations(s, p) {
  if (!s.valid || !p.valid) return { valid: false, reason: s.valid ? p.reason : s.reason };
  const mean = key => (Number.isFinite(s[key]) && Number.isFinite(p[key]) ? (s[key] + p[key]) / 2 : NaN);
  return {
    valid: true,
    phaseRad: s.phaseRad + normalizeRadians(p.phaseRad - s.phaseRad) / 2,
    gdFs: mean('gdFs'), gddFs2: mean('gddFs2'), todFs3: mean('todFs3'),
  };
}

function unwrapFiniteRuns(phases) {
  const result = phases.slice();
  let start = 0;
  while (start < result.length) {
    while (start < result.length && !Number.isFinite(result[start])) start++;
    let end = start;
    while (end < result.length && Number.isFinite(result[end])) end++;
    if (end > start) result.splice(start, end - start, ...unwrapPhase(result.slice(start, end)));
    start = end + 1;
  }
  return result;
}

/**
 * @param {object} design
 * @param {object} s  { lambdaStart, lambdaEnd, lambdaStep, theta, target: 'R'|'T',
 *                      pol: 'avg'|'s'|'p', side: 'front'|'back' }
 * @returns {{ lambda, phaseDeg, gd, gdd, tod, invalid: number, side, target, pol, theta }}
 *          gd in fs, gdd in fs², tod in fs³
 */
export function computeGdGdd(design, s) {
  const { lambdaStart = 400, lambdaEnd = 800, lambdaStep = 1, theta = 0, target = 'R', pol = 'avg', side = 'front' } = s;
  if (!(lambdaStep > 0)) throw new Error(`Wavelength step must be positive: ${lambdaStep} nm`);
  const make = polarization => createDesignPhaseDispersionEvaluator(design, { side, target, polarization, thetaDeg: theta });
  const evaluate = pol === 'avg'
    ? (() => { const es = make('s'), ep = make('p'); return lam => averagePolarizations(es(lam), ep(lam)); })()
    : make(pol);

  const lambda = [];
  for (let l = lambdaStart; l <= lambdaEnd + 1e-9; l += lambdaStep) lambda.push(Math.round(l * 1000) / 1000);
  const values = lambda.map(evaluate);
  const pick = key => values.map(v => (v.valid ? v[key] : NaN));
  return {
    lambda,
    phaseDeg: unwrapFiniteRuns(pick('phaseRad')).map(v => v * 180 / Math.PI),
    gd: pick('gdFs'), gdd: pick('gddFs2'), tod: pick('todFs3'),
    invalid: values.filter(v => !v.valid).length,
    side, target, pol, theta,
  };
}
