/**
 * The Refinement window's Design History groups its rows by the Run press that
 * made them.
 *
 * Every method a Try all run finished used to add a row labelled with the
 * method alone, in the order they finished, so a second Try all put five more
 * CG, DLS, DE rows next to the first five with nothing to say which run each
 * came from or which did best. Now each run has a heading, "Run #3 · Try all ·
 * best: Conjugate Gradient", its rows go best merit first, and the newest run
 * is on top.
 *
 * Run: node tests/refinement_history_runs.mjs
 */
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';
import { availableLocales, getLocale } from '../src/constants/locales/index.js';

shimBrowserGlobals();
await loadApp();
const { HistoryPanel, historyGroups, runHeading } = await import(
    '../src/components/windows/optimization/refinement/HistoryPanel.js');

const t = makeLocale();
const tr = t.refinement;
const c = makeTheme();
const row = (id, runNum, runMethod, method, mf) => ({
    id, runNum, runMethod, method, mf, label: tr.methods[method], iter: 10, layerCount: 4, mfHistory: [mf],
});
// Two Try all runs and a single DLS run between them, in the order recorded.
const entries = [
    row('a1', 1, 'all', 'cg', 0.03), row('a2', 1, 'all', 'dls', 0.01), row('a3', 1, 'all', 'de', 0.02),
    row('b1', 2, 'dls', 'dls', 0.05),
    row('c1', 3, 'all', 'cg', 0.004), row('c2', 3, 'all', 'dls', 0.006),
];

// ── Groups ───────────────────────────────────────────────────────────────────
{
    const groups = historyGroups(entries);
    assert.deepEqual(groups.map(g => g.runNum), [3, 2, 1], 'the newest run is on top');
    assert.deepEqual(groups[2].rows.map(r => r.id), ['a2', 'a3', 'a1'], 'a run lists its methods best merit first');
    assert.deepEqual(groups[0].rows.map(r => r.id), ['c1', 'c2']);
    assert.equal(groups[1].runMethod, 'dls');

    // Rows recorded before runs were numbered come last, newest first, with no heading.
    const old = [{ ...row('o1'), runNum: undefined, mf: 0.1 }, { ...row('o2'), runNum: undefined, mf: 0.2 }];
    const mixed = historyGroups([...old, ...entries]);
    assert.deepEqual(mixed.at(-1).rows.map(r => r.id), ['o2', 'o1']);
    assert.equal(runHeading(mixed.at(-1), tr), null);
}

// ── Headings ─────────────────────────────────────────────────────────────────
{
    const [third, second, first] = historyGroups(entries);
    assert.equal(runHeading(first, tr), `${tr.history.run(1)} · ${tr.history.tryAll} · ${tr.bestLabel} ${tr.methods.dls}`,
        'a Try all run names the method that did best');
    assert.equal(runHeading(third, tr), `${tr.history.run(3)} · ${tr.history.tryAll} · ${tr.bestLabel} ${tr.methods.cg}`);
    assert.equal(runHeading(second, tr), `${tr.history.run(2)} · ${tr.methods.dls}`, 'a one-method run names its method only');
    const list = historyGroups([row('l1', 4, ['cg', 'sa'], 'sa', 0.2), row('l2', 4, ['cg', 'sa'], 'cg', 0.1)])[0];
    assert.equal(runHeading(list, tr), `${tr.history.run(4)} · ${tr.methods.cg} + ${tr.methods.sa} · ${tr.bestLabel} ${tr.methods.cg}`,
        'a list of methods reads as their names');
    for (const { code } of availableLocales) {
        const tryAll = getLocale(code).refinement.history.tryAll;
        assert.ok(tryAll && !/[—:]/.test(tryAll), `${code}: Try all has a short name: ${tryAll}`);
    }
}

// ── The panel ────────────────────────────────────────────────────────────────
{
    const html = renderToStaticMarkup(React.createElement(HistoryPanel, {
        entries, selectedId: null, onSelect: () => {}, onRestore: () => {}, c, t,
    }));
    const order = [
        runHeading(historyGroups(entries)[0], tr), tr.methods.cg, tr.methods.dls,
        runHeading(historyGroups(entries)[1], tr),
        runHeading(historyGroups(entries)[2], tr), '0.010000', '0.020000', '0.030000',
    ];
    let at = 0;
    for (const text of order) {
        const next = html.indexOf(text, at);
        assert.ok(next >= 0, `the panel shows "${text}" after what comes before it`);
        at = next + text.length;
    }
    assert.equal((html.match(/>Restore</g) || []).length, entries.length, 'every row keeps its Restore');
}

console.log('PASS: refinement_history_runs');
