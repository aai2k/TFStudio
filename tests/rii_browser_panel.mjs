/**
 * The refractiveindex.info browser shows a page as a plot or a table, n and k
 * at a typed wavelength, and the formula a formula page is computed from.
 *
 * The panel showed only a chart, and its Data type line read "Dispersion
 * formula" for every formula page. It now has a Plot tab and an n, k data tab
 * with the page's samples, the probe the Material Editor has, reading the
 * material the page is stored as, the formula by number and name with its
 * coefficients, and the band a formula gives no real n in. n is printed to
 * eight decimals here and in the Material Editor, so a gas does not read
 * 1.00028 at every wavelength.
 *
 * Run: node tests/rii_browser_panel.mjs
 */

import assert from 'node:assert/strict';

globalThis.React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useRef: initial => ({ current: initial }),
    useEffect: () => {},
    useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
    useCallback: fn => fn,
};

const { renderRiiRightPanel } = await import('../src/components/windows/design/materialEditor/riiRightPanel.js');
const { RiiChart } = await import('../src/components/windows/design/materialEditor/riiChart.js');
const { NkProbe, KaTeXSpan } = await import('../src/components/windows/design/materialEditor/materialEditorUI.js');
const { TabBtn } = await import('../src/components/ui/tabBtn.js');
const { sampleMaterial, riiToMaterialEntry, riiCatalogFormula } = await import('../src/utils/materials/riiDatabase.js');
const { formulaLatex } = await import('../src/utils/materials/dispersionFormulas.js');
const { makeGetNK } = await import('../src/utils/materials/catalogManager/dispersion.js');
const riiFormulaLatex = (num, count) => formulaLatex(riiCatalogFormula(num), count);
const { getLocale } = await import('../src/constants/locales/index.js');

const rii = getLocale('en').riiDatabase;
const me = getLocale('en').materialEditor;
const c = { bg: '#111', panel: '#181818', border: '#333', text: '#eee', textDim: '#999', accent: '#5dade2' };

function flatten(node, out = []) {
    if (Array.isArray(node)) { node.forEach(child => flatten(child, out)); return out; }
    if (node == null || node === false) return out;
    if (typeof node !== 'object') { out.push(node); return out; }
    out.push(node);
    flatten(node.children, out);
    return out;
}

function renderPanel(mat, sampleTab = 'plot') {
    const tabs = [];
    const nodes = flatten(renderRiiRightPanel({
        c, rii, me, mat, matLoading: false, matErr: null,
        selected: { bookName: 'book', pageName: 'page' },
        wavelengthLabel: 'Wavelength (nm)', phase: 'idle', addMsg: '',
        handleAddClick: () => {}, userCatalogs: [],
        sampleTab, setSampleTab: tab => tabs.push(tab),
    }));
    const of = type => nodes.filter(node => node?.type === type);
    const table = nodes.find(node => typeof node?.type === 'function' && node.props?.rows && node.props?.title);
    return { nodes, texts: nodes.filter(node => typeof node === 'string'), of, table, tabs };
}

const ciddor = {
    type: 'formula', riiFormulaNum: 6, formulaCoeffs: [0, 0.05792105, 238.0185, 0.00167917, 57.362],
    wavelengthRange: [230, 1690], references: '', comments: '', dataPath: 'other/mixed gases/air/nk/Ciddor.yml',
};
const samples = sampleMaterial(ciddor);

// ── Plot tab ─────────────────────────────────────────────────────────────────

const plot = renderPanel(ciddor, 'plot');
assert.equal(plot.of(RiiChart).length, 1, 'the Plot tab draws the chart');
assert.equal(plot.table, undefined, 'and no table');
const tabButtons = plot.of(TabBtn);
assert.deepEqual(tabButtons.map(tab => tab.children[0]), [rii.plotTab, me.nkTable], 'two tabs: Plot and n, k data');
assert.deepEqual(tabButtons.map(tab => tab.props.active), [true, false], 'Plot is the one shown');
tabButtons[1].props.onClick();
assert.deepEqual(plot.tabs, ['table'], 'clicking n, k data asks for the table');

// ── n, k data tab ────────────────────────────────────────────────────────────

