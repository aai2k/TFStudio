/**
 * Material Dispersion's notice for samples it cannot compute is written in the
 * UI language. The reason itself comes from the dispersion engine and is shown
 * as it comes; the sentences around it, the thickness limit and the thickness
 * unit switch's accessible name come from the locale.
 */
import assert from 'node:assert/strict';
import { loadApp, makeLocale, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const { invalidSummary } = await import(
    '../src/components/windows/analysis/materialDispersion/MaterialDispersionEvaluation.js');

const oneReason = { invalid: [{ reason: 'phase wraps', maximumThicknessMm: 2 }, { reason: 'phase wraps' }] };
const twoReasons = { invalid: [{ reason: 'phase wraps' }, { reason: 'beyond data' }, { reason: 'beyond data' }] };

for (const code of ['en', 'ru', 'zh', 'it']) {
    const { gdgdd: text, units } = makeLocale(code);
    const one = invalidSummary(oneReason, 'mm', text, units);
    const two = invalidSummary(twoReasons, 'mm', text, units);
    assert.ok(one.includes('phase wraps') && one.includes('2'), `${code}: the reason and the count are shown`);
    assert.ok(two.includes('3') && two.includes('2'), `${code}: the count and the number of reasons are shown`);
    assert.equal(invalidSummary({ invalid: [] }, 'mm', text, units), null, `${code}: nothing masked, no notice`);
    if (code !== 'en') {
        for (const english of ['samples masked', 'Set thickness', 'or less for the full range']) {
            assert.ok(!one.includes(english) && !two.includes(english), `${code}: "${english}" is not left in English`);
        }
        assert.notEqual(text.thicknessUnit, 'Thickness unit', `${code}: the unit switch has its own name`);
    }
}
assert.equal(invalidSummary(oneReason, 'mm', makeLocale('en').gdgdd, makeLocale('en').units),
    '2 samples masked: phase wraps Set thickness to 2 mm or less for the full range.', 'English reads as before');

console.log('PASS material_dispersion_masked_notice');
