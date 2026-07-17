/**
 * Shared helpers for the synthesis windows (Needle Variation, Gradual Evolution,
 * Structural, Needle Manual). Grouped by concern into sibling modules and
 * re-exported here so every window imports from one place.
 *
 * Two helpers take a parameter so each window keeps its own behavior:
 *   - getPoolMaterials(ids, { verbose }) — `verbose` enables pool-diagnostics
 *     logging (used by Needle Variation).
 *   - load/saveCatSelection(key, …) — each window persists its catalog selection
 *     under a distinct localStorage key.
 *
 * Refinement keeps its own densifyForRun(): its debug-log string differs, so
 * routing it through here would change that window's console output.
 */

export { resolveMat, matDisplayName, matFriendlyName } from './materialNames.js';
export { WARN_BADGE_STYLE, MAT_COLORS, matColor, matColorAlpha } from './materialColors.js';
export { POOL_WARN_COUNT, POOL_MAX_SYNC, countPoolMaterials, getPoolMaterials } from './catalogPool.js';
export { loadSavedCatSelection, saveCatSelection, useCatSelection } from './catSelection.js';
export {
    sideKeyFor, activeSide, densifyForRun, minOmfOf, chunkArray,
    poolSize, buildARSeedCandidates, computePareto,
} from './synthesisMath.js';
export { MaterialPoolPanel } from './MaterialPoolPanel.js';
export { TopDesignsPanel } from './TopDesignsPanel.js';
export { PlotlyChart } from './PlotlyChart.js';
export { SynthesisHistoryTable } from './SynthesisHistoryTable.js';
