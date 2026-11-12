/**
 * The curve editor's headings over their numbers, and the plot's Y range:
 * Auto as the editor opens, the fields showing the ends the axis was drawn
 * with, a typed range on the left axis only, and leaving Auto from the ends
 * on screen.
 * Run: node tests/curve_editor_y_range.mjs
 */
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { importWithHookRuntime, makeHookRuntime } from './_hookHarness.mjs';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();
const runtime = makeHookRuntime();
const { useCurveEditor } = await importWithHookRuntime(
    '../src/components/windows/dataExchange/curveEditor/useCurveEditor.js', runtime);
const { emptyTable, tableFromWeights } = await import(
    '../src/components/windows/dataExchange/curveEditor/curveTable.js');
const { TableHead } = await import('../src/components/windows/dataExchange/curveEditor/TableHead.js');
const { EditorToolbar } = await import('../src/components/windows/dataExchange/curveEditor/EditorToolbar.js');
const { curveChartOption, drawnAxisEnds } = await import(
    '../src/components/windows/dataExchange/curveEditor/chartModel.js');
const { editorLabels } = await import('../src/components/windows/dataExchange/curveEditor/editorLabels.js');

const c = makeTheme();
const t = makeLocale();
const ce = t.curveEditor;

// Every element of a tree a component returns, its child components left
// closed unless named in `open`, which are drawn by calling them.
const elements = (node, open = [], found = []) => {
    if (Array.isArray(node)) node.forEach(child => elements(child, open, found));
    else if (node && typeof node === 'object' && node.props) {
        found.push(node);
        if (open.includes(node.type?.name)) elements(node.type(node.props), open, found);
        else elements(node.props.children, open, found);
    }
    return found;
};

// ── A heading sits over its numbers ──────────────────────────────────────────
// The numbers are set to the right of their cells. In a wide pane a heading
// at the left edge of its column ended up a pane's width from them.
{
    const head = table => renderToStaticMarkup(React.createElement('table', null, React.createElement(TableHead, {
        editor: { table, edit() {}, actions: { selectAll() {}, selectColumn() {} } },
        labels: editorLabels(t, table), c, ce, headRef: null,
    })));
    const pair = head(emptyTable('ellipsometry'));
    assert.equal(pair.split('justify-content:flex-end').length - 1, 3,
        'the wavelength heading and both value headings sit at their column\'s right edge');
    assert.ok(!pair.includes('margin-left:auto'),
        'nothing in a heading pushes the rest to the left edge, the remove button included');
    const name = new RegExp(`<input[^>]*title="${ce.columnName}"[^>]*>`).exec(pair)?.[0] || '';
    assert.ok(name.includes('text-align:right'), 'the name over a new curve\'s column sits at the right too');
    assert.equal(head(tableFromWeights([[400, 1], [500, 2]])).split('justify-content:flex-end').length - 1, 2,
        'a weighting\'s one value heading as well');
}

// ── The left axis takes a typed range; the right axis fits itself ───────────
{
    const colors = { background: '#111', paper: '#222', grid: '#333', text: '#ccc', accent: '#09f' };
    const option = (table, yRange) => curveChartOption(table, {
        colors, backdrops: null, labels: editorLabels(t, table), dragOn: false, yRange,
    });
    const fits = axis => axis.scale === true && axis.min == null && axis.max == null;
    const psiDelta = { ...emptyTable('ellipsometry'), rows: [[400, 30, 100], [500, 20, 200]] };

    const auto = option(psiDelta, { auto: true, min: 0, max: 90 });
    assert.equal(auto.yAxis.length, 2);
    assert.ok(auto.yAxis.every(fits), 'with Auto on both axes fit themselves, whatever the fields hold');
    const typed = option(psiDelta, { auto: false, min: 0, max: 90 });
    assert.deepEqual([typed.yAxis[0].min, typed.yAxis[0].max, typed.yAxis[0].scale], [0, 90, false],
        'Auto off: Ψ, on the left axis, runs from one typed end to the other');
    assert.ok(fits(typed.yAxis[1]), 'and Δ, on the right axis, still fits itself');
    for (const [range, what] of [
        [{ auto: false, min: 90, max: 0 }, 'a low end above the high one'],
        [{ auto: false, min: 40, max: 40 }, 'two equal ends'],
        [{ auto: false, min: null, max: 90 }, 'an end left empty'],
    ]) {
        assert.ok(fits(option(psiDelta, range).yAxis[0]), `${what} leaves the axis fitting itself`);
    }

    const weights = tableFromWeights([[400, 1], [500, 11], [580, 1]]);
    assert.ok(fits(option(weights, undefined).yAxis[0]), 'a plot drawn without a range fits itself, as before');
    const hundred = option(weights, { auto: false, min: 0, max: 100 });
    assert.deepEqual([hundred.yAxis[0].min, hundred.yAxis[0].max, hundred.yAxis[0].interval], [0, 100, 10],
        '0 to 100 is ruled every 10, as the analysis plots rule it');
}

