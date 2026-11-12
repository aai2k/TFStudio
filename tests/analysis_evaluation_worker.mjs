import './_kernel.mjs';
import assert from 'node:assert/strict';
import { dispatchAnalysisEvaluation } from '../src/utils/workers/analysisEvaluationWorker.js';
import { makeOperand } from '../src/utils/physics/optimizer.js';
import { environmentDesign, environmentsInAll, oneEnvironmentDesign } from '../src/utils/environments/environments.js';
import { computeColorReports } from '../src/components/windows/analysis/colorEvaluation/colorModel.js';

const design = {
    id: 'analysis-worker', name: 'Analysis worker fixture',
    incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1 },
    surfaceMode: 'front_only', mfEvalMode: 'side',
    cone: { enabled: true, halfAngleDeg: 4, distribution: 'uniform', gridPoints: 2 },
    frontLayers: [
        { id: 'a', material: 'TiO2', thickness: 60, locked: false },
        { id: 'b', material: 'SiO2', thickness: 90, locked: false },
    ],
    backLayers: [],
};

const spectrum = dispatchAnalysisEvaluation('opticalSpectrum', {
    design, evalMode: 'front',
    params: { lambdaStart: 500, lambdaEnd: 504, lambdaStep: 2, thetas: [0] },
});
assert.equal(spectrum.lambda.length, 3);
assert.equal(spectrum.series.length, 1);
assert.ok(spectrum.series[0].R.every(Number.isFinite));

// Optical Evaluation under a cone, showing every environment of a design: one
// spectrum per environment, each the one that environment's design gives.
{
    const params = { lambdaStart: 500, lambdaEnd: 504, lambdaStep: 2, thetas: [0, 20] };
    const withWater = {
        ...design,
        environments: [{ id: 'base' }, { id: 'env2', name: 'Under water', incidentMedium: 'builtin:H2O' }, { id: 'env3', enabled: false, thicknessFactors: { TiO2: 0.9 } }],
    };
    const shown = environmentsInAll(withWater);
    const designs = shown.map(({ env }) => environmentDesign(withWater, env.id));
    const spectra = dispatchAnalysisEvaluation('opticalSpectra', { designs, params, evalMode: 'front' });
    assert.equal(spectra.length, 2, 'one spectrum per environment that is on');
    for (const [i, { env, number }] of shown.entries()) {
        const apart = dispatchAnalysisEvaluation('opticalSpectrum', { design: oneEnvironmentDesign(withWater, env.id), params, evalMode: 'front' });
        assert.equal(JSON.stringify(spectra[i]), JSON.stringify(apart), `environment ${number} computes as its design apart`);
    }
    assert.notEqual(JSON.stringify(spectra[0].series), JSON.stringify(spectra[1].series), 'the two environments differ');
}

const integralSpectrum = dispatchAnalysisEvaluation('integralSpectrum', {
    design, evalMode: 'front',
    params: { lambdaStart: 500, lambdaEnd: 504, lambdaStep: 2, theta: 0, polarization: 'avg' },
});
assert.equal(integralSpectrum.lambda.length, 3);
assert.ok(integralSpectrum.T.every(Number.isFinite));

const monitorValues = dispatchAnalysisEvaluation('statusMonitors', {
    design,
    monitors: [
        { type: 'fact', fact: 'layerCount' },
        { type: 'point', qty: 'R', lambda: 550, aoi: 0, pol: 'avg' },
    ],
});
assert.equal(monitorValues[0], 2);
assert.ok(Number.isFinite(monitorValues[1]));

const operands = [makeOperand({
    type: 'RAV', lambdaStart: 500, lambdaEnd: 504,
    aoi: 0, pol: 'avg', target: 0.5, weight: 1,
})];
const merit = dispatchAnalysisEvaluation('meritDisplay', { design, operands });
assert.equal(merit.computed.length, 1);
assert.ok(Number.isFinite(merit.mf));
assert.ok(Number.isFinite(merit.omf));

