/**
 * The merit wizard's Color preset and its target editor.
 *
 *   1. Preset Color, Type Reflected or Transmitted color: Generate writes, for
 *      each target, one RCOL or TCOL row per coordinate of the space its colour
 *      was given in, at the target's angle and polarization, the values as
 *      targets, under the wizard's illuminant and observer: x, y, Y writes an
 *      x, a y and a Y row; L*, a*, b* and u′, v′, Y likewise. The block starts
 *      with a header naming the illuminant, observer and count of targets and
 *      ends with the thickness limits, as every preset's does.
 *   2. Two targets, x 0.230 y 0.240 Y 1.00 at 0° and x 0.240 y 0.255 Y 1.50
 *      at 45°, make 8 rows, read "RCOL x, y and Y for 2
 *      targets, MNT, MXT", and score on the 4-layer AR as tf.color() reads it.
 *   3. The box beside Preset is Target: Illuminant, Observer and Colors with
 *      Pick, and no angle or polarization; the collapsed header names the
 *      illuminant and observer.
 *   4. A target keeps its colour when its space changes; a pick on the diagram
 *      moves its chromaticity at the luminance it had, to three places; its
 *      patch is the colour at Fit.
 *   5. The editor: titled Color targets, a list of patch, Name, AOI and Pol
 *      with Add and Delete, the Space choice and the three values, Cancel and
 *      OK, in every language.
 *
 * Run: node tests/mf_wizard_color_preset.mjs
 */
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();
const dir = '../src/components/windows/optimization/meritFunctionEditor';
const { DMFWizard } = await import(`${dir}/DMFWizard.js`);
const { ColorTargetEditor } = await import(`${dir}/ColorTargetEditor.js`);
const { meritWizardSession } = await import(`${dir}/sessionState.js`);
const { buildWizardResult } = await import(`${dir}/meritOperandModel.js`);
const { blockSummary } = await import(`${dir}/wizardModel.js`);
const model = await import(`${dir}/colorTargetModel.js`);
const { FILTER_CATEGORIES, generateFilterOperands, evaluateOperands, buildEvalContext } = await import('../src/utils/physics/optimizer.js');
const { getMaterial } = await import('../src/utils/materials/materialDatabase.js');
const api = await import('../src/api/index.js');
const objects = await import('../src/api/objects/index.js');

await objects.start();
const consoleError = console.error;
console.error = (...args) => {
    if (!String(args[0]).includes('useLayoutEffect does nothing on the server')) consoleError(...args);
};
const c = makeTheme();
const t = makeLocale();
const tw = t.meritFunctionEditor.wizard;
const target = (name, aoi, pol, space, values) => ({ id: name, name, aoi, pol, space, values });
const TWO_TARGETS = [target('Target 1', 0, 'avg', 'xyY', [0.23, 0.24, 1]), target('Target 2', 45, 'avg', 'xyY', [0.24, 0.255, 1.5])];
const renderWizard = () => renderToStaticMarkup(React.createElement(DMFWizard, {
    design: null, onGenerate: () => {}, operandCount: 1, mf: 0.5, omf: 0.5, busy: false, c, t,
}));

// ── 1. The rows ──────────────────────────────────────────────────────────────
assert.deepEqual(FILTER_CATEGORIES.find(cat => cat.id === 'COLOR').types, ['COLOR_R', 'COLOR_T']);
{
    const targets = [
        target('a', 10, 's', 'Lab', [30, 5, -20]),
        target('b', 60, 'p', 'uvY', [0.19, 0.45, 12]),
    ];
    const rows = generateFilterOperands('COLOR_T', {}, { colorTargets: targets, illuminant: 'A', observer: 10 });
    assert.deepEqual(rows.map(op => [op.type, op.color, op.aoi, op.pol, op.target, op.illuminant, op.observer]), [
        ['TCOL', 'L*', 10, 's', 30, 'A', 10], ['TCOL', 'a*', 10, 's', 5, 'A', 10], ['TCOL', 'b*', 10, 's', -20, 'A', 10],
        ['TCOL', "u'", 60, 'p', 0.19, 'A', 10], ['TCOL', "v'", 60, 'p', 0.45, 'A', 10], ['TCOL', 'Y', 60, 'p', 12, 'A', 10],
    ], 'one row per coordinate, at the target\'s angle and polarization');
    assert.ok(rows.every(op => op.weight === 1 && op.flag === 0), 'weighted 1, at Step 0');
}

