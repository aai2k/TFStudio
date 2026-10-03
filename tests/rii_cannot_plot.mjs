/**
 * A refractiveindex.info page the importer cannot evaluate shows why in place
 * of its chart, and the Material Editor stays up.
 *
 * Selecting the air page by Ciddor replaced the whole Material Editor with its
 * error screen: formula 6 threw while the chart drew, and nothing in the
 * browser caught it. Formulas 6 to 9 are now evaluated. A formula number
 * outside 1 to 9 still throws, and the panel shows that error where the chart
 * would be.
 *
 * Run: node tests/rii_cannot_plot.mjs
 */

import assert from 'node:assert/strict';

globalThis.React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useRef: initial => ({ current: initial }),
    useEffect: () => {},
    useState: initial => [initial, () => {}],
};

const { renderRiiRightPanel } = await import('../src/components/windows/design/materialEditor/riiRightPanel.js');
const { RiiChart } = await import('../src/components/windows/design/materialEditor/riiChart.js');
const { riiToMaterialEntry, sampleMaterial } = await import('../src/utils/materials/riiDatabase.js');
const { makeGetNK } = await import('../src/utils/materials/catalogManager/dispersion.js');
const { getLocale } = await import('../src/constants/locales/index.js');

const rii = getLocale('en').riiDatabase;
const me = getLocale('en').materialEditor;

function flatten(node, out = []) {
    if (Array.isArray(node)) { node.forEach(child => flatten(child, out)); return out; }
    if (node == null || node === false) return out;
    if (typeof node !== 'object') { out.push(node); return out; }
    out.push(node);
    flatten(node.children, out);
    return out;
}

function renderPanel(mat) {
    const tree = renderRiiRightPanel({
        c: { bg: '#111', border: '#333', text: '#eee', textDim: '#999' },
        rii, me, mat, matLoading: false, matErr: null, sampleTab: 'plot', setSampleTab: () => {},
        selected: { bookName: 'book', pageName: 'page' },
        wavelengthLabel: 'Wavelength (nm)', phase: 'idle', addMsg: '',
        handleAddClick: () => {}, userCatalogs: [],
    });
    const nodes = flatten(tree);
    return {
        texts: nodes.filter(node => typeof node === 'string'),
        hasChart: nodes.some(node => node.type === RiiChart),
    };
}

// ── A formula number the database does not define ───────────────────────────

const unknown = {
    type: 'formula', riiFormulaNum: 10, formulaCoeffs: [1, 2, 3],
    wavelengthRange: [400, 800], references: '', comments: '', dataPath: 'test/formula10.yml',
};
const failed = renderPanel(unknown);
assert.equal(failed.hasChart, false, 'no chart is drawn for a page that cannot be sampled');
const line = failed.texts.find(text => text.startsWith(rii.cannotPlot('')));
assert.ok(line, 'the panel says the page cannot be plotted');
assert.match(line, /formula 10/, `and why: ${line}`);
assert.ok(failed.texts.includes('—'), 'the range line shows no range');
assert.throws(() => riiToMaterialEntry(unknown, 'p', 'b'), /formula 10/,
    'adding it to a catalog fails with the same reason, which the add action reports');

// ── A formula that gives no finite n inside the stated range ────────────────
//
// Retro with (n² − 1)/(n² + 2) above 1 has no real n.

const noRealN = { ...unknown, riiFormulaNum: 8, formulaCoeffs: [1.2, 0, 0, 0], dataPath: 'test/retro.yml' };
const noN = renderPanel(noRealN);
assert.equal(noN.hasChart, false, 'a formula with no real n in range draws no chart');
assert.ok(noN.texts.some(text => /formula 8 gives no real n anywhere from 400 to 800 nm/.test(text)), 'and says it is real nowhere in range');

// The reason is in the user's language, not only the line around it.
{
    const ru = getLocale('ru').riiDatabase;
    const { sampleErrorText } = await import('../src/components/windows/design/materialEditor/riiRightPanel.js');
    let thrown;
    try { riiToMaterialEntry(noRealN, 'p', 'b'); } catch (err) { thrown = err; }
    assert.equal(sampleErrorText(thrown, ru), ru.noRealN(8, 400, 800), 'no real n, in Russian');
    try { riiToMaterialEntry(unknown, 'p', 'b'); } catch (err) { thrown = err; }
    assert.equal(sampleErrorText(thrown, ru), ru.unknownFormula(10), 'an unknown formula, in Russian');
    assert.equal(sampleErrorText(new Error('network down'), ru), 'network down', 'any other error keeps its own message');
}

// ── One page per formula 6 to 9, the ones that took the window down ─────────
//
// Coefficients and ranges as the database pages give them.

const pages = [
    { dataPath: 'other/mixed gases/air/nk/Ciddor.yml', riiFormulaNum: 6,
      formulaCoeffs: [0, 0.05792105, 238.0185, 0.00167917, 57.362], wavelengthRange: [230, 1690], range: '230–1690 nm' },
    { dataPath: 'other/liquid crystals/5CB/nk/Wu-25.1C-e.yml', riiFormulaNum: 6,
      formulaCoeffs: [0.4552, 2.3250, 22.6757, 1.3970, 12.5748], wavelengthRange: [400, 800], range: '400–800 nm' },
    { dataPath: 'main/Si/nk/Edwards.yml', riiFormulaNum: 7,
      formulaCoeffs: [3.41983, 0.159906, -0.123109, 1.26878E-6, -1.95104E-9], wavelengthRange: [2437.3, 25000], range: '2437–25000 nm' },
    { dataPath: 'main/AgBr/nk/Schroter.yml', riiFormulaNum: 8,
      formulaCoeffs: [0.452505, 0.09939, 0.070537, -0.000150], wavelengthRange: [495, 670], range: '495–670 nm' },
    { dataPath: 'organic/CH4N2O - urea/nk/Rosker-e.yml', riiFormulaNum: 9,
      formulaCoeffs: [2.51527, 0.0240, 0.0300, 0.020, 1.52, 0.8771], wavelengthRange: [300, 1060], range: '300–1060 nm' },
];
for (const { range, ...page } of pages) {
    const mat = { type: 'formula', references: '', comments: '', ...page };
    const shown = renderPanel(mat);
    assert.equal(shown.hasChart, true, `${page.dataPath} draws its chart`);
    assert.ok(shown.texts.includes(range), `${page.dataPath} states ${range}`);
    const entry = riiToMaterialEntry(mat, 'page', 'book');
    assert.equal(entry?.formulaNum, 200 + page.riiFormulaNum, `${page.dataPath} can be added to a catalog, as its formula`);
    const getNK = makeGetNK(entry);
    assert.ok(sampleMaterial(mat).every(([lam]) => getNK(lam)[0] > 1),
        `${page.dataPath} gives a finite n above 1 across its range`);
}

console.log('rii_cannot_plot: passed');
