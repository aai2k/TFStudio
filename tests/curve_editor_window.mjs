/**
 * The curve editor drawn: on its own for a new curve, a long imported one, a
 * Ψ/Δ pair and a weighting, and the buttons that open it in Measured Spectra
 * and Measured Ellipsometry.
 * Run: node tests/curve_editor_window.mjs
 */
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    loadApp, makeLocale, makeSampleDesign, makeTheme, shimBrowserGlobals, withDesign,
} from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();
const { CurveEditor } = await import('../src/components/windows/dataExchange/curveEditor/CurveEditor.js');
const { emptyTable, tableFromCurve, tableFromWeights } = await import(
    '../src/components/windows/dataExchange/curveEditor/curveTable.js');
const { NEW_CURVE_CONDITIONS } = await import('../src/components/windows/dataExchange/curveEditor/designBackdrop.js');
const { SpectrumExchange } = await import('../src/components/windows/dataExchange/spectrumExchange/SpectrumExchange.js');
const { MeasuredEllipsometry } = await import(
    '../src/components/windows/dataExchange/measuredEllipsometry/MeasuredEllipsometry.js');
const { makeMeasuredCurve } = await import('../src/utils/io/spectrumTable.js');

const c = makeTheme();
const t = makeLocale();
const ce = t.curveEditor;
// Text as the server renderer writes it into markup.
const escaped = text => text.replace(/&/g, '&amp;').replace(/'/g, '&#x27;').replace(/"/g, '&quot;');

// ── The editor drawn ─────────────────────────────────────────────────────────
const design = makeSampleDesign();
const draw = props => renderToStaticMarkup(withDesign(React.createElement(CurveEditor, {
    conditions: NEW_CURVE_CONDITIONS, design, onApply() {}, onCancel() {}, c, t, ...props,
}), design));

{
    const html = draw({ title: ce.titleNew, table: emptyTable('spectrum') });
    for (const label of [ce.titleNew, ce.fill, ce.change, ce.smooth, ce.resample, ce.importFile,
        ce.undo, ce.insertRows, ce.dragPoints, ce.addColumn, ce.apply, ce.cancel]) {
        assert.ok(html.includes(label), `the editor offers ${label}`);
    }
    assert.ok(html.includes('λ (nm)') && html.includes('T (%)'), 'columns are headed with their units');
    assert.ok(!html.includes(ce.rebuild(1)), 'a new curve has no merit targets to rebuild');
}

// Only the rows over the pane are drawn.
{
    const curve = makeMeasuredCurve({
        name: 'Scan', x: Array.from({ length: 2301 }, (_, i) => 200 + i), y: Array.from({ length: 2301 }, () => 0.5),
        quantity: 'T',
    });
    const html = draw({ title: 'Scan', table: tableFromCurve(curve, 'spectrum'), blockCount: 2 });
    const drawn = (html.match(/<tr style="height:22px"/g) || []).length;
    assert.ok(drawn > 10 && drawn < 100, `${drawn} of 2301 rows drawn`);
    assert.ok(html.includes(ce.rebuild(2)), 'an edited curve with merit targets offers to rebuild them');
}

// Values outside the physical range are marked.
{
    const table = { ...emptyTable('spectrum'), rows: [[400, 101], [500, 50]] };
    const html = draw({ title: 'x', table });
    assert.ok(html.includes(ce.outOfRange(1)));
    assert.ok(html.includes(`title="${ce.cellProblems.above}"`));
}

// A new Ψ/Δ pair is flagged for its missing angle, as the importer flags it.
{
    const html = draw({ title: 'x', table: emptyTable('ellipsometry') });
    assert.ok(html.includes(escaped(ce.aoiOnCard)));
    assert.ok(html.includes('Ψ (°)') && html.includes('Δ (°)'), 'a new ellipsometric curve opens as a Ψ and Δ pair');
    const atAngle = draw({ title: 'x', table: emptyTable('ellipsometry'), conditions: { ...NEW_CURVE_CONDITIONS, aoi: 70 } });
    assert.ok(!atAngle.includes(escaped(ce.aoiOnCard)));
}

// An Integral Values weighting: one relative column, nothing to drag a design behind.
{
    const html = draw({ title: ce.titleWeight('Source'), table: tableFromWeights([[400, 1], [500, 2]]), design: null });
    assert.ok(html.includes(`${ce.weight} (${ce.relative})`));
    assert.ok(!html.includes(ce.addColumn), 'a weighting has one column');
}

// ── The fill handle drawn ────────────────────────────────────────────────────
{
    const { CurveGrid } = await import('../src/components/windows/dataExchange/curveEditor/CurveGrid.js');
    const table = { ...emptyTable('spectrum'), rows: [[400, 50], [410, 50.1]] };
    const source = { rowStart: 0, rowEnd: 1, colKeys: ['x', 'v0'] };
    const sel = {
        focusCell: { rowIdx: 1, colKey: 'v0' }, range: source, extraCells: new Set(), tableRef: null,
        pressCell() {}, dragOver() {},
    };
    const editorWith = ({ drag = null, label = [], editCell = null }) => ({
        table, sel, editCell, actions: {}, onKeyDown() {}, fill: { source, drag, label, begin() {} },
    });
    const grid = props => renderToStaticMarkup(React.createElement(CurveGrid, {
        editor: editorWith(props), labels: { header: colKey => colKey }, c, ce,
    }));
    const tip = `title="${escaped(ce.fillHandleTip)}"`;
    const still = grid({});
    assert.ok(still.includes(tip) && still.includes('cursor:crosshair'), 'the handle sits on the selection');
    assert.ok(!grid({ editCell: { rowIdx: 0, colKey: 'x', typed: false, initValue: '400' } }).includes(tip),
        'and not while a cell is typed into');
    const drag = { source, reach: { up: false, count: 4 }, ctrl: false, x: 10, y: 10, blankRows: 5 };
    const dragged = grid({ drag, label: ['450', '50.5'] });
    assert.equal((dragged.match(/<tr style="height:22px"/g) || []).length, 11,
        'rows to the reach and a pane of blank room are drawn under the table');
    assert.ok(dragged.includes('inset 0 -2px 0'), 'the cells to fill are outlined');
    assert.ok(dragged.includes('<span>450</span><span>50.5</span>'), 'the label shows the farthest row');
}

// ── Where it opens ───────────────────────────────────────────────────────────
{
    const curve = { ...makeMeasuredCurve({ name: 'R scan', x: [400, 500, 600], y: [0.1, 0.2, 0.3], quantity: 'R' }), id: 'r' };
    const spectra = renderToStaticMarkup(withDesign(
        React.createElement(SpectrumExchange, { c, t }), { ...design, measuredCurves: [curve] }));
    assert.ok(spectra.includes(`>${ce.newCurve}<`), 'Measured Spectra has New curve beside Import');
    assert.ok(spectra.includes(`>${ce.edit}<`), 'and Edit on a curve card');

    const psi = { ...makeMeasuredCurve({ name: 'Psi', x: [400, 500], y: [20, 21], quantity: 'PSI', aoi: 70 }), id: 'p' };
    const ellipsometry = renderToStaticMarkup(withDesign(
        React.createElement(MeasuredEllipsometry, { c, t, theme: c }), { ...design, measuredEllipsometry: [psi] }));
    assert.ok(ellipsometry.includes(`>${ce.newCurve}<`), 'Measured Ellipsometry has New curve');
    assert.ok(ellipsometry.includes(`>${ce.edit}<`), 'and Edit on a curve card');
}

console.log('PASS: curve_editor_window');
