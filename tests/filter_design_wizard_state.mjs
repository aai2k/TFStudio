/**
 * Filter Design wizard state helpers: the materials and the specification it
 * carries over to the next time it is opened, and the step-5 candidate history
 * it keeps across search runs.
 *
 * Run: node tests/filter_design_wizard_state.mjs
 */
import { shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();

const { rememberSetting, rememberedSettings, mergeCandidates, candidateKey, DEFAULTS } =
    await import('../src/components/windows/optimization/filterDesignWizard/model.js');

let fails = 0;
const ok = (c, m) => { if (!c) { console.error('FAIL:', m); fails++; } };

const KEY = 'filterDesign.settings';
const KNOWN = new Set(['user:Ta2O5', 'user:SiO2', 'user:Fused', 'builtin:Air']);
const resolve = (id) => (KNOWN.has(id) ? { getNK: () => [1.5, 0] } : null);

// ── nothing stored → nothing to carry over ───────────────────────────────────
localStorage.removeItem(KEY);
ok(Object.keys(rememberedSettings(resolve)).length === 0, 'a fresh install remembers nothing');

// ── a pick is carried over ───────────────────────────────────────────────────
rememberSetting('matH', 'user:Ta2O5');
rememberSetting('matL', 'user:SiO2');
rememberSetting('substrateMaterial', 'user:Fused');
rememberSetting('incidentMedium', 'builtin:Air');
const back = rememberedSettings(resolve);
ok(back.matH === 'user:Ta2O5', `matH carried over (got ${back.matH})`);
ok(back.matL === 'user:SiO2', `matL carried over (got ${back.matL})`);
ok(back.substrateMaterial === 'user:Fused', `substrate carried over (got ${back.substrateMaterial})`);
ok(back.incidentMedium === 'builtin:Air', `incident medium carried over (got ${back.incidentMedium})`);

// ── the page-2 specification is carried over too ───────────────────
for (const [key, value] of [['lambda0_nm', 1530], ['passHalf_nm', 7.5], ['stopHalf_nm', 10], ['passLevel', 89.13], ['stopLevel', 0.1]]) {
    rememberSetting(key, value);
    ok(rememberedSettings(resolve)[key] === value, `${key} carried over (got ${rememberedSettings(resolve)[key]})`);
}
const opened = { ...DEFAULTS, ...rememberedSettings(resolve) };
ok(opened.matH === 'user:Ta2O5' && opened.lambda0_nm === 1530 && opened.stopHalf_nm === 10,
    'the wizard opens on the materials and the specification it was last used with');
ok(opened.cavities === DEFAULTS.cavities && opened.arMode === DEFAULTS.arMode,
    'everything else still opens on its defaults');

// ── only the listed fields are remembered ───────────────────────
rememberSetting('restarts', 40);
ok(rememberedSettings(resolve).restarts === undefined, 'a field outside the list is not stored');
rememberSetting('lambda0_nm', 'not a number');
ok(rememberedSettings(resolve).lambda0_nm === 1530, 'a non-numeric value cannot overwrite a number');

// ── a material the catalogs no longer hold is dropped ────────────────
rememberSetting('matH', 'user:Deleted');
const afterDelete = rememberedSettings(resolve);
ok(afterDelete.matH === undefined, 'an unresolvable id is dropped rather than offered');
ok(afterDelete.matL === 'user:SiO2', 'the other picks survive it');
ok(afterDelete.lambda0_nm === 1530, 'and so does the specification');

// ── a corrupt store does not break the wizard ────────────────────
localStorage.setItem(KEY, 'not json');
ok(Object.keys(rememberedSettings(resolve)).length === 0, 'a corrupt store reads as empty');
rememberSetting('matL', 'user:SiO2');
ok(rememberedSettings(resolve).matL === 'user:SiO2', 'and is overwritten by the next pick');

localStorage.removeItem(KEY);

// ── step-5 candidate history ───────────────────────────────────
// The list survives a second run so a user can try a seed, try another and
// compare the two. Structures already in it are not repeated.
const cand = (mf, mirrors, spacers) => ({ mf, mirrors, spacers, layers: mirrors.reduce((a, g) => a + g, 0) + spacers.length, thicknessNm: 100 * mf });
const runOne = [cand(0.5, [7, 15, 7], [3, 3]), cand(2.0, [5, 11, 5], [1, 1])];
const runTwo = [cand(0.2, [9, 19, 9], [2, 2]), cand(2.0, [5, 11, 5], [1, 1])];

ok(mergeCandidates([], runOne).length === 2, 'the first run fills an empty history');
const both = mergeCandidates(mergeCandidates([], runOne), runTwo);
ok(both.length === 3, `two runs sharing one structure leave three rows (got ${both.length})`);
ok(both.map(c => c.mf.toFixed(1)).join() === '0.2,0.5,2.0', `the history stays sorted by merit (got ${both.map(c => c.mf).join()})`);
ok(both.some(c => candidateKey(c) === '7,15,7|3,3'), "the first run's best is still there after the second run");
ok(mergeCandidates(both, runTwo).length === 3, 'replaying a run adds nothing');
ok(mergeCandidates(both, null).length === 3, 'a run that reported nothing leaves the history alone');
// Structures differing only in their spacers are distinct candidates.
ok(candidateKey(cand(1, [9, 19, 9], [2, 2])) !== candidateKey(cand(1, [9, 19, 9], [2, 3])), "the spacer vector is part of a candidate's identity");

if (fails === 0) console.log('All wizard-state tests passed.');
else { console.error(`\n${fails} assertion(s) failed.`); process.exit(1); }
