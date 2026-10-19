/**
 * Generate MF names the checks it writes no merit row for.
 *
 * FWHM, EDGE_LAMBDA, THICKNESS_BUDGET and LAYER_COUNT have no row, nor has a
 * PPEF check whose curve the design does not hold. Generate MF replaces the
 * merit function, so the Specification window names these checks beside the
 * button; a merit of 0 then is not read as every check met.
 *
 * Checks:
 *   1. checksWithoutRow lists exactly those checks, enabled ones only.
 *   2. Every language has the note, taking the list of names.
 *   3. The Specification window's bar shows the note with the checks' names
 *      when the list holds such a check, and nothing when it holds none.
 *
 * Run: node tests/generate_mf_checks_without_row.mjs
 */
globalThis.React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }) };
const { makeQualifier, checksWithoutRow, qualifiersToMFOperands } = await import('../src/utils/synthesis/qualifiers.js');
const { localeSources } = await import('../src/constants/locales/index.js');
const { VerdictBar } = await import('../src/components/windows/design/specification/VerdictBar.js');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};

const written = ['T_AVG', 'R_AVG', 'T_AT', 'MIN_MAX', 'INTEGRAL', 'CENTRAL_LAMBDA'].map(kind => makeQualifier({ kind }));
const unwritten = ['FWHM', 'EDGE_LAMBDA', 'THICKNESS_BUDGET', 'LAYER_COUNT'].map(kind => makeQualifier({ kind }));
const ppefWithoutCurve = makeQualifier({ kind: 'PPEF', curveId: 'missing' });
const disabled = makeQualifier({ kind: 'FWHM', enabled: false });
const all = [...written, ...unwritten, ppefWithoutCurve, disabled];

const left = checksWithoutRow(all, { design: { measuredCurves: [] } });
ok('the checks without a row are named', left.map(q => q.kind).join() === 'FWHM,EDGE_LAMBDA,THICKNESS_BUDGET,LAYER_COUNT,PPEF',
    left.map(q => q.kind).join());
ok('every other check gets a row', written.every(q => qualifiersToMFOperands([q]).length > 0));

for (const [lang, t] of Object.entries(localeSources)) {
    const note = t.specification?.noMFRow;
    ok(`${lang}: the note names the checks`, typeof note === 'function' && note(['FWHM', 'LAYER']).includes('FWHM') && note(['FWHM', 'LAYER']).includes('LAYER'), lang);
}

// The note as the bar renders it, with the window's own props.
const ts = localeSources.en.specification;
const c = { textDim: '#888', warning: '#e0a030', success: '#4caf50', error: '#ef5350', panel: '#fff', border: '#ccc' };
const noteOf = qualifiers => {
    const bar = VerdictBar({ verdict: { passing: 0, total: qualifiers.length, allPass: false }, c, ts, qualifiers, generateMF: () => {}, design: null, t: localeSources.en });
    const slot = bar.children.find(child => child && child.type?.name === 'NoRowNote');
    const shown = slot && slot.type(slot.props);
    return shown ? shown.children.join('') : '';
};
const shownNote = noteOf([...written, ...unwritten.slice(0, 1), makeQualifier({ kind: 'LAYER_COUNT' })]);
ok('the bar names the checks without a row', shownNote.includes(ts.kinds.FWHM) && shownNote.includes(ts.kinds.LAYER_COUNT), shownNote);
ok('and shows nothing when every check gets a row', noteOf(written) === '', noteOf(written));

console.log(`${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
