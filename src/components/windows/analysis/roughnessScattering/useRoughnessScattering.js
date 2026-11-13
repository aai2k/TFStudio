import { useDesign } from '../../../../state/DesignContext.js';
import { emptyRoughness, cloneRoughness } from '../../../../utils/physics/scattering.js';
import { useEnvironmentChoice } from '../chrome/environmentChoice.js';
import { designInterfaces } from '../designInterfaces.js';
import { useEvaluationUnderCone } from '../useEvaluationUnderCone.js';
import { calculateRoughness, getRoughnessContext } from './model.js';
import { roughnessDesignSession, roughnessViewSession } from './sessionState.js';
import { useWindowSession } from '../../windowSession.js';

const { useMemo, useCallback } = React;

// `rs` is t.roughnessScattering, which names a medium the design leaves unset.
export function useRoughnessScattering(rs) {
    const { design } = useDesign();
    // The environment the spectra are computed in, Current or one the
    // droplist names, on what it is scored on and under its own cone. The
    // roughness is one list for every environment, each at an interface of the
    // layer list, its transition layer taken out of the layer as the
    // environment shown deposits it.
    const environment = useEnvironmentChoice(design);
    const { design: shown, mode: evalMode, coned: coneActive } = environment.views[0];
    const [designSession, setDesignField] = useWindowSession(roughnessDesignSession, design);
    // Memoised so the fallback is one stable object: a fresh one per render would
    // invalidate every memo below it on every render.
    const rough = useMemo(() => designSession.rough || emptyRoughness(), [designSession.rough]);
    const setRough = useCallback(next => {
        setDesignField('rough', current => {
            const base = current || emptyRoughness();
            return cloneRoughness(typeof next === 'function' ? next(base) : next);
        });
    }, [setDesignField]);

    const [view, setViewField] = useWindowSession(roughnessViewSession, design);
    const { showCurves, lambdaStart, lambdaEnd, lambdaStep, aoi, units, showEditor, showTable } = view;
    // Always averaged: the spectrum carries Ts/Tp and Rs/Rp alongside, so the
    // curve switches pick a polarization without recomputing anything.
    const params = useMemo(() => ({
        lambdaStart, lambdaEnd, lambdaStep, theta: aoi, polarization: 'avg',
    }), [lambdaStart, lambdaEnd, lambdaStep, aoi]);
    const context = getRoughnessContext(shown, evalMode);
    const labels = useMemo(() => designInterfaces(shown, rs), [shown, rs]);
    // Under a cone of incidence the spectra are computed in the analysis worker,
    // as Optical Evaluation computes its own.
    const request = useMemo(() => ({ design: shown, params, rough, evalMode }), [shown, params, rough, evalMode]);
    const evaluated = useEvaluationUnderCone(shown, 'roughnessSpectra', request, calculateRoughness);
    const result = { data: evaluated.data?.data ?? null, error: evaluated.data?.error ?? evaluated.error };

    const setMode = useCallback(mode => setRough(current => ({ ...current, mode })), []);
    const setUniformSigma = useCallback(value => {
        setRough(current => ({ ...current, sigma: Math.max(0, value) }));
    }, []);
    const setUniformRange = useCallback(range => {
        setRough(current => ({ ...current, range }));
    }, []);
    // An interface edited for the first time starts the list at the uniform
    // values, which is what the editor showed for every interface until then.
    const setInterfaceValue = useCallback((key, fill, index, value) => {
        setRough(current => {
            const list = (current[key] || []).slice();
            while (list.length <= index) list.push(current[fill]);
            list[index] = value;
            return { ...current, mode: 'perInterface', [key]: list };
        });
    }, []);
    const setInterfaceSigma = useCallback((side, index, value) => {
        setInterfaceValue(side === 'back' ? 'backSigmas' : 'sigmas', 'sigma', index, Math.max(0, value));
    }, [setInterfaceValue]);
    const setInterfaceRange = useCallback((side, index, range) => {
        setInterfaceValue(side === 'back' ? 'backRanges' : 'ranges', 'range', index, range);
    }, [setInterfaceValue]);
    const clearAll = useCallback(() => setRough(emptyRoughness()), []);

    return {
        design, evalMode, rough, labels, ...context, coneActive, environment, shownDesign: shown,
        calc: result.data, error: result.error,
        lambdaStart, setLambdaStart: value => setViewField('lambdaStart', value),
        lambdaEnd, setLambdaEnd: value => setViewField('lambdaEnd', value),
        lambdaStep, setLambdaStep: value => setViewField('lambdaStep', value),
        aoi, setAoi: value => setViewField('aoi', value),
        showCurves,
        toggleCurve: key => setViewField('showCurves',
            current => ({ ...current, [key]: !current[key] })),
        units, setUnits: value => setViewField('units', value),
        showEditor, setShowEditor: value => setViewField('showEditor', value),
        showTable, setShowTable: value => setViewField('showTable', value),
        setMode, setUniformSigma, setUniformRange, setInterfaceSigma, setInterfaceRange, clearAll,
    };
}
