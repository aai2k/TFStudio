import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    loadApp,
    makeDesignCtx,
    makeLocale,
    makeSampleDesign,
    makeTheme,
    shimBrowserGlobals,
} from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const { buildScatterOption, buildScatterSeries } = await import(
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
assert.equal(result.data.TIS_inc.length, result.data.lambda.length);

// The scattered fraction is removed from every polarization, so the curve
// switches pick one without running the TMM again.
assert.deepEqual(Object.keys(result.data.ideal).sort(), ['R', 'Rp', 'Rs', 'T', 'Tp', 'Ts']);
assert.deepEqual(Object.keys(result.data.specular).sort(), ['R', 'Rp', 'Rs', 'T', 'Tp', 'Ts']);
for (const key of ['R', 'T', 'Rs', 'Ts', 'Rp', 'Tp']) {
    assert.equal(result.data.specular[key].length, result.data.lambda.length);
    assert.equal(result.data.specular[key][0] <= result.data.ideal[key][0], true,
        `${key}: scattering can only take light out of the specular beam`);
}

const names = { ideal: 'ideal', specular: 'specular' };
const calc = {
    lambda: [500, 600],
    ideal: { R: [0.1, 0.2], T: [0.8, 0.7], Rs: [0.11, 0.21], Ts: [0.79, 0.69] },
    specular: { R: [0.09, 0.18], T: [0.72, 0.63], Rs: [0.1, 0.19], Ts: [0.71, 0.62] },
    TIS_inc: [1e-6, 2e-6],
};
const series = buildScatterSeries({
    calc, showCurves: { T: true, R: true }, units: 'ppm', names,
});
// The legend is localized, so the names come in rather than being baked in here.
assert.deepEqual(series.map(item => item.name), [
    'T ideal', 'T specular', 'R ideal', 'R specular', 'TIS (ppm)',
]);
assert.deepEqual(series[2].data.map(point => point[1]), [10, 20]);
assert.deepEqual(series.at(-1).data.map(point => point[1]), [1, 2]);
assert.equal(series.at(-1).yAxisIndex, 1);

// A polarization draws its own pair; TIS is always there because it is the
// quantity the window exists to show.
assert.deepEqual(
    buildScatterSeries({ calc, showCurves: { Rs: true }, units: 'ppm', names })
        .map(item => item.name),
    ['Rs ideal', 'Rs specular', 'TIS (ppm)']);
assert.deepEqual(
    buildScatterSeries({ calc, showCurves: { Tp: true }, units: 'ppm', names })
        .map(item => item.name),
    ['TIS (ppm)'], 'a curve the result does not carry is skipped rather than drawn empty');
assert.deepEqual(buildScatterSeries({ calc: { lambda: [] } }), []);
const scatterOption = buildScatterOption({
    calc, showCurves: {}, units: 'frac', names, c: makeTheme(),
});
assert.equal(scatterOption.yAxis[1].name, 'TIS (fraction)');
assert.equal(scatterOption.legend.show, false,
    'toolbar curve toggles replace the duplicate in-chart legend');

const c = makeTheme();
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
