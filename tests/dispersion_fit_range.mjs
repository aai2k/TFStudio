/**
 * A fit covers the band it was made over, and that band is the user's.
 *
 * The fit panel had no range of its own: it fitted between the λ min and λ max
 * boxes at the top of the form, which are the material's stated validity range.
 * For a tabular material those are replaced on save by the table's own first and
 * last wavelength, so a narrowed band survived until the next save and the next
 * Refit widened silently back to the whole table.
 *
 * A table can cover far more photon energy than any one dispersion model
 * describes, which makes the whole table the worst band to fit over. The fit now
 * carries its own range, the range comes back on the next load, and a band
 * spanning more than a decade of photon energy is reported as such with the band
 * the design is evaluated over offered in its place.
 *
 * Run: node tests/dispersion_fit_range.mjs
 */
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';
import {
    anchoredFitRange, photonEnergyDecades, WIDE_BAND_DECADES,
} from '../src/utils/materials/dispersionFitRange.js';
import {
    evaluateComplexDispersionModel, fitTabulatedMaterial,
} from '../src/utils/materials/dispersionFits.js';

shimBrowserGlobals();
await loadApp();

const { makeGetNK } = await import('../src/utils/materials/catalogManager/dispersion.js');
const { draftToMaterial, fitRangeNm, materialToDraft } =
    await import('../src/components/windows/design/materialEditor/materialDraft.js');
const { UserMaterialForm } = await import('../src/components/windows/design/materialEditor/userMaterialForm.js');
const { fitActions } = await import('../src/components/windows/design/materialEditor/fitPanel.js');

const me = makeLocale().materialEditor;

// A silver-shaped table from 100 nm to 10 µm: two decades of photon energy, the
// span a real coinage-metal table covers. The model is the one a fit of the
// visible part of such a table returns.
const silver = {
    kind: 'drude-lorentz',
    epsilonInfinity: 3.26, plasmaEnergyEv: 8.77, drudeDampingEv: 0.058,
    oscillators: [
        { strengthEv2: 3.13, resonanceEv: 3.74, dampingEv: 0.1 },
        { strengthEv2: 14.8, resonanceEv: 4.56, dampingEv: 8.06 },
    ],
};
const ROWS = 80;
const table = Array.from({ length: ROWS }, (_, index) => {
    const nm = 100 * 10 ** ((2 * index) / (ROWS - 1));
    return [nm, ...evaluateComplexDispersionModel(silver, nm)];
});
const tableNm = table.map(row => row[0]);
const WORKING = [400, 800];

// ── The band, as a span of photon energy ──────────────────────────────────────

assert.equal(Math.round(photonEnergyDecades([tableNm[0], tableNm[ROWS - 1]])), 2,
    'the table covers two decades of photon energy');
assert.ok(photonEnergyDecades(WORKING) < WIDE_BAND_DECADES,
    'and a band anyone deposits in covers well under one');

// ── The band to offer someone designing over 400 to 800 nm ────────────────────

assert.deepEqual(anchoredFitRange(tableNm, WORKING), WORKING,
    'the working band is offered as it stands where the table covers it');
assert.deepEqual(anchoredFitRange(tableNm, [50, 800]), [tableNm[0], 800],
    'and is clipped to the table rather than extrapolating past its last row');
assert.equal(anchoredFitRange(tableNm, [20000, 30000]), null,
    'a table with nothing where the user works has nothing to offer');

// A band holding too few rows to fit is widened outward until it holds enough.
const narrow = anchoredFitRange(tableNm, [500, 505]);
assert.ok(narrow[0] < 500 && narrow[1] > 505, 'a band too narrow to fit is widened outward');
assert.ok(tableNm.filter(nm => nm >= narrow[0] && nm <= narrow[1]).length >= 4,
    'until it holds the four rows a fit needs');

// ── The band survives a save and a reload, and a Refit does not widen it ──────

const fitted = fitTabulatedMaterial(table, { nModel: 'drude-lorentz', rangeNm: WORKING });
const material = {
    id: 'silver_lab', name: 'Silver (lab)', formulaNum: -1, tabData: table,
    coefficients: [], kTable: [], lambdaMin: 0.1, lambdaMax: 10,
    dispersionFit: { ...fitted, active: true },
};

const reloaded = materialToDraft('user_lab', material);
assert.deepEqual([reloaded.fitRangeMinNm, reloaded.fitRangeMaxNm], ['400', '800'],
    'the stored band comes back in the fit range boxes');
assert.deepEqual(draftToMaterial(reloaded).dispersionFit.rangeNm, WORKING,
    'and a save keeps it, where the validity range is overwritten by the table');
assert.equal(draftToMaterial(reloaded).lambdaMin, tableNm[0] / 1000,
    'the validity range is the table, as it always was');
assert.deepEqual(fitRangeNm(reloaded, [1000, 2000]), WORKING,
    'a Refit uses the band the fit was made over, not the design of the day');

