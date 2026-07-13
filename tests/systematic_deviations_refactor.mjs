import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    loadApp,
    makeLocale,
    makeTheme,
    shimBrowserGlobals,
    withDesign,
} from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const [{ SystematicDeviations }, model, runner] = await Promise.all([
    import('../src/components/windows/analysis/systematicDeviations/SystematicDeviations.js'),
    import('../src/components/windows/analysis/systematicDeviations/model.js'),
    import('../src/components/windows/analysis/systematicDeviations/useSystematicDeviations.js'),
]);

assert.deepEqual(model.defaultSweepRange('globalThicknessScale'), { from: 0.95, to: 1.05 });
assert.deepEqual(model.defaultSweepRange('mat:TiO2:dn'), { from: -0.05, to: 0.05 });
assert.deepEqual(model.defaultSweepRange('globalDeltaK'), { from: -0.01, to: 0.01 });
assert.deepEqual(model.defaultSweepRange('mat:SiO2:dOffset', 'qw'), { from: -0.1, to: 0.1 });
assert.deepEqual(model.defaultSweepRange('globalThicknessOffset', 'fw'), { from: -0.05, to: 0.05 });
assert.deepEqual(model.defaultSweepRange('globalThicknessOffset', 'ot'), { from: -10, to: 10 });

const materialBase = runner.sweepBaseDeviation({
    param: 'mat:SiO2:dOffset', offsetUnit: 'qw',
});
assert.deepEqual(materialBase.perMaterial.SiO2, {
    dn: 0, dk: 0, dScale: 1, dOffset: 0, dOffsetUnit: 'qw',
});

const c = makeTheme();
const html = renderToStaticMarkup(withDesign(
    React.createElement(SystematicDeviations, { c, t: makeLocale(), theme: c }),
));
assert.equal(createHash('sha256').update(html).digest('hex').slice(0, 16), 'fb8444873121eeba');

console.log('PASS: systematic_deviations_refactor');
