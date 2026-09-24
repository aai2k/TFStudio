/**
 * Test helper: the single-cavity 1550 nm filter the cone tests share,
 * (HL)^6 H 2L H (LH)^6 of non-dispersive n = 2.35 / 1.46 films on n = 1.52 in
 * air, quarter-waves at 1550 nm, and a Gauss-Legendre rule on [a, b].
 */
import { gaussLegendre } from '../src/utils/physics/optimizer.js';

const mk = (id, n) => ({ id, name: id, getNK: () => [n, 0] });
export const MATS = { H: mk('H', 2.35), L: mk('L', 1.46), Air: mk('Air', 1.0), Sub: mk('Sub', 1.52) };
export const resolveMat = id => MATS[id];

const qw = n => 1550 / (4 * n);

/** Design-editor layers of the filter, incident side first. */
export function filterLayers() {
    const out = [];
    for (let i = 0; i < 6; i++) out.push(['H', qw(2.35)], ['L', qw(1.46)]);
    out.push(['H', qw(2.35)], ['L', 2 * qw(1.46)], ['H', qw(2.35)]);
    for (let i = 0; i < 6; i++) out.push(['L', qw(1.46)], ['H', qw(2.35)]);
    return out.map(([material, thickness], i) => ({ id: `f${i}`, material, thickness, locked: false }));
}

/** The filter as a front-only design, with `cone` when given. */
export const filterDesign = cone => ({
    incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'Sub', thickness: 1 },
    surfaceMode: 'front_only', mfEvalMode: 'side', frontLayers: filterLayers(), backLayers: [],
    ...(cone ? { cone } : {}),
});

/** Gauss-Legendre points x and weights w on [a, b]. */
export function glOn(a, b, n) {
    const { x, w } = gaussLegendre(n);
    const h = (b - a) / 2, m = (a + b) / 2;
    return { x: x.map(v => m + h * v), w: w.map(v => v * h) };
}

/** Largest absolute element-wise difference of two equal-length arrays. */
export const maxAbsDiff = (a, b) => a.reduce((d, v, i) => Math.max(d, Math.abs(v - b[i])), 0);
