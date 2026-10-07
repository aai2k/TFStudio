/**
 * CODE V Coatings window: where the ribbon and the help reach it, and what each
 * tab draws.
 *
 * The window is reached from the Data Exchange group beside Zemax Coatings and
 * its help button opens a page that exists in both documentation languages.
 * The Import tab shows a stack read from a file, incident side first, with the
 * layers CODE V holds fixed locked; the Export tab is blocked while the design
 * has a material this computer cannot resolve, as the Zemax window's is.
 *
 * Run: node tests/codev_coatings_window_render.mjs
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, makeSampleDesign, makeTheme, shimBrowserGlobals, withDesign } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const [{ CodevCoatings }, { ImportTab }, { ExportTab }, { WINDOW_REGISTRY }, { makeTabs, ICONS }, { warningText }] = await Promise.all([
    import('../src/components/windows/dataExchange/codevCoatings/CodevCoatings.js'),
    import('../src/components/windows/dataExchange/codevCoatings/ImportTab.js'),
    import('../src/components/windows/dataExchange/codevCoatings/ExportTab.js'),
    import('../src/components/docking/windowRegistry.js'),
    import('../src/components/Toolbar.js'),
    import('../src/components/windows/dataExchange/codevCoatings/messages.js'),
]);

const c = makeTheme();
const t = makeLocale('en');
const z = t.codevCoatings;
const noop = () => {};
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');

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

// ── The window renders in every language, on the Import tab, empty ───────────
for (const code of ['en', 'ru', 'zh', 'it']) {
    const tl = makeLocale(code);
    const html = renderToStaticMarkup(withDesign(React.createElement(CodevCoatings, { c, t: tl })));
    for (const key of ['title', 'tabImport', 'tabExport', 'openBtn', 'noFile']) {
        assert.ok(text(html).includes(tl.codevCoatings[key]), `${code}: ${key} is shown`);
    }
}

// ── Import tab: what was read, incident side first ────────────────────────────
{
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
    const html = renderToStaticMarkup(React.createElement(ImportTab, {
        c, z, stack, fileName: 'silver.seq', loading: false, onLoad: noop, importCoating: noop,
    }));
    const shown = text(html);
    for (const part of ['Silver Reflector', 'silver.seq', z.wavelengthsValue(3, 400, 1000), '0°, 20°', '550 nm',
        z.layersHeader(3), z.importToFront, z.importNote, warningText(z, stack.warnings[0]), 'n 2.75, k 4.46', 'n 1.5']) {
        assert.ok(shown.includes(part), `the Import tab shows ${part}`);
    }
    const rows = [...html.matchAll(/<tr>(.*?)<\/tr>/g)].map(m => m[1]).filter(row => row.includes('95.00') || row.includes('400.00') || row.includes('12.50'));
    assert.deepEqual(rows.map(row => (row.match(/>(\d+\.\d\d)</) || [])[1]), ['95.00', '400.00', '12.50'], 'layers in file order');
    assert.deepEqual(rows.map(row => row.includes('<svg')), [false, true, false], 'only the code 100 layer is locked');
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
    for (const part of [z.exportHint(2), z.sideFront, z.sideBack, z.titleField, z.saveName, z.refWavelength,
        z.wavelengthCount(31), z.angles, z.generate, z.saveBtn]) {
        assert.ok(open.includes(part), `the Export tab shows ${part}`);
    }

    const tooMany = text(renderToStaticMarkup(React.createElement(ExportTab, { ...props, gStep: 1, missingMaterialIds: [] })));
    assert.ok(tooMany.includes(z.errTooManyWavelengths(301, 100)), 'more than 100 wavelengths is refused on sight');
}

console.log('PASS: codev_coatings_window_render');
