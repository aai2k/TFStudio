/**
 * Roughness / Scattering window model: interface roughness as a transition
 * layer at each interface (Macleod, Thin-Film Optical Filters, 5th ed., §16,
 * p. 626; Carniglia and Jensen, Appl. Opt. 41, 3167 (2002)).
 *
 *   1. One air/BK7 surface, long-range roughness: the specular R and T lose what
 *      scalar scattering theory predicts, ΔR = -R0 (4π n_a σ/λ)² (Eq. 4) and
 *      ΔT = -T0 [2π (n_a - n_s) σ/λ]² (Eq. 6), not the same (4πσ/λ)² off both.
 *   2. Short-range roughness on a lossless stack loses no light: R + T of the
 *      rough design equals R + T of the smooth one, every polarization, oblique.
 *   3. σ = 0 gives the smooth design exactly, and a vanishing σ converges to it.
 *   4. Long-range roughness on a quarter-wave reflector loses least in the
 *      high-reflectance zone, where the field does not reach the inner
 *      interfaces, and most in the reflectance dips (Macleod Fig. 16.22).
 *
 * Run: node tests/roughness_transition_layer.mjs
 */

import { calculateRoughness, getRoughnessContext } from
    '../src/components/windows/analysis/roughnessScattering/model.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';

let fails = 0;
const check = (name, ok, detail = '') => {
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
    if (!ok) fails++;
};

const baseDesign = (frontLayers) => ({
    id: 'rough-test', name: 'rough test',
    incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'builtin:BK7', thickness: 1.0 },
    frontLayers, backLayers: [],
});

function run(design, rough, params, evalMode = 'front') {
    const result = calculateRoughness({
        design, params, rough, evalMode, aoi: params.theta,
        context: getRoughnessContext(design, evalMode),
    });
    if (result.error) throw new Error(result.error);
    return result.data;
}

// ── 1. One surface: Carniglia-Jensen Eqs. 4 and 6 ────────────────────────────
{
    const sigma = 2;
    const data = run(baseDesign([]),
        { mode: 'uniform', sigma, range: 'long' },
        { lambdaStart: 400, lambdaEnd: 800, lambdaStep: 100, theta: 0, polarization: 'avg' });
    const BK7 = getMaterial('BK7');
    let worstR = 0;
    let worstT = 0;
    data.lambda.forEach((lam, i) => {
        const na = 1;
        const ns = BK7.getNK(lam)[0];
        const R0 = data.ideal.R[i];
        const T0 = data.ideal.T[i];
        const dRs = R0 * (4 * Math.PI * na * sigma / lam) ** 2;
        const dTs = T0 * (2 * Math.PI * (na - ns) * sigma / lam) ** 2;
        const dR = R0 - data.specular.R[i];
        const dT = T0 - data.specular.T[i];
        worstR = Math.max(worstR, Math.abs(dR / dRs - 1));
        worstT = Math.max(worstT, Math.abs(dT / dTs - 1));
    });
    // The two agree to terms in (σ/λ)²; at σ = 2 nm the rest is below 0.2 %.
    check('air/BK7 surface: R loses R0 (4π n_a σ/λ)² (Eq. 4)', worstR < 5e-3,
        `worst relative difference ${worstR.toExponential(2)}`);
    check('air/BK7 surface: T loses T0 [2π (n_a - n_s) σ/λ]² (Eq. 6)', worstT < 5e-3,
        `worst relative difference ${worstT.toExponential(2)}`);
    check('the specular loss is the R and T lost together',
        Array.isArray(data.loss) && data.loss.every((v, i) => Math.abs(v - ((data.ideal.R[i] + data.ideal.T[i])
            - (data.specular.R[i] + data.specular.T[i]))) < 1e-15));
}

// Quarter-wave stack, air-first, TiO2 outermost.
function quarterWaveStack(count, lambda0) {
    const H = getMaterial('TiO2');
    const L = getMaterial('SiO2');
    return Array.from({ length: count }, (_, i) => {
        const [id, mat] = i % 2 === 0 ? ['builtin:TiO2', H] : ['builtin:SiO2', L];
        return { material: id, thickness: lambda0 / (4 * mat.getNK(lambda0)[0]) };
    });
}

