/**
 * Optimizer Web Worker: runs one single-start refinement job (optimizerJob.js)
 * off the UI thread and posts its messages back.
 *
 * Lifecycle: the main thread `worker.terminate()`s every pool worker on stop /
 * all-done / unmount / design-switch. A terminated worker cannot zombie-step
 * or push background design mutations — this removes the zombie-loop class.
 */

import { handleOptimizerMessage } from './optimizerJob.js';

onmessage = (e) => handleOptimizerMessage(e.data, (message) => postMessage(message));
