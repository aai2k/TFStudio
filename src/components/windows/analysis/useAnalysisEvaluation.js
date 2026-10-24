import { ANALYSIS_EVALUATION_WORKER_URL } from '../../../workerUrls.js';
import { getTmmWasmBytesForWorker } from '../../../tmmcore.js';
import { embedDesignMaterials } from '../../../utils/materials/designMaterials.js';

const { useEffect, useState } = React;

// The payload with every design in it carrying its materials, since the worker
// has no catalogs to resolve them from.
function portable(payload) {
    if (!payload) return payload;
    return {
        ...payload,
        ...(payload.design ? { design: embedDesignMaterials(payload.design) } : {}),
        ...(payload.candidateDesign
            ? { candidateDesign: embedDesignMaterials(payload.candidateDesign) }
            : {}),
        ...(Array.isArray(payload.designs)
            ? { designs: payload.designs.map(embedDesignMaterials) }
            : {}),
    };
}

// Hands the worker the WASM kernel and the evaluation to run.
function postEvaluation(worker, operation, payload) {
    const wasmBytes = getTmmWasmBytesForWorker();
    if (wasmBytes) worker.postMessage({ type: 'wasmInit', wasmBytes });
    worker.postMessage({ type: 'evaluate', operation, payload: portable(payload) });
}

const FAILED = { data: null, error: 'ANALYSIS_EVALUATION_FAILED', busy: false };

// Runs `operation` on a worker of its own and reports each state it reaches
// through `report`; returns what stops it.
function watchedEvaluation(operation, payload, report) {
    let worker = null;
    let live = true;
    try {
        worker = new Worker(ANALYSIS_EVALUATION_WORKER_URL, { type: 'module' });
        worker.onmessage = (event) => {
            if (!live || !event.data) return;
            if (event.data.type === 'result') report({ data: event.data.data, error: null, busy: false });
            else if (event.data.type === 'error') {
                console.error('[Analysis evaluation worker]', event.data.message);
                report(FAILED);
            }
        };
        worker.onerror = (event) => {
            if (!live) return;
            console.error('[Analysis evaluation worker]', event.message);
            report(FAILED);
        };
        report({ data: null, error: null, busy: true });
        postEvaluation(worker, operation, payload);
    } catch (error) {
        console.error('[Analysis evaluation worker] could not start', error);
        report(FAILED);
        worker?.terminate();
        worker = null;
    }
    return () => {
        live = false;
        worker?.terminate();
    };
}

/**
 * Run cone-heavy display evaluation outside the renderer. Callers keep their
 * existing synchronous path for collimated light and use this hook only when
 * `active` is true. Replacing a design hard-cancels the stale worker.
 */
export function useAnalysisEvaluation(active, operation, payload) {
    const [state, setState] = useState({ data: null, error: null, busy: false, payload: null });

    useEffect(() => (active
        ? watchedEvaluation(operation, payload, next => setState({ ...next, payload }))
        : undefined), [active, operation, payload]);

    return active && state.payload !== payload
        ? { data: null, error: null, busy: true }
        : state;
}

/**
 * One evaluation on a worker of its own, for an action rather than a display:
 * resolves with the result, rejects with the worker's error, and ends the
 * worker either way.
 */
export function evaluateOnAnalysisWorker(operation, payload) {
    return new Promise((resolve, reject) => {
        const worker = new Worker(ANALYSIS_EVALUATION_WORKER_URL, { type: 'module' });
        const finish = (settle, value) => { worker.terminate(); settle(value); };
        worker.onmessage = (event) => {
            if (event.data?.type === 'result') finish(resolve, event.data.data);
            else if (event.data?.type === 'error') finish(reject, new Error(event.data.message));
        };
        worker.onerror = event => finish(reject, new Error(event.message));
        try {
            postEvaluation(worker, operation, payload);
        } catch (error) {
            finish(reject, error);
        }
    });
}
