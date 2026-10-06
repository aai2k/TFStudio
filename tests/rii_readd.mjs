/**
 * Adding a refractiveindex.info page to a catalog that already holds it.
 *
 * A page's id comes from its path in the database, so the n(α) and n(β) pages
 * of one book, whose names differ only in characters an id drops, get ids of
 * their own, and adding one never replaces the other. Adding a page the
 * catalog already holds says so when nothing changed, and otherwise asks: Replace keeps the id the
 * designs use, Keep both adds a second material with an id and name of its own.
 * A page whose material was deleted comes back under a new id.
 *
 * Run: node tests/rii_readd.mjs
 */
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const cm = await import('../src/utils/materials/catalogManager.js');
const { parseMaterialDoc } = await import('../src/utils/materials/riiDatabase/materialParser.js');
const { addRiiMaterial } = await import('../src/components/windows/design/materialEditor/riiActions.js');
const { renderRiiRightPanel } = await import('../src/components/windows/design/materialEditor/riiRightPanel.js');
const t = makeLocale();
const rii = t.riiDatabase;

cm.initCatalogs({});
const films = cm.createUserCatalog('Films');
const doc = n => ({ REFERENCES: 'ref', COMMENTS: '', DATA: [{ type: 'tabulated nk', data: `0.40 ${n + 0.05} 0\n0.55 ${n} 0\n0.80 ${n - 0.03} 0` }] });
const BOOK = 'BeAl2O4 (Beryllium aluminate, chrysoberyl)';
const ALPHA = { bookName: BOOK, pageName: 'Walling et al. 1980: n(α) 0.25–2.6 µm' };
const BETA = { bookName: BOOK, pageName: 'Walling et al. 1980: n(β) 0.25–2.6 µm' };
const alpha = parseMaterialDoc(doc(1.74), 'main/BeAl2O4/Walling-alpha.yml');
const beta = parseMaterialDoc(doc(1.75), 'main/BeAl2O4/Walling-beta.yml');

function add(mat, selected, choice) {
    const out = { added: [] };
    addRiiMaterial(films.id, {
        mat, selected, rii, onAdded: (catId, name) => out.added.push(name),
        setPhase: phase => { out.phase = phase; }, setAddMsg: msg => { out.msg = msg; },
        setConflict: conflict => { out.conflict = conflict; },
    }, choice);
    return out;
}
const materials = () => cm.getCatalog(films.id).materials;
const n550 = id => cm.getMaterialById(`${films.id}:${id}`).getNK(550)[0];

const first = add(alpha, ALPHA);
assert.equal(first.phase, 'ok');
const alphaId = 'main_BeAl2O4_Walling-alpha';
assert.deepEqual(Object.keys(materials()), [alphaId], 'the id comes from the page path');

// The other page of the book is another material.
add(beta, BETA);
assert.deepEqual(Object.keys(materials()).sort(), [alphaId, 'main_BeAl2O4_Walling-beta'], 'n(β) does not replace n(α)');

// The same page again, unchanged: nothing to do.
const same = add(alpha, ALPHA);
assert.equal(same.phase, 'ok');
assert.equal(same.msg, rii.alreadyInCatalog(materials()[alphaId].name, 'Films'));
assert.equal(Object.keys(materials()).length, 2);

// The user edits it; adding the page again asks first and changes nothing yet.
cm.saveUserMaterial(films.id, { ...materials()[alphaId], name: 'Chrysoberyl alpha (my fit)', tabData: [[400, 1.8, 0], [550, 1.77, 0], [800, 1.75, 0]] });
const asked = add(alpha, ALPHA);
assert.equal(asked.phase, 'conflict');
assert.equal(asked.msg, rii.addConflict('Chrysoberyl alpha (my fit)'));
assert.equal(n550(alphaId), 1.77, 'nothing is replaced before the answer');
assert.deepEqual(asked.conflict, { catId: films.id });

// The bar offers both answers.
{
    const html = renderToStaticMarkup(React.createElement('div', null, renderRiiRightPanel({
        c: makeTheme(), rii, me: t.materialEditor, selected: ALPHA, mat: alpha, matLoading: false, matErr: null,
        sampleTab: 'table', setSampleTab() {}, wavelengthLabel: 'nm',
        phase: 'conflict', addMsg: asked.msg, conflict: asked.conflict, doAdd() {}, setPhase() {}, handleAddClick() {},
    })));
    assert.ok(html.includes(rii.replace) && html.includes(rii.keepBoth), 'Replace and Keep both are offered');
}

// Keep both: a second material, the edit untouched.
const kept = add(alpha, ALPHA, 'keep');
assert.equal(kept.phase, 'ok');
assert.equal(n550(alphaId), 1.77);
const second = `${alphaId}_2`;
assert.ok(materials()[second], 'the page is added under a fresh id');
assert.equal(n550(second), 1.74);
assert.equal(new Set(Object.values(materials()).map(m => m.name)).size, Object.keys(materials()).length, 'names stay distinct');

// Replace: the page data under the id designs already use.
const replaced = add(alpha, ALPHA, 'replace');
assert.equal(replaced.phase, 'ok');
assert.equal(n550(alphaId), 1.74, 'the edit is replaced by the page');
assert.equal(materials()[alphaId].dataPath, 'main/BeAl2O4/Walling-alpha.yml');

// A material an earlier build added under a name-made id is found by its page.
{
    const legacyId = 'BeAl2O4_Beryllium_aluminate_chrysoberyl_Walling_et_al_1980_n_02526_m';
    cm.saveUserMaterial(films.id, { ...materials()[alphaId], id: legacyId, tabData: [[400, 1.9, 0], [550, 1.88, 0], [800, 1.86, 0]] });
    cm.removeUserMaterial(films.id, alphaId);
    cm.removeUserMaterial(films.id, second);
    const legacy = add(alpha, ALPHA);
    assert.equal(legacy.phase, 'conflict', 'the edited legacy copy of the page is found');
    add(alpha, ALPHA, 'replace');
    assert.equal(n550(legacyId), 1.74, 'Replace keeps the legacy id');
    assert.equal(materials()[alphaId], undefined, 'and adds no second copy');
}

// A page added again after its material was deleted gets a new id: a design
// that kept the deleted material under the old one keeps computing with it.
{
    cm.removeUserMaterial(films.id, 'BeAl2O4_Beryllium_aluminate_chrysoberyl_Walling_et_al_1980_n_02526_m');
    const again = add(alpha, ALPHA);
    assert.equal(again.phase, 'ok');
    const ids = Object.keys(materials()).filter(id => materials()[id].dataPath === 'main/BeAl2O4/Walling-alpha.yml');
    assert.equal(ids.length, 1, 'the page is added once');
    assert.ok(![alphaId, second].includes(ids[0]), `under an id no deleted material had, got ${ids[0]}`);
}

console.log('PASS: rii_readd');
