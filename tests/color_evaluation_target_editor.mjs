/**
 * Editing colour targets on Color Evaluation's diagram.
 *
 *   1. A click writes a target as two rows of the coordinates the diagram is
 *      drawn in (x and y; u′ and v′; a* and b*; C*ab and hab; C*uv and huv), on
 *      the window's side, polarization, illuminant and observer, weight 1,
 *      after the last row, each value kept to the wizard's places. The diagram
 *      that drew it draws it back.
 *   2. The rows take the angle of the coating point nearest the click; under
 *      All the nearest point of any environment, and the rows are scored in
 *      that environment.
 *   3. A drag moves the two rows of the diamond in their own coordinates; a
 *      delete removes both; other rows are left as they are.
 *   4. The shared overlay: a colour target is a point dragged in both
 *      coordinates, and a click on the diagram draws a point. In every window
 *      the Delete tool drags a target too, and removes it on a click.
 *   5. The hook writes each gesture to the design's merit rows.
 *   6. While a target is drawn the chart gives up its readout and zoom; the
 *      editing row; the Edit button and the Targets switch parked on.
 *   7. While editing, a click, a drag or a delete never moves the frame of the
 *      CIELAB and CIELUV planes; a value typed past its edge, or the coating
 *      moving past it, widens it.
 *
 * Run: node tests/color_evaluation_target_editor.mjs
 */
import './_kernel.mjs';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, makeSampleDesign, makeTheme, shimBrowserGlobals, withDesign } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();
const { initCatalogs } = await import('../src/utils/materials/catalogManager.js');
initCatalogs({});
const dir = '../src/components/windows/analysis/colorEvaluation';
const { colorTargetMarks } = await import(`${dir}/colorTargets.js`);
const {
    createColorTarget, deleteColorTarget, editableColorTargets, markKey, moveColorTarget, nearestCoating,
} = await import(`${dir}/colorTargetEdits.js`);
const { useColorTargetEditor } = await import(`${dir}/useColorTargetEditor.js`);
const { ColorTargetToolbar } = await import(`${dir}/ColorTargetToolbar.js`);
const { buildChromaticityOption } = await import(`${dir}/chartFigure.js`);
const { ColorEvaluation } = await import(`${dir}/ColorEvaluation.js`);
const { colorTargetSession } = await import(`${dir}/sessionState.js`);
const { drawnItem, dropOutcome, moveGeometry } = await import('../src/components/ui/targetEditorGeometry.js');
const { colorReport } = await import('../src/utils/physics/colorimetry.js');
const { makeOperand } = await import('../src/utils/physics/optimizer.js');

const c = makeTheme();
const t = makeLocale();
const ce = t.colorEval;
const VIEW = { characteristic: 'R', pol: 'avg', illuminant: 'D65', observer: '2', diagram: 'xy' };
const ONE = { shown: false, every: false, views: [{ id: 'base', number: 1 }] };
const WHITE = { X: 95.047, Y: 100, Z: 108.883 };

// The coating at three angles, placed on each plane: on x, y (and u′, v′) and
// on the CIELAB and CIELUV planes.
const coating = (theta, xy, ab, env) => ({
    theta, ...(env ? { env } : {}),
    report: {
        white: WHITE, xy: { x: xy[0], y: xy[1] }, uvP: { up: xy[0], vp: xy[1] },
        Lab: { L: 50, a: ab[0], b: ab[1] }, Luv: { L: 50, u: ab[0], v: ab[1] },
    },
});
const REPORTS = [coating(0, [0.30, 0.30], [0, 0]), coating(30, [0.35, 0.32], [10, 5]), coating(60, [0.45, 0.40], [-20, 30])];
const existing = makeOperand({ type: 'RAV', target: 4 });
const draw = (point, view = {}, more = {}) => createColorTarget({
    operands: [existing], point, view: { ...VIEW, ...view }, reports: REPORTS, environment: ONE, ...more,
});

