/**
 * A worker's side of a Monte Carlo run spread over a pool of workers
 * (physics/errorAnalysis/mcPool.js). The app's analysis worker
 * (analysisEvaluationWorker.js) and the API's trial threads
 * (api/monteCarloThread.js) both answer these messages:
 *
 *   { type: 'mcStart', design, params, options }  →  { type: 'mcReady', spreads }
 *   { type: 'mcTrial', trial }                    →  { type: 'mcTrialDone', trial, outcome }
 *   { type: 'mcStop' }                            →  { type: 'mcStopped' }
 *
 * `design` carries its materials (embedDesignMaterials), since a worker has no
 * catalogs. Trials are answered in the order they are asked for. A failure is
 * answered once with { type: 'error', message }, and no trial after it.
 * mcStopped comes once the worker has finished what it was doing, and it
 * evaluates no trial after mcStop.
 */

import { startMCTrials } from '../physics/errorAnalysis/monteCarlo.js';
import { designMaterialLookup } from '../materials/designMaterials.js';
import { awaitTmmWasmReady } from '../../tmmcore.js';

/**
 * The worker's handler of these messages, `post` sending its answers. It
 * returns true for a message it answers and false for any other.
 */
export function monteCarloTrialHandler(post) {
    let run = null;
    let failed = false;
    let stopped = false;
    const fail = error => {
        if (failed) return;
        failed = true;
        post({ type: 'error', message: error?.message || String(error) });
    };
    return message => {
        if (message?.type === 'mcStart') {
            const { design, params, options } = message;
            run = awaitTmmWasmReady().then(() => {
                const trials = startMCTrials(design, params, designMaterialLookup(design), options);
                post({ type: 'mcReady', spreads: trials.spreads });
                return trials;
            });
            run.catch(fail);
            return true;
        }
        if (message?.type === 'mcTrial') {
            run.then(trials => {
                if (!failed && !stopped) post({ type: 'mcTrialDone', trial: message.trial, outcome: trials.evaluate(message.trial) });
            }).catch(fail);
            return true;
        }
        if (message?.type === 'mcStop') {
            stopped = true;
            const answer = () => post({ type: 'mcStopped' });
            (run ?? Promise.resolve()).then(answer, answer);
            return true;
        }
        return false;
    };
}
