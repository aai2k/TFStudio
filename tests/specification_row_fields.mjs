/**
 * The Step and side fields of a Specification row.
 *
 * Checks:
 *   1. A Min / Max or Central λ check on a peak, and a FWHM or edge check,
 *      shows a Step select: the default 1 nm, then 0.1, 0.01 and 0.001 nm. An
 *      average or integral check shows auto (the design's fringe grid), then
 *      1, 0.1, 0.01 and 0.001 nm. A check on a dip, at one wavelength, on a
 *      thickness, a layer count or a curve shows none. Each says what its Step
 *      does.
 *   2. Picking a step sets the check's flag, and the default clears it. A
 *      provisional result shows faded, with ≈ before its value, and says why.
 *   3. A thickness budget or layer count shows a side select of front, back
 *      and both, both for a check saved without a side; picking one sets it.
 *      No other kind shows one.
 *   4. A thickness budget or layer count added, or a row switched to one,
 *      starts at the side the design coats unless it names one; Ins below a
 *      check copies its Step and its side, and every other field but its id
 *      and label: an integral check's preset, source and detector, an = check's
 *      tolerance, a range check's limits and a PPEF check's curve.
 *
 * Run: node tests/specification_row_fields.mjs
 */
import { isDeepStrictEqual } from 'node:util';

globalThis.React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    createContext: value => ({ Provider: 'Provider', Consumer: 'Consumer', _currentValue: value }),
};
const { makeQualifier } = await import('../src/utils/synthesis/qualifiers.js');
const { localeSources } = await import('../src/constants/locales/index.js');
const { QRow } = await import('../src/components/windows/design/specification/QRow.js');
const { Field } = await import('../src/components/windows/design/specification/fields.js');
const { addQualifierTo, updateQualifierIn, insertQualifierInto } = await import('../src/components/windows/design/specification/useSpecificationState.js');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};

const t = localeSources.en;
const ts = t.specification;
const c = { textDim: '#888', text: '#000', success: '#4caf50', error: '#ef5350', panel: '#fff', border: '#ccc', bg: '#fff', accent: '#06c' };

// Every element of a rendered tree, children of children included.
function elements(node, out = []) {
    if (Array.isArray(node)) { node.forEach(child => elements(child, out)); return out; }
    if (!node || typeof node !== 'object') return out;
    out.push(node);
    elements(node.children, out);
    return out;
}
const textOf = node => (Array.isArray(node) ? node.map(textOf).join('') : node && typeof node === 'object' ? textOf(node.children) : String(node ?? ''));

// The row as the window renders it, with the field labelled `label` and the
// patch an edit sends.
function rowOf(fields, label = ts.step) {
    const q = makeQualifier(fields);
    const patches = [];
    const tree = QRow({ q, r: null, c, ts, units: t.units, updateQualifier: (id, patch) => patches.push(patch), removeQualifier: () => {} });
    const field = elements(tree).find(node => node.type === Field && node.props.label === label);
    const select = field && elements(field.children).find(node => node.type === 'select');
    return { field, select, patches };
}

// ── 1. Which rows show a Step ────────────────────────────────────────────────
{
    const peak = rowOf({ kind: 'MIN_MAX', channel: 'T', direction: 'max' });
    const options = elements(peak.select?.children).filter(node => node.type === 'option');
    ok('a Min / Max check on a peak shows a Step', !!peak.select);
    ok('with 1 nm by default and three finer steps',
        options.map(o => o.props.value).join() === ',2,3,4' && textOf(options[0]) === `1 ${t.units.nm}` && textOf(options[3]) === `0.001 ${t.units.nm}`,
        options.map(o => `${o.props.value}:${textOf(o)}`).join(' '));
    ok('a Central λ check on a peak shows one', !!rowOf({ kind: 'CENTRAL_LAMBDA', channel: 'T', direction: 'max' }).select);
    ok('so does a check on the minimum of R', !!rowOf({ kind: 'MIN_MAX', channel: 'R', direction: 'min' }).select);
    ok('a check on a dip shows none', !rowOf({ kind: 'MIN_MAX', channel: 'T', direction: 'min' }).field);
    for (const kind of ['FWHM', 'EDGE_LAMBDA']) {
        const scan = rowOf({ kind });
        ok(`a ${kind} check shows one, from 1 nm`, elements(scan.select?.children).filter(node => node.type === 'option').map(o => o.props.value).join() === ',2,3,4');
        ok(`and says what its Step does`, scan.field.props.tip === ts.stepTips.scan);
    }
    for (const kind of ['T_AVG', 'R_AVG', 'A_AVG', 'INTEGRAL']) {
        const band = rowOf({ kind });
        const bandOptions = elements(band.select?.children).filter(node => node.type === 'option');
        ok(`a ${kind} check shows auto, then 1 nm and finer`,
            bandOptions.map(o => o.props.value).join() === ',1,2,3,4' && textOf(bandOptions[0]) === ts.stepAuto && textOf(bandOptions[1]) === `1 ${t.units.nm}`,
            bandOptions.map(o => `${o.props.value}:${textOf(o)}`).join(' '));
        ok(`${kind}: and says what its Step does`, band.field.props.tip === ts.stepTips.band);
    }
    ok('a peak check says what its Step does', peak.field.props.tip === ts.stepTips.peak);
    ok('none at one wavelength, on a thickness, a layer count or a curve',
        ['T_AT', 'THICKNESS_BUDGET', 'LAYER_COUNT', 'PPEF'].every(kind => !rowOf({ kind }).field));
}