// ── 2. Short range on a lossless stack keeps R + T ───────────────────────────
{
    // Fused silica substrate: TiO2, SiO2 and the substrate all have k = 0, so
    // R + T = 1 is exact for the smooth design and must stay so.
    const design = { ...baseDesign(quarterWaveStack(15, 550)), substrate: { material: 'builtin:SiO2', thickness: 1.0 } };
    const params = { lambdaStart: 400, lambdaEnd: 800, lambdaStep: 10, theta: 30, polarization: 'avg' };
    const data = run(design, { mode: 'uniform', sigma: 3, range: 'short' }, params);
    let worst = 0;
    for (const [r, t] of [['R', 'T'], ['Rs', 'Ts'], ['Rp', 'Tp']]) {
        data.lambda.forEach((_, i) => {
            worst = Math.max(worst, Math.abs(data.specular[r][i] + data.specular[t][i] - 1));
        });
    }
    check('short range, 15-layer lossless stack at 30°: R + T = 1 in s, p and average', worst < 1e-12,
        `worst |R + T - 1| ${worst.toExponential(2)}`);
    let moved = 0;
    data.lambda.forEach((_, i) => { moved = Math.max(moved, Math.abs(data.specular.R[i] - data.ideal.R[i])); });
    check('short range still changes R through the graded index', moved > 1e-4,
        `largest |ΔR| ${moved.toExponential(2)}`);
}

// ── 3. σ = 0 is the smooth design ────────────────────────────────────────────
{
    const design = baseDesign(quarterWaveStack(9, 550));
    const params = { lambdaStart: 450, lambdaEnd: 650, lambdaStep: 25, theta: 20, polarization: 'avg' };
    const departure = (sigma, range) => {
        const data = run(design, { mode: 'uniform', sigma, range }, params);
        let worst = 0;
        for (const key of ['R', 'T']) {
            data.specular[key].forEach((v, i) => { worst = Math.max(worst, Math.abs(v - data.ideal[key][i])); });
        }
        return worst;
    };
    for (const range of ['short', 'long']) {
        const zero = run(design, { mode: 'uniform', sigma: 0, range }, params);
        const same = ['R', 'T', 'Rs', 'Ts', 'Rp', 'Tp'].every(key =>
            zero.specular[key].every((v, i) => v === zero.ideal[key][i]));
        check(`${range} range, σ = 0: identical to the smooth design`, same);
        // The transition layer moves the optical thickness at each interface
        // in proportion to σ, so the departure falls a hundredfold from
        // σ = 1e-4 nm to 1e-6 nm.
        const ratio = departure(1e-4, range) / departure(1e-6, range);
        check(`${range} range: departure from the smooth design falls in proportion to σ`,
            ratio > 50 && ratio < 200, `ratio ${ratio.toFixed(1)}`);
    }
}

// ── 4. Long range on a reflector: loss follows the field ─────────────────────
{
    const lambda0 = 550;
    const design = baseDesign(quarterWaveStack(31, lambda0));
    const params = { lambdaStart: 400, lambdaEnd: 800, lambdaStep: 2, theta: 0, polarization: 'avg' };
    const data = run(design, { mode: 'uniform', sigma: 1, range: 'long' }, params);
    const at = lam => data.lambda.indexOf(lam);
    const centre = at(lambda0);
    // First reflectance minimum past the long-wavelength band edge.
    let dip = centre;
    while (data.ideal.R[dip] > 0.5) dip++;
    while (data.ideal.R[dip + 1] < data.ideal.R[dip]) dip++;
    const lossAt = i => (data.ideal.R[i] + data.ideal.T[i]) - (data.specular.R[i] + data.specular.T[i]);
    const lossCentre = lossAt(centre);
    const lossDip = lossAt(dip);
    check('reflector: R at the band centre is above 0.999', data.ideal.R[centre] > 0.999,
        `R = ${data.ideal.R[centre].toFixed(5)}`);
    check('reflector: specular loss is lower in the band than in the first dip beyond it',
        lossCentre * 5 < lossDip,
        `${(lossCentre * 1e6).toFixed(0)} ppm at ${lambda0} nm, ${(lossDip * 1e6).toFixed(0)} ppm at ${data.lambda[dip]} nm`);
}

console.log(fails === 0 ? '\nPASS: roughness_transition_layer' : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