// ── 2. Two targets ───────────────────────────────────────────────────────────
const session = {
    ...meritWizardSession.read(null), typeId: 'COLOR_R', catId: 'COLOR',
    colorTargets: TWO_TARGETS, colorIlluminant: 'D65', colorObserver: 2,
};
{
    const ownRows = model.colorWizardRows({ typeId: 'COLOR_R', session, tw });
    const { block } = buildWizardResult({ tw, ...session, typeId: 'COLOR_R', ownRows, units: t.units });
    assert.equal(block[0].type, 'DMFS');
    assert.ok(block[0].comment.startsWith(`${tw.types.COLOR_R.label}, D65 · 2°, ${tw.header.colorTargets(2)}`), block[0].comment);
    const summary = blockSummary(block);
    assert.equal(summary.count, 8, '8 rows');
    assert.equal(tw.colorRows('RCOL', ['x', 'y', 'Y'], 2), 'RCOL x, y and Y for 2 targets');
    assert.deepEqual(block.slice(1, 7).map(op => [op.color, op.aoi, op.target]), [
        ['x', 0, 0.23], ['y', 0, 0.24], ['Y', 0, 1], ['x', 45, 0.24], ['y', 45, 0.255], ['Y', 45, 1.5],
    ]);
    assert.deepEqual(block.slice(7).map(op => op.type), ['MNT', 'MXT'], 'then the thickness limits');
    meritWizardSession.write(null, session);
    const shown = renderWizard();
    assert.ok(shown.includes(tw.preview(8, 'RCOL x, y and Y for 2 targets, MNT, MXT')), 'the summary line names the colour rows');
    // The rows score as tf.color() reads the AR at each angle.
    const layers = [['MgF2', 95], ['Ta2O5', 120], ['SiO2', 20], ['Ta2O5', 15]]
        .map(([material, thickness], i) => ({ id: `L${i}`, material, thickness, locked: false }));
    const ar = {
        name: 'AR', incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
        frontLayers: layers, backLayers: [], surfaceMode: 'front_only', mfEvalMode: 'side',
    };
    const rows = block.slice(1, 7).map(op => ({ ...op, flag: -0.5 }));
    const values = evaluateOperands(rows, buildEvalContext(ar, id => getMaterial(id)));
    for (const [k, aoi] of [[0, 0], [3, 45]]) {
        const color = api.color(ar, { quantity: 'R', angle: aoi, step: 0.5 });
        assert.ok(Math.abs(values[k] - color.x) < 1e-12 && Math.abs(values[k + 1] - color.y) < 1e-12
            && Math.abs(values[k + 2] - color.Y) < 1e-12, `the ${aoi}° rows read tf.color()`);
    }
}

// ── 3. The Target box ────────────────────────────────────────────────────────
{
    const html = renderWizard();
    for (const word of [tw.colorBox, `${tw.illuminant}:`, `${tw.observer}:`, `${tw.colors}:`, tw.pick]) {
        assert.ok(html.includes(`>${word}<`), `the Target box shows ${word}`);
    }
    assert.ok(!html.includes(`>${tw.aoiRange}:<`) && !html.includes(`>${tw.pol}:<`), 'and no angle or polarization');
    assert.equal([...html.matchAll(/min-width:(\d+)px/g)].length, 3, 'three boxes, as every preset has');
    meritWizardSession.write(null, { open: false });
    const folded = renderWizard();
    assert.ok(folded.includes(`${tw.types.COLOR_R.label} · D65 · 2°`), 'the folded wizard names the illuminant and observer');
    meritWizardSession.reset();
}