// ── 1. The rows a click writes, on each tab ──────────────────────────────────
const TABS = [
    ['xy', [0.31234, 0.33156], ['x', 'y'], [0.312, 0.332]],
    ['uv', [0.2001, 0.4567], ["u'", "v'"], [0.2, 0.457]],
    ['ab', [12.3456, -7.891], ['a*', 'b*'], [12.35, -7.89]],
    ['chAb', [-3, -4], ['C*ab', 'hab'], [5, 233.13]],
    ['chUv', [3, 4], ['C*uv', 'huv'], [5, 53.13]],
];
for (const [diagram, point, quantities, targets] of TABS) {
    const rows = draw(point, { diagram, characteristic: 'T', pol: 's', illuminant: 'A', observer: '10' });
    assert.equal(rows.length, 3, `${diagram}: two rows added`);
    assert.equal(rows[0], existing, `${diagram}: the rows there are kept as they are`);
    const added = rows.slice(1);
    assert.deepEqual(added.map(op => op.color), quantities, `${diagram}: the diagram's coordinates`);
    assert.deepEqual(added.map(op => op.target), targets, `${diagram}: kept to the wizard's places`);
    for (const op of added) {
        assert.equal(op.type, 'TCOL', `${diagram}: the side shown`);
        assert.equal(op.pol, 's');
        assert.equal(op.illuminant, 'A');
        assert.equal(op.observer, 10, 'the observer as a row holds it, a number');
        assert.equal(op.weight, 1);
        assert.equal(op.enabled, true);
        assert.ok(op.id && !('env' in op), `${diagram}: a design with one environment scores the rows in it`);
    }
    const back = colorTargetMarks(rows, { ...VIEW, diagram, characteristic: 'T', pol: 's', illuminant: 'A', observer: '10' });
    assert.equal(back.length, 1, `${diagram}: the diagram that drew the target draws it`);
    assert.deepEqual(back[0].rows, added.map(op => op.id));
}
assert.equal(draw([0.3, 0.3])[1].type, 'RCOL', 'RCOL over R');

// ── 2. The angle is that of the nearest coating point ────────────────────────
assert.equal(draw([0.36, 0.33])[1].aoi, 30, 'x, y: beside the 30° point');
assert.equal(draw([0.31, 0.29])[2].aoi, 0, 'x, y: beside the 0° point');
assert.equal(draw([-15, 25], { diagram: 'ab' })[1].aoi, 60, 'a*, b*: beside the 60° point');
assert.equal(draw([8, 8], { diagram: 'chAb' })[1].aoi, 30, 'C*ab, hab: on the plane of a*, b*');
assert.equal(nearestCoating(REPORTS, 'chUv', [-19, 31]).theta, 60, 'C*uv, huv: on the plane of u*, v*');
{
    // Under All, the nearest point of any environment, and its environment.
    const env = number => ({ number, label: `Env ${number}` });
    const reports = [
        coating(0, [0.30, 0.30], [0, 0], env(1)), coating(45, [0.31, 0.31], [1, 1], env(1)),
        coating(0, [0.40, 0.36], [0, 0], env(2)), coating(45, [0.42, 0.38], [1, 1], env(2)),
    ];
    const all = { shown: true, every: true, views: [{ id: 'base', number: 1 }, { id: 'e2', number: 2 }] };
    const rows = createColorTarget({ operands: [], point: [0.415, 0.375], view: VIEW, reports, environment: all });
    assert.deepEqual(rows.map(op => [op.aoi, op.env]), [[45, 'e2'], [45, 'e2']], 'the 45° point of environment 2');
    const near1 = createColorTarget({ operands: [], point: [0.299, 0.3], view: VIEW, reports, environment: all });
    assert.deepEqual(near1.map(op => [op.aoi, op.env]), [[0, 'base'], [0, 'base']], 'the 0° point of environment 1');
    // One environment of several shown: its rows are scored there.
    const second = { shown: true, every: false, views: [{ id: 'e2', number: 2 }] };
    const alone = createColorTarget({ operands: [], point: [0.3, 0.3], view: VIEW, reports: REPORTS, environment: second });
    assert.deepEqual(alone.map(op => op.env), ['e2', 'e2']);
}

