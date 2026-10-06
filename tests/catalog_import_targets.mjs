/**
 * Where imported materials may go, and the names they get there.
 *
 * Material files (TFCalc, Macleod, OptiLayer) go into user catalogs only: a
 * material put into an AGF or bundled library catalog could not be edited or
 * deleted, and an AGF re-import would wipe it. Names stay distinct inside a
 * catalog and across the catalog list, so two rows that read the same cannot be
 * picked by mistake.
 *
 * Run: node tests/catalog_import_targets.mjs
 */
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const cm = await import('../src/utils/materials/catalogManager.js');
const { MaterialImportDialog } = await import('../src/components/windows/design/materialEditor/materialImportDialog.js');
const { DEFAULT_IMPORT_UNITS } = await import('../src/utils/materials/materialFileImport.js');
const me = makeLocale().materialEditor;
const c = makeTheme();

const entry = (id, name) => ({ id, name, formulaNum: -1, tabData: [[400, 2.2, 0], [800, 2.1, 0]] });
cm.initCatalogs({
    schott2025: { id: 'schott2025', name: 'schott2025', source: 'agf', materials: { 'N-BK7': entry('N-BK7', 'N-BK7') } },
    library_coatings: { id: 'library_coatings', name: 'Coating Materials', source: 'library', materials: {} },
    user_lab_00000001: { id: 'user_lab_00000001', name: 'Lab', source: 'user', materials: {} },
});

// The dialog offers user catalogs and a new one, nothing else.
{
    const html = renderToStaticMarkup(React.createElement(MaterialImportDialog, {
        fileImport: { files: [], units: DEFAULT_IMPORT_UNITS },
        setFileImport() {}, catalogs: cm.getCatalogs(), onCommit() {}, me, c,
    }));
    const options = [...html.matchAll(/<option value="([^"]*)"/g)].map(match => match[1]);
    assert.deepEqual(options, ['user_lab_00000001', '__new__'], `only user catalogs are targets: ${options}`);
}

// The import itself refuses a catalog that is not the user's.
assert.equal(cm.importMaterialsIntoCatalog('schott2025', { Ta2O5: entry('Ta2O5', 'Ta2O5') }), 0, 'nothing goes into an AGF catalog');
assert.deepEqual(Object.keys(cm.getCatalog('schott2025').materials), ['N-BK7']);
assert.equal(cm.importMaterialsIntoCatalog('library_coatings', { Ta2O5: entry('Ta2O5', 'Ta2O5') }), 0, 'nor into a library one');
assert.equal(cm.importMaterialsIntoCatalog('user_lab_00000001', { Ta2O5: entry('Ta2O5', 'Ta2O5') }), 1);

// The same file imported twice: the second copy has an id and a name of its own.
assert.equal(cm.importMaterialsIntoCatalog('user_lab_00000001', { Ta2O5: entry('Ta2O5', 'Ta2O5') }), 1);
const names = () => Object.values(cm.getCatalog('user_lab_00000001').materials).map(m => `${m.id}=${m.name}`).sort();
assert.deepEqual(names(), ['Ta2O5=Ta2O5', 'Ta2O5_2=Ta2O5 (2)']);

// Copy to catalog into the material's own catalog.
const copy = cm.copyMaterialToCatalog(cm.getCatalog('user_lab_00000001').materials.Ta2O5, 'user_lab_00000001');
assert.equal(copy.name, 'Ta2O5 (3)', 'a copy beside its original reads differently');
assert.equal(new Set(names().map(row => row.split('=')[1])).size, 3, 'no two materials of the catalog share a name');

// A new catalog whose name another catalog has gets a number; a refreshed one keeps its name.
const added = cm.addCatalog({ id: 'zemax_x_0000aaaa', name: 'Lab', source: 'user', materials: {} });
assert.equal(added.name, 'Lab 2', 'a new catalog does not take a name in use');
const again = cm.addCatalog({ id: 'zemax_x_0000aaaa', name: 'Lab 2', source: 'user', materials: { A: entry('A', 'A') } });
assert.equal(again.name, 'Lab 2', 'the same catalog refreshed keeps its own name');
assert.equal(cm.addCatalog({ id: 'other_agf', source: 'agf', name: 'schott2025', materials: {} }).name, 'schott2025 2');

console.log('PASS: catalog_import_targets');