// With no band set, the design is what the fit is offered, and the whole table
// is what is left when the design is nowhere near the material.
const fresh = { ...reloaded, fitRangeMinNm: '', fitRangeMaxNm: '' };
assert.deepEqual(fitRangeNm(fresh, WORKING), WORKING, 'an unset band follows the design');
assert.deepEqual(fitRangeNm(fresh, [20000, 30000]), [tableNm[0], tableNm[ROWS - 1]],
    'and falls back to the whole table');

// Each edge stands on its own, and neither leaves the table: a fit read past
// the last row it was made from is a model extrapolated, not a material.
assert.deepEqual(fitRangeNm({ ...fresh, fitRangeMinNm: '500' }, WORKING), [500, 800],
    'one box filled keeps the typed edge and the offer for the other');
assert.deepEqual(fitRangeNm({ ...fresh, fitRangeMinNm: '1', fitRangeMaxNm: '900000' }, WORKING),
    [tableNm[0], tableNm[ROWS - 1]], 'and a band wider than the table is held inside it');

// ── The fit is read inside its band and the table outside it ──────────────────

const cauchy = fitTabulatedMaterial(table, { nModel: 'cauchy', rangeNm: WORKING });
const getNK = makeGetNK({ ...material, dispersionFit: { ...cauchy, active: true } });
const inside = table.find(row => row[0] > 500 && row[0] < 700);
const outside = table.find(row => row[0] > 2000);
assert.ok(cauchy.residuals.n.rms > 1e-6, 'a Cauchy over an absorbing metal does not match it exactly');
assert.notEqual(getNK(inside[0])[0], inside[1], 'inside the band the fit is what is read');
assert.equal(getNK(outside[0])[0], outside[1], 'outside it the table is read as it stands');

// ── The window says when the band is wider than any model covers ──────────────

const html = renderToStaticMarkup(React.createElement(UserMaterialForm, {
    draft: { ...reloaded, fitRangeMinNm: String(tableNm[0]), fitRangeMaxNm: String(tableNm[ROWS - 1]) },
    onChange() {}, onSave() {}, onRevert() {}, onDelete() {},
    dirty: false, catalogs: [], workingNm: WORKING, c: makeTheme(), t: makeLocale(),
}));
assert.ok(html.includes('decades of photon energy'),
    'a fit over two decades of photon energy is reported as such');
assert.ok(html.includes(me.fitTryRange(400, 800)),
    'with the band the design is evaluated over offered in its place');

// ── The offer is fitted first, then installed on the second click ────────────

{
    const wide = { ...reloaded, fitRangeMinNm: String(tableNm[0]), fitRangeMaxNm: String(tableNm[ROWS - 1]) };
    let suggestion = null;
    let changed = null;
    const actions = () => fitActions({
        draft: wide, onChange: value => { changed = value; }, workingNm: WORKING, suggestion,
        setFitError() {}, setSuggestion: value => { suggestion = value; },
    });

    actions().onSuggest();
    assert.deepEqual(suggestion.rangeNm, WORKING, 'the offer is the band the design is evaluated over');
    assert.ok(suggestion.fit.residuals.n.rms > 0, 'fitted, so the panel can say what it reaches');
    assert.equal(changed, null, 'and nothing has happened to the material yet');

    const offered = suggestion;
    actions().onApplySuggestion();
    assert.deepEqual(changed.dispersionFit.rangeNm, WORKING, 'accepting it installs that fit');
    assert.deepEqual([changed.fitRangeMinNm, changed.fitRangeMaxNm], ['400', '800'],
        'and the boxes follow the fit rather than drifting from it');

    // A row edited after the offer was made leaves it a fit of rows the table no
    // longer holds, which is what every row edit drops the fit to prevent.
    changed = null;
    const edited = { ...wide, rows: wide.rows.slice(0, -1), dispersionFit: null };
    fitActions({
        draft: edited, onChange: value => { changed = value; }, workingNm: WORKING,
        suggestion: offered, setFitError() {}, setSuggestion() {},
    }).onApplySuggestion();
    assert.equal(changed, null, 'an offer made from rows that have since changed is not installed');

    // And the same offer still installs on the draft it was made from.
    fitActions({
        draft: wide, onChange: value => { changed = value; }, workingNm: WORKING,
        suggestion: offered, setFitError() {}, setSuggestion() {},
    }).onApplySuggestion();
    assert.deepEqual(changed.dispersionFit.rangeNm, WORKING, 'while the offer itself is still good');
}

const narrowHtml = renderToStaticMarkup(React.createElement(UserMaterialForm, {
    draft: reloaded, onChange() {}, onSave() {}, onRevert() {}, onDelete() {},
    dirty: false, catalogs: [], workingNm: WORKING, c: makeTheme(), t: makeLocale(),
}));
assert.ok(!narrowHtml.includes('decades of photon energy'),
    'a band one model can cover is left alone');

console.log('PASS: dispersion_fit_range');
