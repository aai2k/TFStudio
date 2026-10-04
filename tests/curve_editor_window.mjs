/**
 * The curve editor drawn: on its own for a new curve, a long imported one, a
 * Ψ/Δ pair and a weighting, its table heading and tool panels, and the
 * buttons that open it in Measured Spectra and Measured Ellipsometry.
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

const { editorLabels } = await import('../src/components/windows/dataExchange/curveEditor/editorLabels.js');

const c = makeTheme();
const t = makeLocale();
const ce = t.curveEditor;
// Text as the server renderer writes it into markup.
const escaped = text => text.replace(/&/g, '&amp;').replace(/'/g, '&#x27;').replace(/"/g, '&quot;');
const count = (html, text) => html.split(text).length - 1;
const headOf = html => html.slice(html.indexOf('<thead'), html.indexOf('</thead>'));
// A select drawn with `id` chosen.
const chosen = id => new RegExp(`<option[^>]*value="${id}"[^>]*selected=""|<option[^>]*selected=""[^>]*value="${id}"`);
// Every element of a tree a component returns, its child components left
// closed unless named in `open`, which are drawn by calling them: none of
// those holds state of its own.
const elements = (node, open = [], found = []) => {
    if (Array.isArray(node)) node.forEach(child => elements(child, open, found));
    else if (node && typeof node === 'object' && node.props) {
        found.push(node);
        if (open.includes(node.type?.name)) elements(node.type(node.props), open, found);
        else elements(node.props.children, open, found);
    }
    return found;
};
const press = () => {
    const event = { prevented: false, stopped: false };
    event.preventDefault = () => { event.prevented = true; };
    event.stopPropagation = () => { event.stopped = true; };
    return event;
};

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
    assert.ok(!html.includes(ce.rebuild(1)), 'a new curve has no merit targets to rebuild');

    // Each column's unit is set in its own heading, and nowhere else.
    const head = headOf(html);
    const unitTitles = [ce.wavelengthUnit, ce.quantity, ce.unitTip].map(text => `title="${escaped(text)}"`);
    for (const title of unitTitles) {
        assert.equal(count(head, title), 1, `the heading holds the select ${title}`);
        assert.equal(count(html, title), 1, `and no bar outside the table holds it too: ${title}`);
    }
    assert.ok(head.includes('>λ<') && chosen('nm').test(head) && chosen('T').test(head) && chosen('%').test(head),
        'the wavelength in nm and a T column in %');
    assert.equal(count(head, `title="${escaped(ce.columnName)}"`), 1, 'a new curve names its column under its heading');
    assert.ok(head.includes(ce.addColumn), '+ Column ends the heading');
    assert.equal(count(head, `title="${escaped(ce.removeColumn)}"`), 0, 'the last value column cannot be removed');
    for (const label of [ce.panels.selectFirst, ce.panels.fill.run(0)]) {
        assert.ok(!html.includes(label), 'no tool panel is open');
    }
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
    const head = headOf(html);
    assert.ok(chosen('PSI').test(head) && chosen('DEL').test(head) && head.includes('>°<'),
        'a new ellipsometric curve opens as a Ψ and Δ pair in degrees');
    assert.equal(count(head, `title="${escaped(ce.removeColumn)}"`), 2, 'either of two columns can be removed');
    const atAngle = draw({ title: 'x', table: emptyTable('ellipsometry'), conditions: { ...NEW_CURVE_CONDITIONS, aoi: 70 } });
    assert.ok(!atAngle.includes(escaped(ce.aoiOnCard)));
}

// An Integral Values weighting: one relative column, nothing to drag a design behind.
{
    const html = draw({ title: ce.titleWeight('Source'), table: tableFromWeights([[400, 1], [500, 2]]), design: null });
    const head = headOf(html);
    assert.ok(head.includes(`>${ce.weight}<`) && head.includes(`>${ce.relative}<`), 'a relative weight');
    assert.ok(!html.includes(ce.addColumn), 'a weighting has one column');
    assert.ok(!head.includes(escaped(ce.columnName)) && !head.includes(escaped(ce.removeColumn)),
        'which has no name to type and cannot be removed');
}

// ── The heading: a press outside its controls selects the column ─────────────
{
    const { TableHead } = await import('../src/components/windows/dataExchange/curveEditor/TableHead.js');
    const table = emptyTable('ellipsometry');
    const picked = [];
    const editor = {
        table, edit() {},
        actions: { selectAll: () => picked.push('all'), selectColumn: colKey => picked.push(colKey) },
    };
    const all = elements(TableHead({ editor, labels: editorLabels(t, table), c, ce, headRef: null }));
    const heads = all.filter(node => node.type === 'th' && node.props.onMouseDown);
    heads.forEach(th => th.props.onMouseDown(press()));
    assert.deepEqual(picked, ['x', 'v0', 'v1', 'all', 'x', 'v0', 'v1'],
        'a column\'s name and the heading under it select the column; the # heading selects every cell');

    // The names sit in a row above the quantities and units, and every heading
    // takes one row, so #, λ and + Column line up with the selects.
    const rows = all.filter(node => node.type === 'tr');
    assert.equal(rows.length, 2);
    const inRow = row => elements(row.props.children);
    assert.ok(inRow(rows[0]).some(node => node.props?.title === ce.columnName), 'the names are in the first row');
    assert.ok(inRow(rows[1]).some(node => node.type === 'th' && node.props.children === '#'), '# is in the row of selects');
    assert.ok(!all.some(node => node.type === 'th' && node.props.rowSpan > 1), 'no heading spans two rows');
    const kept = all.filter(node => node.type !== 'th' && node.props.onMouseDown).map(node => {
        const event = press();
        node.props.onMouseDown(event);
        return event.stopped;
    });
    assert.ok(kept.length >= 4 && kept.every(Boolean), 'a press on a select or a remove button stays with it');

    // Where a column lies, for scrolling a cell the keys move to into view:
    // value columns share what the fixed ones leave.
    const { columnSpan } = await import('../src/components/windows/dataExchange/curveEditor/TableHead.js');
    const layout = { widths: [46, 80, null, null, 90], minWidth: 500 };
    assert.deepEqual(columnSpan(layout, 1, 600), { left: 46, right: 126 }, 'the wavelength column');
    assert.deepEqual(columnSpan(layout, 3, 600), { left: 318, right: 510 }, 'the second value column');
    assert.deepEqual(columnSpan(layout, 4, 600), { left: 510, right: 600 }, '+ Column');
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
        table, sel, editCell, actions: {}, edit() {}, onKeyDown() {}, fill: { source, drag, label, begin() {} },
    });
    const grid = props => renderToStaticMarkup(React.createElement(CurveGrid, {
        editor: editorWith(props), labels: editorLabels(t, table), c, ce,
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
    assert.ok(/min-width:\d+px/.test(still), 'columns past what the pane fits scroll it sideways');
}

// ── The tool panels ──────────────────────────────────────────────────────────
{
    const { PanelTool } = await import('../src/components/windows/dataExchange/curveEditor/ToolPanels.js');
    const table = { ...emptyTable('spectrum'), rows: Array.from({ length: 8 }, (_, i) => [300 + 50 * i, 90 + i]) };
    const tools = {
        fill: { mode: 'step', value: null, first: 400, step: 10, last: null },
        change: { mode: 'percent', percent: 5, a: null, b: null },
        step: 1,
        smooth: { window: 5, order: 2 },
    };
    const draw = (id, open, sel) => renderToStaticMarkup(React.createElement(PanelTool, {
        editor: {
            table, tools, panel: open, setPanel() {}, setTools() {}, actions: {},
            sel: { range: null, extraCells: new Set(), focusCell: null, tableRef: { current: null }, ...sel },
        },
        labels: editorLabels(t, table), c, ce, id,
    }));
    const lambdas = { range: { rowStart: 1, rowEnd: 6, colKeys: ['x'] }, focusCell: { rowIdx: 6, colKey: 'x' } };

    const closed = draw('fill', null, lambdas);
    assert.ok(closed.includes('aria-expanded="false"') && closed.includes(`>${ce.fill}<`));
    assert.ok(!closed.includes(ce.panels.fill.run(6)), 'a closed panel is not drawn');
    assert.ok(!draw('fill', 'change', lambdas).includes(ce.panels.fill.run(6)), 'nor one while another is open');

    const fill = draw('fill', 'fill', lambdas);
    assert.ok(fill.includes('aria-expanded="true"'));
    assert.ok(fill.includes(ce.panels.fill.title(6, 'λ (nm)')), 'Fill names the cells it fills');
    assert.equal(count(fill, 'type="radio"'), 4, 'in one of four ways');
    assert.ok(fill.includes('value="400"') && fill.includes('value="10"'), 'with its numbers in the sentence');
    assert.ok(fill.includes('400, 410, 420 … 450'), 'and shows what they will be');
    assert.ok(fill.includes(`>${ce.panels.fill.run(6)}</button>`));

    const change = draw('change', 'change', { range: { rowStart: 0, rowEnd: 2, colKeys: ['v0'] } });
    assert.ok(change.includes(ce.panels.change.title(3, 'T 1')) && change.includes(ce.panels.change.preview('90', '94.5')));

    const smooth = draw('smooth', 'smooth', {});
    assert.ok(smooth.includes(ce.panels.selectFirst), 'with nothing selected a panel asks for cells');
    assert.ok(smooth.includes('value="2"') && !smooth.includes('value="5"'),
        'Smooth shows a five-point fit as two points on each side');
    assert.ok(new RegExp(`<span style="opacity:0.45"><button[^>]*>${ce.panels.smooth.run}</button>`).test(smooth),
        'and its button is dimmed');
    assert.ok(fill.includes(`<span style="opacity:1"><button`), 'a tool that can run is not');

    // The button runs the tool and closes the panel, and does nothing until the tool can run.
    const pressRun = (id, sel) => {
        const events = [];
        const editor = {
            table, tools, panel: id, setPanel: open => events.push(['panel', open]), setTools() {},
            actions: { [id]: () => events.push(['run', id]) },
            sel: { range: null, extraCells: new Set(), focusCell: null, tableRef: { current: null }, ...sel },
        };
        const tree = PanelTool({ editor, labels: editorLabels(t, table), c, ce, id });
        const open = ['FillPanel', 'SmoothPanel', 'PanelBody', 'RunButton'];
        const run = elements(tree, open).find(node => node.type?.name === 'ActionButton');
        run.props.onClick();
        return events;
    };
    assert.deepEqual(pressRun('fill', lambdas), [['run', 'fill'], ['panel', null]]);
    assert.deepEqual(pressRun('smooth', {}), [], 'with nothing selected');

    const resample = draw('resample', 'resample', {});
    assert.ok(resample.includes(escaped(ce.panels.resample.plan('300', '650', 'nm', 351))));
    assert.ok(resample.includes(`>${ce.panels.resample.run(351)}</button>`));
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

// ── A curve typed in dB says so on its card ──────────────────────────────────
{
    const sx = t.spectrumExchange;
    const card = curve => renderToStaticMarkup(withDesign(
        React.createElement(SpectrumExchange, { c, t }), { ...design, measuredCurves: [curve] }));
    const gain = { ...makeMeasuredCurve({ name: 'Gain', x: [1530, 1540], y: [0.5, 0.6], quantity: 'T' }), id: 'g', yTypedUnit: 'dB' };
    const typed = card(gain);
    assert.ok(typed.includes(`>${sx.typedIn('dB')}<`), 'the card names the unit the curve was typed in');
    assert.ok(!typed.includes(`>${sx.percent}<`) && !typed.includes(`>${sx.fraction}<`),
        'and offers no Percent or Fraction correction, which would rescale it wrongly');
    const scan = { ...makeMeasuredCurve({ name: 'Scan', x: [400, 500], y: [10, 20], quantity: 'R', isPercent: true }), id: 's' };
    const read = card(scan);
    assert.ok(read.includes(`>${sx.percent}<`) && read.includes(`>${sx.fraction}<`), 'a curve read from a file keeps it');
    assert.ok(!read.includes(sx.typedIn('dB')));
}

console.log('PASS: curve_editor_window');
