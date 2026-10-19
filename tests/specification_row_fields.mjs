/**
 * The Step field of a Specification row.
 *
 * Checks:
 *   1. A Min / Max or Central λ check on a peak shows a Step select: the
 *      default 1 nm, then 0.1, 0.01 and 0.001 nm. A check on a dip, and every
 *      other kind, shows none.
 *   2. Picking a step sets the check's flag, and the default clears it.
 *
 * Run: node tests/specification_row_fields.mjs
 */
globalThis.React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }) };
const { makeQualifier } = await import('../src/utils/synthesis/qualifiers.js');
const { localeSources } = await import('../src/constants/locales/index.js');
const { QRow } = await import('../src/components/windows/design/specification/QRow.js');
const { Field } = await import('../src/components/windows/design/specification/fields.js');

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

// The row as the window renders it, with the patch an edit sends.
function rowOf(fields) {
    const q = makeQualifier(fields);
    const patches = [];
    const tree = QRow({ q, r: null, c, ts, units: t.units, updateQualifier: (id, patch) => patches.push(patch), removeQualifier: () => {} });
    const field = elements(tree).find(node => node.type === Field && node.props.label === ts.step);
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
    ok('nor does an average, a FWHM or a thickness budget',
        ['T_AVG', 'FWHM', 'THICKNESS_BUDGET'].every(kind => !rowOf({ kind }).field));
}

// ── 2. Picking a step ────────────────────────────────────────────────────────
{
    const row = rowOf({ kind: 'MIN_MAX', channel: 'T', direction: 'max', flag: 3 });
    ok('the select shows the check\'s step', row.select.props.value === '3', row.select.props.value);
    row.select.props.onChange({ target: { value: '4' } });
    row.select.props.onChange({ target: { value: '' } });
    ok('a step sets the flag, and the default clears it',
        row.patches[0].flag === 4 && 'flag' in row.patches[1] && row.patches[1].flag === undefined, JSON.stringify(row.patches));
}

console.log(`${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
