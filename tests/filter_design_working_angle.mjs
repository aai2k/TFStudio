/**
 * Filter Design: designing a filter for a working angle.
 *
 * Step 1 takes the angle the filter will be used at. Three things have to follow
 * from it, and this checks each against the full TMM of the finished coated
 * filter in air:
 *
 *   - the frame. Steps 1 to 5 evaluate the filter embedded in its substrate, so
 *     45° in air is 27.8° there (Macleod, Thin-Film Optical Filters 5th ed.,
 *     Eq. 9.5). Scoring the air angle against an embedded stack designs for an
 *     angle nobody uses.
 *   - the position. A tilted filter's passband moves to shorter wavelengths
 *     (§8.2.5, p. 276), so the quarter waves go down at a longer reference. For
 *     45° in air the stretch is about 11 %.
 *   - the shape. The search has to score at the angle, because what a tilt does
 *     to a multiple-cavity filter depends on the cavity orders and materials it
 *     chose (§8.4.1).
 *
 * Fixtures are the wizard's own defaults where the numbers are absolute (Nb2O5,
 * SiO2, BK7 at 600 nm) and constant indices where a comparison is what matters.
 *
 * Run: node tests/filter_design_working_angle.mjs
 */
import {
    constIndex, buildPrototypeLayers, coupledMirrors, toNDLayers, buildFilterTarget, targetSpan,
    meritFunctionEmbedded, globalIntegerSearch, embeddedAngleDeg, invariantOf, designReference,
    adjustToIncidentMedium, bandCentreAtAngle, angleWindowLow,
} from '../src/utils/filter/filterDesign.js';
import { buildFilterDesignObject } from '../src/utils/filter/filterDesignBuild.js';
import { tmm } from '../src/utils/physics/thinFilmMath.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';

let fails = 0;
const ok = (c, m) => { if (!c) { console.error('FAIL:', m); fails++; } };

const LAM0 = 600, HALF_PASS = 2.0, HALF_STOP = 6.0, CAVITIES = 4;
const SPEC = { lambda0_nm: LAM0, halfPass: HALF_PASS, halfStop: HALF_STOP };
const nAir = constIndex(1);
const FLAT = { nH: constIndex(1.952), nL: constIndex(1.452), nSub: constIndex(1.51593) };
const REAL = { nH: getMaterial('Nb2O5').getNK, nL: getMaterial('SiO2').getNK, nSub: getMaterial('BK7').getNK };
const inSub = (deg, M) => embeddedAngleDeg({ aoiDeg: deg, nInc: nAir, nSub: M.nSub, lambda0_nm: LAM0 });
const targetAt = (deg, M, pol = 's') => buildFilterTarget({ ...SPEC, aoi: inSub(deg, M), pol });
const layersAt = (M, ref, mirrors, spacers) => buildPrototypeLayers({ nH: M.nH, nL: M.nL, lambda0_nm: ref, mirrors, spacers });

/** T of a layer list in air at an angle. */
function airT(layers, lam, M, aoi, pol) {
    const v = M.nSub(lam);
    return tmm(lam, aoi, pol, [1, 0], Array.isArray(v) ? v : [v, 0], toNDLayers(layers, lam)).T;
}

/** Peak T and where it is, and the range over the specified passband, in air. */
function airShape(layers, M, aoi, pol) {
    let peak = 0, at = LAM0;
    for (let lam = LAM0 - 40; lam <= LAM0 + 40; lam += 0.01) {
        const T = airT(layers, lam, M, aoi, pol);
        if (T > peak) { peak = T; at = lam; }
    }
    let sum = 0, n = 0, min = 1;
    for (let x = -HALF_PASS; x <= HALF_PASS + 1e-9; x += HALF_PASS / 16) {
        const T = airT(layers, LAM0 + x, M, aoi, pol);
        sum += T; n++; min = Math.min(min, T);
    }
    return { peak, at, min, mean: sum / n };
}

/** The design the wizard's Finish button would build. */
function design(best, deg, pol, ids) {
    return buildFilterDesignObject({
        name: 'x', matH: 'H', matL: 'L', substrateMaterial: 'S', incidentMedium: 'A', exitMedium: 'A',
        lambda0_nm: LAM0, candidate: best, arMode: 'vcoat',
        halfPass: HALF_PASS, halfStop: HALF_STOP, aoi: deg, pol,
        resolve: (id) => ({ getNK: ids[id] }),
    });
}
const idsOf = (M) => ({ H: M.nH, L: M.nL, S: M.nSub, A: nAir });

/**
 * A search at one working angle, kept so the same one is not run twice: the
 * sections below compare the same cases from different sides and a search is the
 * expensive part of this file.
 */