// ── The ends the axis was drawn with ─────────────────────────────────────────
{
    const chartWith = extent => ({
        getModel: () => ({
            getComponent: (type, index) => (type === 'yAxis' && index === 0
                ? { axis: { scale: { getExtent: () => extent } } } : null),
        }),
    });
    assert.deepEqual(drawnAxisEnds(chartWith([0, 12])), [0, 12], 'the left axis\'s ends, bottom first');
    assert.deepEqual(drawnAxisEnds(chartWith([3.456789123, 7.000000000001])), [3.45679, 7],
        'a zoomed axis\'s ends kept to the six figures a field shows');
    assert.equal(drawnAxisEnds(chartWith([NaN, 1])), null);
    assert.equal(drawnAxisEnds({}), null, 'a chart that gives no axis gives no ends');
    assert.equal(drawnAxisEnds(null), null);
}

// ── Auto as the editor opens, and leaving it from the ends on screen ─────────
{
    const props = { initialTable: tableFromWeights([[400, 1], [500, 11], [580, 1]]), onApply() {}, ce };
    const render = () => runtime.render(() => useCurveEditor(props));
    // The Y group as the tool row draws it for the editor's state.
    const yGroup = editor => {
        const all = elements(EditorToolbar({ editor, labels: editorLabels(t, editor.table), c, ce }), ['YRange']);
        const group = all.find(node => node.type === 'div' && node.props.title === ce.yRangeTip);
        const range = all.find(node => node.type?.name === 'RangeField').props;
        return {
            group, check: all.find(node => node.type?.name === 'CheckField').props,
            label: all.find(node => node.type?.name === 'FieldLabel').props.children,
            from: range.from, to: range.to,
        };
    };

    let editor = render();
    assert.deepEqual(editor.yRange, { auto: true, min: null, max: null }, 'the editor opens on Auto');
    let y = yGroup(editor);
    assert.ok(y.group, 'the tool row holds the Y range, its tooltip on it');
    assert.equal(y.group.props.style.marginLeft, 'auto', 'at the row\'s right end, over the plot');
    assert.equal(y.label, 'Y');
    assert.equal(y.check.label, ce.yAuto);
    assert.equal(y.check.checked, true);
    assert.ok(y.from.disabled && y.to.disabled, 'with Auto on the fields are greyed');
    assert.deepEqual([y.from.value, y.to.value], [null, null], 'and empty until the plot is drawn');

    editor.setYEnds([0, 12]);
    editor = render();
    y = yGroup(editor);
    assert.deepEqual([y.from.value, y.to.value], [0, 12], 'they show the ends the axis was drawn with');
    assert.equal(editor.yRange.auto, true, 'which does not leave Auto');

    y.check.onChange({ target: { checked: false } });
    editor = render();
    assert.deepEqual(editor.yRange, { auto: false, min: 0, max: 12 },
        'clearing Auto starts from the ends on screen, so the plot does not move');
    y = yGroup(editor);
    assert.ok(!y.from.disabled && !y.to.disabled);
    y.to.onChange(100);
    editor = render();
    assert.deepEqual(editor.yRange, { auto: false, min: 0, max: 100 });
    y = yGroup(editor);
    assert.deepEqual([y.from.value, y.to.value], [0, 100], 'the fields show the range typed');
    assert.equal(y.from.step, 5, 'the arrows step 5 on 0 to 100, as Optical Evaluation\'s do in %');
    y.from.onChange(0.2);
    y.to.onChange(0.8);
    editor = render();
    assert.equal(yGroup(editor).from.step, 0.05, 'and 0.05 on a span under 1');

    yGroup(editor).check.onChange({ target: { checked: true } });
    editor = render();
    y = yGroup(editor);
    assert.equal(editor.yRange.auto, true, 'ticking Auto again lets the axis fit itself');
    assert.ok(y.from.disabled, 'and greys the fields');

    // The editor is opened again: mounted afresh, it is on Auto again.
    editor.setYAuto(false);
    assert.equal(render().yRange.auto, false);
    runtime.reset();
    assert.equal(render().yRange.auto, true, 'the range is not kept between openings');
}

console.log('PASS: curve_editor_y_range');
