import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    loadApp, makeDesignCtx, makeLocale, makeSampleDesign, makeTheme,
    shimBrowserGlobals, withDesign,
} from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const { buildScatterLayout, buildScatterTraces } = await import(
    '../src/components/windows/analysis/roughnessScattering/figure.js'
);
const { calculateRoughness, getRoughnessContext } = await import(
    '../src/components/windows/analysis/roughnessScattering/model.js'
);
const { RoughnessScattering } = await import(
    '../src/components/windows/analysis/roughnessScattering/RoughnessScattering.js'
);
const { DesignContext } = await import('../src/state/DesignContext.js');

const design = makeSampleDesign();
assert.deepEqual(getRoughnessContext(design, 'front'), {
    hasBack: false, activeSides: ['front'], frontN: 3, backN: 0, nIfaces: 3,
});
assert.deepEqual(getRoughnessContext(design, 'back'), {
    hasBack: false, activeSides: ['back'], frontN: 3, backN: 0, nIfaces: 0,
});

design.backLayers = [{ material: 'builtin:SiO2', thickness: 75 }];
const totalContext = getRoughnessContext(design, 'total');
assert.deepEqual(totalContext, {
    hasBack: true, activeSides: ['front', 'back'], frontN: 3, backN: 2, nIfaces: 5,
});
const result = calculateRoughness({
    design,
    params: { lambdaStart: 500, lambdaEnd: 510, lambdaStep: 5, theta: 0, polarization: 'avg' },
    rough: { mode: 'perInterface', sigma: 0, sigmas: [1, 2, 3], backSigmas: [4, 5] },
    evalMode: 'total',
    aoi: 0,
    context: totalContext,
});
assert.equal(result.error, null);
assert.deepEqual(result.data.sigmas, [1, 2, 3, 4, 5]);
assert.equal(result.data.lambda.length, 3);
assert.equal(result.data.R.length, result.data.lambda.length);
assert.equal(result.data.T.length, result.data.lambda.length);
assert.equal(result.data.TIS_inc.length, result.data.lambda.length);

const traces = buildScatterTraces({
    lambda: [500, 600], R: [0.1, 0.2], T: [0.8, 0.7],
    R_spec: [0.09, 0.18], T_spec: [0.72, 0.63], TIS_inc: [1e-6, 2e-6], units: 'ppm',
});
assert.deepEqual(traces.map(trace => trace.name), [
    'R (ideal)', 'T (ideal)', 'R spec', 'T spec', 'TIS (ppm)',
]);
assert.deepEqual(traces[0].y, [10, 20]);
assert.deepEqual(traces[4].y, [1, 2]);
assert.equal(traces[4].yaxis, 'y2');
assert.deepEqual(buildScatterTraces({ lambda: [] }), []);
assert.equal(buildScatterLayout(makeTheme(), 'frac').yaxis2.title.text, 'TIS (fraction)');

const c = makeTheme();
const html = renderToStaticMarkup(withDesign(
    React.createElement(RoughnessScattering, { c, t: makeLocale(), theme: c })
));
const hash = createHash('sha256').update(html).digest('hex').slice(0, 16);
assert.equal(hash, 'f2d911f5dec35147');

const backOnlyDesign = makeSampleDesign();
backOnlyDesign.frontLayers = [];
backOnlyDesign.backLayers = [{ material: 'builtin:SiO2', thickness: 75 }];
const backOnlyContext = { ...makeDesignCtx(backOnlyDesign), evalMode: 'back' };
const backOnlyHtml = renderToStaticMarkup(
    React.createElement(
        DesignContext.Provider,
        { value: backOnlyContext },
        React.createElement(RoughnessScattering, { c, t: makeLocale(), theme: c })
    )
);
assert.match(backOnlyHtml, /No layers in design\./);

console.log('PASS: roughness_scattering_refactor_characterization');
