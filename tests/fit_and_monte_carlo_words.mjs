/**
 * The dispersion fit text and Monte Carlo's no-layers message read in the
 * language shown.
 *
 *   - The Material Editor's fit panel and n,k Characterization's results word
 *     a fit's model, range, parameter units, wavelength unit, residual and
 *     errors from t.dispersionFit and t.units, so a Russian, Chinese or Italian
 *     user reads none of them in English. Both are drawn here in Russian.
 *   - Monte Carlo's run, given no layer to perturb, sets the window's own
 *     message rather than an English literal.
 *
 * Run: node tests/fit_and_monte_carlo_words.mjs
 */

import './_kernel.mjs';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const { getLocale } = await import('../src/constants/locales/index.js');
const { fitTabulatedMaterial, dispersionFitParameters, metalFitDiagnostics } =
    await import('../src/utils/materials/dispersionFits.js');
const { dispersionFitErrorText, dispersionFitModelText, fitParameterLabel } =
    await import('../src/utils/materials/dispersionFitText.js');
const { renderFitPanel } = await import('../src/components/windows/design/materialEditor/fitPanel.js');
const { materialToDraft } = await import('../src/components/windows/design/materialEditor/materialDraft.js');
const { resultRows } = await import('../src/components/windows/dataExchange/nkCharacterization/resultsModel.js');
const { executeRun } = await import('../src/components/windows/analysis/errorAnalysis/useErrorAnalysis.js');

const h = React.createElement;
const LANGUAGES = ['en', 'ru', 'zh', 'it'];
// English words of the fit text. Italian "oscillatore" and "termini" are not
// among them.
const ENGLISH_WORDS = /\bterms?\b|\boscillators?\b|\bresidual\b|\bFit:|\bin µm\b|\bfit\b/;

// A transparent oxide with a weak absorption edge, so the Cauchy and Sellmeier
// fits carry an Urbach k.
const oxide = [];
for (let nm = 400; nm <= 900; nm += 25) {
    const um = nm / 1000;
    oxide.push([nm, 2.0 + 0.02 / um ** 2, 1e-3 * Math.exp(-3 * um)]);
}
// A Drude metal sampled from its own model.
const metalRows = [];
for (let nm = 400; nm <= 900; nm += 10) {
    const energy = 1.239841984 / (nm / 1000);
    const epsilon = [3 - 81 / (energy ** 2 + 0.01), 0.9 / energy];
    const magnitude = Math.hypot(...epsilon);
    metalRows.push([nm, Math.sqrt((magnitude + epsilon[0]) / 2), Math.sqrt((magnitude - epsilon[0]) / 2)]);
}
// A Drude-Lorentz fit with one oscillator, its strength and damping on their caps.
const atTheCap = {
    rangeNm: [400, 800],
    residuals: { n: { rms: 1e-3, max: 2e-3 }, k: { rms: 1e-3, max: 2e-3 } },
    complex: {
        kind: 'drude-lorentz', epsilonInfinity: 3, plasmaEnergyEv: 9, drudeDampingEv: 0.1,
        oscillators: [{ strengthEv2: 3000, resonanceEv: 28.7, dampingEv: 50 }],
    },
};

const cauchy = fitTabulatedMaterial(oxide, { nModel: 'cauchy', nTerms: 3 });
const sellmeier = fitTabulatedMaterial(oxide, { nModel: 'sellmeier', nTerms: 2 });
const drude = fitTabulatedMaterial(metalRows, { nModel: 'drude' });

const refusal = (rows, options) => {
    try { fitTabulatedMaterial(rows, options); } catch (error) { return error; }
    return null;
};
const tooFew = refusal(oxide.slice(0, 3), { nModel: 'cauchy' });
const narrow = refusal(oxide, { nModel: 'cauchy', rangeNm: [400, 460] });
assert.equal(tooFew?.code, 'tooFewRows', 'a table of three rows is refused by its code');
assert.equal(narrow?.code, 'tooFewInRange', 'a range holding three rows is refused by its code');
assert.equal(getLocale('en').dispersionFit.errors.tooFewRows, tooFew.message,
    'the English text is the message the fit throws');

