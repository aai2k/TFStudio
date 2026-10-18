/**
 * Non-polarizing edge filter: a five-layer symmetrical period (aA bB cA bB aA)
 * whose s and p zone edges fall at the same wavelength at one angle of
 * incidence.
 *
 * The zone edge. A symmetrical period of lossless layers has a characteristic
 * matrix whose diagonal terms are real and equal, N11 = N22 (Macleod, Thin-Film
 * Optical Filters, 5th ed., §7.2.2, Eqs. 7.5 and 7.6, pp. 216-217). Where
 * |N11| > 1 the reflectance of a stack of the period tends to unity as periods
 * are added (p. 218), and the edges of that high-reflectance zone are where
 * N11 = ±1 (§9.5.1, Eq. 9.21, p. 351,
 * after A. Thelen, J. Opt. Soc. Am. 71, 309 (1981)). The edge is a property of
 * the period alone: the number of periods, the substrate and any matching
 * layers do not move it. An edge filter for unpolarized light needs the s and
 * p zones to start at the same wavelength and on the same side of it.
 *
 * Conventions. a, b and c are quarter-wave optical thickness multipliers at
 * the edge wavelength λe at normal incidence, as in Stack Formula:
 * d = coef·λe / (4n). Lengths below are in units of λe, so a wavelength λ
 * enters as λ/λe = 1/g, g = λe/λ. Each layer's phase thickness is
 * δ = 2π n d cosθ / λ (§9.2, Eq. 9.2) and its tilted admittance n cosθ for s,
 * n / cosθ for p, in free-space units (§9.2); cosθ follows from the real
 * invariant n0 sinθ0 of the incident medium. The layer matrices come from
 * tmmcore, the same ones every spectrum in TFStudio is computed with.
 *
 * The search. The indices are those at λe and the layers are taken as
 * lossless, the case Eq. 9.21 holds for. Write the period as L·C·R with C the
 * centre layer cA and R the mirror image of L = (aA)(bB). C is linear in
 * cos γ and sin γ, γ the centre layer's phase, so
 *     N11 = P cos γ + Q sin γ,
 * P = N11 with the centre layer absent and Q = N11 with it a tilted quarter
 * wave. γ is the same number for s and p (it depends on n cosθ, not on the
 * admittance), so asking N11 = σ for both polarizations at λe, σ = ±1, is two
 * linear equations in cos γ and sin γ, as Macleod's Eq. 9.23 is for his
 * detuned outer layers (solved in Eqs. 9.24 and 9.25, p. 352). Their solution
 * is a point on the unit circle only for particular b, and that is the one
 * condition left:
 *     F(b) = x² + y² − 1 = 0,  x = σ(Qp − Qs)/D,  y = σ(Ps − Pp)/D,
 *     D = Ps Qp − Qs Pp.
 * F does not depend on σ, so each root b gives two periods, γ and γ + π, one
 * with its edge on an odd-order zone (N11 = −1) and one on an even-order zone
 * (N11 = +1).
 *
 * For each a on the search grid and for either material outside, F is sampled
 * over one period of b and its roots bracketed and bisected. The manual of
 * Essential Macleod's Edge Filter tool (Design Tools, Edge Filter, pp. 238-241)
 * describes finding b and then scaling a, b and c together to put the edge at
 * λe; solving at λe from the start gives the same periods without the scaling
 * and keeps a on the grid asked for, as the manual's worked example has
 * (a = 0.4 with the edge exactly at the reference wavelength).
 *
 * Which periods are kept. At a root the two zones touch λe; a shortwave-pass
 * filter needs both on the long-wavelength side, a longwave-pass filter both
 * on the short side. A root whose zones face opposite ways, or that only
 * touches |N11| = 1 without entering a zone (a single layer, for one), is no
 * edge filter and is dropped.
 *
 * Selection rule. Unpolarized light is rejected only where both zones are, so
 * the narrower of the s and p zones is the rejection band of the filter. The
 * periods are ranked by that width, widest first, and a tie goes to the wider
 * pass region, the distance from the edge to the next zone of either
 * polarization on the pass side. For the worked example in Essential Macleod's
 * manual this picks the period it reports.
 *
 * Normal incidence. At 0° s and p are the same wave, so every period has its
 * edges together and there is nothing to search (D above vanishes). The
 * search gives the plain quarter-wave period (½sO sI ½sO) instead, with s
 * putting its first-order zone edge at λe (N11 = −1 there), both ways round.
 * Between air and glass a shortwave pass is better matched with the low index
 * outside and a longwave pass with the high index outside (Chapter 7,
 * "Application to Edge Filters", Eqs. 7.17 and 7.18, Fig. 7.3), so that one is
 * listed first. Its c is null: the period has no centre layer.
 */

