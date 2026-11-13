import { normalizeSeed, randomSeed } from '../../../../utils/physics/errorAnalysis/mcConfig.js';
import { BASE_ENVIRONMENT, environmentsOf, hasEnvironments, isEnvironmentOn } from '../../../../utils/environments/environments.js';
import { startMonteCarloRun } from './monteCarloRun.js';
import { hasPerturbableLayers } from './trialModel.js';
import { errorAnalysisSession } from './sessionState.js';
import { useWindowSession } from '../../windowSession.js';
import { useRefreshRevision } from '../../../../state/refreshAll.js';
import { useEnvironmentChoice } from '../chrome/environmentChoice.js';

const { useCallback, useEffect, useMemo, useRef, useState } = React;

// The curves of one environment's spread, as a run lists each environment's.
const SPREAD_KEYS = ['lambda', 'theory', 'mean', 'stdev', 'lower', 'upper', 'envLower', 'envUpper'];

/**
 * The environments a run on `design` computes the spread of, by id: every
 * environment that is on and `shownId`, the one the window shows, in the
 * design's order, and environment 1 first in any case, so the run's own
 * curves, which the Report prints, are always the design's. Undefined on a
 * design without environments, whose run computes the design alone.
 */
export function runEnvironments(design, shownId) {
    if (!hasEnvironments(design)) return undefined;
    return environmentsOf(design)
        .filter(env => env.id === BASE_ENVIRONMENT || isEnvironmentOn(env) || env.id === shownId)
        .map(env => env.id);
}

/**
 * `result` as the window shows it in environment `id`: its spread in that
 * environment in place of the first one's, its yield and trials as they are.
 * A result without spreads of its own, a run on a design without
 * environments, is environment 1's. Null when the run did not compute that
 * environment, or there is no result.
 */
export function shownSpread(result, id) {
    if (!result) return null;
    if (!result.environments) return id === BASE_ENVIRONMENT ? result : null;
    const spread = result.environments.find(entry => entry.id === id);
    if (!spread) return null;
    return { ...result, ...Object.fromEntries(SPREAD_KEYS.map(key => [key, spread[key]])) };
}

/**
 * One Monte-Carlo run with the window's settings, off the window's thread
 * (monteCarloRun.js). The corridor width goes to the run too, so the run
 * records the k its corridor was drawn with. `runRef` holds the run while it
 * goes, so Stop can end it; a stopped run's result is the trials reported,
 * and none when it reported none. `shownView`, the environment shown (`{
 * design, mode }`, environment 1 by default), needs a layer to perturb on the
 * side it is scored on.
 */
export async function executeRun(options) {
    const {
        design, params, evalMode, char, nTrials, corridorSigma, rmsAbsNm, rmsRelPct,
        rmsReN, rmsImN, distribution, perMaterial, keepOPT, seed, runRef,
        setError, setRunning, setProgress, setResult, setSeed, environments,
        shownView = { design, mode: evalMode },
    } = options;
    if (!hasPerturbableLayers(shownView.design, shownView.mode)) {
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
        ...(environments ? { environments } : {}),
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

    // The environment shown, Current or one the droplist names; a run computes
    // it beside every environment that is on, so the droplist moves between
    // them on the same trials without a new run.
    const environment = useEnvironmentChoice(design);
    const shownView = environment.views[0];
    const environments = useMemo(() => runEnvironments(design, shownView.id), [design, shownView.id]);
    const shown = useMemo(() => shownSpread(result, shownView.id), [result, shownView.id]);

    const run = useCallback(() => executeRun({
        design, params, evalMode, char, nTrials, corridorSigma, rmsAbsNm, rmsRelPct,
        rmsReN, rmsImN, distribution, perMaterial, keepOPT, seed, runRef,
        setError, setRunning, setProgress, setResult, setSeed, environments, shownView,
    }), [design, params, evalMode, char, nTrials, corridorSigma,
        rmsAbsNm, rmsRelPct, rmsReN, rmsImN, distribution, perMaterial, keepOPT, seed, environments, shownView]);

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

    // An environment the last run did not compute, one that is off chosen
    // after it or while it went, is run again with the seed that run was drawn
    // from: the same trials, seen in that environment as well. Once for each
    // result and environment, so a run that fails is not started again and again.
    const missing = !!result && !shown;
    const ranFor = useRef(null);
    useEffect(() => {
        if (!missing || running) return;
        if (ranFor.current?.result === result && ranFor.current?.id === shownView.id) return;
        ranFor.current = { result, id: shownView.id };
        run();
    }, [missing, running, shownView.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
        environment, shown, shownDesign: shownView.design, shownMode: shownView.mode,
        showEditor: session.showEditor, setShowEditor: value => setField('showEditor', value),
        showTable: session.showTable, setShowTable: value => setField('showTable', value),
    };
}
