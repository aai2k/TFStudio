/**
 * Coating Library window: renders in every locale, is reachable from the ribbon
 * and the window registry, and the Design Editor offers the save action.
 *
 * Run: node tests/coating_library_window.mjs
 */
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, makeSampleDesign, makeTheme, shimBrowserGlobals, withDesign } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const { CoatingLibrary } = await import('../src/components/windows/design/coatingLibrary/CoatingLibrary.js');
const { SaveCoatingDialog } = await import('../src/components/windows/design/coatingLibrary/SaveCoatingDialog.js');
const { ImportLinkDialog } = await import('../src/components/windows/design/coatingLibrary/ImportLinkDialog.js');
const { coatingLibrarySession } = await import('../src/components/windows/design/coatingLibrary/sessionState.js');
const { LayerList } = await import('../src/components/windows/design/designEditor/LayerList.js');
const { WINDOW_REGISTRY } = await import('../src/components/docking/windowRegistry.js');
const { ICONS, makeTabs } = await import('../src/components/Toolbar.js');
const { BUILTIN_COATINGS } = await import('../src/utils/coatingLibrary/builtin/index.js');
const { COATING_TYPES } = await import('../src/utils/coatingLibrary/entryModel.js');

const c = makeTheme();
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

// ── Registry and ribbon ───────────────────────────────────────────────────────

const entry = WINDOW_REGISTRY['coating-library'];
assert.ok(entry?.component === CoatingLibrary, 'the window is registered under coating-library');
assert.equal(entry.help, 'design/coating-library');
assert.ok(ICONS['coating-library'], 'the ribbon has an icon for it');
const designGroup = makeTabs(makeLocale('en')).find(tab => tab.key === 'setup').groups.find(g => g.key === 'design');
assert.ok(designGroup.items.some(item => item.id === 'coating-library'), 'it sits in the Design group of the Setup tab');

// ── Every locale names every type and every control ───────────────────────────

for (const code of ['en', 'ru', 'zh']) {
    const t = makeLocale(code);
    const ts = t.coatingLibrary;
    assert.ok(ts, `${code}: t.coatingLibrary is missing`);
    for (const type of COATING_TYPES) assert.ok(ts.types[type], `${code}: no label for coating type ${type}`);
    for (const pol of ['avg', 's', 'p']) assert.ok(ts.pols[pol], `${code}: no label for polarization ${pol}`);
    assert.equal(typeof ts.applied(3, ts.sideFront), 'string');
    assert.equal(typeof ts.saveDialog.saved('x'), 'string');
    assert.ok(t.designEditor.tools.saveToLibrary, `${code}: the Design Editor tools menu has no save entry`);
    assert.ok(t.settings.folders.coatings, `${code}: the Coatings folder has no label in Settings`);
    assert.ok(t.toolbar.buttons['coating-library'] && t.toolbar.tooltips['coating-library'], `${code}: ribbon strings`);
}

// ── Render ────────────────────────────────────────────────────────────────────

const t = makeLocale('en');
const ts = t.coatingLibrary;

