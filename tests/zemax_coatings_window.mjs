/**
 * Zemax Coatings window: built from the shared Data Exchange chrome, and what
 * each tab draws.
 *
 * The tabs, the reference wavelength and the report of the last action sit in
 * one control row, as in Measured Spectra. Both import tabs carry the panel
 * that opens the file; the Coatings tab offers the selected stack to the front
 * coating, off with no design selected, and to the Coating Library; the
 * Materials tab selects records; the Export tab holds its options in a panel
 * section above the preview, and with no design selected asks for one instead.
 * A file that defines a material name twice raises a notice in the control row.
 *
 * Run: node tests/zemax_coatings_window.mjs
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeDesignCtx, makeLocale, makeTheme, shimBrowserGlobals, withDesign } from './_uiShim.mjs';

shimBrowserGlobals();
const { DesignContext } = await loadApp();

const [{ ZemaxCoatings }, { zemaxCoatingsSession }, { WINDOW_REGISTRY }, { parseZemaxCoating }] = await Promise.all([
    import('../src/components/windows/dataExchange/zemaxCoatings/ZemaxCoatings.js'),
    import('../src/components/windows/dataExchange/zemaxCoatings/sessionState.js'),
    import('../src/components/docking/windowRegistry.js'),
    import('../src/utils/io/zemaxCoatingFile.js'),
]);

const c = makeTheme();
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const render = (t) => renderToStaticMarkup(withDesign(React.createElement(ZemaxCoatings, { c, t, setInputDialog: () => {} })));
// The window as it is with no design selected in the explorer.
const renderNoDesign = (t) => renderToStaticMarkup(React.createElement(DesignContext.Provider,
    { value: { ...makeDesignCtx(), hasActiveDesign: false } },
    React.createElement(ZemaxCoatings, { c, t, setInputDialog: () => {} })));
const attr = (value) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
// The buttons with these labels, each as [label, off].
const buttons = (markup, labels) => [...markup.matchAll(/<button([^>]*)>([^<]*)<\/button>/g)]
    .filter(([, , label]) => labels.includes(label))
    .map(([, attrs, label]) => [label, /\sdisabled/.test(attrs)]);

// ── Registered, with a help page in both documentation languages ─────────────
{
    const entry = WINDOW_REGISTRY['zemax-coatings'];
    assert.equal(entry.component, ZemaxCoatings);
    assert.equal(entry.help, 'data-exchange/zemax-coatings');
    for (const slug of ['data-exchange/zemax-coatings.md', 'zh/data-exchange/zemax-coatings.md']) {
        assert.ok(existsSync(new URL(`../docs-site/src/content/docs/${slug}`, import.meta.url)), `help page ${slug} exists`);
    }
}

// ── Every language, no file: the control row and the file panel ──────────────
for (const code of ['en', 'ru', 'zh', 'it']) {
    zemaxCoatingsSession.reset();
    const t = makeLocale(code);
    const z = t.zemaxCoatings;
    const html = render(t);
    const shown = text(html);
    for (const key of ['tabCoatings', 'tabMaterials', 'tabExport', 'refWavelength', 'fileTitle', 'loadBtn', 'fileHint', 'noFile']) {
        assert.ok(shown.includes(z[key]), `${code}: ${key} is shown`);
    }
    assert.ok(html.includes(`title="${z.refWaveHint.replace(/"/g, '&quot;').replace(/'/g, '&#x27;')}"`), `${code}: λ₀ says what it converts`);
    assert.ok(html.includes('tfs-spectrum-import-layout'), `${code}: the Coatings tab is an import layout, panel and preview`);
    assert.equal((html.match(/aria-pressed="true"/g) || []).length, 1, `${code}: one tab is active`);
}

// ── A loaded file ────────────────────────────────────────────────────────────
const t = makeLocale('en');
const z = t.zemaxCoatings;
const doc = parseZemaxCoating([
    'MATE TIO2', '0.40 2.35 0', '0.80 2.25 0',
    'MATE TIO2', '0.40 2.45 0', '0.80 2.35 0',
    'MATE SIO2', '0.40 1.47 0', '0.80 1.45 0',
    'COAT AR', 'TIO2 0.25 0', 'SIO2 0.1 1',
    'COAT I.0.5',
].join('\n'));
const load = (patch) => {
    zemaxCoatingsSession.reset();
    zemaxCoatingsSession.write(null, { doc, fileName: 'LAB.DAT', filePath: 'C:\\lab\\LAB.DAT', selCoating: 0, ...patch });
};

// Coatings: the list in the panel, the selected stack beside it with its actions.
{
    load({ tab: 'coatings' });
    const html = render(t);
    const shown = text(html);
    for (const part of ['LAB.DAT', 'AR', 'I.0.5', z.typeStack, z.typeIdeal, z.layersHeader, z.importToFront, z.saveToLibrary]) {
        assert.ok(shown.includes(part), `the Coatings tab shows ${part}`);
    }
    assert.ok(html.includes(`title="${z.saveToLibraryTip}"`), 'the library button says where the media come from');
    assert.deepEqual(buttons(html, [z.importToFront]), [[z.importToFront, false]], 'a design open, the import is on');
    assert.ok(!html.includes(attr(z.importNoDesign)), 'and nothing asks for one');
    assert.ok(shown.includes('100.00 nm'), 'an absolute thickness is shown in nm');
    // d = T·λ₀/n₀ at 550 nm, n₀ interpolated in each TIO2 table.
    const thickness = (n0) => `${(0.25 * 550 / n0).toFixed(2)} nm`;
    assert.ok(shown.includes(thickness(2.45 - 0.1 * 0.15 / 0.4)) && !shown.includes(thickness(2.35 - 0.1 * 0.15 / 0.4)),
        'a relative thickness uses the last record of a repeated name, as the import does');
}

// Materials: the selection actions in the panel, the records beside them, and
// the repeated name raised in the control row.
{
    load({ tab: 'materials', selRows: new Set([1]) });
    const html = render(t);
    const shown = text(html);
    for (const part of [z.selectAll, z.clearSel, z.importSelected, z.importAll, z.repeatedRow(1, 2), z.repeatedRow(2, 2)]) {
        assert.ok(shown.includes(part), `the Materials tab shows ${part}`);
    }
    const checked = [...html.matchAll(/<input type="checkbox"([^>]*)>/g)].map(([, attrs]) => /checked/.test(attrs));
    assert.deepEqual(checked, [false, true, false], 'the selection is the second TIO2 row alone');
    assert.ok(html.includes(`title="${t.analysisChrome.notices}"`), 'the repeated name raises a notice');
}

// With no design selected there is nothing to import into: the import to the
// front coating is off and says why. The file still opens, the stack can still
// go to the Coating Library, and materials still go into a catalog.
{
    load({ tab: 'coatings' });
    const coatings = renderNoDesign(t);
    assert.deepEqual(buttons(coatings, [z.importToFront, z.saveToLibrary, z.loadBtn]),
        [[z.loadBtn, false], [z.importToFront, true], [z.saveToLibrary, false]]);
    assert.ok(coatings.includes(`<span title="${attr(z.importNoDesign)}"><button`), 'the import says a design is needed');
    load({ tab: 'materials', selRows: new Set([1]) });
    assert.deepEqual(buttons(renderNoDesign(t), [z.importSelected, z.importAll]),
        [[z.importSelected, false], [z.importAll, false]]);

    // And nothing to export: the Export tab asks for a design in place of its
    // options and the preview, even a preview built while a design was open.
    load({ tab: 'export', preview: 'MATE STALE' });
    const exported = renderNoDesign(t);
    const shown = text(exported);
    assert.ok(shown.includes(t.windowChrome.noDesign), 'the Export tab asks for a design');
    for (const part of [z.exportTitle, z.frontLayerCount(2), z.thicknessMode, z.generate, z.saveBtn, z.preview, 'MATE STALE']) {
        assert.ok(!shown.includes(part), `and shows no ${part}`);
    }
    assert.ok(shown.includes(z.tabExport) && shown.includes(z.refWavelength), 'the tabs and λ₀ stay');
}

// Export: the options in a panel section, the preview under them.
{
    load({ tab: 'export' });
    const shown = text(render(t));
    for (const part of [z.exportTitle, z.frontLayerCount(2), z.thicknessMode, z.thicknessAbs, z.thicknessRel,
        z.materialScope, z.scopeUsed, z.scopeAll, z.coatingName, z.sampleGrid, z.step, z.generate, z.saveBtn, z.preview]) {
        assert.ok(shown.includes(part), `the Export tab shows ${part}`);
    }
}

// A file with no repeated name raises no notice.
{
    zemaxCoatingsSession.reset();
    zemaxCoatingsSession.write(null, { doc: { ...doc, materials: doc.materials.slice(1) }, tab: 'materials' });
    assert.ok(!render(t).includes(`title="${t.analysisChrome.notices}"`), 'no notice without a repeated name');
}

zemaxCoatingsSession.reset();
console.log('PASS: zemax_coatings_window');
