/**
 * How the merit tables show a value read at a default step where a row has a
 * Step of its own (optimization/useMeritValues.js): faded, with ≈ before it and
 * a tooltip, in the row's Current cell, on every share when the MF can change,
 * on the Merit Function Editor's MF and OMF, and on the Refinement window's MF. An error is shown as an error, a row
 * without a value as a dash, and a value that is final unmarked.
 *
 * Run: node tests/merit_provisional_marks.mjs
 */
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals, withDesign } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();
const { MFTable } = await import('../src/components/windows/optimization/meritFunctionEditor/mfTable/MFTable.js');
const { WizardHeader } = await import('../src/components/windows/optimization/meritFunctionEditor/WizardHeader.js');
const { ControlBar } = await import('../src/components/windows/optimization/refinement/ControlBar.js');

const c = makeTheme();
const t = makeLocale();
const te = t.meritFunctionEditor;
const noop = () => {};
const row = (id, type, extra = {}) => ({
    id, type, enabled: true, lambdaStart: 530, lambdaEnd: 590, aoi: 0, pol: 'avg', target: 0.5, weight: 1, ...extra,
});
const escaped = text => text.replace(/'/g, '&#x27;');

// ── The Current cell ─────────────────────────────────────────────────────────
{
    const operands = [
        row('peak', 'TMX', { flag: 3, target: 1 }), row('average', 'TAV'),
        row('broken', 'TMX', { flag: 3 }), row('empty', 'TMX', { flag: 3 }),
    ];
    const html = renderToStaticMarkup(React.createElement(MFTable, {
        operands, computed: [0.75, 0.4, 0.2, null], evaluationErrors: [null, null, 'TiO2: out of range', null],
        provisional: [true, false, true, true], selectedId: null, noOperandsMsg: '',
        onSelect: noop, onEdit: noop, onAdd: noop, onInsertAt: noop, onDuplicate: noop, onDelete: noop,
        onMoveUp: noop, onMoveDown: noop, c, t,
    }));
    const at = html.indexOf('>≈ 75.000 %</td>');
    assert.ok(at > 0, 'a marked row reads ≈ before its value');
    const cell = html.slice(html.lastIndexOf('<td', at), at);
    assert.ok(cell.includes('opacity:0.6'), 'faded');
    assert.ok(cell.includes(`title="${escaped(te.provisionalTip)}"`), 'with the tooltip');
    assert.ok(html.includes('>40.000 %</td>'), 'a row read at its own step is not marked');
    assert.equal((html.match(/≈[^<]*<\/td>/g) || []).length, 1, 'nor is an error or a row without a value');
    const shares = html.match(/>≈ [^<]*<\/span>/g) || [];
    assert.equal(shares.length, 3, 'every share of the marked MF is marked too');

    const plain = renderToStaticMarkup(React.createElement(MFTable, {
        operands: [row('peak', 'TMX', { flag: 3, target: 1, weight: 0 }), row('average', 'TAV')],
        computed: [0.75, 0.4], evaluationErrors: [], provisional: [true, false], selectedId: null, noOperandsMsg: '',
        onSelect: noop, onEdit: noop, onAdd: noop, onInsertAt: noop, onDuplicate: noop, onDelete: noop,
        onMoveUp: noop, onMoveDown: noop, c, t,
    }));
    assert.ok(!/>≈ [^<]*<\/span>/.test(plain), 'a marked row without a weight leaves the shares unmarked');
}

// ── The editor's MF and OMF ──────────────────────────────────────────────────
{
    const header = provisional => renderToStaticMarkup(withDesign(React.createElement(WizardHeader, {
        open: false, onToggle: noop, summary: '', mf: 0.123456, omf: 0.05, mfProvisional: provisional, busy: false, c, t, te,
    })));
    const marked = header(true);
    assert.ok(marked.includes('≈ 0.123456') && marked.includes('≈ 0.050000'), 'both are marked');
    assert.ok(marked.includes(escaped(te.provisionalTip)), 'with the tooltip');
    assert.ok(marked.includes(`title="${escaped(te.omfTip)}\n${escaped(te.provisionalTip)}"`)
        || marked.includes(`title="${escaped(te.omfTip)}&#10;${escaped(te.provisionalTip)}"`), 'the OMF keeps its own tooltip first');
    assert.ok(!header(false).includes('≈'), 'a final value is not');
}

// ── The Refinement window's MF ───────────────────────────────────────────────
{
    const bar = (props) => renderToStaticMarkup(withDesign(React.createElement(ControlBar, {
        running: false, iter: 0, mf: 0.123456, mfBest: null, mfInitial: null, canReset: false,
        method: 'sqp', nRestarts: 20, perturbPct: 30, restartIdx: 0, maxIter: 200, stopReason: null,
        surfaceMode: 'front_only', mfEvalMode: 'side',
        onRun: noop, onStop: noop, onReset: noop, onBest: noop,
        onMethod: noop, onNRestarts: noop, onPerturbPct: noop, onMaxIter: noop,
        t, c, ...props,
    })));
    const marked = bar({ mfProvisional: true });
    assert.ok(marked.includes('≈ 0.123456'), 'the MF is marked');
    assert.ok(marked.includes(escaped(te.provisionalTip)), 'with the tooltip');
    assert.ok(!bar({ mfProvisional: false }).includes('≈'), 'a final MF is not');
    assert.ok(bar({ evaluating: true }).includes(te.evaluating), 'the cone evaluation under way is said');
}

console.log('PASS: merit_provisional_marks');