const candidateDesign = {
    ...design,
    frontLayers: design.frontLayers.map((layer, index) => index === 0
        ? { ...layer, thickness: layer.thickness + 2 }
        : layer),
};
const meritPair = dispatchAnalysisEvaluation('meritPair', { design, candidateDesign, operands });
assert.ok(Number.isFinite(meritPair.before.mf));
assert.ok(Number.isFinite(meritPair.after.mf));
assert.ok(Number.isFinite(meritPair.before.omf));
assert.ok(Number.isFinite(meritPair.after.omf));

const timeline = dispatchAnalysisEvaluation('meritTimeline', {
    design,
    designs: [{ ...design, meritOperands: operands }, { ...candidateDesign, meritOperands: operands }],
});
assert.equal(timeline.length, 2);
assert.ok(timeline.every(entry => Number.isFinite(entry.mf) && entry.materialMissing === false));

assert.throws(
    () => dispatchAnalysisEvaluation('not-real', { design }),
    /Unknown analysis evaluation/,
);

// Color Evaluation and Integral Values under a cone, showing every environment
// of a design: the colour and the spectrum of each, each the one that
// environment's design gives.
{
    const withWater = {
        ...design,
        environments: [{ id: 'base' }, { id: 'env2', name: 'Under water', incidentMedium: 'builtin:H2O' }],
    };
    const designs = environmentsInAll(withWater).map(({ env }) => environmentDesign(withWater, env.id));
    const options = { evalMode: 'front', characteristic: 'R', pol: 'avg', thetas: [0, 30], observer: '2', illuminant: 'D65', step: 10 };
    const sets = dispatchAnalysisEvaluation('colorReports', { designs, options });
    assert.equal(sets.length, 2, 'Color Evaluation: one set of colours per environment');
    designs.forEach((one, i) => assert.equal(JSON.stringify(sets[i]), JSON.stringify(computeColorReports({ ...options, design: one, setError() {} })),
        `Color Evaluation: environment ${i + 1} computes as its design apart`));
    assert.notEqual(JSON.stringify(sets[0]), JSON.stringify(sets[1]), 'and the two differ');
    const params = { lambdaStart: 500, lambdaEnd: 520, lambdaStep: 10, theta: 0, polarization: 'avg' };
    // The whole part, which the design is not scored on, so the spectra are in
    // the mode given rather than the design's own.
    const spectra = dispatchAnalysisEvaluation('integralSpectra', { designs, grids: [params], evalMode: 'total' });
    designs.forEach((one, i) => assert.equal(JSON.stringify(spectra[i][0]), JSON.stringify(dispatchAnalysisEvaluation('integralSpectrum', { design: one, params, evalMode: 'total' })),
        `Integral Values: environment ${i + 1} computes as its design apart, in the window's evaluation mode`));
    assert.notEqual(JSON.stringify(spectra[0][0].R), JSON.stringify(dispatchAnalysisEvaluation('integralSpectrum', { design: designs[0], params, evalMode: 'front' }).R),
        'the whole part, not the front the design is scored on');
    assert.notEqual(JSON.stringify(spectra[0][0].R), JSON.stringify(spectra[1][0].R), 'the two environments differ');
}

