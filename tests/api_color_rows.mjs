/**
 * Colour rows through the API, and the difference between two colours.
 *
 *   1. setMerit takes RCOL and TCOL rows with color, illuminant and observer;
 *      a row that leaves them out starts at Y under D65 and the 2 degree
 *      observer, as a row added in the editor does. merit() gives each row's
 *      value, which is the quantity tf.color() reads at the row's angle,
 *      polarization, illuminant and observer, and names what the row reads:
 *      its quantity, illuminant, observer, angle and polarization, with no
 *      band. A quantity, illuminant or observer it does not have is refused.
 *   2. colorDifference(a, b) is the Differences view's ΔL*, Δa*, Δb*, ΔE*ab
 *      and ΔE00, b less a; it refuses two colours under different
 *      illuminants or observers and an answer of env 'all'.
 *   3. The objects: design.merit.add('RCOL', { color, ... }), a MeritRow's
 *      color, illuminant and observer, and tf.colorDifference() of two Colors.
 *   4. A row with no value: λd has none for a purple. The row shows an error
 *      and the merit has no value. A run pulled toward a λd past the blue end
 *      of the spectral locus, where only the purples lie beyond, stops at the
 *      locus's end without stepping into a colour that has none; a run that
 *      starts on a purple ends at once, naming the row, with the design as it
 *      was. Each method moves differently, so DLS, CG and SQP are each run.
 *
 * Run: node tests/api_color_rows.mjs
 */
import assert from 'node:assert/strict';

const api = await import('../src/api/index.js');
const objects = await import('../src/api/objects/index.js');
const { labDifference } = await import('../src/utils/physics/colorimetry.js');
await api.init();

const ar = api.stackFromFormula(api.newDesign({ name: 'AR' }), { formula: '(HL)^2' });
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected)),
    `${label}: ${actual} against ${expected}`);
// The value tf.color() gives for `quantity`, as the Color list names it.
const READ = {
    x: c => c.x, Y: c => c.Y, 'L*': c => c.lab.L, hab: c => c.lab.h, "u'": c => c.uv1976.u,
    dominant: c => c.dominant.wavelength, purity: c => c.dominant.purity, CCT: c => c.cct,
};

// ── 1. setMerit and merit ────────────────────────────────────────────────────
{
    const ROWS = [
        { type: 'RCOL', color: 'x', target: 0.3 },
        { type: 'RCOL', color: 'L*', target: 10, aoi: 30, pol: 's' },
        { type: 'TCOL', color: 'Y', target: 99, illuminant: 'A', observer: 10 },
        { type: 'RCOL', color: 'hab', target: 250, illuminant: 'D50', aoi: 45, pol: 'p' },
        { type: 'TCOL', color: "u'", target: 0.2, observer: 10, aoi: 20 },
        { type: 'RCOL', color: 'purity', target: 0.5, illuminant: 'E' },
    ];
    const scored = api.merit(api.setMerit(ar, ROWS));
    ROWS.forEach((row, i) => {
        const got = scored.rows[i];
        const colour = api.color(ar, {
            quantity: row.type === 'RCOL' ? 'R' : 'T', angle: row.aoi ?? 0, pol: row.pol ?? 'avg',
            illuminant: row.illuminant ?? 'D65', observer: row.observer ?? 2,
        });
        // The row integrates on the band grid and color() on its 0.5 nm grid.
        assert.ok(Math.abs(got.value - READ[row.color](colour)) < 1e-3 * Math.max(1, Math.abs(READ[row.color](colour))),
            `${row.type} ${row.color}: ${got.value} is tf.color()'s ${READ[row.color](colour)}`);
        assert.deepEqual([got.color, got.illuminant, got.observer, got.aoi, got.pol],
            [row.color, row.illuminant ?? 'D65', row.observer ?? 2, row.aoi ?? 0, row.pol ?? 'avg'], `${row.type} ${row.color}: what it reads`);
        assert.ok(!('lambdaStart' in got) && !('lambdaEnd' in got), 'a colour row has no band');
    });
    assert.ok(Number.isFinite(scored.total), 'the merit is computed');
    const [plain] = api.setMerit(ar, [{ type: 'RCOL' }]).meritOperands;
    assert.deepEqual([plain.color, plain.illuminant, plain.observer, plain.target], ['Y', 'D65', 2, 0], 'a row as the editor starts one');

    const refusedWith = (row, pattern) => assert.throws(() => api.setMerit(ar, [row]), pattern);
    refusedWith({ type: 'RCOL', color: 'q' }, /^Error: setMerit: row 0: color is one of 'X', 'Y', 'Z', 'x', 'y', "u'", "v'", .* or 'Duv', not "q"$/);
    refusedWith({ type: 'RCOL', illuminant: 'F2' }, /illuminant is 'D65', 'D50', 'A' or 'E', not "F2"/);
    refusedWith({ type: 'TCOL', observer: '10' }, /observer is 2 or 10, not "10"/);
}