coatingLibrarySession.reset();
let html = renderToStaticMarkup(withDesign(React.createElement(CoatingLibrary, { c, t })));
assert.ok(html.includes(esc(ts.sourceBuiltin)) && html.includes(esc(ts.sourceUser)), 'both shelves are offered');
assert.ok(html.includes(esc(ts.saveCurrent)), 'the save action is in the window');
assert.ok(html.includes(esc(ts.importLink)), 'the share-link import is in the window');
assert.ok(html.includes(esc(ts.anySubstrate)), 'the substrate filter is offered');
assert.ok(html.includes(esc(ts.selectHint)), 'nothing selected shows the hint');
if (BUILTIN_COATINGS.length > 0) {
    const first = BUILTIN_COATINGS[0];
    assert.ok(html.includes(esc(first.name)), 'the first built-in entry is listed');
    // Entries sit in one folder per family, each folder a header that folds.
    assert.ok(html.includes(`aria-expanded="true"`) && html.includes(esc(ts.types[first.type])),
        'the list shows family folders');
    coatingLibrarySession.write(null, { collapsedTypes: [first.type] });
    const folded = renderToStaticMarkup(withDesign(React.createElement(CoatingLibrary, { c, t })));
    assert.ok(!folded.includes(esc(first.name)) && folded.includes(`aria-expanded="false"`),
        'a folded family hides its entries but keeps its header');
    coatingLibrarySession.write(null, { collapsedTypes: [] });

    // The tag panel is folded by default; only the toggle shows.
    assert.ok(html.includes(esc(ts.showTags)), 'the tag toggle is shown when entries carry tags');
    const firstTag = first.tags[0];
    // A counted chip renders as "tag N"; none is on the page while folded.
    assert.ok(!html.includes(`>${esc(firstTag)} `), 'no tag chips are listed while the panel is folded');
    coatingLibrarySession.write(null, { tagsOpen: true });
    const opened = renderToStaticMarkup(withDesign(React.createElement(CoatingLibrary, { c, t })));
    assert.ok(opened.includes(`aria-pressed="false"`) && opened.includes(`>${esc(firstTag)} `),
        'unfolded, a tag renders as a chip with its count');
    assert.ok(opened.includes(esc(ts.tagGroups.region)), 'chips are listed under the kind of tag');
    // Choosing a tag narrows the list to entries carrying it, and the chosen
    // chip stays in view with the panel folded again.
    coatingLibrarySession.write(null, { tags: [firstTag], tagsOpen: false });
    const narrowed = renderToStaticMarkup(withDesign(React.createElement(CoatingLibrary, { c, t })));
    assert.ok(narrowed.includes(esc(ts.clearTags)), 'a chosen tag offers Clear tags');
    assert.ok(narrowed.includes(`aria-pressed="true"`), 'the chosen tag stays visible while folded');
    for (const entry of BUILTIN_COATINGS) {
        assert.equal(narrowed.includes(esc(entry.name)), entry.tags.includes(firstTag),
            `${entry.id} listed under tag ${firstTag}`);
    }
    coatingLibrarySession.write(null, { tags: [] });
    // Selecting an entry shows its stack, properties and specification.
    coatingLibrarySession.write(null, { selectedId: BUILTIN_COATINGS[0].id });
    html = renderToStaticMarkup(withDesign(React.createElement(CoatingLibrary, { c, t })));
    assert.ok(html.includes(esc(ts.stackHeading)) && html.includes(esc(ts.propertiesHeading))
        && html.includes(esc(ts.specHeading)), 'the detail panel renders for a selected entry');
    assert.ok(html.includes(esc(ts.pass)), 'the selected built-in entry passes its specification on screen');
    assert.ok(!html.includes(esc(ts.problemsHeading)), 'a built-in entry has no problems to show');
    assert.ok(html.includes(`${esc(first.layers[0].thickness.toFixed(1))} nm"`),
        'the material-colored stack strip names its layers');
} else {
    assert.ok(html.includes(esc(ts.emptyBuiltin)));
}

// A search that matches nothing shows the empty text, not a blank list. With
// nothing on the shelf at all, the shelf's own empty text takes precedence.
coatingLibrarySession.write(null, { selectedId: null, query: 'zzz-no-such-coating' });
html = renderToStaticMarkup(withDesign(React.createElement(CoatingLibrary, { c, t })));
assert.ok(html.includes(esc(BUILTIN_COATINGS.length > 0 ? ts.emptyFiltered : ts.emptyBuiltin)));
coatingLibrarySession.reset();

// The dialog renders with the design's name proposed and the side chosen.
const design = makeSampleDesign();
html = renderToStaticMarkup(withDesign(React.createElement(SaveCoatingDialog, {
    design, side: 'front', c, t, onClose: () => {},
}), design));
assert.ok(html.includes(esc(ts.saveDialog.title)));
assert.ok(html.includes(`value="${esc(design.name)} front"`), 'the name is proposed from the design');
assert.ok(html.includes(esc(ts.layersShort(design.frontLayers.length))), 'the dialog says how many layers it will save');

// The import dialog renders with its explanation and a disabled Import button
// until a link is pasted.
html = renderToStaticMarkup(React.createElement(ImportLinkDialog, { c, t, onClose: () => {} }));
assert.ok(html.includes(esc(ts.importDialog.title)) && html.includes(esc(ts.importDialog.hint)));
assert.ok(html.includes(`disabled=""`), 'Import is disabled with nothing pasted');

// The Design Editor's tools menu offers the save action.
html = renderToStaticMarkup(withDesign(React.createElement(LayerList, {
    layers: design.frontLayers, side: 'front', design, updateDesign: () => {}, missingMaterialIds: new Set(), c, t,
    addLayer: () => {}, removeLayer: () => {}, updateLayer: () => {},
    insertLayerAt: () => {}, removeLayerAt: () => {}, duplicateLayerAt: () => {},
    pasteLayersAtDisplayIndex: () => {}, removeLayers: () => {}, reorderLayers: () => {},
    invertActiveSide: () => {}, setAllLocked: () => {}, copyToOther: () => {},
    onOpenReplaceMaterials: () => {}, refLambda: 550,
}), design));
assert.ok(html.includes(`value="saveToLibrary"`) && html.includes(esc(t.designEditor.tools.saveToLibrary)),
    'the Design Editor tools menu lists "Save coating to library"');

console.log('PASS coating_library_window');