const table = renderPanel(ciddor, 'table');
assert.equal(table.of(RiiChart).length, 0, 'the n, k data tab draws no chart');
assert.equal(table.table.props.rows, samples, 'it lists the page sampled on the 1% grid');
assert.equal(table.table.props.title, `${me.nkTableSampled} (${samples.length})`, 'a formula page says they are sampled');
assert.equal(table.table.props.fill, true, 'the table takes the height of the tab');
const drawn = flatten(table.table.type(table.table.props)).filter(node => typeof node === 'string');
assert.ok(drawn.includes('1.00030800'), 'n is printed to eight decimals: air at 230 nm reads 1.00030800');
assert.ok(drawn.length < 3 * 100, `only the rows in view are drawn (${drawn.length} cells for ${samples.length} rows)`);

const tablePage = { type: 'tabulated_nk', tableNK: [[400, 2.2, 0.01], [600, 2.1, 0], [800, 2.05, 0]], references: '', comments: '', dataPath: 'main/X/nk/Y.yml' };
assert.equal(renderPanel(tablePage, 'table').table.props.title, `${me.nkTable} (3)`, 'a table page lists its own rows');

// ── n, k at a typed wavelength ───────────────────────────────────────────────

for (const view of [plot, table]) {
    const [probe] = view.of(NkProbe);
    assert.ok(probe, 'the probe sits under either tab');
    assert.deepEqual(probe.props.rangeNm, [230, 1690], 'it knows the sampled range');
    const imported = makeGetNK(riiToMaterialEntry(ciddor, 'Ciddor', 'air'));
    for (const lam of [550, 633, 1064, 100, 2000]) {
        assert.deepEqual(probe.props.getNK(lam), imported(lam),
            `at ${lam} nm it reads what the material reads once added to a catalog`);
    }
}
// A k table that stops short of the formula's range narrows the range a design
// is warned outside of, so the probe marks the same wavelengths (ZnSe
// Amotchkina: formula 400 to 13900 nm, k table 400 to 888 nm).
{
    const znse = {
        type: 'formula', riiFormulaNum: 2, formulaCoeffs: [-0.689818, 4.855169, 0.056359, 0.673922, 0.056336, 2.481890, 2222.114],
        wavelengthRange: [400, 13900], tableK: [[400, 0.05, 0], [600, 0.001, 0], [888, 0.0002, 0]],
        references: '', comments: '', dataPath: 'main/ZnSe/nk/Amotchkina.yml',
    };
    const range = renderPanel(znse).of(NkProbe)[0].props.rangeNm;
    assert.ok(Math.abs(range[0] - 400) < 1e-9 && Math.abs(range[1] - 888) < 1e-9, `the probe's range is the stored material's: ${range}`);
}
const shown = flatten(NkProbe(plot.of(NkProbe)[0].props)).filter(node => typeof node === 'string');
assert.ok(shown.some(text => /^n = 1\.0002\d{4}$/.test(text)), `the probe prints n to eight decimals: ${shown.join(' | ')}`);

// ── The formula ──────────────────────────────────────────────────────────────

assert.ok(plot.texts.includes('Formula 6, Gases'), 'Data type names the formula');
const [katex] = plot.of(KaTeXSpan);
assert.equal(katex.props.latex, riiFormulaLatex(6, 5), 'the formula is written out');
assert.equal(katex.props.latex,
    'n - 1 = C_{1} + \\dfrac{C_{2}}{C_{3} - \\lambda^{-2}} + \\dfrac{C_{4}}{C_{5} - \\lambda^{-2}}',
    'with the two terms the page gives');
assert.equal(katex.props.displayMode, true, 'laid out as the Material Editor writes its formulas');
assert.ok(plot.texts.includes(`Formula 6, Gases · ${rii.formulaUnits}`), 'over its units');
for (const [name, value] of [['C₂', '0.05792105'], ['C₃', '238.0185'], ['C₄', '0.00167917'], ['C₅', '57.362']]) {
    assert.ok(plot.texts.includes(`${name} = `) && plot.texts.includes(value), `${name} = ${value} with every digit the page gives`);
}
assert.ok(!plot.texts.includes('C₁ = '), 'a zero coefficient is not listed');
const edwards = {
    type: 'formula', riiFormulaNum: 7, formulaCoeffs: [3.41983, 0.159906, -0.123109, 1.26878E-6, -1.95104E-9],
    wavelengthRange: [2437.3, 25000], references: '', comments: '', dataPath: 'main/Si/nk/Edwards.yml',
};
const siTexts = renderPanel(edwards).texts;
assert.ok(siTexts.includes('1.26878e-6') && siTexts.includes('-1.95104e-9'),
    'small coefficients in one notation, every digit kept');