const searches = new Map();
function searchAt(M, deg, pol) {
    const key = `${M === FLAT ? 'flat' : 'real'}|${deg}|${pol}`;
    if (!searches.has(key)) {
        searches.set(key, globalIntegerSearch({
            nH: M.nH, nL: M.nL, nSub: M.nSub, lambda0_nm: LAM0,
            target: deg > 0 ? targetAt(deg, M, pol) : buildFilterTarget(SPEC),
            cavities: CAVITIES, seedMirrors: coupledMirrors(CAVITIES, 9, 1), seedMirror: 9, seedSpacer: 1,
            restarts: 6, rngSeed: 1234,
        }).best);
    }
    return searches.get(key);
}

// ── 1. The frame conversion ──────────────────────────────────────────────────
console.log('-- the angle in the substrate --');
{
    ok(inSub(0, FLAT) === 0, 'normal incidence stays normal');
    const at45 = inSub(45, FLAT);
    console.log(`    45° in air = ${at45.toFixed(3)}° in n = 1.51593;  15° = ${inSub(15, FLAT).toFixed(3)}°`);
    ok(Math.abs(at45 - 27.804) < 0.001, `45° in air is 27.804° in the substrate (got ${at45.toFixed(3)})`);
    // The free-space invariant is what both angles share (Eq. 9.5).
    const kAir = invariantOf(45, 1), kSub = invariantOf(at45, 1.51593);
    ok(Math.abs(kAir - kSub) < 1e-12, `the invariant is the same on both sides (${kAir.toFixed(9)} vs ${kSub.toFixed(9)})`);
    // The angle is read at λ₀ and held across the window, so a dispersive
    // substrate is scored at one angle instead of its own angle per wavelength.
    // The size of that is what the module documents: 0.02° for BK7 at 45°, a
    // tenth of a nanometre of band position, against a 0.25 nm target spacing.
    const span = targetSpan(HALF_PASS, HALF_STOP);
    const ends = [LAM0 - span, LAM0 + span].map((lam) => embeddedAngleDeg({ aoiDeg: 45, nInc: nAir, nSub: REAL.nSub, lambda0_nm: lam }));
    const cosOf = (d) => Math.cos(d * Math.PI / 180);
    const drift = LAM0 * Math.abs(cosOf(ends[0]) - cosOf(ends[1])) / cosOf(ends[0]);
    console.log(`    BK7 across ±${span} nm: ${ends[0].toFixed(4)}..${ends[1].toFixed(4)}°, worth ${drift.toFixed(3)} nm of band position`);
    ok(Math.abs(ends[0] - ends[1]) < 0.02, `BK7's dispersion moves it under 0.02° across the target window (got ${Math.abs(ends[0] - ends[1]).toFixed(4)}°)`);
    ok(drift < HALF_PASS / 8, `less than one target point spacing (${drift.toFixed(3)} nm against ${(HALF_PASS / 8).toFixed(3)})`);

    // An incident medium denser than the low-index coating material puts the
    // geometry past critical: no wave propagates in that layer, so there is no
    // band. The scan has to say so without walking the spectrum, and the window a
    // caller samples materials over has to stay a wavelength.
    const layers = layersAt(FLAT, LAM0, [9, 19, 19, 17, 7], [1, 1, 1, 1]);
    let lookups = 0;
    const counted = (lam) => { lookups += 1; return FLAT.nSub(lam); };
    const past = bandCentreAtAngle({
        layers, target: buildFilterTarget(SPEC), nSub: counted, nInc: constIndex(1.75), aoiDeg: 60, pol: 's',
    });
    const kappaPast = invariantOf(60, 1.75);
    console.log(`    n_inc 1.75 at 60°: kappa ${kappaPast.toFixed(4)} over n_L 1.452, peak ${past.peak}, ${lookups} lookups`);
    ok(past.peak === 0 && lookups === 0, `past critical the scan reports no band without running (peak ${past.peak}, ${lookups} lookups)`);
    const low = angleWindowLow({ lambda0_nm: LAM0, kappa: kappaPast, nLow: 1.452, halfPass: HALF_PASS, halfStop: HALF_STOP });
    ok(low > 0, `and the sampling window stays a wavelength rather than going negative (got ${low.toFixed(1)} nm)`);
}

