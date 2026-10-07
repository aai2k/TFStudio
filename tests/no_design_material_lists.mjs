/**
 * With no design open, the windows that stay open list no materials of the
 * placeholder design the provider hands out meanwhile.
 *
 * The material picker and the Material Editor each offer the open design's own
 * materials as a list of their own ("This design"), and a phase monitor in the
 * status bar names the side the design is evaluated on. The placeholder is
 * nobody's design, so with no design open there is no such list and no side.
 *
 * Run: node tests/no_design_material_lists.mjs
 */
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeDesignCtx, makeLocale, makeSampleDesign, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
const { DesignContext } = await loadApp();
const [{ MaterialPicker }, { useMaterialEditor }, { SpectralMonitor }, { initCatalogs }, { constantIndexRecord }] = await Promise.all([
    import('../src/components/ui/MaterialPicker.js'),
    import('../src/components/windows/design/materialEditor/useMaterialEditor.js'),
    import('../src/components/SpectralMonitor.js'),
    import('../src/utils/materials/catalogManager.js'),
    import('../src/utils/io/designImport/materialResolution.js'),
]);

const c = makeTheme();
const t = makeLocale();
const h = React.createElement;
const OPEN_STATES = [false, true];

// A design whose one layer is a material only the design carries, so its name
// can come from nowhere but the design.
const QUARTZ = { ...constantIndexRecord(1.46), name: 'Quartz glass' };
const design = {
    ...makeSampleDesign(),
    frontLayers: [{ id: 'l1', material: QUARTZ.id, thickness: 100, locked: false }],
    materials: { [QUARTZ.id]: QUARTZ },
};
initCatalogs({});

const inContext = (element, hasActiveDesign) =>
    h(DesignContext.Provider, { value: { ...makeDesignCtx(design), hasActiveDesign } }, element);

// ── Material picker ──────────────────────────────────────────────────────────
for (const hasActiveDesign of OPEN_STATES) {
    const html = renderToStaticMarkup(inContext(h(MaterialPicker, { value: QUARTZ.id, onChange: () => {}, c, t }), hasActiveDesign));
    assert.equal(html.includes(QUARTZ.name), hasActiveDesign,
        `the picker reads the design's own materials only with a design open (open: ${hasActiveDesign})`);
}

// ── Material Editor ──────────────────────────────────────────────────────────
for (const hasActiveDesign of OPEN_STATES) {
    let editor = null;
    function Probe() {
        editor = useMaterialEditor({ c: {}, t, setInputDialog: () => {} });
        return null;
    }
    renderToStaticMarkup(h(DesignContext.Provider, { value: { design, designs: {}, hasActiveDesign } }, h(Probe)));
    const listed = editor.browseCatalogs.some(catalog => catalog.name === t.materialEditor.designCatalog);
    assert.equal(listed, hasActiveDesign,
        `the editor lists the design's materials only with a design open (open: ${hasActiveDesign})`);
}

// ── Phase monitor ────────────────────────────────────────────────────────────
localStorage.setItem('tfstudio-monitors-v1', JSON.stringify([{ id: 'gd', type: 'GD', lambda: 550, aoi: 0, pol: 'avg' }]));
for (const hasActiveDesign of OPEN_STATES) {
    const html = renderToStaticMarkup(inContext(h(SpectralMonitor, { c, t }), hasActiveDesign));
    assert.equal(html.includes(`>${t.statusMonitors.scopeFront}<`), hasActiveDesign,
        `a phase monitor names the side only with a design open (open: ${hasActiveDesign})`);
}

console.log('no_design_material_lists: passed');
