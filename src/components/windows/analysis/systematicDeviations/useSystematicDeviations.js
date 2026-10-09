import { useDesign } from '../../../../state/DesignContext.js';
import { designMaterialLookup } from '../../../../utils/materials/designMaterials.js';
import { MaterialHasNoIndexError } from '../../../../utils/materials/materialIndexAt.js';
import {
    cloneDeviation,
    computeDeviatedSpectrum,
    deviatedDesignForSpec,
    emptyDeviation,
    enumerateUniqueMaterials,
    runDeviationSweep,
} from '../../../../utils/physics/systematicDeviations.js';
import { systematicDeviationsSession } from './sessionState.js';
import { useWindowSession } from '../../windowSession.js';
import { useAfterRefreshAll } from '../../../../state/refreshAll.js';
import { staleSweepPatch, sweepForDesign, sweepParamKind } from './model.js';

const { useCallback, useEffect, useMemo, useState } = React;

function computeSpectrum(design, params, deviation, evalMode) {
    if (!design?.frontLayers) return { s: null, error: null };
    try {
        const resolveMaterial = designMaterialLookup(design);
        return { s: computeDeviatedSpectrum(design, params, deviation, evalMode, resolveMaterial), error: null };
    } catch (error) {
        return { s: null, error };
    }
}

// The deviated design the specification verdict is judged on. An optical-unit
// offset on a material with no index at λ₀ has no thickness; the spectrum
// reports that, and the verdict has nothing to judge.
function specDesign(design, dev) {
    try {
        return deviatedDesignForSpec(design, dev, designMaterialLookup(design));
    } catch (error) {
        if (error instanceof MaterialHasNoIndexError) return null;
        throw error;
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

// The sweep and its result as the design can use them. A swept material the
// design no longer uses is reset in the store, and the result swept on it
// dropped, so the selector, the run and the plot agree. The store is checked
// again when writing: for one render after a design switch `session` still
// holds the previous design's values, and those must not be written over the
// new design's.
function useDesignSweep(session, uniqueMats, patch) {
    const sweep = useMemo(() => sweepForDesign(session.sweep, uniqueMats), [session.sweep, uniqueMats]);
    const stale = sweep !== session.sweep;
    useEffect(() => {
        if (stale) patch(stored => staleSweepPatch(stored, uniqueMats));
    }, [stale, uniqueMats, patch]);
    return { sweep, sweepResult: stale ? null : session.sweepResult };
}

export function useSystematicDeviations() {
    const { design, evalMode } = useDesign();
    const [session, setField, patch] = useWindowSession(systematicDeviationsSession, design);
    const {
        mode, channel, showBaseline, lambdaStart, lambdaEnd, lambdaStep,
        aoi, pol, sweepChannel, showEditor, showTable,
    } = session;
    const uniqueMats = useMemo(() => enumerateUniqueMaterials(design), [design]);
    const { sweep, sweepResult } = useDesignSweep(session, uniqueMats, patch);
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
    const specDev = useMemo(() => specDesign(design, dev), [design, dev]);
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
                // The window names the parameter when it draws, in the UI
                // language of that moment.
                result.param = sweep.param;
                result.offsetUnit = sweep.offsetUnit || 'nm';
                setSweepResult(result);
            } catch (caught) {
                setError(caught);
            }
            setSweepRunning(false);
        }, 0);
    }, [design, params, sweep, evalMode]);

    // A sweep that has been run is run again after Refresh all, against the
    // files just read.
    useAfterRefreshAll(() => {
        if (sweepResult && !sweepRunning) runSweep();
    });

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
        showEditor, setShowEditor: value => setField('showEditor', value),
        showTable, setShowTable: value => setField('showTable', value),
        runSweep, resetDeviation, updateGlobal, updateMat,
    };
}