// The windows under a cone hand the worker the design of each environment they
// show, and compute none on their own thread. Each hook runs once under a
// stand-in for React that runs the effects after the render, as the browser
// does, with a Worker that records what it is asked.
{
    const { shimBrowserGlobals } = await import('./_uiShim.mjs');
    shimBrowserGlobals();
    let slots = [], cursor = 0, effects = [];
    const slot = make => { const i = cursor++; if (slots.length <= i) slots[i] = make(); return slots[i]; };
    globalThis.React = {
        createContext: value => ({ value, Provider: 'Provider' }),
        useContext: context => context.value,
        createElement: () => null, memo: component => component, forwardRef: render => render, Fragment: 'Fragment',
        Component: class {}, PureComponent: class {},
        useState: initial => { const s = slot(() => ({ value: typeof initial === 'function' ? initial() : initial })); return [s.value, next => { s.value = typeof next === 'function' ? next(s.value) : next; }]; },
        useRef: initial => slot(() => ({ current: initial })),
        useMemo: fn => slot(() => ({ value: fn() })).value,
        useCallback: fn => slot(() => ({ value: fn })).value,
        useEffect: fn => { slot(() => ({})); effects.push(fn); },
        useLayoutEffect: fn => { slot(() => ({})); effects.push(fn); },
    };
    const posted = [];
    globalThis.Worker = class { postMessage(message) { posted.push(message); } terminate() {} };
    const { DesignContext } = await import('../src/state/DesignContext.js');
    const { useOpticalEvaluation } = await import('../src/components/windows/analysis/opticalEvaluation/useOpticalEvaluation.js');
    const { useColorReports } = await import('../src/components/windows/analysis/colorEvaluation/useColorReports.js');
    const { useIntegralValues } = await import('../src/components/windows/analysis/integralValues/useIntegralValues.js');
    const { environmentChoiceSession } = await import('../src/components/windows/analysis/chrome/environmentChoice.js');
    const { currentEnvironmentSession } = await import('../src/components/windows/design/environments/currentEnvironment.js');
    const { threeEnvironmentDesign } = await import('./_environmentDesign.mjs');
    const coned = { ...threeEnvironmentDesign(), cone: design.cone };
    // The state `useHook` gives and what it asks the worker for, with the
    // current environment and the droplist's choice set.
    const asked = (useHook, { current = 'base', choice = 'current' }) => {
        currentEnvironmentSession.write(coned, { current });
        environmentChoiceSession.write(coned, { choice });
        DesignContext.value = { design: coned, evalMode: 'front', updateDesign() {}, isOptimizing: false, liveUpdate: true };
        slots = []; cursor = 0; effects = []; posted.length = 0;
        const state = useHook();
        effects.forEach(effect => effect());
        return { state, request: posted.find(message => message.type === 'evaluate') };
    };
    const substrates = request => request.payload.designs.map(one => one.substrate.material);
    const third = environmentDesign(coned, 'env3').frontLayers[0].thickness;
    const thicknesses = request => request.payload.designs.map(one => one.frontLayers[0].thickness);

    const all = asked(useOpticalEvaluation, { choice: 'all' });
    assert.ok(all.state.busy && all.state.data === null, 'Optical Evaluation computes nothing on its own thread under a cone');
    assert.equal(all.request.operation, 'opticalSpectra');
    assert.deepEqual(substrates(all.request), ['builtin:BK7', 'builtin:Al2O3'],
        'and under All asks the worker for the design of each environment that is on');
    assert.deepEqual(thicknesses(asked(useOpticalEvaluation, { current: 'env3' }).request), [third], 'or of the current environment alone');
    assert.deepEqual(thicknesses(asked(useOpticalEvaluation, { choice: 'env3' }).request), [third], 'or of the one environment chosen');

    const options = { evalMode: 'front', characteristic: 'R', pol: 'avg', thetas: [0], observer: '2', illuminant: 'D65', step: 5 };
    const colour = state => asked(() => useColorReports(coned, options), state);
    const allColours = colour({ choice: 'all' });
    assert.ok(allColours.state.busy && allColours.state.reports === null, 'Color Evaluation computes nothing on its own thread under a cone');
    assert.deepEqual([allColours.request.operation, substrates(allColours.request), allColours.request.payload.options],
        ['colorReports', ['builtin:BK7', 'builtin:Al2O3'], options], 'and under All asks the worker for the colour of each environment that is on');
    assert.deepEqual(thicknesses(colour({ choice: 'env3' }).request), [third], 'or of the one environment chosen');

    const integrals = state => asked(() => useIntegralValues(coned, 'front'), state);
    const allIntegrals = integrals({ choice: 'all' });
    assert.ok(allIntegrals.state.spectrum === null && allIntegrals.state.sets === null, 'Integral Values computes nothing on its own thread under a cone');
    const { payload } = allIntegrals.request;
    assert.deepEqual([allIntegrals.request.operation, substrates(allIntegrals.request), payload.grids.length, payload.evalMode],
        ['integralSpectra', ['builtin:BK7', 'builtin:Al2O3'], 1, 'front'], 'and under All asks the worker for the spectrum of each environment that is on');
    assert.deepEqual(thicknesses(integrals({ current: 'env3' }).request), [third], 'or of the current environment alone');
}

console.log('PASS: analysis_evaluation_worker');