import { layerMatrix, matmul, snellCosTheta } from '../../tmmcore.js';

const HALF_PI = Math.PI / 2;

// Samples of b across one period of the inner layer's phase. Neighbouring
// roots lie 0.017 apart in b in the worked example of Essential Macleod's
// manual; 400 samples put about three between them.
const B_SAMPLES = 400;

// Bisection steps: 60 halvings take a bracket of 0.005 below double
// precision.
const BISECTIONS = 60;

// A root is kept when N11 lands within this of ±1 for both polarizations; the
// bisection reaches round-off, so a miss means the bracket held a pole.
const EDGE_TOLERANCE = 1e-7;

// Steps in g = λe/λ for walking across a zone or a pass region. A zone or gap
// narrower than 0.2 % of λe could be stepped over; the far edge of each is
// then bisected to round-off.
const G_STEP = 0.002;

// The zone has to be entered within this fraction of λe on the stop side.
const SIDE_PROBE = 1e-5;

// The pass region is walked out to λe/4 on the short side and 20·λe on the
// long side. On the long side a first-order zone has no other zone beyond it,
// so its pass region does not end: it is reported as Infinity.
const G_MAX = 4;
const G_MIN = 0.05;

// The range of a. It starts at 0 or above, a being a thickness. It ends at 2
// or below: adding 2/cosθ to a, at least 2 at any angle, adds a tilted half
// wave to each outer layer, which changes the sign of both their matrices and
// so leaves the period at λe as it was, with the same b and c, and a range of 2
// is shorter than that repeat. The step is 0.0001 or more: the widest range
// then has 20001 values of a, a few minutes of search at about 11 ms each.
export const EDGE_SEARCH_LIMITS = {
    lowerMin: 0, upperMax: 2, stepMin: 0.0001,
};

function cosThetaIn(n, geometry) {
    return snellCosTheta([geometry.n0, 0], geometry.sin0, [n, 0], geometry.cos0)[0];
}

// The incidence geometry shared by every layer: Snell's invariant n0 sinθ0.
function incidenceGeometry(n0, angleDeg) {
    const rad = angleDeg * Math.PI / 180;
    return { n0, sin0: [Math.sin(rad), 0], cos0: [Math.cos(rad), 0] };
}

// One layer of index n and normal-incidence quarter-wave multiplier `coef` at
// λe, seen at λ = 1/g (λe = 1).
function layer(n, cosTheta, coef, g, pol) {
    return layerMatrix([n, 0], coef / (4 * n), 1 / g, [cosTheta, 0], pol);
}

// The centre layer as a tilted quarter wave at λ = 1/g: phase π/2.
function quarterWaveAt(n, cosTheta, g, pol) {
    return layerMatrix([n, 0], 1 / (4 * g * n * cosTheta), 1 / g, [cosTheta, 0], pol);
}

/**
 * N11 of the period (aO bI cO bI aO) at g = λe/λ, O the outer material and I
 * the inner one. `period` holds { nOuter, nInner, cosOuter, cosInner, a, b, c }.
 */
export function periodN11(period, g, pol) {
    const { nOuter, nInner, cosOuter, cosInner, a, b, c } = period;
    const A = layer(nOuter, cosOuter, a, g, pol);
    const B = layer(nInner, cosInner, b, g, pol);
    const C = layer(nOuter, cosOuter, c, g, pol);
    return matmul(matmul(matmul(matmul(A, B), C), B), A)[0][0][0];
}

// P and Q of N11 = P cos γ + Q sin γ for one polarization at λe.
function centreTerms(period, pol) {
    const { nOuter, nInner, cosOuter, cosInner, a, b } = period;
    const A = layer(nOuter, cosOuter, a, 1, pol);
    const B = layer(nInner, cosInner, b, 1, pol);
    const left = matmul(A, B);
    const right = matmul(B, A);
    const P = matmul(left, right)[0][0][0];
    const Q = matmul(matmul(left, quarterWaveAt(nOuter, cosOuter, 1, pol)), right)[0][0][0];
    return { P, Q };
}

// cos γ and sin γ for σ = +1 that satisfy both polarizations, and their
// distance from the unit circle.
function centreSolution(period) {
    const s = centreTerms(period, 's');
    const p = centreTerms(period, 'p');
    const D = s.P * p.Q - s.Q * p.P;
    const x = (p.Q - s.Q) / D;
    const y = (s.P - p.P) / D;
    return { x, y, F: x * x + y * y - 1 };
}

function bisectRoot(f, lo, hi, fLo) {
    for (let k = 0; k < BISECTIONS; k++) {
        const mid = (lo + hi) / 2;
        const fMid = f(mid);
        if (Math.sign(fMid) === Math.sign(fLo)) { lo = mid; fLo = fMid; } else hi = mid;
    }
    return (lo + hi) / 2;
}

