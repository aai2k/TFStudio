/**
 * Turning Point Cutter runs, generated from the run number: layer count, growth
 * rate, signal noise, and turning points per layer. Generated rather than
 * listed, so there is no last run, and a run is the same on every play.
 */

import { makeRng } from './rng.js';

// Run patterns. Each one raises a different parameter.
export const PATTERNS = ['steady', 'doubles', 'mixed', 'noisy', 'fast'];

const MAX_LAYERS = 12;
const BASE_LAYERS = 4;
const LAYERS_PER_LEVEL = 3;

/** Random stream for a run, the same on every play. */
function levelRng(level) {
    return makeRng(Math.imul(level, 2654435761) ^ 0x9e3779b9);
}

export function levelPlan(level) {
    const rng = levelRng(level);
    // Run 1 always uses the plain pattern.
    const pattern = level === 1 ? 'steady' : PATTERNS[Math.floor(rng() * PATTERNS.length)];
    return {
        level,
        pattern,
        rng,
        layers: Math.min(BASE_LAYERS + Math.floor(level / LAYERS_PER_LEVEL), MAX_LAYERS),
        rate: Math.min(0.20 + level * 0.010, 0.50) * (pattern === 'fast' ? 1.35 : 1),
        noiseAmp: Math.min(0.010 + level * 0.0018, 0.040) * (pattern === 'noisy' ? 1.8 : 1),
    };
}

/** How many turning points this layer has to pass before it is cut. */
function targetFor(plan) {
    if (plan.pattern === 'doubles') return 2;
    if (plan.pattern === 'mixed') return plan.rng() < 0.5 ? 1 : 2;
    return 1;
}

/** The next layer of the run, drawn in order from the run's stream. */
export function layerPlan(plan) {
    return {
        target: targetFor(plan),
        mid: 0.38 + plan.rng() * 0.22,
        amp: 0.20 + plan.rng() * 0.16,
    };
}
