/**
 * The non-polarizing edge filter search (src/utils/synthesis/edgeFilter.js).
 *
 *   1. Every period it returns has its s and p zone edges at the edge
 *      wavelength, N11 = ±1 for both (Macleod 5th ed., Eq. 9.21), checked with
 *      a matrix product of its own layers.
 *   2. A long stack of the chosen period, through TFStudio's spectrum code,
 *      crosses 50 % in s and in p within a small fraction of its rejection
 *      band of each other, and closer still with more periods, while a
 *      quarter-wave (0.5H L 0.5H) stack at the same angle stays split.
 *   3. No three-layer symmetrical period, the quarter-wave one among them, has
 *      coinciding edges: the search with a = 0 finds nothing.
 *   4. The edge is where it was asked for: the same indices at another edge
 *      wavelength give the same multipliers, and the zone starts there.
 *   5. The worked example in Essential Macleod's manual (Design Tools, Edge
 *      Filter, pp. 238-241: shortwave pass, 45° in air, SiO2 and TiO2) picks
 *      the period it reports.
 *   6. The ranking and the input limits.
 *
 * Run: node tests/edge_filter_search.mjs
 */

import assert from 'node:assert/strict';
import { layerMatrix, matmul, snellCosTheta } from '../src/tmmcore.js';
import { evaluateSpectrumAt } from '../src/utils/physics/thinFilmMath.js';
import {
    searchEdgeFilters, compareSolutions, edgeSearchError, searchGrid,
} from '../src/utils/synthesis/edgeFilter.js';

const ANGLE = 45;
const N_LOW = 1.45042;   // fused silica at 1000 nm (Malitson)
const N_HIGH = 2.25;     // the TiO2 index of Essential Macleod's example
const SUBSTRATE = 1.52;

const constant = n => ({ getNK: () => [n, 0] });
const request = (over = {}) => ({
    pass: 'short', edgeLambda: 510, nIncident: 1, angleDeg: ANGLE,
    nA: N_LOW, nB: N_HIGH, lower: 0.1, upper: 1.0, step: 0.05, ...over,
});

// The period's five layers as [n, coef], outer material first; A is the low
// index and B the high one throughout.
function periodLayers(sol) {
    const [nO, nI] = sol.outer === 'A' ? [N_LOW, N_HIGH] : [N_HIGH, N_LOW];
    return [[nO, sol.a], [nI, sol.b], [nO, sol.c], [nI, sol.b], [nO, sol.a]];
}

// N11 of the period from physical thicknesses at λ, by tmmcore's own matrices.
function n11At(sol, edgeLambda, lambda, pol) {
    const sin0 = [Math.sin(ANGLE * Math.PI / 180), 0];
    const cos0 = [Math.cos(ANGLE * Math.PI / 180), 0];
    let M = [[[1, 0], [0, 0]], [[0, 0], [1, 0]]];
    for (const [n, coef] of periodLayers(sol)) {
        const cosT = snellCosTheta([1, 0], sin0, [n, 0], cos0);
        M = matmul(M, layerMatrix([n, 0], coef * edgeLambda / (4 * n), lambda, cosT, pol));
    }
    return M[0][0][0];
}

// ── 1. Edges coincide at every solution ──────────────────────────────────────
for (const pass of ['short', 'long']) {
    const { solutions } = searchEdgeFilters(request({ pass }));
    assert.ok(solutions.length > 10, `${pass}: the default range finds periods (${solutions.length})`);
    for (const sol of solutions) {
        const s = n11At(sol, 510, 510, 's');
        const p = n11At(sol, 510, 510, 'p');
        assert.ok(Math.abs(s - sol.sigma) < 1e-7 && Math.abs(p - sol.sigma) < 1e-7,
            `${pass} ${sol.outer} a=${sol.a}: N11s ${s}, N11p ${p}, not both ${sol.sigma}`);
        // Both zones start on the stop side: longer wavelengths for a shortwave pass.
        const stop = pass === 'short' ? 510.05 : 509.95;
        const pas = pass === 'short' ? 509.95 : 510.05;
        for (const pol of ['s', 'p']) {
            assert.ok(Math.abs(n11At(sol, 510, stop, pol)) > 1, `${pass} ${pol}: the zone is on the stop side`);
            assert.ok(Math.abs(n11At(sol, 510, pas, pol)) < 1, `${pass} ${pol}: the pass side is out of the zone`);
        }
        assert.ok(sol.zoneS > 0 && sol.zoneP > 0 && sol.passWidth > 0, 'widths are positive');
    }
}