// Roots of F over b in (0, 2/cosθ_inner). The period holds two inner layers,
// and a layer's matrix only changes sign when its phase grows by π, so the
// period repeats with that period in b.
function innerRoots(base) {
    const bSpan = 2 / base.cosInner;
    const F = b => centreSolution({ ...base, b }).F;
    const roots = [];
    let prev = null;
    for (let i = 1; i < B_SAMPLES; i++) {
        const b = bSpan * i / B_SAMPLES;
        const value = F(b);
        if (prev && Number.isFinite(value) && Number.isFinite(prev.value)
            && Math.sign(value) !== Math.sign(prev.value)) {
            roots.push(bisectRoot(F, prev.b, b, prev.value));
        }
        prev = { b, value };
    }
    return roots;
}

const excess = (period, g, pol) => Math.abs(periodN11(period, g, pol)) - 1;

// Which side of λe both zones lie on: 'short' when they lie at longer
// wavelengths (a shortwave-pass filter), 'long' when at shorter ones, null when
// the polarizations disagree or neither enters a zone.
function passSide(period) {
    const inside = dir => ['s', 'p'].every(pol => excess(period, 1 + dir * SIDE_PROBE, pol) > 0);
    const outside = dir => ['s', 'p'].every(pol => excess(period, 1 + dir * SIDE_PROBE, pol) < 0);
    if (inside(-1) && outside(1)) return 'short';
    if (inside(1) && outside(-1)) return 'long';
    return null;
}

// Walk g from λe in direction `dir` (+1 toward shorter wavelengths) until
// f changes sign, and bisect that crossing. null when none within the bound.
function walkTo(f, dir) {
    let gPrev = 1 + dir * SIDE_PROBE;
    let fPrev = f(gPrev);
    for (let k = 1; ; k++) {
        const g = 1 + dir * k * G_STEP;
        if (g > G_MAX || g < G_MIN) return null;
        const value = f(g);
        if (Math.sign(value) !== Math.sign(fPrev)) return bisectRoot(f, gPrev, g, fPrev);
        gPrev = g;
        fPrev = value;
    }
}

// Width in nm between λe and the wavelength λe/g.
const widthNm = (g, edgeLambda) => (g === null ? Infinity : Math.abs(edgeLambda / g - edgeLambda));

// Zone widths of s and p on the stop side and the pass region on the other,
// in nm, with the indices at λe.
function zoneWidths(period, side, edgeLambda) {
    const stopDir = side === 'short' ? -1 : 1;
    const zone = pol => widthNm(walkTo(g => excess(period, g, pol), stopDir), edgeLambda);
    const anyZone = g => Math.max(excess(period, g, 's'), excess(period, g, 'p'));
    return {
        zoneS: zone('s'),
        zoneP: zone('p'),
        passWidth: widthNm(walkTo(anyZone, -stopDir), edgeLambda),
    };
}

// The periods with edges at λe for one outer material and one a.
function periodsAt(base, edgeLambda, pass) {
    const found = [];
    for (const b of innerRoots(base)) {
        const { x, y } = centreSolution({ ...base, b });
        for (const sigma of [1, -1]) {
            let gamma = Math.atan2(sigma * y, sigma * x);
            if (gamma <= 0) gamma += 2 * Math.PI;
            const period = { ...base, b, c: gamma / (HALF_PI * base.cosOuter) };
            const onEdge = ['s', 'p'].every(pol => Math.abs(periodN11(period, 1, pol) - sigma) < EDGE_TOLERANCE);
            if (!onEdge || passSide(period) !== pass) continue;
            found.push({ period, sigma, ...zoneWidths(period, pass, edgeLambda) });
        }
    }
    return found;
}

// The scale s of the quarter-wave period (½sO sI ½sO) at normal incidence
// whose first-order zone edge is at λe. At s = 1 the period is a quarter wave
// at λe, the centre of its zone, where N11 is lowest and below −1; at s = 0 it
// has no thickness and at s = 2 its layers are half waves, and N11 = 1 at both.
// So N11 = −1 once on each side: above 1 for a shortwave pass, whose zone then
// lies at longer wavelengths, below 1 for a longwave pass. These are the
// s = 1 ± Δg of the zone half-width in Eq. 7.15 (§7.2.2), the same for either
// material outside.
function quarterWaveScale(nOuter, nInner, pass) {
    const n11 = s => matmul(matmul(layer(nOuter, 1, s / 2, 1, 's'), layer(nInner, 1, s, 1, 's')),
        layer(nOuter, 1, s / 2, 1, 's'))[0][0][0];
    const f = s => n11(s) + 1;
    return bisectRoot(f, 1, pass === 'short' ? 2 : 0, f(1));
}