// ── 2. Picking a step ────────────────────────────────────────────────────────
{
    const row = rowOf({ kind: 'MIN_MAX', channel: 'T', direction: 'max', flag: 3 });
    ok('the select shows the check\'s step', row.select.props.value === '3', row.select.props.value);
    row.select.props.onChange({ target: { value: '4' } });
    row.select.props.onChange({ target: { value: '' } });
    ok('a step sets the flag, and the default clears it',
        row.patches[0].flag === 4 && 'flag' in row.patches[1] && row.patches[1].flag === undefined, JSON.stringify(row.patches));
    const badgeOf = r => elements(QRow({ q: makeQualifier({ kind: 'MIN_MAX', flag: 3 }), r, c, ts, units: t.units, updateQualifier: () => {}, removeQualifier: () => {} }))
        .find(node => node.type === 'div' && typeof node.children?.[0] === 'string' && node.children[0].includes('75'));
    const provisional = badgeOf({ value: 0.75, pass: false, unit: '%', provisional: true });
    ok('a provisional result shows ≈ and says why', provisional?.props.title === ts.provisionalTip && provisional.children[0].includes('≈')
        && provisional.props.style.opacity < 1, JSON.stringify(provisional?.children));
    const settled = badgeOf({ value: 0.75, pass: false, unit: '%' });
    ok('a settled one does not', settled && !settled.props.title && !settled.children[0].includes('≈'));
}

// ── 3. The side of a thickness budget or layer count ─────────────────────────
{
    const budget = rowOf({ kind: 'THICKNESS_BUDGET' }, ts.side);
    const options = elements(budget.select?.children).filter(node => node.type === 'option');
    ok('a thickness budget shows a side', !!budget.select);
    ok('of front, back and both', options.map(o => `${o.props.value}:${textOf(o)}`).join()
        === `front:${ts.sideFront},back:${ts.sideBack},both:${ts.sideBoth}`, options.map(o => o.props.value).join());
    ok('a check saved without a side shows both', budget.select.props.value === 'both', budget.select.props.value);
    const count = rowOf({ kind: 'LAYER_COUNT', side: 'back' }, ts.side);
    ok('a layer count shows its side', count.select?.props.value === 'back');
    count.select.props.onChange({ target: { value: 'front' } });
    ok('picking one sets it', count.patches[0]?.side === 'front', JSON.stringify(count.patches));
    ok('no other kind shows a side', ['T_AVG', 'MIN_MAX', 'FWHM'].every(kind => !rowOf({ kind }, ts.side).field));
    const avg = rowOf({ kind: 'T_AVG', flag: 1 });
    ok('an average with a 1 nm Step shows it', avg.select.props.value === '1', avg.select.props.value);
}

// ── 4. New rows and copies ───────────────────────────────────────────────────
{
    const backOnly = { surfaceMode: 'back_only' }, twoSided = { surfaceMode: 'both_independent' };
    let rows = null;
    const setRows = next => { rows = next; };
    addQualifierTo([], setRows, () => {}, 'THICKNESS_BUDGET', backOnly);
    ok('a thickness budget added on a back-only design starts at the back', rows[0].side === 'back', rows[0].side);
    const avg = makeQualifier({ kind: 'T_AVG' });
    updateQualifierIn([avg], setRows, avg.id, { kind: 'LAYER_COUNT' }, twoSided);
    ok('a row switched to a layer count on a two-sided design starts at both', rows[0].side === 'both', rows[0].side);
    const named = makeQualifier({ kind: 'T_AVG', side: 'front' });
    updateQualifierIn([named], setRows, named.id, { kind: 'THICKNESS_BUDGET' }, twoSided);
    ok('a row that names a side keeps it', rows[0].side === 'front', rows[0].side);
    addQualifierTo([], setRows, () => {}, 'T_AVG', backOnly);
    ok('other kinds start with no side', rows[0].side === undefined, rows[0].side);
    const insertBelow = q => insertQualifierInto({ qualifiers: [q], writeQualifiers: setRows, setSelectedId: () => {}, containerRef: { current: null } }, 1, q);
    insertBelow(makeQualifier({ kind: 'MIN_MAX', channel: 'T', direction: 'max', flag: 3 }));
    ok('Ins below a check with a Step copies it', rows[1].flag === 3, String(rows[1].flag));
    insertBelow(makeQualifier({ kind: 'THICKNESS_BUDGET', side: 'back' }));
    ok('and below a budget, its side', rows[1].side === 'back', rows[1].side);
    const sources = [
        makeQualifier({ kind: 'INTEGRAL', presetKey: 'My lamp', presetLabel: 'My lamp', source: { id: 'A' }, detector: { id: 'flat' },
            lambdaStart: 420, lambdaEnd: 680, label: 'Lamp' }),
        makeQualifier({ kind: 'CENTRAL_LAMBDA', cmp: 'eq', target: 1550, tol: 3 }),
        makeQualifier({ kind: 'R_AVG', cmp: 'between', lo: 0.2, hi: 0.4 }),
        makeQualifier({ kind: 'PPEF', curveId: 'curve-1', cmp: 'le', target: 0.5 }),
    ];
    for (const source of sources) {
        insertBelow(source);
        const { id, label, ...copied } = rows[1];
        const { id: _id, label: _label, ...given } = source;
        ok(`Ins below ${source.kind} copies every field but its id and label`,
            isDeepStrictEqual(copied, given) && id !== source.id && label === '', JSON.stringify(rows[1]));
    }
}

console.log(`${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