assert.equal(renderPanel(tablePage).of(KaTeXSpan).length, 0, 'a table page shows no formula');

const withK = { ...ciddor, riiFormulaNum: 2, formulaCoeffs: [0, 1.1, 0.01], tableK: [[300, 1e-3], [1000, 1e-4]] };
assert.ok(renderPanel(withK).texts.includes('Formula 2, Sellmeier-2, tabulated k'), 'a formula page with a k table says so');

// The registry writes out a series as far as the page goes, and a fixed
// formula whole.
assert.equal(riiFormulaLatex(2, 3), 'n^2 - 1 = C_{1} + \\dfrac{C_{2}\\lambda^2}{\\lambda^2 - C_{3}}');
assert.equal(riiFormulaLatex(4, 11),
    'n^2 = C_{1} + \\dfrac{C_{2}\\lambda^{C_{3}}}{\\lambda^2 - C_{4}^{C_{5}}} + \\dfrac{C_{6}\\lambda^{C_{7}}}{\\lambda^2 - C_{8}^{C_{9}}} + C_{10}\\lambda^{C_{11}}');
assert.match(riiFormulaLatex(7, 5), /C_\{6\}\\lambda\^6$/, 'Herzberger shows all six terms');
assert.equal(riiFormulaLatex(10, 3), null, 'a formula the database does not define has none');

// ── A long formula does not push the action bar out ──────────────────────────
// HIKARI E-K3 is a Polynomial with eleven coefficients: three rows of chips.
// The details and the formula shrink and scroll as one block; the tabs, the
// probe and Add to Catalog stay outside it, so the dialog's fixed height cannot
// clip them.
{
    const ek3 = {
        type: 'formula', riiFormulaNum: 3, wavelengthRange: [400, 700], references: '', comments: '', dataPath: 'specs/HIKARI/E-K3.yml',
        formulaCoeffs: [2.2707833, -0.00772009861, 2, 0.0126286148, -2, -0.0000460005382, -4, 0.0000330622876, -6, -0.00000137462973, -8],
    };
    const { nodes } = renderPanel(ek3);
    const scrolling = nodes.filter(node => node?.props?.style?.overflowY === 'auto' && node.props.style.flex === '0 1 auto');
    assert.equal(scrolling.length, 1, 'one block above the tabs scrolls');
    const inside = flatten(scrolling[0]);
    assert.ok(inside.some(node => node?.type === KaTeXSpan), 'the formula is in it');
    assert.ok(inside.includes('Formula 3, Polynomial'), 'and the details');
    assert.ok(!inside.some(node => node?.type === TabBtn || node?.type === NkProbe), 'the tabs and the probe are not');
    assert.ok(!inside.some(node => node?.props?.label === rii.addToCatalog), 'nor is Add to Catalog');
    assert.ok(nodes.some(node => node?.props?.label === rii.addToCatalog), 'which is still in the panel');
}

// ── The band a formula gives no real n in ────────────────────────────────────

const cs2 = {
    type: 'formula', riiFormulaNum: 1, formulaCoeffs: [0, 1.499426, 0.178763, 0.089531, 6.591946],
    wavelengthRange: [300, 12000], references: '', comments: '', dataPath: 'main/CS2/nk/Chemnitz.yml',
};
const cs2Panel = renderPanel(cs2);
assert.ok(cs2Panel.texts.includes(rii.leftOut('6493–6558 nm')), 'the panel names the band');
assert.match(rii.leftOut('6493–6558 nm'), /gets no result there/, 'and says a design gets nothing there');
const cs2Probe = cs2Panel.of(NkProbe)[0].props.getNK;
assert.ok(Number.isNaN(cs2Probe(6525)[0]), 'the probe reads no n inside the band, as the stored formula has none');
assert.ok(cs2Probe(6620)[0] > 3, 'and a real n past it');
assert.ok(!plot.texts.some(text => text.startsWith('The formula gives no real n')), 'a page real over its range says nothing');

console.log('rii_browser_panel: passed');
