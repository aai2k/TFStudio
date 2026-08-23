import { ANALYSIS_EVALUATION_WORKER_URL } from '../../../workerUrls.js';
import { getTmmWasmBytesForWorker } from '../../../tmmcore.js';
import { embedDesignMaterials } from '../../../utils/materials/designMaterials.js';

const { useEffect, useState } = React;

/**
 * Run cone-heavy display evaluation outside the renderer. Callers keep their
 * existing synchronous path for collimated light and use this hook only when
 * `active` is true. Replacing a design hard-cancels the stale worker.
 */
export function useAnalysisEvaluation(active, operation, payload) {
    const [state, setState] = useState({ data: null, error: null, busy: false, payload: null });

    useEffect(() => {
        if (!active) return undefined;
        let worker;
        try {
            worker = new Worker(ANALYSIS_EVALUATION_WORKER_URL, { type: 'module' });
        } catch (error) {
            console.error('[Analysis evaluation worker] construction failed', error);
            setState({ data: null, error: 'ANALYSIS_EVALUATION_FAILED', busy: false, payload });
            return undefined;
        }
        let live = true;
        setState({ data: null, error: null, busy: true, payload });
        worker.onmessage = event => {
            if (!live || !event.data) return;
            if (event.data.type === 'result') {
                setState({ data: event.data.data, error: null, busy: false, payload });
            } else if (event.data.type === 'error') {
                console.error('[Analysis evaluation worker]', event.data.message);
                setState({ data: null, error: 'ANALYSIS_EVALUATION_FAILED', busy: false, payload });
            }
        };
        worker.onerror = event => {
            if (live) {
                console.error('[Analysis evaluation worker]', event.message);
                setState({ data: null, error: 'ANALYSIS_EVALUATION_FAILED', busy: false, payload });
            }
        };
        try {
            const wasmBytes = getTmmWasmBytesForWorker();
            if (wasmBytes) worker.postMessage({ type: 'wasmInit', wasmBytes });
            const portablePayload = payload ? {
                ...payload,
                ...(payload.design ? { design: embedDesignMaterials(payload.design) } : {}),
                ...(payload.candidateDesign
                    ? { candidateDesign: embedDesignMaterials(payload.candidateDesign) }
                    : {}),
                ...(Array.isArray(payload.designs)
                    ? { designs: payload.designs.map(embedDesignMaterials) }
                    : {}),
            } : payload;
            worker.postMessage({ type: 'evaluate', operation, payload: portablePayload });
        } catch (error) {
            console.error('[Analysis evaluation worker] postMessage failed', error);
            setState({ data: null, error: 'ANALYSIS_EVALUATION_FAILED', busy: false, payload });
            worker.terminate();
            return undefined;
        }
        return () => {
            live = false;
            worker.terminate();
        };
    }, [active, operation, payload]);

    return active && state.payload !== payload
        ? { data: null, error: null, busy: true }
        : state;
}
