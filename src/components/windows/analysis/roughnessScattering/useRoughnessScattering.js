import { useDesign } from '../../../../state/DesignContext.js';
import { emptyRoughness, cloneRoughness } from '../../../../utils/physics/scattering.js';
import { buildInterfaceLabels, calculateRoughness, getRoughnessContext } from './model.js';
import { roughnessDesignSession, roughnessViewSession } from './sessionState.js';
import { useWindowSession } from '../../windowSession.js';

const { useMemo, useCallback } = React;

export function useRoughnessScattering() {
    const { design, evalMode } = useDesign();
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
    const { lambdaStart, lambdaEnd, lambdaStep, aoi, pol, units, showTable } = view;
    const params = useMemo(() => ({
        lambdaStart, lambdaEnd, lambdaStep, theta: aoi, polarization: pol,
    }), [lambdaStart, lambdaEnd, lambdaStep, aoi, pol]);
    const context = getRoughnessContext(design, evalMode);
    const labels = useMemo(() => buildInterfaceLabels(design), [design]);
    const result = useMemo(
        () => calculateRoughness({ design, params, rough, evalMode, aoi, context }),
        [design, params, rough, evalMode, aoi, context.frontN, context.backN, context.hasBack]
    );

    const setMode = useCallback(mode => setRough(current => ({ ...current, mode })), []);
    const setUniformSigma = useCallback(value => {
        setRough(current => ({ ...current, sigma: Math.max(0, value) }));
    }, []);
    const setInterfaceSigma = useCallback((side, index, value) => {
        const key = side === 'back' ? 'backSigmas' : 'sigmas';
        setRough(current => {
            const sigmas = (current[key] || []).slice();
            while (sigmas.length <= index) sigmas.push(current.sigma ?? 0);
            sigmas[index] = Math.max(0, value);
            return { ...current, mode: 'perInterface', [key]: sigmas };
        });
    }, []);
    const clearAll = useCallback(() => setRough(emptyRoughness()), []);

    return {
        design, evalMode, rough, labels, ...context,
        calc: result.data, error: result.error,
        lambdaStart, setLambdaStart: value => setViewField('lambdaStart', value),
        lambdaEnd, setLambdaEnd: value => setViewField('lambdaEnd', value),
        lambdaStep, setLambdaStep: value => setViewField('lambdaStep', value),
        aoi, setAoi: value => setViewField('aoi', value),
        pol, setPol: value => setViewField('pol', value),
        units, setUnits: value => setViewField('units', value),
        showTable, setShowTable: value => setViewField('showTable', value),
        setMode, setUniformSigma, setInterfaceSigma, clearAll,
    };
}
