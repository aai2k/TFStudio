/**
 * Admittance locus sampling quality.
 *
 * The locus of one layer is a Moebius image of the round-trip phase, so in a
 * high reflector it is traversed within a phase interval of width ~(1 - |rho|).
 * Sampling that interval uniformly in phase collapses the arc into a polygon:
 * before the image-angle reparametrization, a quarter-wave TiO2 layer sitting on
 * Y_R = 6000 was drawn with 40 points and 63-degree corners, and a half-wave
 * layer with 9 points and 90-degree corners.
 *
 * These assertions pin the two properties that matter: the drawn polyline turns
 * smoothly, and it ends on the admittance the transfer matrix actually predicts.
 */
import assert from 'node:assert/strict';
import { initCatalogs } from '../src/utils/materials/catalogManager.js';
import { buildDiagramData, sampleArcAdaptive } from '../src/components/windows/analysis/admittanceDiagram/model.js';

initCatalogs({});

const MAX_TURN_DEG = 2.0;
const MAX_POINTS = 1200;
const MIN_POINTS = 16;

const cadd = ([ar, ai], [br, bi]) => [ar + br, ai + bi];
const csub = ([ar, ai], [br, bi]) => [ar - br, ai - bi];
const cmul = ([ar, ai], [br, bi]) => [ar * br - ai * bi, ar * bi + ai * br];
const cdiv = ([ar, ai], [br, bi]) => {
    const d = br * br + bi * bi;
    return [(ar * br + ai * bi) / d, (ai * br - ar * bi) / d];
};
const cexp = ([r, i]) => [Math.exp(r) * Math.cos(i), Math.exp(r) * Math.sin(i)];

/**
 * Endpoint admittance by an independent route: Y = eta (1 + G)/(1 - G) with
 * G = rho exp(2 i delta), rather than the cosine/sine transfer form the sampler
 * itself evaluates.
 */
function endpointFromReflection(Y_R, eta, delta) {
    const rho = cdiv(csub(Y_R, eta), cadd(Y_R, eta));
    const G = cmul(rho, cexp([-2 * delta[1], 2 * delta[0]]));
    return cmul(eta, cdiv(cadd([1, 0], G), csub([1, 0], G)));
}

function relativeError(got, want) {
    return Math.hypot(got[0] - want[0], got[1] - want[1]) / Math.max(Math.hypot(want[0], want[1]), 1);
}

function maxTurnDeg(re, im) {
    let worst = 0;
    for (let i = 1; i < re.length - 1; i++) {
        const ax = re[i] - re[i - 1], ay = im[i] - im[i - 1];
        const bx = re[i + 1] - re[i], by = im[i + 1] - im[i];
        if (Math.hypot(ax, ay) < 1e-12 || Math.hypot(bx, by) < 1e-12) continue;
        const deg = Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by)) * 180 / Math.PI;
        if (deg > worst) worst = deg;
    }
    return worst;
}

const QW = [Math.PI / 2, 0];
const HW = [Math.PI, 0];

// [name, substrate-side admittance Y_R, layer admittance eta, phase thickness delta]
const CASES = [
    ['single-layer AR on glass', [1.52, 0], [1.38, 0], QW],
    ['mirror, mid stack', [120, 0], [2.35, 0], QW],
    ['mirror, outer layers', [6000, 0], [2.35, 0], QW],
    ['half-wave layer, full circle', [6000, 0], [2.35, 0], HW],
    ['very high admittance', [1e5, 0], [2.35, 0], QW],
    // Entered from below: rho approaches -1, so the crowded stretch of the
    // locus falls at the end of the layer rather than at its start.
    ['mirror, low incoming admittance', [0.001, 0], [2.35, 0], QW],
    ['very low admittance', [1e-5, 0], [2.35, 0], QW],
    ['low incoming, half wave', [0.001, 0], [2.35, 0], HW],
    ['low incoming, high index step', [0.02, 0], [1.46, 0], QW],
    ['absorbing silver', [1.52, 0], [0.05, -3.4], [1.2, -0.9]],
    ['absorbing chromium', [1.52, 0], [3.1, -4.4], [0.8, -1.1]],
    ['absorbing gold', [2.3, 0], [0.3, -3.0], [0.9, -1.4]],
    ['oblique p-polarized', [9.3, 0], [4.9, 0], QW],
    ['very thin layer', [300, 0], [2.35, 0], [0.06, 0]],
    ['three and a half quarter waves', [40, 0], [2.35, 0], [3.5 * Math.PI / 2, 0]],
];

for (const [name, Y_R, eta, delta] of CASES) {
    const { re, im } = sampleArcAdaptive(Y_R, eta, delta);

    assert.ok(re.length >= MIN_POINTS && re.length <= MAX_POINTS,
        `${name}: ${re.length} points is outside [${MIN_POINTS}, ${MAX_POINTS}]`);

    const turn = maxTurnDeg(re, im);
    assert.ok(turn <= MAX_TURN_DEG,
        `${name}: polyline turns by ${turn.toFixed(2)} deg, limit ${MAX_TURN_DEG}`);

    const endErr = relativeError([re.at(-1), im.at(-1)], endpointFromReflection(Y_R, eta, delta));
    assert.ok(endErr < 1e-9, `${name}: endpoint off by ${endErr.toExponential(2)} relative`);

    const startErr = relativeError([re[0], im[0]], endpointFromReflection(Y_R, eta, [0, 0]));
    assert.ok(startErr < 1e-9, `${name}: arc starts ${startErr.toExponential(2)} off the incoming admittance`);
}

/**
 * A layer whose admittance equals the incident medium's only turns Gamma about
 * the origin, so the reflection view's map has no finite pole. Treating that as
 * a pole at the origin crowds every sample into a sliver and draws the layer as
 * a couple of straight lines.
 */
const matchedMediumDesign = {
    incidentMedium: 'builtin:Air',
    substrate: { material: 'builtin:BK7' },
    backLayers: [],
    frontLayers: [
        { id: '1', material: 'builtin:Air', thickness: 80 },
        { id: '2', material: 'builtin:Ta2O5', thickness: 60 },
        { id: '3', material: 'builtin:Air', thickness: 70 },
        { id: '4', material: 'builtin:SiO2', thickness: 85 },
    ],
};

for (const view of ['admittance', 'reflection']) {
    const series = buildDiagramData(matchedMediumDesign, {
        lambda_nm: 550, theta_deg: 0, pol: 's', side: 'front', view,
    });
    for (const arc of series[0].arcs) {
        const turn = maxTurnDeg(arc.re, arc.im);
        assert.ok(turn <= MAX_TURN_DEG,
            `${view} L${arc.layerNum} (${arc.material}): turns by ${turn.toFixed(2)} deg`);
        assert.ok(arc.re.length >= MIN_POINTS,
            `${view} L${arc.layerNum} (${arc.material}): only ${arc.re.length} points`);
    }
}

console.log('PASS: admittance_arc_sampling');