// The quarter-wave periods at normal incidence, the better matched first. As
// a five-layer period (aO bI cO bI aO) with a = s/2 and b = c = s it is two of
// the three-layer one, whose zones are the same (N11 of two is 2·N11² − 1), so
// its widths come from the same walk as every other period's.
function quarterWavePeriods({ pass, edgeLambda, nA, nB }) {
    const lowOutside = nA < nB ? 'A' : 'B';
    const highOutside = lowOutside === 'A' ? 'B' : 'A';
    const first = pass === 'short' ? lowOutside : highOutside;
    return [first, first === 'A' ? 'B' : 'A'].map((outer) => {
        const [nOuter, nInner] = outer === 'A' ? [nA, nB] : [nB, nA];
        const s = quarterWaveScale(nOuter, nInner, pass);
        const period = { nOuter, nInner, cosOuter: 1, cosInner: 1, a: s / 2, b: s, c: s };
        return { outer, a: s / 2, b: s, c: null, sigma: -1, ...zoneWidths(period, pass, edgeLambda) };
    });
}

/** The search grid of a: lower, lower + step, … up to upper. */
export function searchGrid(lower, upper, step) {
    const count = Math.floor((upper - lower) / step + 1e-9) + 1;
    return Array.from({ length: count }, (_, k) => lower + k * step);
}

const L = EDGE_SEARCH_LIMITS;

// Each check names the input it refuses; the first that fails is reported.
// Comparisons are written so that a missing or NaN input fails them.
const REQUEST_CHECKS = [
    ['edgeLambda', r => r.edgeLambda > 0],
    ['angle', r => r.angleDeg >= 0 && r.angleDeg < 90],
    ['noIndex', r => r.nA > 0 && r.nB > 0 && r.nIncident > 0],
    ['sameIndex', r => r.nA !== r.nB],
    // A layer past its critical angle carries no travelling wave.
    ['evanescent', r => Math.min(r.nA, r.nB) > r.nIncident * Math.sin(r.angleDeg * Math.PI / 180)],
    ['lower', r => r.lower >= L.lowerMin],
    ['upper', r => r.upper > r.lower && r.upper <= L.upperMax],
    ['step', r => r.step >= L.stepMin],
];

/** Why a request cannot be searched, as an error key, or null when it can. */
export function edgeSearchError(request) {
    return REQUEST_CHECKS.find(([, passes]) => !passes(request))?.[0] ?? null;
}

/** Rejection band first, then pass region: negative when x ranks above y. */
export function compareSolutions(x, y) {
    const band = Math.min(y.zoneS, y.zoneP) - Math.min(x.zoneS, x.zoneP);
    return band !== 0 ? band : y.passWidth - x.passWidth;
}

/**
 * Search the periods (aA bB cA bB aA) and (aB bA cB bA aB) for edges at λe.
 *
 * request: { pass: 'short' | 'long', edgeLambda (nm), nIncident, angleDeg,
 *            nA, nB (real indices at λe), lower, upper, step }
 * options: { onProgress(done, total) } called after each value of a.
 *
 * Returns { solutions } best first, each { outer: 'A' | 'B', a, b, c, sigma,
 * zoneS, zoneP, passWidth }, widths in nm; or { errorKey }.
 */
export function searchEdgeFilters(request, { onProgress } = {}) {
    const errorKey = edgeSearchError(request);
    if (errorKey) return { errorKey };
    if (request.angleDeg === 0) {
        if (onProgress) onProgress(1, 1);
        return { solutions: quarterWavePeriods(request) };
    }
    const { pass, edgeLambda, nIncident, angleDeg, nA, nB, lower, upper, step } = request;
    const geometry = incidenceGeometry(nIncident, angleDeg);
    const orders = [
        { outer: 'A', nOuter: nA, nInner: nB },
        { outer: 'B', nOuter: nB, nInner: nA },
    ].map(o => ({ ...o, cosOuter: cosThetaIn(o.nOuter, geometry), cosInner: cosThetaIn(o.nInner, geometry) }));
    const grid = searchGrid(lower, upper, step);
    const solutions = [];
    grid.forEach((a, done) => {
        for (const { outer, ...materials } of orders) {
            for (const found of periodsAt({ ...materials, a }, edgeLambda, pass)) {
                const { b, c } = found.period;
                solutions.push({ outer, a, b, c, sigma: found.sigma,
                    zoneS: found.zoneS, zoneP: found.zoneP, passWidth: found.passWidth });
            }
        }
        if (onProgress) onProgress(done + 1, grid.length);
    });
    return { solutions: solutions.sort(compareSolutions) };
}
