/**
 * CODE V Coatings window: where the ribbon and the help reach it, and what each
 * tab draws.
 *
 * The window is reached from the Data Exchange group beside Zemax Coatings and
 * its help button opens a page that exists in both documentation languages.
 * It is built from the shared Data Exchange chrome: the Import and Export tabs
 * and the report of the last action in one control row, the reader's or the
 * writer's notes in the notice badge there. The Import tab opens the file in
 * its panel, sums up what the file sets there, and beside it shows the stack,
 * incident side first, with the layers CODE V holds fixed locked; it offers the
 * stack to the front and the back coating, the back off in Symmetric mode and
 * both off with no design selected, and to the Coating Library. Wavelengths
 * are shown as short as the float32 CODE V holds them in allows. The Export
 * tab holds its options in a panel section
 * above the preview, and is blocked while the design has a material this
 * computer cannot resolve, as the Zemax window's is. With no design selected it
 * asks for one in place of all of that.
 *
 * Run: node tests/codev_coatings_window_render.mjs
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeDesignCtx, makeLocale, makeSampleDesign, makeTheme, shimBrowserGlobals, withDesign } from './_uiShim.mjs';

shimBrowserGlobals();
const { DesignContext } = await loadApp();

const [
    { CodevCoatings }, { tabNotices }, { ImportTab }, { ExportTab }, { codevCoatingsSession },
    { WINDOW_REGISTRY }, { makeTabs, ICONS }, { warningText }, { parseCodevSeq },
] = await Promise.all([
    import('../src/components/windows/dataExchange/codevCoatings/CodevCoatings.js'),
    import('../src/components/windows/dataExchange/codevCoatings/CodevLayout.js'),
    import('../src/components/windows/dataExchange/codevCoatings/ImportTab.js'),
    import('../src/components/windows/dataExchange/codevCoatings/ExportTab.js'),
    import('../src/components/windows/dataExchange/codevCoatings/sessionState.js'),
    import('../src/components/docking/windowRegistry.js'),
    import('../src/components/Toolbar.js'),
    import('../src/components/windows/dataExchange/codevCoatings/messages.js'),
    import('../src/utils/io/codevCoatingFile.js'),
]);

const c = makeTheme();
const t = makeLocale('en');
const z = t.codevCoatings;
const noop = () => {};
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const attr = (value) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const renderWindow = (tl) => renderToStaticMarkup(withDesign(React.createElement(CodevCoatings, { c, t: tl })));

// ── Registered, on the ribbon beside Zemax Coatings, with a help page ─────────
{
    const entry = WINDOW_REGISTRY['codev-coatings'];
    assert.equal(entry.component, CodevCoatings);
    assert.equal(entry.help, 'data-exchange/codev-coatings');
    const exchange = makeTabs(t).flatMap(tab => tab.groups).find(group => group.key === 'exchange');
    const ids = exchange.items.map(item => item.id);
    assert.equal(ids.indexOf('codev-coatings'), ids.indexOf('zemax-coatings') + 1, `beside Zemax Coatings: ${ids}`);
    assert.ok(ICONS['codev-coatings'], 'the ribbon button has an icon');
    for (const slug of [`data-exchange/codev-coatings.md`, `zh/data-exchange/codev-coatings.md`]) {
        const page = new URL(`../docs-site/src/content/docs/${slug}`, import.meta.url);
        assert.ok(existsSync(page), `help page ${slug} exists`);
        assert.match(readFileSync(page, 'utf8'), /^ribbonIcon: codev-coatings$/m, `${slug} shows the ribbon icon`);
    }
}

// ── Every language, no file: the control row and the file panel ──────────────
for (const code of ['en', 'ru', 'zh', 'it']) {
    codevCoatingsSession.reset();
    const tl = makeLocale(code);
    const html = renderWindow(tl);
    for (const key of ['tabImport', 'tabExport', 'fileTitle', 'openBtn', 'fileHint', 'noFile']) {
        assert.ok(text(html).includes(tl.codevCoatings[key]), `${code}: ${key} is shown`);
    }
    assert.ok(html.includes('tfs-spectrum-import-layout'), `${code}: the Import tab is an import layout, panel and stack`);
    assert.equal((html.match(/aria-pressed="true"/g) || []).length, 1, `${code}: one tab is active`);
    assert.ok(!html.includes(`title="${tl.analysisChrome.notices}"`), `${code}: no file, no notices`);
}

// ── Import tab: what was read, incident side first ────────────────────────────
const stack = {
    title: 'Silver Reflector', refNm: 550, wavelengthsNm: [400, 750, 1000], anglesDeg: [0, 20],
    incident: { n: 1, k: 0 }, substrate: { n: 1.5, k: 0 },
    layers: [
        { thicknessNm: 95, code: 0, index: { label: 'SiO2' } },
        { thicknessNm: 400, code: 100, index: { label: 'Silver' } },
        { thicknessNm: 12.5, code: 0, index: { n: 2.75, k: 4.46 } },
    ],
    mic: {},
    warnings: [{ kind: 'unknownCommand', command: 'MAN', line: 26 }],
};
const renderImport = (design, shown = stack) => renderToStaticMarkup(React.createElement(ImportTab, {
    c, z, stack: shown, design, hasActiveDesign: true, fileName: 'silver.seq', loading: false, onLoad: noop,
    importCoating: noop, saveToLibrary: noop, panelWidth: null, setPanelWidth: noop,
}));
// The buttons with these labels, each as [label, off].
const buttons = (markup, labels = [z.importToFront, z.importToBack]) => [...markup.matchAll(/<button([^>]*)>([^<]*)<\/button>/g)]
    .filter(([, , label]) => labels.includes(label))
    .map(([, attrs, label]) => [label, /\sdisabled/.test(attrs)]);
{
    const html = renderImport(makeSampleDesign());
    const shown = text(html);
    for (const part of ['Silver Reflector', 'silver.seq', z.fileTitle, z.openBtn, z.wavelengthsValue(3, 400, 1000), '0°, 20°', '550 nm',
        z.summaryIncident, z.summarySubstrate, z.layersHeader(3), z.importToFront, z.importToBack, z.saveToLibrary,
        'n 2.75, k 4.46', 'n 1.5']) {
        assert.ok(shown.includes(part), `the Import tab shows ${part}`);
    }
    assert.ok(html.includes(`title="${attr(z.saveToLibraryTip)}"`), 'the library button says where the media come from');
    const rows = [...html.matchAll(/<tr>(.*?)<\/tr>/g)].map(m => m[1]).filter(row => row.includes('95.00') || row.includes('400.00') || row.includes('12.50'));
    assert.deepEqual(rows.map(row => (row.match(/>(\d+\.\d\d)</) || [])[1]), ['95.00', '400.00', '12.50'], 'layers in file order');
    assert.deepEqual(rows.map(row => row.includes('<svg')), [false, true, false], 'only the code 100 layer is locked');

    // Both import buttons are live, unless the back mirrors the front.
    assert.deepEqual(buttons(html), [[z.importToFront, false], [z.importToBack, false]]);
    assert.ok(!html.includes(attr(z.importNoDesign)), 'with a design open nothing asks for one');
    const symmetric = renderImport({ ...makeSampleDesign(), surfaceMode: 'symmetric' });
    assert.deepEqual(buttons(symmetric), [[z.importToFront, false], [z.importToBack, true]],
        'in Symmetric mode the back coating is the mirror of the front');
    assert.ok(symmetric.includes(`title="${attr(z.importBackSymmetric)}"`), 'and the back button says so');
    assert.ok(!html.includes(`title="${attr(z.importBackSymmetric)}"`), 'which it does not say otherwise');
}

// A stack with no title is headed by its file name.
assert.ok(text(renderImport(makeSampleDesign(), { ...stack, title: '' })).includes('silver.seq'));

// With no design selected there is nothing to import into: both import buttons
// are off and say why, while the file still opens and the stack can still go
// to the Coating Library, which takes its media from the file.
{
    codevCoatingsSession.reset();
    codevCoatingsSession.write(null, { stack, fileName: 'silver.seq', filePath: 'C:\\silver.seq' });
    const value = { ...makeDesignCtx(makeSampleDesign()), hasActiveDesign: false };
    const html = renderToStaticMarkup(React.createElement(DesignContext.Provider, { value },
        React.createElement(CodevCoatings, { c, t })));
    assert.deepEqual(buttons(html), [[z.importToFront, true], [z.importToBack, true]]);
    assert.equal(html.split(`<span title="${attr(z.importNoDesign)}"><button`).length - 1, 2,
        'each import button says a design is needed');
    assert.deepEqual(buttons(html, [z.openBtn, z.saveToLibrary]), [[z.openBtn, false], [z.saveToLibrary, false]]);
    codevCoatingsSession.reset();
}

// WLG wavelengths are float32 sums in µm; they are shown as short as that allows.
{
    const wlg = parseCodevSeq(['MUL', 'MDA', 'PHT Y', 'WLG 400 700 10', 'COA 100 0 1.46', 'SUB 1.52', 'MEX'].join('\r\n'));
    const [first, last] = [wlg.wavelengthsNm[0], wlg.wavelengthsNm.at(-1)];
    assert.notEqual(first, 400, 'the first WLG wavelength is not 400 to the last digit');
    const shown = text(renderImport(makeSampleDesign(), wlg));
    assert.ok(!shown.includes(String(first)), `${first} is not shown in full`);
    const range = /31, 400 to ([\d.]+) nm/.exec(shown);
    assert.ok(range, `the range is shown from 400: ${shown}`);
    assert.ok(Math.abs(Number(range[1]) - last) <= last * 2 ** -23, `and to ${range[1]}, the last of them as a float32 holds it`);
    assert.ok(range[1].replace('.', '').length <= 9, 'with no more digits than a float32 carries');
}

// ── The notices: the reader's on the Import tab, the writer's on Export ──────
{
    const exportWarnings = [{ kind: 'mediumAbsorbs', role: 'substrate', material: 'Ag' }];
    assert.deepEqual(tabNotices({ z, tab: 'import', stack, exportWarnings }),
        [{ label: warningText(z, stack.warnings[0]), tone: 'warning' }]);
    assert.deepEqual(tabNotices({ z, tab: 'export', stack, exportWarnings }),
        [{ label: warningText(z, exportWarnings[0]), tone: 'warning' }]);
    assert.deepEqual(tabNotices({ z, tab: 'import', stack: null, exportWarnings }), [], 'no file, no notices');

    codevCoatingsSession.reset();
    codevCoatingsSession.write(null, { stack, fileName: 'silver.seq', filePath: 'C:\\silver.seq' });
    const html = renderWindow(t);
    assert.ok(html.includes(`title="${t.analysisChrome.notices}"`), 'a file with a note raises the notice badge');
    assert.ok(text(html).includes('Silver Reflector'), 'beside the stack read');
    assert.deepEqual(buttons(html), [[z.importToFront, false], [z.importToBack, false]], 'a design open, both imports are on');
    codevCoatingsSession.reset();
}

// ── Export tab: blocked by a missing material, otherwise the settings ─────────
{
    const props = {
        c, z, design: makeSampleDesign(), side: 'front', title: 'AR', saveName: 'ar', refNm: 550,
        anglesDeg: [0, 30], gStart: 400, gEnd: 700, gStep: 10, preview: '', exportWarnings: [],
        setSide: noop, setTitle: noop, setSaveName: noop, setRefNm: noop, setAnglesDeg: noop,
        setGStart: noop, setGEnd: noop, setGStep: noop, onGenerate: noop, onSave: noop,
    };
    const blocked = renderToStaticMarkup(React.createElement(ExportTab, { ...props, missingMaterialIds: ['user_gone_1:X'] }));
    assert.ok(text(blocked).includes(z.exportBlocked('user_gone_1:X')), 'a missing material blocks the export');
    assert.ok(!text(blocked).includes(z.generate), 'and there is nothing to generate');

    const open = text(renderToStaticMarkup(React.createElement(ExportTab, { ...props, missingMaterialIds: [] })));
    for (const part of [z.exportTitle, z.exportHint(2), z.side, z.sideFront, z.sideBack, z.titleField, z.saveName, z.refWavelength,
        z.wavelengths, z.step, z.wavelengthCount(31), z.angles, z.generate, z.saveBtn, z.preview]) {
        assert.ok(open.includes(part), `the Export tab shows ${part}`);
    }

    const tooMany = text(renderToStaticMarkup(React.createElement(ExportTab, { ...props, gStep: 1, missingMaterialIds: [] })));
    assert.ok(tooMany.includes(z.errTooManyWavelengths(301, 100)), 'more than 100 wavelengths is refused on sight');
}

// ── Export tab, no design selected: a request for one, and nothing else ──────
// Missing materials are not the reason given: with no design open there is no
// design to repair.
{
    codevCoatingsSession.reset();
    codevCoatingsSession.write(null, { tab: 'export' });
    const value = { ...makeDesignCtx(makeSampleDesign()), hasActiveDesign: false };
    const shown = text(renderToStaticMarkup(React.createElement(DesignContext.Provider, { value },
        React.createElement(CodevCoatings, { c, t }))));
    assert.ok(shown.includes(t.windowChrome.noDesign), 'the Export tab asks for a design');
    for (const part of [z.exportTitle, z.exportHint(2), z.side, z.titleField, z.wavelengths, z.generate, z.saveBtn, z.preview]) {
        assert.ok(!shown.includes(part), `and shows no ${part}`);
    }
    assert.ok(shown.includes(z.tabImport) && shown.includes(z.tabExport), 'the tabs stay');

    const blocked = text(renderToStaticMarkup(React.createElement(ExportTab, {
        c, t, z, hasActiveDesign: false, missingMaterialIds: ['user_gone_1:X'], preview: '',
    })));
    assert.ok(blocked.includes(t.windowChrome.noDesign) && !blocked.includes(z.exportBlocked('user_gone_1:X')),
        'no design open comes before a missing material');
    codevCoatingsSession.reset();
}

console.log('PASS: codev_coatings_window_render');
