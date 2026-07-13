import { getMaterialById } from '../../../../utils/materials/catalogManager.js';
import { getMaterial } from '../../../../utils/materials/materialDatabase.js';
import { runErrorAnalysisMC } from '../../../../utils/physics/errorAnalysis.js';
import { hasPerturbableLayers } from './trialModel.js';

const { useCallback, useEffect, useMemo, useRef, useState } = React;

const resultCache = new Map();

function defaults() {
    return {
        params: { lambdaStart: 400, lambdaEnd: 800, lambdaStep: 5, theta: 0, polarization: 'avg' },
        char: 'R', nTrials: 200, corridorSigma: 1.0,
        rmsAbsNm: 0, rmsRelPct: 1, rmsReN: 0, rmsImN: 0,
        distribution: 'gaussian',
        perMaterial: false, keepOPT: false, result: null,
    };
}

function snapshot(design) {
    return (design && resultCache.get(design.id)) || defaults();
}

function resolveMat(id) {
    if (!id) return getMaterial('Air');
    return getMaterialById(id) || getMaterial(id) || getMaterial('Air');
}

async function executeRun(options) {
    const {
        design, params, evalMode, char, nTrials, rmsAbsNm, rmsRelPct,
        rmsReN, rmsImN, distribution, perMaterial, keepOPT, cancelledRef,
        setError, setRunning, setProgress, setResult,
    } = options;
    if (!hasPerturbableLayers(design, evalMode)) {
        setError('No layers to perturb.');
        return;
    }
    setError(null);
    setRunning(true);
    setProgress({ i: 0, total: nTrials });
    cancelledRef.current = false;
    await new Promise((resolve) => setTimeout(resolve, 0));

    try {
        const result = await runErrorAnalysisMC(design, params, resolveMat, {
            char,
            evalMode,
            nTrials,
            yieldEvery: 4,
            onYield: () => new Promise((resolve) => setTimeout(resolve, 0)),
            shouldCancel: () => cancelledRef.current,
            rmsAbsNm,
            rmsRelPct,
            rmsReN,
            rmsImN,
            distribution,
            perMaterialErrors: perMaterial,
            keepOpticalThickness: keepOPT && (rmsReN > 0 || rmsImN > 0),
            evaluateSpec: (design?.qualifiers?.length || 0) > 0,
            qualifiers: design?.qualifiers || [],
            recordTrials: true,
            onTrial: ({ i, total }) => setProgress({ i, total }),
        });
        setResult(result);
    } catch (error) {
        setError(error.message || String(error));
    }
    setRunning(false);
}

function restoreSnapshot(snap, setters) {
    setters.setParams(snap.params);
    setters.setChar(snap.char);
    setters.setNTrials(snap.nTrials);
    setters.setCorridorSigma(snap.corridorSigma);
    setters.setRmsAbsNm(snap.rmsAbsNm);
    setters.setRmsRelPct(snap.rmsRelPct);
    setters.setRmsReN(snap.rmsReN);
    setters.setRmsImN(snap.rmsImN);
    setters.setDistribution(snap.distribution || 'gaussian');
    setters.setPerMaterial(snap.perMaterial);
    setters.setKeepOPT(snap.keepOPT);
    setters.setResult(snap.result);
}

export function useErrorAnalysis({ design, evalMode }) {
    const initial = useMemo(() => snapshot(design), []); // eslint-disable-line react-hooks/exhaustive-deps
    const [params, setParams] = useState(initial.params);
    const [char, setChar] = useState(initial.char);
    const [nTrials, setNTrials] = useState(initial.nTrials);
    const [corridorSigma, setCorridorSigma] = useState(initial.corridorSigma);
    const [rmsAbsNm, setRmsAbsNm] = useState(initial.rmsAbsNm);
    const [rmsRelPct, setRmsRelPct] = useState(initial.rmsRelPct);
    const [rmsReN, setRmsReN] = useState(initial.rmsReN);
    const [rmsImN, setRmsImN] = useState(initial.rmsImN);
    const [distribution, setDistribution] = useState(initial.distribution || 'gaussian');
    const [perMaterial, setPerMaterial] = useState(initial.perMaterial);
    const [keepOPT, setKeepOPT] = useState(initial.keepOPT);
    const [result, setResult] = useState(initial.result);
    const [running, setRunning] = useState(false);
    const [progress, setProgress] = useState({ i: 0, total: 0 });
    const [error, setError] = useState(null);
    const [showTrials, setShowTrials] = useState(false);
    const [showEnvelope, setShowEnvelope] = useState(false);
    const cancelledRef = useRef(false);

    const setters = {
        setParams, setChar, setNTrials, setCorridorSigma, setRmsAbsNm, setRmsRelPct,
        setRmsReN, setRmsImN, setDistribution, setPerMaterial, setKeepOPT, setResult,
    };
    useEffect(() => {
        if (!design) return;
        restoreSnapshot(snapshot(design), setters);
    }, [design?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    const run = useCallback(() => executeRun({
        design, params, evalMode, char, nTrials, rmsAbsNm, rmsRelPct,
        rmsReN, rmsImN, distribution, perMaterial, keepOPT, cancelledRef,
        setError, setRunning, setProgress, setResult,
    }), [design, params, evalMode, char, nTrials,
        rmsAbsNm, rmsRelPct, rmsReN, rmsImN, distribution, perMaterial, keepOPT]);

    const stop = useCallback(() => {
        cancelledRef.current = true;
        setRunning(false);
    }, []);

    const hasRunRef = useRef(!!initial.result);
    const didMountRef = useRef(false);
    useEffect(() => {
        if (!didMountRef.current) {
            didMountRef.current = true;
            return;
        }
        if (hasRunRef.current && !running) run();
    }, [design?.id, char, params.theta, params.polarization, evalMode]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!design) return;
        resultCache.set(design.id, {
            params, char, nTrials, corridorSigma,
            rmsAbsNm, rmsRelPct, rmsReN, rmsImN, distribution,
            perMaterial, keepOPT, result,
        });
    }, [design?.id, params, char, nTrials, corridorSigma,
        rmsAbsNm, rmsRelPct, rmsReN, rmsImN, distribution, perMaterial, keepOPT, result]);

    const handleRun = useCallback(async () => {
        hasRunRef.current = true;
        await run();
    }, [run]);

    return {
        design, evalMode,
        params, setParams, char, setChar, nTrials, setNTrials,
        corridorSigma, setCorridorSigma, rmsAbsNm, setRmsAbsNm,
        rmsRelPct, setRmsRelPct, rmsReN, setRmsReN, rmsImN, setRmsImN,
        distribution, setDistribution, perMaterial, setPerMaterial, keepOPT, setKeepOPT,
        result, running, progress, error, showTrials, setShowTrials,
        showEnvelope, setShowEnvelope, stop, handleRun,
    };
}
