import { designMaterialLookup } from '../../../../utils/materials/designMaterials.js';
import { runErrorAnalysisMC } from '../../../../utils/physics/errorAnalysis.js';
import { hasPerturbableLayers } from './trialModel.js';
import { errorAnalysisSession } from './sessionState.js';
import { useWindowSession } from '../../windowSession.js';

const { useCallback, useEffect, useRef, useState } = React;

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
        const result = await runErrorAnalysisMC(design, params, designMaterialLookup(design), {
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

export function useErrorAnalysis({ design, evalMode }) {
    const [session, setField] = useWindowSession(errorAnalysisSession, design);
    const {
        params, char, nTrials, corridorSigma, rmsAbsNm, rmsRelPct, rmsReN, rmsImN,
        distribution, perMaterial, keepOPT, showEnvelope, result,
    } = session;
    const setParams = value => setField('params', value);
    const setChar = value => setField('char', value);
    const setNTrials = value => setField('nTrials', value);
    const setCorridorSigma = value => setField('corridorSigma', value);
    const setRmsAbsNm = value => setField('rmsAbsNm', value);
    const setRmsRelPct = value => setField('rmsRelPct', value);
    const setRmsReN = value => setField('rmsReN', value);
    const setRmsImN = value => setField('rmsImN', value);
    const setDistribution = value => setField('distribution', value);
    const setPerMaterial = value => setField('perMaterial', value);
    const setKeepOPT = value => setField('keepOPT', value);
    const setShowEnvelope = value => setField('showEnvelope', value);
    const setResult = value => setField('result', value);

    // Run status is deliberately not stored: a window that reopens mid-run shows
    // no result rather than a progress bar for a run it is no longer driving.
    const [running, setRunning] = useState(false);
    const [progress, setProgress] = useState({ i: 0, total: 0 });
    const [error, setError] = useState(null);
    const [showTrials, setShowTrials] = useState(false);
    const cancelledRef = useRef(false);

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

    const hasRunRef = useRef(!!result);
    const didMountRef = useRef(false);
    useEffect(() => {
        if (!didMountRef.current) {
            didMountRef.current = true;
            return;
        }
        if (hasRunRef.current && !running) run();
    }, [design?.id, char, params.theta, params.polarization, evalMode]); // eslint-disable-line react-hooks/exhaustive-deps

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
        showEditor: session.showEditor, setShowEditor: value => setField('showEditor', value),
        showTable: session.showTable, setShowTable: value => setField('showTable', value),
    };
}
