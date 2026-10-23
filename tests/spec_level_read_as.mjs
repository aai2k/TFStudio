/**
 * A FWHM or edge check reads its crossing level inside 0.001 to 0.999, and the
 * Specification window says so when the level typed lies outside that.
 *
 * Checks, on a corpus design and on checks made as the Specification window
 * makes and edits them:
 *   1. A FWHM and an edge check at level 1.5 and at -0.2 show, beside the
 *      level field, the level the scan reads (0.999 and 0.001); at 0.5 they
 *      show nothing.
 *   2. An edge check at level 1.5 gives the value the same check gives at
 *      0.999, the level the note names.
 *
 * Run: node tests/spec_level_read_as.mjs
 */
import { createRequire } from 'node:module';
import { fixtureFile } from './_apiCorpus.mjs';

const require = createRequire(import.meta.url);
globalThis.React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const api = await import('../src/api/index.js');
const { getLocale } = await import('../src/constants/locales/index.js');
const { dispatchAnalysisEvaluation } = await import('../src/utils/workers/analysisEvaluationWorker.js');
const { embedDesignMaterials, withHerpinRecords } = await import('../src/utils/materials/designMaterials.js');
const { addQualifierTo, updateQualifierIn } = await import('../src/components/windows/design/specification/useSpecificationState.js');
const { QRow } = await import('../src/components/windows/design/specification/QRow.js');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};

await api.init();
const bare = api.openDesign(fixtureFile('front-only-total-mode'));
const t = getLocale('en');
const c = { bg: '#1e1e1e', panel: '#252526', text: '#e0e0e0', textDim: '#9a9a9a', border: '#3c3c3c',
    accent: '#0a84ff', error: '#f14c4c', warning: '#e0a030', success: '#3fb950', hover: '#2f2f2f' };

// A check of `kind` as the window adds one, with `fields` typed into it.
function windowCheck(kind, fields) {
    let qualifiers = [];
    const write = next => { qualifiers = next; };
    addQualifierTo(qualifiers, write, () => {}, kind, bare);
    updateQualifierIn(qualifiers, write, qualifiers[0].id, fields, bare);
    return qualifiers[0];
}

const rowHtml = q => renderToStaticMarkup(React.createElement(QRow, {
    q, r: null, c, ts: t.specification, units: t.units,
    updateQualifier: () => {}, removeQualifier: () => {}, integralPresets: [], measuredCurves: [],
}));

// ── 1. The note beside the level field ─────────────────────────────────────
for (const kind of ['FWHM', 'EDGE_LAMBDA']) {
    for (const [level, used] of [[1.5, 0.999], [-0.2, 0.001], [0.5, null]]) {
        const html = rowHtml(windowCheck(kind, { level }));
        const note = t.specification.levelUsedAs(used ?? 0.5);
        ok(`${kind} at level ${level}: ${used === null ? 'no note' : `the row says it reads ${used}`}`,
            html.includes(note) === (used !== null), note);
    }
}

// ── 2. The note names the level the scan reads ─────────────────────────────
const checks = [windowCheck('EDGE_LAMBDA', { level: 1.5 }), windowCheck('EDGE_LAMBDA', { level: 0.999 })];
const design = api.setSpecification(bare, checks);
const [typed, named] = dispatchAnalysisEvaluation('specification', { designs: [embedDesignMaterials(withHerpinRecords(design))] })[0];
ok('an edge check at 1.5 gives the value it gives at 0.999',
    Number.isFinite(typed.value) && typed.value === named.value, `${typed.value} vs ${named.value}`);

console.log(`${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
