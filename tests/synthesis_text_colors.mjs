/**
 * The optimizer windows draw no words in a fixed pale orange, which cannot be
 * read on a light theme: the warning badge carries the theme's text on a tint
 * of its warning colour, the note under the floor setting is the theme's dim
 * text, and GE's step count is the theme's warning colour.
 *
 * Run: node tests/synthesis_text_colors.mjs
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, shimBrowserGlobals, withDesign } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const api = await import('../src/api/index.js');
const { contrastRatio, getPalette, getPaletteNames } = await import('../src/constants/colorPalettes.js');
const { settingNoteStyle, warnBadgeStyle } = await import('../src/components/windows/optimization/synthesisShared/noticeStyles.js');
const W = '../src/components/windows/optimization/';
const { NeedleVariation } = await import(`${W}needleVariation/NeedleVariation.js`);
const { GradualEvolution } = await import(`${W}gradualEvolution/GradualEvolution.js`);
const { StructuralOptimizer } = await import(`${W}structuralOptimizer/StructuralOptimizer.js`);
const { DeepSynthesis } = await import(`${W}deepSynthesis/DeepSynthesis.js`);
const { NeedleManual } = await import(`${W}needleManual/NeedleManual.js`);
const { Refinement } = await import(`${W}refinement/Refinement.js`);
const { SynthesisHistoryTable } = await import(`${W}synthesisShared/SynthesisHistoryTable.js`);

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};

// The badge's words and the note read on the panel of every built-in theme.
for (const name of getPaletteNames()) {
    const c = getPalette(name);
    ok(`${name}: the warning badge's words are the theme's text`, warnBadgeStyle(c).color === c.text);
    ok(`${name}: the note under a setting is the theme's dim text`, settingNoteStyle(c).color === c.textDim);
}
const light = getPalette('Light');
ok('Light: the badge reads on the panel', contrastRatio(warnBadgeStyle(light).color, light.panel) >= 4.5);
ok('Light: the note reads on the panel', contrastRatio(settingNoteStyle(light).color, light.panel) >= 4.5);

// The windows, on the light theme, with an MNT row the floors differ from, so
// the notes show, and with no merit function, so the warning badges do.
await api.init();
const t = makeLocale();
const base = api.stackFromFormula(api.newDesign({ name: 'AR' }), { formula: '(HL)^2' });
const withMnt = api.setMerit(base, [
    { type: 'RAV', lambdaStart: 450, lambdaEnd: 650, target: 0 },
    { type: 'MNT', target: 30 },
]);
const PALE = /(?<![-\w])color:\s*(#ffa726|#ffb74d|#ff7043)/i;
const WINDOWS = { NeedleVariation, GradualEvolution, StructuralOptimizer, DeepSynthesis, NeedleManual, Refinement };
for (const [name, Window] of Object.entries(WINDOWS)) {
    for (const [label, design] of [['with an MNT row', withMnt], ['with no merit function', base]]) {
        const html = renderToStaticMarkup(withDesign(React.createElement(Window, { c: light, theme: light, t }), design));
        const hit = html.match(PALE);
        ok(`${name} ${label}: no words in a fixed pale orange`, !hit, hit && html.slice(Math.max(0, hit.index - 160), hit.index + 40));
    }
}

// The history table's side column, with a row inserted on each side.
const tn = t.needle;
const row = (id, side) => ({ id, genNum: id, side, layerCount: 4, mf: 0.1 * id, dMF: -0.01, insertMat: 'TiO2', runNum: 1 });
const table = renderToStaticMarkup(withDesign(React.createElement(SynthesisHistoryTable, {
    rows: [row(1, 'front'), row(2, 'back')], bestMF: 0.1, onRestore() {}, showSide: true, c: light,
    labels: {
        noGens: tn.noGens, genCol: tn.genCol, layersCol: tn.layersCol, mfCol: tn.mfCol, totCol: tn.totCol,
        timeCol: tn.timeCol, dMFCol: tn.dMFCol, matCol: tn.matCol, restore: tn.restore,
        runSeparator: tn.runSeparator, rescueRow: tn.rescueRow,
        sideCol: t.synthesisShell.sideCol, sideFront: t.synthesisShell.sideFront, sideBack: t.synthesisShell.sideBack,
    },
}), base));
const sideCell = label => table.match(new RegExp(`<span style="([^"]*)">${label}</span>`));
for (const label of [t.synthesisShell.sideFront, t.synthesisShell.sideBack]) {
    const cell = sideCell(label);
    ok(`history: the ${label} badge is drawn`, !!cell);
    ok(`history: the ${label} badge's words are the theme's text`, !!cell && cell[1].includes(`;color:${light.text}`), cell && cell[1]);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