// ── 3. Moving and deleting a diamond ─────────────────────────────────────────
{
    const rows = draw([0.312, 0.332]);
    const [mark] = colorTargetMarks(rows, VIEW);
    const moved = moveColorTarget(rows, mark, [0.40017, 0.29981]);
    assert.equal(moved[0], existing, 'other rows are left as they are');
    assert.deepEqual(moved.slice(1).map(op => op.target), [0.4, 0.3], 'x, y kept to three places');
    assert.deepEqual(moved.slice(1).map(op => [op.id, op.color, op.aoi, op.type]),
        rows.slice(1).map(op => [op.id, op.color, op.aoi, op.type]), 'a move changes the targets only');
    assert.deepEqual(colorTargetMarks(moved, VIEW)[0].value, [0.4, 0.3], 'drawn where it was dropped');
    assert.deepEqual(deleteColorTarget(rows, mark), [existing], 'a delete removes both rows');

    // The CIELAB plane draws an a*, b* pair and a C*ab, hab pair; each moves in
    // its own coordinates.
    const lab = [
        makeOperand({ type: 'RCOL', color: 'a*', target: 5, aoi: 30, illuminant: 'D65', observer: 2 }),
        makeOperand({ type: 'RCOL', color: 'b*', target: -20, aoi: 30, illuminant: 'D65', observer: 2 }),
        makeOperand({ type: 'RCOL', color: 'C*ab', target: 10, aoi: 60, illuminant: 'D65', observer: 2 }),
        makeOperand({ type: 'RCOL', color: 'hab', target: 90, aoi: 60, illuminant: 'D65', observer: 2 }),
    ];
    const [cartesian, polar] = colorTargetMarks(lab, { ...VIEW, diagram: 'chAb' });
    assert.deepEqual(moveColorTarget(lab, cartesian, [6.004, -21.996]).slice(0, 2).map(op => op.target), [6, -22]);
    assert.deepEqual(moveColorTarget(lab, polar, [0, -12]).slice(2).map(op => op.target), [12, 270],
        'C*ab and hab of the point dropped at a* 0, b* -12');
    assert.deepEqual(deleteColorTarget(lab, polar).map(op => op.color), ['a*', 'b*']);
}

