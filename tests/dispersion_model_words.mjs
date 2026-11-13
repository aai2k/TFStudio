/**
 * The dispersion models Group Delay / GDD lists under Models read in the
 * language shown, and in English exactly as the API gives them.
 *
 *   - materialOmegaResponse gives each model in parts beside its English name;
 *     worded in English the parts are that name, for a formula, a table, a
 *     constant, a fit and a split n and k, so the window and the API never
 *     disagree.
 *   - The sampling note in Russian names tables, fits, formulas, constants and
 *     a substrate without a name in Russian.
 *
 * Run: node tests/dispersion_model_words.mjs
 */

import './_kernel.mjs';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const { getLocale } = await import('../src/constants/locales/index.js');
const { getMaterial } = await import('../src/utils/materials/materialDatabase.js');
const { materialOmegaResponse } = await import('../src/utils/materials/materialDispersion.js');
const { fitTabulatedMaterial } = await import('../src/utils/materials/dispersionFits.js');
const { materialModelText } = await import('../src/utils/materials/materialModelText.js');
const { modelNotes } = await import('../src/utils/physics/phaseDispersion/modelNotes.js');
const { SamplingNote } = await import('../src/components/windows/analysis/gdGddEvaluation/GDControls.js');

const h = React.createElement;
const en = getLocale('en');
const ru = getLocale('ru');

// ── Worded in English, the parts are the name the API gives ──────────────────
const rows = [];
for (let nm = 400; nm <= 900; nm += 25) rows.push([nm, 2.0 + 0.02 / (nm / 1000) ** 2, 1e-3 * Math.exp(-3 * nm / 1000)]);
const fitted = { id: 'oxide', name: 'Oxide', getNK: getMaterial('TiO2').getNK, dispersionFit: fitTabulatedMaterial(rows, { nModel: 'cauchy' }) };
const constant = { id: 'glass', name: 'Glass', getNK: Object.assign(() => [1.5, 0], { constantNK: [1.5, 0] }) };
for (const material of [getMaterial('SiO2'), getMaterial('TiO2'), getMaterial('Ag'), getMaterial('BK7'), constant, fitted]) {
    const response = materialOmegaResponse(material, 600);
    assert.ok(response.modelParts, `${material.name}: the model comes in parts`);
    assert.equal(materialModelText(response.modelParts, en), response.model, `${material.name}: ${response.model}`);
}

// ── The sampling note in Russian ─────────────────────────────────────────────
{
    const entry = (material, role, model, n, k = n) => ({ material, role, response: { model, modelParts: { n, k } } });
    const notes = modelNotes([
        entry('TiO2', 'layer', 'Table (PCHIP)', { kind: 'table', interp: 'pchip' }),
        entry(null, 'substrate', 'n: Formula 9999; k: Zero', { kind: 'formula', formulaNum: 9999 }, { kind: 'zero' }),
        entry('Glass', 'incident', 'n: Constant; k: Table (linear)', { kind: 'constant' }, { kind: 'table', interp: 'linear' }),
        entry('Oxide', 'layer', 'Fit', { kind: 'fit', fit: fitted.dispersionFit }),
    ]);
    const html = renderToStaticMarkup(h(SamplingNote, { c: makeTheme(), t: ru, raw: { ...notes, adaptivePointCount: 0 } }));
    const text = html.replace(/<[^>]+>/g, ' ');
    for (const russian of ['Таблица (PCHIP)', 'Таблица (линейная)', 'Подложка: n: Формула 9999; k: Ноль', 'Константа', 'Аппроксимация: Коши']) {
        assert.ok(text.includes(russian), `the note says "${russian}": ${text}`);
    }
    assert.doesNotMatch(text, /Table|Fit:|Constant|Zero|Substrate|Formula|Cauchy/, 'no English in the note');
}

console.log('PASS: dispersion_model_words');
