/**
 * Material Dispersion's notice for samples it cannot compute is written in the
 * UI language: the reason, worded from the code the dispersion engine gives it,
 * the sentences around it, the thickness limit and the thickness unit switch's
 * accessible name all come from the locale.
 */
import assert from 'node:assert/strict';
import { loadApp, makeLocale, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const { invalidSummary } = await import(
    '../src/components/windows/analysis/materialDispersion/MaterialDispersionEvaluation.js');
const { materialPropagationDispersion } = await import('../src/utils/materials/materialDispersion.js');

const extinguished = { reasonCode: 'extinguished', material: 'Ag' };
const noDerivatives = { reasonCode: 'noDerivatives', material: 'Ag' };
const oneReason = { invalid: [{ ...extinguished, maximumThicknessMm: 2 }, extinguished] };
const twoReasons = { invalid: [extinguished, noDerivatives, noDerivatives] };

for (const code of ['en', 'ru', 'zh', 'it']) {
    const { gdgdd: text, units } = makeLocale(code);
    const one = invalidSummary(oneReason, 'mm', text, units);
    const two = invalidSummary(twoReasons, 'mm', text, units);
    assert.ok(one.includes(text.maskedExtinguished('Ag')) && one.includes('2'), `${code}: the reason and the count are shown`);
    assert.ok(two.includes('3') && two.includes('2'), `${code}: the count and the number of reasons are shown`);
    assert.equal(invalidSummary({ invalid: [] }, 'mm', text, units), null, `${code}: nothing masked, no notice`);
    if (code !== 'en') {
        for (const english of ['samples masked', 'Set thickness', 'or less for the full range', 'extinguished', 'derivatives']) {
            assert.ok(!one.includes(english) && !two.includes(english), `${code}: "${english}" is not left in English`);
        }
        assert.notEqual(text.thicknessUnit, 'Thickness unit', `${code}: the unit switch has its own name`);
    }
}
assert.equal(invalidSummary(oneReason, 'mm', makeLocale('en').gdgdd, makeLocale('en').units),
    '2 samples masked: Ag: direct pulse is extinguished at this thickness Set thickness to 2 mm or less for the full range.',
    'English reads as the engine words it');

// The engine gives each masked sample its code and material beside the
// English reason the API returns.
{
    const absorber = { id: 'absorber', name: 'Absorber', getNK: Object.assign(() => [2, 1], { constantNK: [2, 1] }) };
    const masked = materialPropagationDispersion(absorber, 500, 10);
    assert.deepEqual([masked.valid, masked.reasonCode, masked.material], [false, 'extinguished', 'Absorber']);
    assert.equal(masked.reason, makeLocale('en').gdgdd.maskedExtinguished('Absorber'),
        'the English reason is the one the window words in English');
}

console.log('PASS material_dispersion_masked_notice');
