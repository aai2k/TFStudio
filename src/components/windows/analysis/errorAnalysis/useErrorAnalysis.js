import { normalizeSeed, randomSeed } from '../../../../utils/physics/errorAnalysis/mcConfig.js';
import { startMonteCarloRun } from './monteCarloRun.js';
import { hasPerturbableLayers } from './trialModel.js';
import { errorAnalysisSession } from './sessionState.js';
import { useWindowSession } from '../../windowSession.js';
import { useRefreshRevision } from '../../../../state/refreshAll.js';

const { useCallback, useEffect, useMemo, useRef, useState } = React;

/**
 * One Monte-Carlo run with the window's settings, off the window's thread
 * (monteCarloRun.js). The corridor width goes to the run too, so the run
 * records the k its corridor was drawn with. `runRef` holds the run while it
 * goes, so Stop can end it; a stopped run's result is the trials reported,
 * and none when it reported none.
 */
export async function executeRun(options) {
    const {
        design, params, evalMode, char, nTrials, corridorSigma, rmsAbsNm, rmsRelPct,
        rmsReN, rmsImN, distribution, perMaterial, keepOPT, seed, runRef,
        setError, setRunning, setProgress, setResult, setSeed,
    } = options;
    if (!hasPerturbableLayers(design, evalMode)) {
        setError('No layers to perturb.');
        return;
    }
    // The seed field keeps the seed this run is drawn from, so running again
    // with the same settings replays it. An empty field draws a fresh seed.
    const runSeed = normalizeSeed(seed) ?? randomSeed();
    if (runSeed !== seed) setSeed(runSeed);
    setError(null);
    setRunning(true);
    setProgress({ i: 0, total: nTrials });
    // Stop reaches the run from here on: pressed before it starts, it starts none.
    const pending = { stopped: false, stop() { this.stopped = true; } };
    runRef.current = pending;
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (pending.stopped) {
        setResult(null);
        if (runRef.current === pending) runRef.current = null;
        setRunning(false);
        return;
    }

    const run = startMonteCarloRun(design, params, {
        char,
        evalMode,
        nTrials,
        corridorSigma,
        seed: runSeed,
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
    }, setProgress);
    runRef.current = run;
    try {
        // A run stopped before it reported a trial has no result, and the one on
        // screen was made with other settings, so it goes too.
        setResult(await run.done);
    } catch (error) {
        setError(error.message || String(error));
    }
    if (runRef.current === run) runRef.current = null;
    setRunning(false);
}

export function useErrorAnalysis({ design, evalMode }) {
    const [session, setField, patchSession] = useWindowSession(errorAnalysisSession, design);
    const {
        char, nTrials, corridorSigma, rmsAbsNm, rmsRelPct, rmsReN, rmsImN,
        distribution, perMaterial, keepOPT, showEnvelope, seed, result,
    } = session;
    // The evaluation grid is held as flat keys so Settings can edit each of them,
    // and gathered back into the shape the spectrum functions take.
    const { lambdaStart, lambdaEnd, lambdaStep, theta, polarization } = session;
    const params = useMemo(
        () => ({ lambdaStart, lambdaEnd, lambdaStep, theta, polarization }),
        [lambdaStart, lambdaEnd, lambdaStep, theta, polarization],
    );
    const setParams = value => patchSession(current => (
        typeof value === 'function' ? value(current) : value));
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
    const setSeed = value => setField('seed', value);
    const setResult = value => setField('result', value);

    // Run status is deliberately not stored: a window that reopens mid-run shows
    // no result rather than a progress bar for a run it is no longer driving.
    const [running, setRunning] = useState(false);
    const [progress, setProgress] = useState({ i: 0, total: 0 });
    const [error, setError] = useState(null);
    const [showTrials, setShowTrials] = useState(false);
    const runRef = useRef(null);

    const run = useCallback(() => executeRun({
        design, params, evalMode, char, nTrials, corridorSigma, rmsAbsNm, rmsRelPct,
        rmsReN, rmsImN, distribution, perMaterial, keepOPT, seed, runRef,
        setError, setRunning, setProgress, setResult, setSeed,
    }), [design, params, evalMode, char, nTrials, corridorSigma,
        rmsAbsNm, rmsRelPct, rmsReN, rmsImN, distribution, perMaterial, keepOPT, seed]);

    // A run goes on when the window is closed, docked elsewhere or its tab
    // switched, and its result lands in the window's session.
    const stop = useCallback(() => {
        runRef.current?.stop();
        setRunning(false);
    }, []);

    // Once a run has been made, it is made again when the design, the channel,
    // the angle, the polarization or the surface changes, and after Refresh all
    // has read the files again.
    const refreshRevision = useRefreshRevision();
    const hasRunRef = useRef(!!result);
    const didMountRef = useRef(false);
    useEffect(() => {
        if (!didMountRef.current) {
            didMountRef.current = true;
            return;
        }
        if (hasRunRef.current && !running) run();
    }, [design?.id, char, params.theta, params.polarization, evalMode, refreshRevision]); // eslint-disable-line react-hooks/exhaustive-deps

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
        seed, setSeed, result, running, progress, error, showTrials, setShowTrials,
        showEnvelope, setShowEnvelope, stop, handleRun,
        showEditor: session.showEditor, setShowEditor: value => setField('showEditor', value),
        showTable: session.showTable, setShowTable: value => setField('showTable', value),
    };
}
