/**
 * Unit — Material Editor / RIIBrowser refactor characterization.
 *
 * Pins pure helpers that moved during the materialEditor/ decomposition
 * (MaterialEditor.js + RIIBrowser.js split into a hook + small render/action
 * modules; see useMaterialEditor.js, useRIIBrowser.js):
 *   - riiRightPanel.js: wlRange (wavelengthRange / tableNK / no-data fallback)
 *     and typeLabel (known RII material types + unknown passthrough).
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
ok(wlRange({ wavelengthRange: [200.4, 2500.6] }) === '200–2501 nm', 'wlRange: wavelengthRange rounds to nearest nm');
ok(wlRange({ tableNK: [[300, 1.5, 0], [1000, 1.4, 0]] }) === '300–1000 nm', 'wlRange: falls back to tableNK span');
ok(wlRange({ wavelengthRange: [200, 2500], tableNK: [[300, 1.5, 0]] }) === '200–2500 nm', 'wlRange: wavelengthRange takes priority over tableNK');
ok(wlRange({}) === '—', 'wlRange: no data → em dash placeholder');
ok(wlRange({ tableNK: [] }) === '—', 'wlRange: empty tableNK → em dash placeholder');

// ── typeLabel ───────────────────────────────────────────────────────────────
ok(typeLabel('tabulated_nk') === 'Tabulated n,k', 'typeLabel: tabulated_nk');
ok(typeLabel('tabulated_n') === 'Tabulated n', 'typeLabel: tabulated_n');
ok(typeLabel('formula') === 'Dispersion formula', 'typeLabel: formula');
ok(typeLabel('mixed') === 'Formula + tabulated k', 'typeLabel: mixed');
ok(typeLabel('something_else') === 'something_else', 'typeLabel: unknown type passes through verbatim');

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
