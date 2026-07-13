import { useDesign } from '../../../../state/DesignContext.js';
import { emptyRoughness, cloneRoughness } from '../../../../utils/physics/scattering.js';
import { buildInterfaceLabels, calculateRoughness, getRoughnessContext } from './model.js';

const { useState, useEffect, useMemo, useCallback } = React;
const scatterCache = new Map();

export function useRoughnessScattering() {
    const { design, evalMode } = useDesign();
    const [rough, setRough] = useState(() => {
        const cached = design && scatterCache.get(design.id);
        return cached ? cloneRoughness(cached) : emptyRoughness();
    });

    useEffect(() => {
        if (!design) return;
        const cached = scatterCache.get(design.id);
        setRough(cached ? cloneRoughness(cached) : emptyRoughness());
    }, [design?.id]);
    useEffect(() => {
        if (!design) return;
        scatterCache.set(design.id, cloneRoughness(rough));
    }, [rough, design?.id]);

    const [lambdaStart, setLambdaStart] = useState(400);
    const [lambdaEnd, setLambdaEnd] = useState(800);
    const [lambdaStep, setLambdaStep] = useState(5);
    const [aoi, setAoi] = useState(0);
    const [pol, setPol] = useState('avg');
    const [units, setUnits] = useState('ppm');
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
        lambdaStart, setLambdaStart, lambdaEnd, setLambdaEnd,
        lambdaStep, setLambdaStep, aoi, setAoi, pol, setPol, units, setUnits,
        setMode, setUniformSigma, setInterfaceSigma, clearAll,
    };
}