// ── 4. The shared overlay ────────────────────────────────────────────────────
{
    const rows = draw([0.312, 0.332]);
    const marks = colorTargetMarks(rows, VIEW);
    const [item] = editableColorTargets(marks, '#123');
    assert.deepEqual(item, {
        opId: `${rows[1].id} ${rows[2].id}`, shape: 'point', free: true, x0: 0.312, y0: 0.332, color: '#123',
    });
    assert.equal(markKey(marks[0]), item.opId, 'the overlay names a diamond by its two rows');
    assert.deepEqual(moveGeometry(null, item, 'point', [0.4, 0.3], [5, 5]), { ...item, x0: 0.4, y0: 0.3 },
        'a free point goes where the pointer is');
    const reading = { opId: 'r', shape: 'point', x0: 550, y0: 40 };
    assert.deepEqual(moveGeometry(null, reading, 'point', [560, 47], [5, 5]), { ...reading, y0: 47 },
        'a reading still keeps its wavelength');
    const drawn = drawnItem('point', [0.3, 0.3], [0.31, 0.32], '#123');
    assert.deepEqual(drawn, { shape: 'point', x0: 0.31, y0: 0.32, color: '#123' }, 'a drawing is a point at the pointer');
    assert.deepEqual(dropOutcome({ mode: 'create' }, drawn, false, true), { create: drawn }, 'a click creates it there');
    assert.deepEqual(dropOutcome({ mode: 'create' }, drawn, true, true), { create: drawn }, 'and so does a press dragged');
    assert.deepEqual(drawnItem(undefined, [500, 1], [600, 2], 'c'), { x0: 500, y0: 1, x1: 600, y1: 2, color: 'c' },
        'a plot of lines still draws lines');

    // In every window the delete tool drags a target as Draw does, and a click
    // on the target removes it.
    const pressed = { mode: 'edit', source: item, removes: true };
    assert.deepEqual(dropOutcome(pressed, item, false), { remove: item.opId }, 'a click with Delete removes it');
    assert.deepEqual(dropOutcome(pressed, { ...item, x0: 0.4 }, true), { edit: { ...item, x0: 0.4 } },
        'a drag with Delete moves it');
    assert.equal(dropOutcome({ ...pressed, removes: false }, item, false), null, 'a click with Draw leaves it');
    const line = { opId: 'l', x0: 500, y0: 1, x1: 600, y1: 1 };
    assert.deepEqual(dropOutcome({ mode: 'edit', source: line, removes: true }, line, false), { remove: 'l' },
        'and so on a plot of lines');
}
{
    // The overlay's own pointer handlers, on a chart whose pixels are its data.
    const { useTargetDrag } = await import('../src/components/ui/TargetEditorOverlay.js');
    const svg = { getBoundingClientRect: () => ({ left: 0, top: 0 }) };
    const chartRef = { current: { containPixel: () => true, convertFromPixel: (_axes, pixel) => [...pixel] } };
    const pointer = (x, y, target = svg) => ({
        clientX: x, clientY: y, pointerId: 1, target, preventDefault() {}, stopPropagation() {},
        currentTarget: { setPointerCapture() {}, releasePointerCapture() {} },
    });
    const handlersFor = (tool, calls) => {
        let drag = null;
        const Probe = () => {
            drag = useTargetDrag({
                enabled: true, tool, drawShape: 'point', createOnClick: true, drawColor: '#123',
                onCreate: item => calls.push(['create', item]), onEdit: (meta, item) => calls.push(['edit', meta.opId, item]),
                onDelete: opId => calls.push(['delete', opId]),
            }, chartRef, { current: svg });
            return null;
        };
        renderToStaticMarkup(React.createElement(Probe));
        return drag;
    };
    const item = { opId: 'a b', shape: 'point', free: true, x0: 100, y0: 50, color: '#123' };
    for (const tool of ['delete', 'draw']) {
        const calls = [];
        const drag = handlersFor(tool, calls);
        drag.startHandleDrag(pointer(100, 50), item, 'point');
        assert.deepEqual(calls, [], `${tool}: a press on a target changes nothing yet`);
        drag.finishDrag(pointer(100, 50));
        assert.deepEqual(calls, tool === 'delete' ? [['delete', 'a b']] : [], `${tool}: a click on a target`);
        drag.startHandleDrag(pointer(100, 50), item, 'point');
        drag.updateDrag(pointer(130, 70));
        drag.finishDrag(pointer(130, 70));
        assert.deepEqual(calls.at(-1), ['edit', 'a b', { ...item, x0: 130, y0: 70 }], `${tool}: a drag moves the target`);
    }
    const calls = [];
    const drawing = handlersFor('draw', calls);
    drawing.startDrawing(pointer(40, 30));
    drawing.finishDrag(pointer(40, 30));
    assert.deepEqual(calls, [['create', { shape: 'point', x0: 40, y0: 30, color: '#123' }]],
        'a click on the empty diagram draws a point there');
}

// ── 5. The hook writes each gesture to the merit rows ────────────────────────
{
    const design = { ...makeSampleDesign(), meritOperands: draw([0.312, 0.332]) };
    const written = [];
    let editor = null;
    const Probe = () => {
        editor = useColorTargetEditor({
            design, updateDesign: patch => written.push(patch), state: VIEW,
            marks: colorTargetMarks(design.meritOperands, VIEW), reports: REPORTS, environment: ONE,
        });
        return null;
    };
    renderToStaticMarkup(React.createElement(Probe));
    assert.equal(editor.editMode, false, 'editing is off when the window opens');
    assert.equal(editor.editTool, 'draw');
    editor.onCreate({ shape: 'point', x0: 0.44, y0: 0.39 });
    assert.deepEqual(written[0].meritOperands.slice(3).map(op => [op.color, op.target, op.aoi]),
        [['x', 0.44, 60], ['y', 0.39, 60]]);
    const key = `${design.meritOperands[1].id} ${design.meritOperands[2].id}`;
    editor.onEdit({ opId: key, kind: undefined, type: undefined }, { x0: 0.5, y0: 0.4 });
    assert.deepEqual(written[1].meritOperands.slice(1).map(op => op.target), [0.5, 0.4]);
    editor.onDelete(key);
    assert.deepEqual(written[2].meritOperands, [existing]);
    editor.onDelete('gone');
    assert.equal(written.length, 3, 'a diamond no longer drawn is left alone');
}
assert.deepEqual(colorTargetSession.read(null), { editMode: false, editTool: 'draw', drawAoi: 'nearest' });

