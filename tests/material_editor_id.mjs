/**
 * A material's ID is shown in the Material Editor, never typed.
 *
 * The form offered the ID as a field under the name, where the eye lands
 * first, so a new material could get its name typed into the ID. The ID is
 * now made from the name when the material is first saved, unique in its
 * catalog, and a saved material keeps the ID designs refer to it by.
 *
 * Run: node tests/material_editor_id.mjs
 */

import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const { initCatalogs, getCatalogs } = await import('../src/utils/materials/catalogManager.js');
const { emptyDraft, materialToDraft } = await import('../src/components/windows/design/materialEditor/materialDraft.js');
const { draftSaveId, saveMaterial } =
    await import('../src/components/windows/design/materialEditor/materialEditorMaterialActions.js');
const { UserMaterialForm } = await import('../src/components/windows/design/materialEditor/userMaterialForm.js');

const film = {
    id: 'SiO2_film', name: 'SiO2 film', formulaNum: -1, tabData: [[400, 1.47, 0], [800, 1.45, 0]],
    lambdaMin: 0.4, lambdaMax: 0.8, coefficients: [], kTable: [],
};
initCatalogs({ user_lab: { id: 'user_lab', name: 'Lab', source: 'user', materials: { SiO2_film: film } } });

const rows = [{ _key: 1, lam: '400', n: '1.47', k: '0' }, { _key: 2, lam: '800', n: '1.45', k: '0' }];
const newDraft = name => ({ ...emptyDraft('user_lab'), name, rows });
const renamed = { ...materialToDraft('user_lab', film), name: 'Silica film, run 7' };

// ── The ID a draft is saved under ────────────────────────────────────────────

assert.equal(draftSaveId(newDraft('Ta2O5 film')), 'Ta2O5_film', 'a new material takes its ID from its name');
assert.equal(draftSaveId(newDraft('SiO2 film')), 'SiO2_film_2', 'made unique in its catalog rather than refused');
assert.equal(draftSaveId(newDraft('Оксид циркония')), 'material', 'a name with no Latin letters still gets an ID');
assert.equal(draftSaveId(renamed), 'SiO2_film', 'a saved material keeps its ID when renamed');

// ── The form shows it and offers nothing to type into ───────────────────────

const t = makeLocale();
const me = t.materialEditor;
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const render = draft => renderToStaticMarkup(React.createElement(UserMaterialForm, {
    draft, onChange() {}, onSave() {}, onRevert() {}, onDelete() {},
    dirty: false, catalogs: getCatalogs(), detailTab: 'nk', setDetailTab() {}, c: makeTheme(), t,
}));

const fresh = render(newDraft('Ta2O5 film'));
assert.ok(fresh.includes('>Ta2O5_film<'), 'the form shows the ID the material will be saved under');
assert.ok(!/<input[^>]*value="Ta2O5_film"/.test(fresh), 'as text, not as a field');
assert.ok(fresh.includes(`title="${esc(me.materialIdTip)}"`), 'and says where it comes from');
assert.ok(!render(newDraft('')).includes('>material<'), 'a new material with no name shows no ID yet');
assert.ok(render(renamed).includes('>SiO2_film<'), 'a saved material shows its own ID');

// ── Saving a name another material already has ──────────────────────────────

const notices = [];
saveMaterial({
    editDraft: newDraft('SiO2 film'), catalogs: getCatalogs(), me,
    notify: kind => notices.push(kind), loadCatalogs() {}, setEditDraft() {},
});
assert.deepEqual(notices, ['ok'], 'it saves without an error to correct');
const lab = getCatalogs().find(cat => cat.id === 'user_lab');
assert.equal(lab.materials.SiO2_film_2?.name, 'SiO2 film', 'under the unique ID');
assert.equal(lab.materials.SiO2_film.tabData.length, 2, 'and the material that had the name is untouched');

console.log('material_editor_id: passed');