// ── 2. The reference stretch puts the band on λ₀ ─────────────────────────────
// Every delivered case is measured on the coated filter in air, which is the
// thing the user gets. The first row is the bug this covers: the same structure
// with its quarter waves at λ₀ resonates 61 nm short when used at 45°.
//
// The band edges are worth watching at 45° in s. The s-reflectance of every
// mirror rises with angle, so the cavities sharpen and the ±halfPass points end
// up on the roll-off: the minimum across the specified passband falls to 92.6 %
// with constant indices and 88.8 % with the builtin materials, against a mean
// still over 97 %. More cavities or a wider passband is the dial for that; the
// claim tested here is that the band is in the right place and full height.
console.log('-- the band lands on λ₀ --');
{
    const best = searchAt(FLAT, 45, 's');
    const t45 = targetAt(45, FLAT, 's');
    const { centre } = bandCentreAtAngle({
        layers: layersAt(FLAT, LAM0, best.mirrors, best.spacers),
        target: t45, nSub: FLAT.nSub, aoiDeg: inSub(45, FLAT), pol: 's',
    });
    console.log(`    laid at λ₀, used at 45°:  band at ${centre.toFixed(2)} nm, ${(LAM0 - centre).toFixed(2)} nm short`);
    ok(centre < LAM0 - 20, `a stack laid at λ₀ resonates well short of it at 45° (${centre.toFixed(2)} nm)`);

    for (const [M, label, deg, pol] of [[FLAT, 'flat', 15, 's'], [FLAT, 'flat', 45, 's'], [FLAT, 'flat', 45, 'p'], [REAL, 'Nb2O5/SiO2/BK7', 45, 's']]) {
        const cd = M === FLAT && deg === 45 && pol === 's' ? best : searchAt(M, deg, pol);
        const ids = idsOf(M);
        const d = design(cd, deg, pol, ids);
        const got = airShape(d.frontLayers.map(l => ({ nk: ids[l.material], d: l.thickness })), M, deg, pol);
        const stretch = d.referenceWavelength / LAM0;
        console.log(`    ${label.padEnd(15)} ${String(deg).padStart(2)}° ${pol}:  reference ${d.referenceWavelength.toFixed(2)} nm (x${stretch.toFixed(4)})` +
            `  peak ${(100 * got.peak).toFixed(2)} % at ${got.at.toFixed(2)} nm  passband ${(100 * got.min).toFixed(2)}..${(100 * got.mean).toFixed(2)} %`);
        ok(Math.abs(got.at - LAM0) <= 0.05, `${label} ${deg}° ${pol}: the band peaks on λ₀ (${got.at.toFixed(2)} nm)`);
        ok(got.peak > 0.99, `${label} ${deg}° ${pol}: peak T over 99 % (${(100 * got.peak).toFixed(2)} %)`);
        // The 0.5 dB pass level is the specification the target is written to.
        ok(got.mean > 0.8913, `${label} ${deg}° ${pol}: mean across the passband above the 0.5 dB level (${(100 * got.mean).toFixed(2)} %)`);
        ok(stretch > 1, `${label} ${deg}° ${pol}: the reference is stretched, never shortened (x${stretch.toFixed(4)})`);
    }
}

// ── 3. Normal incidence is untouched ────────────────────────────────────────
console.log('-- no working angle: nothing moves --');
{
    const t = buildFilterTarget(SPEC);
    const best = searchAt(FLAT, 0, 's');
    const d = design(best, 0, 's', idsOf(FLAT));
    console.log(`    [${best.mirrors.join(' ')}]/[${best.spacers.join(' ')}]  MF ${best.mf.toFixed(6)}  reference ${d.referenceWavelength.toFixed(4)} nm`);
    ok(d.referenceWavelength === LAM0, `the reference stays exactly λ₀ (got ${d.referenceWavelength})`);
    // The reference solve short-circuits at angle 0 rather than measuring, so an
    // unbuildable callback proves it never builds.
    const never = designReference({ buildAt: () => { throw new Error('built'); }, target: t, nSub: FLAT.nSub });
    ok(never === LAM0, 'designReference returns λ₀ at normal incidence without building anything');

    // The merit brackets its centring scan against the wavelength the quarter
    // waves were laid at. A stretched stack scored on the default assumption
    // brackets a window its band is not in and comes back meaningless, so the
    // reference has to be sayable and has to change the answer.
    const cd = searchAt(FLAT, 45, 's');
    const t45 = targetAt(45, FLAT, 's');
    const buildAt = (ref) => layersAt(FLAT, ref, cd.mirrors, cd.spacers);
    const ref = designReference({ buildAt, target: t45, nSub: FLAT.nSub });
    const assumed = meritFunctionEmbedded(buildAt(ref), t45, FLAT.nSub);
    const told = meritFunctionEmbedded(buildAt(ref), t45, FLAT.nSub, ref);
    console.log(`    stretched to ${ref.toFixed(2)} nm: MF ${assumed.toFixed(3)} assuming λ₀, ${told.toFixed(3)} told the reference`);
    ok(told < assumed / 10, `telling the merit the reference is worth more than a factor of ten here (${told.toFixed(3)} against ${assumed.toFixed(3)})`);
    ok(Object.is(meritFunctionEmbedded(buildAt(LAM0), t45, FLAT.nSub), meritFunctionEmbedded(buildAt(LAM0), t45, FLAT.nSub, LAM0)),
        'and passing λ₀ explicitly is the same call as leaving it out');
}