// ── 6. The chart, the editing row and the window ─────────────────────────────
{
    const lambda = Array.from({ length: 401 }, (_, i) => 380 + i);
    const report = colorReport({ lambda, values: lambda.map(() => 0.04) }, { observer: '2', illuminant: 'D65' });
    const chart = drawing => buildChromaticityOption({
        reports: [{ theta: 0, report }], observer: '2', diagram: 'xy', c, tr: ce, units: t.units, drawing,
        display: { showWavelengths: false, showWhite: true, showPlanckian: false, showSrgb: false },
    });
    assert.equal(chart(true).tooltip.show, false, 'no readout freezes under a drawing');
    assert.equal(chart(true).toolbox.feature.dataZoom, undefined, 'no rectangle zoom takes the press that makes a target');
    assert.ok(chart(false).toolbox.feature.dataZoom, 'a diagram not being drawn on keeps its zoom');
    assert.notEqual(chart(false).tooltip.show, false);
}
{
    const noop = () => {};
    const editor = { editMode: true, editTool: 'draw', setEditTool: noop, angles: [0, 45], drawAoi: '45', setDrawAoi: noop };
    const row = props => renderToStaticMarkup(React.createElement(ColorTargetToolbar, { c, ce, editor, ...props }));
    const drawRow = row();
    assert.match(drawRow, />Draw</);
    assert.match(drawRow, />Delete</);
    assert.ok(drawRow.includes(`>${ce.aoi}<`), 'the angle new targets take, beside the tools');
    assert.deepEqual([...drawRow.matchAll(/<option[^>]*>([^<]*)</g)].map(m => m[1]), [ce.drawAoiNearest, '0°', '45°'],
        'Nearest, then the angles the window shows');
    assert.match(drawRow, /<option[^>]*value="45"[^>]*selected/);
    assert.ok(!drawRow.includes('flex-basis:100%'), 'no hint line: the tools carry it in their tooltips');
    assert.equal(row({ editor: { ...editor, editMode: false } }), '', 'the row exists only while editing');

    // A chosen angle writes the target there, scored beside the nearest point at that angle.
    const drawn = (aoi) => draw([0.3, 0.3], {}, { aoi }).slice(1).map(op => op.aoi);
    assert.deepEqual(drawn(null), [0, 0], 'Nearest: the angle of the coating point nearest the click');
    assert.deepEqual(drawn(60), [60, 60], 'a chosen angle, though another angle\'s point is nearer');
}
{
    const lambdaRows = draw([0.312, 0.332]);
    const design = { ...makeSampleDesign(), meritOperands: lambdaRows };
    const render = () => renderToStaticMarkup(withDesign(React.createElement(ColorEvaluation, { c, theme: c, t }), design));
    const button = (html, label) => {
        const at = html.indexOf(`>${label}</button>`);
        return at < 0 ? null : html.slice(html.lastIndexOf('<button', at), at);
    };
    const off = render();
    assert.ok(button(off, ce.editTargets).includes(`title="${ce.editTargetsTooltipOff}"`), 'the Edit button, off');
    assert.ok(off.indexOf(`>${ce.targets}</button>`) < off.indexOf(`>${ce.editTargets}</button>`), 'beside Targets');
    assert.doesNotMatch(off, /data-color-toolbar="targets"/, 'no editing row until editing is on');
    colorTargetSession.write(design, { editMode: true });
    const { colorEvaluationSession } = await import(`${dir}/sessionState.js`);
    colorEvaluationSession.write(design, { showTargets: false });
    const on = render();
    assert.ok(button(on, ce.editTargets).includes('aria-pressed="true"'));
    assert.match(on, /data-color-toolbar="targets"/, 'the editing row');
    const targets = button(on, ce.targets);
    assert.ok(targets.includes('aria-pressed="true"') && targets.includes('disabled'), 'Targets parked on while editing');
    colorTargetSession.write(design, { editMode: false });
    colorEvaluationSession.write(design, { showTargets: true });
}

