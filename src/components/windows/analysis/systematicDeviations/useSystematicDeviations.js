import { useDesign } from '../../../../state/DesignContext.js';
import { getMaterialById } from '../../../../utils/materials/catalogManager.js';
import { getMaterial } from '../../../../utils/materials/materialDatabase.js';
import {
    cloneDeviation,
    computeDeviatedSpectrum,
    deviatedDesignForSpec,
    emptyDeviation,
    enumerateUniqueMaterials,
    paramLabel,
    runDeviationSweep,
} from '../../../../utils/physics/systematicDeviations.js';
import { cacheDesignState, designSnapshot } from './designCache.js';
import { sweepParamKind } from './model.js';

const { useCallback, useEffect, useMemo, useState } = React;

export function resolveMaterial(id) {
    if (!id) return getMaterial('Air');
    return getMaterialById(id) || getMaterial(id) || getMaterial('Air');
}

function computeSpectrum(design, params, deviation, evalMode) {
    if (!design?.frontLayers) return { s: null, error: null };
    try {
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

function restoreSnapshot(snapshot, setters) {
    setters.setDev(cloneDeviation(snapshot.dev));
    setters.setMode(snapshot.mode);
    setters.setChannel(snapshot.channel);
    setters.setShowBaseline(snapshot.showBaseline);
    setters.setLambdaStart(snapshot.lambdaStart);
    setters.setLambdaEnd(snapshot.lambdaEnd);
    setters.setLambdaStep(snapshot.lambdaStep);
    setters.setAoi(snapshot.aoi);
    setters.setPol(snapshot.pol);
    setters.setSweep(snapshot.sweep);
    setters.setSweepChannel(snapshot.sweepChannel);
    setters.setSweepResult(snapshot.sweepResult);
}

export function useSystematicDeviations() {
    const { design, evalMode } = useDesign();
    const initial = useMemo(() => designSnapshot(design), []); // eslint-disable-line react-hooks/exhaustive-deps
    const [dev, setDev] = useState(() => cloneDeviation(initial.dev));
    const [mode, setMode] = useState(initial.mode);
    const [channel, setChannel] = useState(initial.channel);
    const [showBaseline, setShowBaseline] = useState(initial.showBaseline);
    const [lambdaStart, setLambdaStart] = useState(initial.lambdaStart);
    const [lambdaEnd, setLambdaEnd] = useState(initial.lambdaEnd);
    const [lambdaStep, setLambdaStep] = useState(initial.lambdaStep);
    const [aoi, setAoi] = useState(initial.aoi);
    const [pol, setPol] = useState(initial.pol);
    const [sweep, setSweep] = useState(initial.sweep);
    const [sweepChannel, setSweepChannel] = useState(initial.sweepChannel);
    const [sweepResult, setSweepResult] = useState(initial.sweepResult);
    const [sweepRunning, setSweepRunning] = useState(false);
    const [error, setError] = useState(null);

    const setters = {
        setDev, setMode, setChannel, setShowBaseline,
        setLambdaStart, setLambdaEnd, setLambdaStep, setAoi, setPol,
        setSweep, setSweepChannel, setSweepResult,
    };

    useEffect(() => {
        if (!design) return;
        restoreSnapshot(designSnapshot(design), setters);
    }, [design?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    const params = useMemo(() => ({
        lambdaStart, lambdaEnd, lambdaStep, theta: aoi, polarization: pol,
    }), [lambdaStart, lambdaEnd, lambdaStep, aoi, pol]);
    const uniqueMats = useMemo(() => enumerateUniqueMaterials(design), [design]);
    const specDev = useMemo(
        () => deviatedDesignForSpec(design, dev, resolveMaterial),
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
                    design, params, baseDev: sweepBaseDeviation(sweep), sweep, evalMode, resolveMat: resolveMaterial,
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

    useEffect(() => {
        cacheDesignState(design, {
            dev, mode, channel, showBaseline,
            lambdaStart, lambdaEnd, lambdaStep, aoi, pol,
            sweep, sweepChannel, sweepResult,
        });
    }, [design?.id, dev, mode, channel, showBaseline,
        lambdaStart, lambdaEnd, lambdaStep, aoi, pol,
        sweep, sweepChannel, sweepResult]);

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
