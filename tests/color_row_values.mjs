/**
 * A colour row (RCOL, TCOL) reads what tf.color() gives for the same colour of
 * the same design, so a target typed from the Color Evaluation window means
 * what the window showed.
 *
 *   1. Every quantity of the Color list, at a 0.5 nm Step against tf.color()
 *      at its 0.5 nm step: R and T, front, back and total, s, p and the
 *      polarization average, at 0° and 45°, on a dielectric and an absorbing
 *      stack, under D65 with the 2° observer; then under every illuminant and
 *      observer at 30°. Equal to a part in 10¹⁰, and a row has no value
 *      exactly where tf.color() gives null or NaN (λd of a purple, λc of
 *      another colour, CCT off the locus).
 *   2. Under a cone: the row reads the cone-averaged spectrum as the window
 *      does, R and T, front, back and total. The two settle their ray counts
 *      each by its own rule, per wavelength for a merit row and over the whole
 *      spectrum for the window; on this cone both keep the same rays, so they
 *      agree as closely as without one.
 *
 * Run: node tests/color_row_values.mjs
 */
import assert from 'node:assert/strict';

const api = await import('../src/api/index.js');
const objects = await import('../src/api/objects/index.js');
const { makeOperand, evaluateOperands, buildEvalContext } = await import('../src/utils/physics/optimizer.js');
const { COLOR_QUANTITIES, ILLUMINANTS, OBSERVERS } = await import('../src/utils/physics/colorimetry.js');
const { getMaterial } = await import('../src/utils/materials/materialDatabase.js');

await objects.start();
const resolveMat = id => getMaterial(id);
const layers = spec => spec.map(([material, thickness], i) => ({ id: `L${i}`, material, thickness, locked: false }));
const base = { name: 'Colour', incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 } };
const STACKS = {
    dielectric: [['MgF2', 95], ['Ta2O5', 120], ['SiO2', 20], ['Ta2O5', 15]],
    absorbing: [['TiO2', 25], ['Ag', 12], ['TiO2', 30]],
};
const SIDES = {
    front: spec => ({ ...base, frontLayers: layers(spec), backLayers: [], surfaceMode: 'front_only', mfEvalMode: 'side' }),
    back: spec => ({ ...base, frontLayers: [], backLayers: layers(spec), surfaceMode: 'back_only', mfEvalMode: 'side' }),
    total: spec => ({
        ...base, frontLayers: layers(spec), backLayers: layers([['MgF2', 100]]),
        surfaceMode: 'both_independent', mfEvalMode: 'total',
    }),
};
const CONE = { enabled: true, halfAngleDeg: 7.5, distribution: 'uniform', gridPoints: 15 };

// Each quantity of the Color list as tf.color() reports it.
const REPORTED = {
    X: c => c.X, Y: c => c.Y, Z: c => c.Z, x: c => c.x, y: c => c.y,
    "u'": c => c.uv1976.u, "v'": c => c.uv1976.v, u: c => c.uv1960.u, v: c => c.uv1960.v,
    'L*': c => c.lab.L, 'a*': c => c.lab.a, 'b*': c => c.lab.b, 'C*ab': c => c.lab.C, hab: c => c.lab.h,
    'u*': c => c.luv.u, 'v*': c => c.luv.v, 'C*uv': c => c.luv.C, huv: c => c.luv.h, suv: c => c.luv.s,
    'Hunter L': c => c.hunterLab.L, 'Hunter a': c => c.hunterLab.a, 'Hunter b': c => c.hunterLab.b,
    dominant: c => c.dominant.wavelength, complementary: c => c.dominant.complementary,
    purity: c => c.dominant.purity, CCT: c => c.cct, Duv: c => c.duv,
};
assert.deepEqual(Object.keys(REPORTED), COLOR_QUANTITIES, 'every quantity has its tf.color() field');

const has = value => value != null && Number.isFinite(value);

// The rows of every quantity on `d` against tf.color(); `close(q, row, ref)`
// says whether the two agree.
function compare(tag, d, { type, pol, angle, illuminant = 'D65', observer = 2, step = 0.5 }, close) {
    const rows = COLOR_QUANTITIES.map(color => makeOperand({
        type, color, aoi: angle, pol, illuminant, observer, flag: -step, target: 1, weight: 1,
    }));
    const values = evaluateOperands(rows, buildEvalContext(d, resolveMat));
    const c = api.color(d, { quantity: type[0], angle, pol, illuminant, observer, step });
    COLOR_QUANTITIES.forEach((q, i) => {
        const ref = REPORTED[q](c);
        assert.equal(values[i] != null, has(ref), `${tag}, ${q}: a value exactly where tf.color() has one`);
        if (has(ref)) assert.ok(close(q, values[i], ref), `${tag}, ${q}: ${values[i]} against ${ref}`);
    });
}

const exact = (q, a, b) => Math.abs(a - b) <= 1e-10 * Math.max(1, Math.abs(b));

// Every combination of the lists, as arrays of one item of each.
const product = (...lists) => lists.reduce((combos, list) => combos.flatMap(combo => list.map(item => [...combo, item])), [[]]);
const TYPES = ['RCOL', 'TCOL'];

// ── 1. Without a cone ────────────────────────────────────────────────────────
const SETTINGS = product(Object.entries(STACKS), Object.entries(SIDES), TYPES, ['s', 'p', 'avg'], [0, 45]);
for (const [[stackName, spec], [sideName, sided], type, pol, angle] of SETTINGS) {
    compare(`${type} ${pol} ${angle}°, ${stackName}, ${sideName}`, sided(spec), { type, pol, angle }, exact);
}
const LIGHTS = product(Object.entries(STACKS), ILLUMINANTS.map(i => i.id), OBSERVERS.map(o => Number(o.id)), TYPES);
for (const [[stackName, spec], illuminant, observer, type] of LIGHTS) {
    compare(`${type} ${illuminant} ${observer}°, ${stackName}`, SIDES.front(spec), { type, pol: 'avg', angle: 30, illuminant, observer }, exact);
}

// ── 2. Under a cone ──────────────────────────────────────────────────────────
const CONED = product(Object.entries(STACKS), Object.entries(SIDES), TYPES);
for (const [[stackName, spec], [sideName, sided], type] of CONED) {
    compare(`${type} under a cone, ${stackName}, ${sideName}`, { ...sided(spec), cone: CONE }, { type, pol: 'avg', angle: 20 }, exact);
}

const cases = SETTINGS.length + LIGHTS.length + CONED.length;
console.log(`PASS color_row_values (${cases} cases)`);