// ── 4. Conversions ───────────────────────────────────────────────────────────
{
    const white = model.targetWhite('D65', 2);
    const xy = target('t', 0, 'avg', 'xyY', [0.23, 0.24, 1]);
    const lab = model.targetInSpace(xy, 'Lab', white);
    const uv = model.targetInSpace(lab, 'uvY', white);
    const back = model.targetInSpace(uv, 'xyY', white);
    back.values.forEach((value, k) => assert.ok(Math.abs(value - xy.values[k]) < 1e-12, 'the colour survives a change of space'));
    assert.deepEqual(model.TARGET_DIAGRAMS, { xyY: 'xy', Lab: 'ab', uvY: 'uv' }, 'each space is picked on its own diagram');
    assert.deepEqual(model.targetOnPlane(lab), [lab.values[1], lab.values[2]], 'an L*, a*, b* target sits at its a*, b*');
    assert.deepEqual(model.targetOnPlane(uv), [uv.values[0], uv.values[1]], 'a u′, v′, Y target sits at its u′, v′');
    assert.deepEqual(model.targetAtPlanePoint(lab, [12.3456, -6.789]).values,
        [Number(lab.values[0].toFixed(2)), 12.35, -6.79], 'a pick on a*, b* keeps L*, to two places');
    assert.deepEqual(model.targetAtPlanePoint(uv, [0.21234, 0.45678]).values,
        [0.212, 0.457, Number(uv.values[2].toFixed(2))], 'a pick on u′, v′ keeps Y, to three places');
    assert.deepEqual(model.targetAtPlanePoint(xy, [0.31234, 0.33012]).values, [0.312, 0.33, 1], 'a pick on x, y keeps Y, to three places');
    assert.match(model.targetPatch(xy, white), /^rgb\(\d+, \d+, \d+\)$/);
    const made = model.newColorTarget('Target 3', { X: 20, Y: 25, Z: 30 }, white);
    assert.deepEqual([made.aoi, made.pol, made.space], [0, 'avg', 'xyY'], 'a new target starts at 0°, avg, in x, y, Y');
    assert.deepEqual(made.values, [0.267, 0.333, 25], 'at the colour it is given');
}

// ── 5. The editor ────────────────────────────────────────────────────────────
for (const code of ['en', 'ru', 'zh', 'it']) {
    const tl = makeLocale(code);
    const te = tl.meritFunctionEditor.wizard.colorEditor;
    const html = renderToStaticMarkup(React.createElement(ColorTargetEditor, {
        design: null, typeId: 'COLOR_R', targets: TWO_TARGETS, illuminant: 'D65', observer: 2,
        onApply: () => {}, onCancel: () => {}, c, t: tl,
    }));
    for (const word of [te.title, te.color, te.name, te.aoi, te.pol, te.add, te.delete, te.space, tl.dialogs.input.cancel, tl.dialogs.input.ok]) {
        assert.ok(html.includes(word), `${code}: the editor shows ${word}`);
    }
    assert.ok(html.includes('value="Target 1"') && html.includes('value="45"'), `${code}: each target's name and angle, editable`);
    assert.equal([...html.matchAll(/background:rgb\(/g)].length, 2, `${code}: a patch per target`);
    const fields = [...html.matchAll(/width:100px[^>]*value="([^"]*)"/g)].map(m => m[1]);
    assert.deepEqual(fields, ['0.23', '0.24', '1'], `${code}: the selected target's x, y and Y`);
    assert.ok(html.includes(te.hint.xyY), `${code}: and what a click sets`);
    const fresh = renderToStaticMarkup(React.createElement(ColorTargetEditor, {
        design: null, typeId: 'COLOR_R', targets: [], illuminant: 'D65', observer: 2,
        onApply: () => {}, onCancel: () => {}, c, t: tl,
    }));
    assert.ok(fresh.includes(`value="${te.targetName(1)}"`), `${code}: with no targets it opens on ${te.targetName(1)}`);
    assert.equal([...fresh.matchAll(/width:100px[^>]*value="([^"]*)"/g)].length, 3, `${code}: selected, with its three values`);
}

console.error = consoleError;
console.log('mf_wizard_color_preset: passed');