// ── 4. The angle changes the design, and for the better at that angle ───────
// The point of scoring at the angle rather than correcting the position after the
// fact. A design chosen at normal incidence and then stretched onto λ₀ puts the
// band in the right place with the wrong shape.
console.log('-- the angle changes what the search picks --');
{
    const at0 = searchAt(FLAT, 0, 's');
    const at45 = searchAt(FLAT, 45, 's');
    const key = (c) => `${c.mirrors.join(',')}|${c.spacers.join(',')}`;
    console.log(`    chosen at  0°: [${at0.mirrors.join(' ')}]/[${at0.spacers.join(' ')}]`);
    console.log(`    chosen at 45°: [${at45.mirrors.join(' ')}]/[${at45.spacers.join(' ')}]`);
    ok(key(at0) !== key(at45), 'a working angle of 45° picks a different structure than normal incidence does');

    // Both, built for 45°, measured at 45°.
    const ids = idsOf(FLAT);
    const shapeOf = (cd) => {
        const d = design(cd, 45, 's', ids);
        return airShape(d.frontLayers.map(l => ({ nk: ids[l.material], d: l.thickness })), FLAT, 45, 's');
    };
    const s0 = shapeOf(at0), s45 = shapeOf(at45);
    console.log(`    at 45°:  0°-chosen mean ${(100 * s0.mean).toFixed(2)} %   45°-chosen mean ${(100 * s45.mean).toFixed(2)} %`);
    ok(s45.mean > s0.mean, `the 45°-chosen design is flatter at 45° (${(100 * s45.mean).toFixed(2)} % against ${(100 * s0.mean).toFixed(2)} %)`);

    // And the merit agrees with that ordering, which is what the search ranks on.
    const t45 = targetAt(45, FLAT, 's');
    const mf = (cd) => meritFunctionEmbedded(layersAt(FLAT, LAM0, cd.mirrors, cd.spacers), t45, FLAT.nSub);
    ok(mf(at45) < mf(at0), `and scores better on the 45° merit (${mf(at45).toFixed(3)} against ${mf(at0).toFixed(3)})`);
}

// ── 5. The coat is matched at the angle, not at normal incidence ────────────
// A V coat solved at normal incidence and used at 45° leaves enough reflectance
// to pull the passband off centre, which is the one thing the reference stretch
// exists to prevent.
console.log('-- the coat is matched at the working angle --');
{
    const best = searchAt(FLAT, 45, 's');
    const ref = 668.52;
    const filterLayers = layersAt(FLAT, ref, best.mirrors, best.spacers);
    const coat = (aoiDeg) => adjustToIncidentMedium({
        filterLayers, nH: FLAT.nH, nL: FLAT.nL, nInc: nAir, nSub: FLAT.nSub,
        lambda0_nm: LAM0, mode: 'vcoat', aoiDeg, pol: 's',
    });
    const atAngle = coat(45), atNormal = coat(0);
    // Reflectance each leaves where the filter is used: at λ₀ and at 45°.
    const Rof = (layers) => 1 - airT(layers, LAM0, FLAT, 45, 's');
    console.log(`    matched at 45°: residual R ${(100 * atAngle.residualR).toExponential(2)} %,  1-T at λ₀ ${(100 * Rof(atAngle.layers)).toFixed(3)} %`);
    console.log(`    matched at  0°: residual R ${(100 * atNormal.residualR).toExponential(2)} %,  1-T at λ₀ ${(100 * Rof(atNormal.layers)).toFixed(3)} %`);
    ok(atAngle.residualR < 1e-6, `the 45° match nulls the reflectance it was solved for (${atAngle.residualR.toExponential(2)})`);
    ok(Rof(atAngle.layers) < Rof(atNormal.layers), 'and beats the normal-incidence coat where the filter is used');
    // At normal incidence the two solves are the same calculation.
    const plain = adjustToIncidentMedium({
        filterLayers, nH: FLAT.nH, nL: FLAT.nL, nInc: nAir, nSub: FLAT.nSub, lambda0_nm: LAM0, mode: 'vcoat',
    });
    ok(plain.layers.length === atNormal.layers.length
        && plain.layers.every((l, i) => Object.is(l.d, atNormal.layers[i].d)),
        'an explicit 0° coat is bit-identical to the default one');
}

if (fails === 0) console.log('\nAll filter-design working-angle tests passed.');
else { console.error(`\n${fails} assertion(s) failed.`); process.exit(1); }
