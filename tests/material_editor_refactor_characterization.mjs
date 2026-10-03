/**
 * Unit — Material Editor / RIIBrowser refactor characterization.
 *
 * Pins pure helpers that moved during the materialEditor/ decomposition
 * (MaterialEditor.js + RIIBrowser.js split into a hook + small render/action
 * modules; see useMaterialEditor.js, useRIIBrowser.js):
 *   - riiRightPanel.js: wlRange (the span that will be sampled, and the no-data
 *     fallback) and typeLabel (what the samples come from, unknown passthrough).
 *   - riiEffects.js: toggleInSet (immutable Set toggle used by the shelf/book
 *     tree expand/collapse state).
 *
 * Run: node tests/material_editor_refactor_characterization.mjs
 */

import { shimBrowserGlobals } from './_uiShim.mjs';

// riiRightPanel.js references the global `React` (house convention — no per-file
// import; loaded as a UMD vendor global in the real app), so it must be shimmed
// before the module loads.
shimBrowserGlobals();

const { wlRange, typeLabel } = await import('../src/components/windows/design/materialEditor/riiRightPanel.js');
const { toggleInSet } = await import('../src/components/windows/design/materialEditor/riiEffects.js');

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } else { console.log('  ✓', msg); } };

// ── wlRange ─────────────────────────────────────────────────────────────────
// wlRange reports the span that will be sampled, so the panel agrees with the
// chart beside it and with what an import stores. It used to print the record's
// declared range in preference to its data, which for an infrared record was a
// range fifty times wider than the one that arrived. See tests/rii_sampled_range.mjs.
ok(wlRange({ tableNK: [[300, 1.5, 0], [1000, 1.4, 0]] }) === '300–1000 nm', 'wlRange: a table reads its own span');
ok(wlRange({ tableNK: [[200.4, 1.5, 0], [2500.6, 1.4, 0]] }) === '200–2501 nm', 'wlRange: rounds to nearest nm');
ok(wlRange({ wavelengthRange: [200, 2500], tableNK: [[300, 1.5, 0]] }) === '300–300 nm', 'wlRange: the data wins over the declared range');
ok(wlRange({ tableNK: [[500, 2.1, 0], [900000, 2.6, 0]] }) === '500–900000 nm', 'wlRange: a page running to 0.9 mm is offered whole');
ok(wlRange({ tableNK: [[27.5043, 1.5, 0], [125141, 1.4, 0]] }) === '27.5–125141 nm', 'wlRange: below 100 nm it keeps a decimal');
ok(wlRange({ wavelengthRange: [200.4, 2500.6] }) === '—', 'wlRange: a declared range with no data behind it is not a span');
ok(wlRange({}) === '—', 'wlRange: no data → em dash placeholder');
ok(wlRange({ tableNK: [] }) === '—', 'wlRange: empty tableNK → em dash placeholder');

// ── typeLabel ───────────────────────────────────────────────────────────────
// Names what the samples come from: a formula page by its number and the
// database's name for it, and the k table it carries beside it.
const { getLocale } = await import('../src/constants/locales/index.js');
const rii = getLocale('en').riiDatabase;
const table = [[300, 1.5, 0]];
ok(typeLabel({ type: 'tabulated_nk', tableNK: table }, rii) === 'Tabulated n,k', 'typeLabel: tabulated_nk');
ok(typeLabel({ type: 'tabulated_n', tableNK: table }, rii) === 'Tabulated n', 'typeLabel: tabulated_n');
ok(typeLabel({ type: 'tabulated_n', tableNK: table, tableK: [[300, 0.1]] }, rii) === 'Tabulated n,k',
    'typeLabel: an n table with a separate k table samples both');
ok(typeLabel({ type: 'formula', riiFormulaNum: 6 }, rii) === 'Formula 6, Gases', 'typeLabel: formula 6 by name');
ok(typeLabel({ type: 'formula', riiFormulaNum: 2, tableK: [[500, 1e-4]] }, rii) === 'Formula 2, Sellmeier-2, tabulated k',
    'typeLabel: a formula with a k table says so');
ok(typeLabel({ type: 'formula', riiFormulaNum: 10 }, rii) === 'Formula 10', 'typeLabel: a formula number with no name');
ok(typeLabel({ type: 'mixed', riiFormulaNum: 5, tableNK: table }, rii) === 'Tabulated n,k',
    'typeLabel: a page with a table and a formula is sampled from the table, and says so');
ok(typeLabel({ type: 'something_else' }, rii) === 'something_else', 'typeLabel: unknown type passes through verbatim');

// ── toggleInSet ─────────────────────────────────────────────────────────────
const empty = new Set();
const added = toggleInSet(empty, 'a');
ok(added.has('a') && added.size === 1, 'toggleInSet: adds a missing key');
ok(empty.size === 0, 'toggleInSet: does not mutate the input set');

const removed = toggleInSet(added, 'a');
ok(!removed.has('a') && removed.size === 0, 'toggleInSet: removes a present key');
ok(added.has('a'), 'toggleInSet: does not mutate the input set (remove case)');

const twoKeys = toggleInSet(toggleInSet(new Set(), 'x'), 'y');
ok(twoKeys.has('x') && twoKeys.has('y') && twoKeys.size === 2, 'toggleInSet: chained toggles accumulate keys');

if (fails) { console.error(`\n${fails} test(s) FAILED`); process.exit(1); }
console.log('\nAll tests passed.');