// ── 7. The CIELAB and CIELUV frame holds still while editing ─────────────────
{
    const { nextHeldFrame } = await import(`${dir}/heldFrame.js`);
    const { diagramView } = await import(`${dir}/chartFigure.js`);
    // The coating reaches a* 15 on the a*, b* plane: a frame of ±20.
    const reports = [coating(0, [0.3, 0.3], [15, 3]), coating(30, [0.3, 0.3], [9, -6]), coating(60, [0.3, 0.3], [4, -9])];
    const onPlane = reports.map(({ report }) => [report.Lab.a, report.Lab.b]);
    const edge = held => diagramView('ab', [...onPlane, ...held.points]).x[1];
    const look = (held, points, more = {}) => nextHeldFrame(held, {
        editMode: true, key: 'ab', reports, diagram: 'ab', points, ...more,
    });
    const start = look(null, []);
    assert.equal(edge(start), 20, 'editing starts on the frame fitted to the targets as they are');
    assert.equal(diagramView('ab', [...onPlane, [19, -5]]).x[1], 30, 'refitted, a target at a* 19 would make it ±30');
    assert.equal(look(start, [[19, -5]]), start, 'a target drawn or dropped at a* 19 leaves the frame at ±20');
    assert.equal(look(start, []), start, 'and so does deleting it');
    const typed = look(start, [[40, 0]]);
    assert.ok(edge(typed) > 40, 'a value typed past the edge widens the frame');
    assert.equal(look(typed, [[10, 0]]), typed, 'dragged back in, the frame stays as wide');
    const further = [...reports, coating(80, [0.3, 0.3], [35, 0])];
    assert.ok(diagramView('ab', [[35, 0], ...look(start, [], { reports: further }).points]).x[1] > 35,
        'a coating that moves past the edge widens it');
    for (const diagram of ['chAb', 'chUv']) {
        const polar = look(null, [], { diagram });
        assert.equal(look(polar, [[14, 14]], { diagram }), polar, `${diagram}: a target inside the disc leaves it`);
        assert.equal(look(polar, [[17, 17]], { diagram }), polar,
            `${diagram}: so does one in a corner of the plot past the disc, where a click can put it`);
        assert.notEqual(look(polar, [[30, 0]], { diagram }), polar, `${diagram}: one typed past the plot widens it`);
    }
    const xy = look(null, [], { diagram: 'xy' });
    assert.equal(look(xy, [[0.95, 0.5]], { diagram: 'xy' }), xy, 'x, y keeps its fixed frame, past which nothing is added');
    assert.deepEqual(look(typed, [[10, 0]], { key: 'chAb' }), { key: 'chAb', points: [[10, 0]] },
        'another tab or setting starts the frame again on the targets as they are');
    assert.equal(look(typed, [], { reports: null }), typed, 'while the colour is computed the frame is kept');
    assert.equal(look(typed, [], { editMode: false }), null, 'off, the frame fits the targets as they are');

    // The chart sizes the frame to the points held, not to the targets.
    const lambda = Array.from({ length: 401 }, (_, i) => 380 + i);
    const report = colorReport({ lambda, values: lambda.map(() => 0.04) }, { observer: '2', illuminant: 'D65' });
    const chart = viewPoints => buildChromaticityOption({
        reports: [{ theta: 0, report }], observer: '2', diagram: 'ab', c, tr: ce, units: t.units,
        targets: [{ value: [5.8, 0], label: '0°' }], viewPoints,
        display: { showWavelengths: false, showWhite: true, showPlanckian: false, showSrgb: false },
    });
    assert.equal(chart([]).xAxis.max, 6, 'held: the frame the plane had before the target came near its edge');
    assert.equal(chart(undefined).xAxis.max, 8, 'not held: the frame takes the target in');
}

console.log('color_evaluation_target_editor: passed');