// ── 2. Long stacks through the spectrum code ─────────────────────────────────
// A finite stack has no sharp zone edge: T rises over a stretch that narrows as
// periods are added, and the p edge is the less steep of the two (Macleod
// p. 354), so the 50 % points of an unmatched stack sit a little apart even
// where the zone edges coincide. That gap closes as the stack grows. A
// quarter-wave stack's does not: its zones end at different wavelengths.

const transmittance = (layers, lambda, pol) => evaluateSpectrumAt([lambda],
    { theta: ANGLE, polarization: pol }, constant(1), constant(SUBSTRATE), layers).T[0];

// Where T first rises through 50 %, walking from `inside` (in both zones)
// toward the pass band in steps of `step` nm, then bisected.
function halfPoint(layers, pol, inside, dir, step) {
    let lo = inside;
    let lambda = inside;
    while (transmittance(layers, lambda, pol) < 0.5) { lo = lambda; lambda += dir * step; }
    let hi = lambda;
    for (let k = 0; k < 40; k++) {
        const mid = (lo + hi) / 2;
        if (transmittance(layers, mid, pol) < 0.5) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
}

function split(layers, inside, step) {
    const s = halfPoint(layers, 's', inside, -1, step);
    const p = halfPoint(layers, 'p', inside, -1, step);
    return { s, p, gap: Math.abs(s - p) };
}

const stack = (period, count, lambda0) => Array.from({ length: count }, () => period).flat()
    .map(([n, coef]) => ({ material: constant(n), thickness: coef * lambda0 / (4 * n) }));

const [best] = searchEdgeFilters(request()).solutions;
const bestPeriod = periodLayers(best);
const rejection = Math.min(best.zoneS, best.zoneP);
const edge40 = split(stack(bestPeriod, 40, 510), 512, 0.01);
const edge160 = split(stack(bestPeriod, 160, 510), 510.3, 0.002);
assert.ok(edge40.gap < 0.05 * rejection,
    `edge filter, 40 periods: s and p cross 50 % ${edge40.gap.toFixed(3)} nm apart, rejection band ${rejection.toFixed(1)} nm`);
assert.ok(Math.abs(edge40.s - 510) < 0.05 * rejection, `the 50 % edge (${edge40.s.toFixed(2)} nm) is at the zone edge`);
assert.ok(edge160.gap < edge40.gap / 4,
    `the gap closes with more periods: ${edge40.gap.toFixed(3)} nm at 40, ${edge160.gap.toFixed(3)} nm at 160`);

// The quarter-wave period (0.5H L 0.5H) at 600 nm: at 45° its zone covers
// about 490-600 nm in p, wider in s. The steps stay well under the fringe
// spacing beside the edge.
const qw = [[N_HIGH, 0.5], [N_LOW, 1], [N_HIGH, 0.5]];
const qw40 = split(stack(qw, 40, 600), 500, 0.02);
const qw160 = split(stack(qw, 160, 600), 500, 0.01);
assert.ok(qw40.gap > 20 * edge40.gap,
    `quarter-wave stack: s and p cross 50 % ${qw40.gap.toFixed(2)} nm apart, the edge filter ${edge40.gap.toFixed(3)} nm`);
assert.ok(qw160.gap > 0.9 * qw40.gap, `the quarter-wave gap stays: ${qw40.gap.toFixed(2)} nm at 40, ${qw160.gap.toFixed(2)} nm at 160`);

// ── 3. Three-layer periods ───────────────────────────────────────────────────
// a = 0 leaves (bB cA bB) and (bA cB bA), every three-layer symmetrical period.
for (const pass of ['short', 'long']) {
    const { solutions } = searchEdgeFilters(request({ pass, lower: 0, upper: 0.5, step: 1 }));
    assert.equal(searchGrid(0, 0.5, 1).length, 1, 'that range holds a = 0 only');
    assert.deepEqual(solutions, [], `${pass}: a three-layer period with coinciding edges was found`);
}

// ── 4. The edge lands at the asked wavelength ────────────────────────────────
{
    const at510 = searchEdgeFilters(request()).solutions;
    const at1000 = searchEdgeFilters(request({ edgeLambda: 1000 })).solutions;
    assert.equal(at510.length, at1000.length);
    at510.forEach((sol, i) => {
        const other = at1000[i];
        for (const key of ['a', 'b', 'c']) {
            assert.ok(Math.abs(sol[key] - other[key]) < 1e-12, `${key} is the same multiplier at either edge`);
        }
        assert.ok(Math.abs(other.zoneS / sol.zoneS - 1000 / 510) < 1e-6, 'zone widths scale with the edge');
    });
    const sol = at1000[0];
    for (const pol of ['s', 'p']) {
        assert.ok(Math.abs(Math.abs(n11At(sol, 1000, 1000, pol)) - 1) < 1e-7, `${pol}: |N11| = 1 at 1000 nm`);
        assert.ok(Math.abs(n11At(sol, 1000, 1001, pol)) > 1, `${pol}: in the zone at 1001 nm`);
    }
}

// ── 5. Essential Macleod's worked example ───────────────────────────────────
// Its formula is (0.4X 0.548835441844365Y 0.362700817540749X 0.548835441844365Y
// 0.4X)^19 with X = SiO2 and Y = TiO2, edge 1000 nm. Its SiO2 at 1000 nm is not
// stated; its thicknesses put it between 1.4504 and 1.4506, which moves b and c
// in the fifth decimal.
{
    const { solutions } = searchEdgeFilters(request({ edgeLambda: 1000 }));
    const top = solutions[0];
    assert.equal(top.outer, 'A', 'SiO2 outside');
    assert.ok(Math.abs(top.a - 0.4) < 1e-12, `a = ${top.a}`);
    assert.ok(Math.abs(top.b - 0.548835) < 5e-5, `b = ${top.b}`);
    assert.ok(Math.abs(top.c - 0.362701) < 5e-5, `c = ${top.c}`);
    assert.equal(top.sigma, -1, 'a first-order zone');
}

// ── 6. Ranking and limits ────────────────────────────────────────────────────
{
    const { solutions } = searchEdgeFilters(request());
    const narrower = sol => Math.min(sol.zoneS, sol.zoneP);
    for (let i = 1; i < solutions.length; i++) {
        assert.ok(narrower(solutions[i - 1]) >= narrower(solutions[i]), 'ranked by the narrower zone');
        assert.ok(compareSolutions(solutions[i - 1], solutions[i]) <= 0);
    }
    const tie = { zoneS: 10, zoneP: 8 };
    assert.ok(compareSolutions({ ...tie, passWidth: 300 }, { ...tie, passWidth: 200 }) < 0, 'a tie goes to the wider pass region');

    let calls = 0;
    searchEdgeFilters(request(), { onProgress: (done, total) => { calls++; assert.ok(done <= total); } });
    assert.equal(calls, 19, 'one progress call per value of a');

    const cases = [
        [{ edgeLambda: 0 }, 'edgeLambda'],
        [{ angleDeg: 0 }, 'angle'],
        [{ angleDeg: 90 }, 'angle'],
        [{ nB: N_LOW }, 'sameIndex'],
        [{ nIncident: 1.52, angleDeg: 80, nA: 1.38 }, 'evanescent'],
        [{ lower: -0.1 }, 'lower'],
        [{ upper: 0.1 }, 'upper'],
        [{ lower: 1.5, upper: 1.5 }, 'upper'],
        [{ upper: 2.01 }, 'upper'],
        [{ step: 0.00009 }, 'step'],
    ];
    for (const [over, key] of cases) {
        assert.equal(edgeSearchError(request(over)), key, JSON.stringify(over));
        assert.deepEqual(searchEdgeFilters(request(over)), { errorKey: key });
    }
    assert.equal(edgeSearchError(request({ lower: 0, upper: 2, step: 0.0001 })), null, 'the widest range the limits allow');
    // Each limit has a reason (edgeFilter.js, EDGE_SEARCH_LIMITS); a start
    // above 1 and a step wider than the range have none against them.
    assert.equal(edgeSearchError(request({ lower: 1.5, upper: 1.8 })), null, 'a start between 1 and 2 is searched');
    assert.equal(edgeSearchError(request({ step: 1.5 })), null, 'a step wider than the range is accepted');
    assert.deepEqual(searchGrid(0.1, 1, 1.5), [0.1], 'and searches the start alone');
}

console.log('edge_filter_search: passed');
console.log(`  edge filter, s and p 50 % points apart: ${edge40.gap.toFixed(3)} nm at 40 periods, ${edge160.gap.toFixed(3)} nm at 160`);
console.log(`  quarter-wave stack: ${qw40.gap.toFixed(2)} nm at 40 periods, ${qw160.gap.toFixed(2)} nm at 160`);