// ── 2. colorDifference ───────────────────────────────────────────────────────
{
    const a = api.color(ar);
    const b = api.color(ar, { angle: 45, pol: 's' });
    const d = api.colorDifference(a, b);
    assert.deepEqual(d, labDifference(a.lab, b.lab), 'the Differences view\'s figures');
    near(d.dL, b.lab.L - a.lab.L, 'ΔL* is b less a');
    near(d.dEab, Math.hypot(d.dL, d.da, d.db), 'ΔE*ab');
    near(api.colorDifference(b, a).dEab, d.dEab, 'ΔE*ab both ways');
    assert.equal(api.colorDifference(a, a).dE00, 0, 'none from itself');
    assert.ok(d.dE00 > 0 && d.dE00 !== d.dEab, 'ΔE00 is its own figure');
    assert.ok(Number.isFinite(api.colorDifference(a, api.color(ar, { quantity: 'T' })).dEab), 'R against T');
    assert.throws(() => api.colorDifference(a, api.color(ar, { illuminant: 'A' })),
        /^Error: colorDifference: a is under D65 with the 2 degree observer and b under A with the 2 degree observer; L\*a\*b\* is relative to the illuminant's white/);
    assert.throws(() => api.colorDifference(api.color(ar, { observer: 10 }), a), /a is under D65 with the 10 degree observer and b under D65 with the 2 degree/);
    const wet = api.addEnvironment(ar, { name: 'Under water', incidentMedium: 'H2O' });
    assert.throws(() => api.colorDifference(a, api.color(wet, { env: 'all' })), /b is one colour as color\(\) answers it; with env 'all'/);
    assert.throws(() => api.colorDifference(null, a), /a is one colour/);
}

// ── 3. The objects ───────────────────────────────────────────────────────────
{
    const tf = await objects.start();
    const design = tf.newDesign('AR');
    design.stack('(HL)^2');
    design.merit.add('RCOL', { color: 'b*', target: -5, aoi: 10 });
    design.merit.add('TCOL', { color: 'CCT', target: 6500, illuminant: 'D50', observer: 10, pol: 'p' });
    const [first, second] = design.merit.rows;
    assert.deepEqual([first.color, first.illuminant, first.observer, first.aoi, first.start, first.end], ['b*', 'D65', 2, 10, null, null]);
    assert.deepEqual([second.color, second.illuminant, second.observer, second.pol], ['CCT', 'D50', 10, 'p']);
    assert.ok(Math.abs(first.value - design.color({ angle: 10 }).lab.b) < 1e-2, 'the row reads design.color(), on its own grid');
    assert.match((await import('node:util')).inspect(first), /^<MeritRow RCOL b\*: -?[\d.]+ for -5>$/);
    assert.throws(() => design.merit.add('RCOL', { observer: 3 }), /^Error: add: observer is 2 or 10, not 3$/);

    const shift = tf.colorDifference(design.color(), design.color({ angle: 45 }));
    assert.deepEqual(shift, api.colorDifference(api.color(design._data), api.color(design._data, { angle: 45 })));
    assert.throws(() => tf.colorDifference(design.color(), design.color({ illuminant: 'E' })), /^Error: colorDifference: a is under D65/);
    assert.throws(() => tf.colorDifference(design.color(), api.color(design._data)),
        /^Error: colorDifference: b is a Color, as design.color\(\) gives one; with env 'all' it gives an array of them$/);
}

// ── 4. A row with no value ───────────────────────────────────────────────────
{
    // AR on BK7, from the air side MgF2 95, Ta2O5 t, SiO2 20 and Ta2O5 15 nm:
    // blue in reflection at t = 120 nm (λd near 456 nm), a purple at 110 nm.
    const coating = t => [['Ta2O5', 15], ['SiO2', 20], ['Ta2O5', t], ['MgF2', 95]]
        .reduce((d, [material, thickness]) => api.insertLayer(d, { material, thickness, index: 0 }),
            api.newDesign({ name: 'AR', substrate: 'BK7' }));
    const toward = target => [{ type: 'RCOL', color: 'dominant', target }];
    const thicknesses = d => d.frontLayers.map(l => l.thickness);

    const purple = api.setMerit(coating(110), toward(456));
    const none = api.merit(purple);
    assert.deepEqual([none.total, none.rows[0].value], [null, null], 'a purple has no λd, so the merit has no value');
    assert.match(none.rows[0].error, /not a finite number/);

    const blue = api.setMerit(coating(120), toward(360));
    const start = api.merit(blue).rows[0].value;
    assert.ok(start > 450 && start < 460, `λd starts at ${start} nm`);
    for (const method of ['dls', 'cg', 'sqp']) {
        const { result, design } = await api.refine(blue, { method, maxIter: 80 });
        const end = api.merit(design).rows[0];
        assert.notEqual(result.stopReason, 'invalidOperand', `${method}: the run keeps a λd`);
        assert.ok(Number.isFinite(end.value) && end.value >= 380 - 1e-3 && end.value < 381,
            `${method}: stops at the locus's end, λd ${end.value} nm`);
        const stuck = await api.refine(purple, { method, maxIter: 20 });
        assert.deepEqual([stuck.result.stopReason, stuck.result.message], ['invalidOperand', 'Row 1 RCOL: Its value is not a finite number.'],
            `${method}: a run from a purple names the row`);
        assert.deepEqual(thicknesses(stuck.design), thicknesses(purple), `${method}: and leaves the design as it was`);
    }
}

console.log('api_color_rows: passed');
