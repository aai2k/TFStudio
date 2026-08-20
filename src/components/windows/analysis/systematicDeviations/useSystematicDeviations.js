import { useDesign } from '../../../../state/DesignContext.js';
import { designMaterialLookup } from '../../../../utils/materials/designMaterials.js';
import {
    cloneDeviation,
    computeDeviatedSpectrum,
    deviatedDesignForSpec,
    emptyDeviation,
    enumerateUniqueMaterials,
    paramLabel,
    runDeviationSweep,
} from '../../../../utils/physics/systematicDeviations.js';
import { systematicDeviationsSession } from './sessionState.js';
import { useWindowSession } from '../../windowSession.js';
import { sweepParamKind } from './model.js';

const { useCallback, useMemo, useState } = React;

function computeSpectrum(design, params, deviation, evalMode) {
    if (!design?.frontLayers) return { s: null, error: null };
    try {
        const resolveMaterial = designMaterialLookup(design);
        return { s: computeDeviatedSpectrum(design, params, deviation, evalMode, resolveMaterial), error: null };
    } catch (error) {
        return { s: null, error: error.message };
    }
}

export function sweepBaseDeviation(sweep) {
    const base = emptyDeviation();
    if (sweepParamKind(sweep.param) !== 'offset') return base;
    const unit = sweep.offsetUnit || 'nm';
    if (sweep.param === 'globalThicknessOffset') {
        base.globalThicknessOffsetUnit = unit;
        return base;
    }
    const match = /^mat:(.+):dOffset$/.exec(sweep.param);
    if (match) {
        base.perMaterial[match[1]] = {
            dn: 0, dk: 0, dScale: 1, dOffset: 0, dOffsetUnit: unit,
        };
    }
    return base;
}

export function useSystematicDeviations() {
    const { design, evalMode } = useDesign();
    const [session, setField] = useWindowSession(systematicDeviationsSession, design);
    const {
        mode, channel, showBaseline, lambdaStart, lambdaEnd, lambdaStep,
        aoi, pol, sweep, sweepChannel, sweepResult,
    } = session;
    // Memoised so the fallback is one stable object: a fresh one per render would
    // invalidate every memo below it on every render.
    const dev = useMemo(() => session.dev || emptyDeviation(), [session.dev]);
    const setDev = useCallback(next => {
        setField('dev', current => {
            const base = current || emptyDeviation();
            return cloneDeviation(typeof next === 'function' ? next(base) : next);
        });
    }, [setField]);
    const setMode = value => setField('mode', value);
    const setChannel = value => setField('channel', value);
    const setShowBaseline = value => setField('showBaseline', value);
    const setLambdaStart = value => setField('lambdaStart', value);
    const setLambdaEnd = value => setField('lambdaEnd', value);
    const setLambdaStep = value => setField('lambdaStep', value);
    const setAoi = value => setField('aoi', value);
    const setPol = value => setField('pol', value);
    const setSweep = value => setField('sweep', value);
    const setSweepChannel = value => setField('sweepChannel', value);
    const setSweepResult = value => setField('sweepResult', value);
    const [sweepRunning, setSweepRunning] = useState(false);
    const [error, setError] = useState(null);

    const params = useMemo(() => ({
        lambdaStart, lambdaEnd, lambdaStep, theta: aoi, polarization: pol,
    }), [lambdaStart, lambdaEnd, lambdaStep, aoi, pol]);
    const uniqueMats = useMemo(() => enumerateUniqueMaterials(design), [design]);
    const specDev = useMemo(
        () => deviatedDesignForSpec(design, dev, designMaterialLookup(design)),
        [design, dev]
    );
    const baselineM = useMemo(
        () => computeSpectrum(design, params, emptyDeviation(), evalMode),
        [design, params, evalMode]
    );
    const deviatedM = useMemo(
        () => computeSpectrum(design, params, dev, evalMode),
        [design, params, dev, evalMode]
    );

    const runSweep = useCallback(() => {
        if (!design?.frontLayers) return;
        setSweepRunning(true);
        setError(null);
        setTimeout(() => {
            try {
                const result = runDeviationSweep({
                    design, params, baseDev: sweepBaseDeviation(sweep), sweep, evalMode,
                    resolveMat: designMaterialLookup(design),
                });
                const unit = sweepParamKind(sweep.param) === 'offset' ? ` (${sweep.offsetUnit || 'nm'})` : '';
                result.paramName = paramLabel(sweep.param) + unit;
                setSweepResult(result);
            } catch (caught) {
                setError(caught.message || String(caught));
            }
            setSweepRunning(false);
        }, 0);
    }, [design, params, sweep, evalMode]);

    const resetDeviation = useCallback(() => setDev(emptyDeviation()), []);
    const updateGlobal = useCallback((field, value) => {
        setDev(previous => {
            const next = cloneDeviation(previous);
            next[field] = value;
            return next;
        });
    }, []);
    const updateMat = useCallback((id, field, value) => {
        setDev(previous => {
            const next = cloneDeviation(previous);
            next.perMaterial = next.perMaterial || {};
            next.perMaterial[id] = next.perMaterial[id] || {
                dn: 0, dk: 0, dScale: 1, dOffset: 0, dOffsetUnit: 'nm',
            };
            next.perMaterial[id][field] = value;
            return next;
        });
    }, []);

    return {
        design, dev, mode, channel, showBaseline,
        lambdaStart, lambdaEnd, lambdaStep, aoi, pol,
        sweep, sweepChannel, sweepResult, sweepRunning,
        error, computeError: deviatedM.error || baselineM.error,
        baseline: baselineM.s, deviated: deviatedM.s,
        uniqueMats, specDev,
        setMode, setChannel, setShowBaseline,
        setLambdaStart, setLambdaEnd, setLambdaStep, setAoi, setPol,
        setSweep, setSweepChannel,
        runSweep, resetDeviation, updateGlobal, updateMat,
    };
}