for (const language of LANGUAGES) {
    const t = getLocale(language);
    const words = t.dispersionFit;
    const models = [cauchy, sellmeier, drude, atTheCap].map(fit => dispersionFitModelText(fit, words, t.units));
    for (const text of models) {
        assert.ok(text.includes(t.units.nm), `${language}: the range is in the language's nm: ${text}`);
        if (language !== 'en') assert.doesNotMatch(text, ENGLISH_WORDS, `${language}: no English in ${text}`);
    }
    assert.ok(models[0].startsWith(words.terms(words.models.cauchy, 3)), `${language}: ${models[0]}`);
    assert.ok(models[1].startsWith(words.terms(words.models.sellmeier, 2)), `${language}: ${models[1]}`);
    assert.ok(models[2].startsWith(words.models.drude) && !models[2].startsWith(words.drudeLorentz(1)),
        `${language}: a Drude fit is named Drude`);
    assert.ok(models[3].startsWith(words.drudeLorentz(1)), `${language}: ${models[3]}`);

    const labels = dispersionFitParameters(cauchy).parameters.map(parameter => fitParameterLabel(parameter, t.units));
    assert.equal(labels[1], `A1 (${t.units.um}²)`, `${language}: A1 carries the language's µm`);
    assert.equal(labels.at(-1), `kc (1/${t.units.um})`, `${language}: kc is per µm`);
    assert.deepEqual(metalFitDiagnostics(atTheCap).pinned.map(parameter => fitParameterLabel(parameter, t.units)),
        [`f1 (${t.units.eV}²)`, `γ1 (${t.units.eV})`], `${language}: a parameter on its cap is named in the language's eV`);

    assert.equal(dispersionFitErrorText(tooFew, words), words.errors.tooFewRows, `${language}: the refusal in words`);
    assert.equal(dispersionFitErrorText(narrow, words), words.errors.tooFewInRange, `${language}: the range refusal in words`);
}

// ── The fit panel, drawn in Russian ──────────────────────────────────────────
{
    const t = getLocale('ru');
    const draft = materialToDraft('user', {
        id: 'oxide', name: 'Oxide', formulaNum: -1, tabData: oxide, dispersionFit: cauchy,
    });
    const html = renderToStaticMarkup(h('div', null, renderFitPanel({
        draft, set() {}, runFit() {}, fitError: tooFew, workingNm: null, suggestion: null,
        onSuggest() {}, onApplySuggestion() {},
        me: t.materialEditor, fitWords: t.dispersionFit, units: t.units, c: makeTheme(),
        sectionLabel: text => h('div', null, text), inputStyle: {}, labelStyle: {},
    })));
    const text = html.replace(/<[^>]+>/g, ' ');
    assert.ok(text.includes('Коши') && text.includes('Селлмейер'), 'the model droplist is in Russian');
    assert.ok(text.includes(dispersionFitModelText(cauchy, t.dispersionFit, t.units)), 'the fitted model is named in Russian');
    assert.ok(text.includes('λ в мкм') && text.includes('A1 (мкм²)'), 'the formula and the units are in Russian');
    assert.ok(text.includes('Невязка по n'), 'the residual is in Russian');
    assert.ok(text.includes(t.dispersionFit.errors.tooFewRows), 'the refusal is in Russian');
    assert.doesNotMatch(text, ENGLISH_WORDS, 'no English in the panel');
}

// ── n,k Characterization's results, in Russian ───────────────────────────────
{
    const t = getLocale('ru');
    const result = {
        fit: cauchy, thicknessNm: 250, thicknessStatus: 'fitted', thicknessSpreadNm: 0.5,
        residuals: { T: { rms: 1e-3, max: 2e-3 } },
        diagnostics: { indexRange: [2.0, 2.1], extinctionRange: [1e-4, 1e-3], resolvableExtinction: 1e-4 },
        pointwise: { resolved: [true] }, lambdas: [500],
    };
    const rows = resultRows(result, t.nkCharacterization, t.units, t.dispersionFit);
    const model = rows.find(row => row.quantity === t.nkCharacterization.rowModel);
    assert.equal(model.value, dispersionFitModelText(cauchy, t.dispersionFit, t.units), 'the model row is in Russian');
    assert.ok(rows.some(row => row.quantity.endsWith('A1 (мкм²)')), 'a parameter row carries мкм');
    for (const row of rows) assert.doesNotMatch(`${row.quantity} ${row.value}`, ENGLISH_WORDS);
}

// ── Monte Carlo with no layer to perturb ─────────────────────────────────────
{
    const message = getLocale('ru').errorAnalysis.noLayers;
    const design = { id: 'empty', name: 'Empty', frontLayers: [], backLayers: [] };
    let shown;
    await executeRun({ design, evalMode: 'front', noLayersMessage: message, setError: value => { shown = value; } });
    assert.equal(shown, message, 'the run sets the window\'s own message');
}

console.log('PASS: fit_and_monte_carlo_words');
