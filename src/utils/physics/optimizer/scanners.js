/**
 * Needle / Gradual-Evolution insertion scanners — analytic P-function scan,
 * finite-difference fallback, optimal-thickness search, GE boundary scan.
 *
 * Each concern lives in its own module under `scanners/`; this barrel re-exports
 * the public surface and provides the analytic→FD dispatcher.
 * Reference: Sullivan & Dobrowolski / Tikhonravov, Appl. Opt. 35 (1996).
 */

import { scanNeedlesAnalytic } from './scanners/analyticScan.js';
import { scanNeedlesFD } from './scanners/fdScan.js';

export { resolveScanSide } from './scanners/sides.js';
export { scanNeedlesAnalytic } from './scanners/analyticScan.js';
export { scanNeedlesFD } from './scanners/fdScan.js';
export { findOptimalNeedleThickness } from './scanners/thickness.js';
export { scanGEInsertions } from './scanners/geScan.js';

// Dispatcher: prefer the exact analytic Tikhonravov/Sullivan P-function; fall
// back to the validated finite-difference scan when the merit function contains
// terms whose ∂Q/∂(B,C) is not analytically defined here (ramp / constraint-only
// / integral / minmax / math / argwave / cone). Sullivan & Dobrowolski (1996)
// give exactly this rationale for keeping a numerical variant available.
//
// Surface-mode awareness: both scanners route through buildEvalContext /
// tmmFullSystem (Macleod §2.6.4) when design.surfaceMode != 'front_only'.
// `side` ('front'|'back') chooses which stack to scan; it is forced to 'front'
// in front_only and symmetric (symmetric auto-mirrors into the back), and to
// 'back' in back_only. In both_independent the caller passes it explicitly.
export function scanNeedlesPFunction(args) {
    const analytic = scanNeedlesAnalytic(args);
    if (analytic) return analytic;
    return scanNeedlesFD(args);
}
