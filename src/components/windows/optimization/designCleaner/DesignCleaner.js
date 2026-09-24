/**
 * Design Cleaner — structural cleanup window.
 *
 * Combines two cleanup modes: Design Cleaner (merge similar adjacent
 * layers + remove sub-threshold layers + re-optimize) and Thin
 * Layer Removal (list sub-N nm layers and drop them with optional
 * post-refinement). Both use the same underlying `cleanupDesign()` from
 * `src/utils/synthesis/designCleaner.js`.
 *
 * Flow:
 *   1. User picks threshold + toggles (merge / re-optimize / clean back)
 *   2. Window previews the operations (remove/merge) and shows MF before
 *   3. User clicks Apply: if enabled, a short pass of the default refiner
 *      (the Refinement window's default method) polishes the cleaned stack
 *      in the optimizer worker, so the window stays responsive, with a step
 *      count and a Stop button. The cleaned (and refined) design is then
 *      committed behind one undo checkpoint.
 *
 * The previous design is reachable via Ctrl+Z (single checkpoint covers
 * both the cleanup and the optional refinement).
 */

import { CleanerControls } from './CleanerControls.js';
import { CleanerOpsTable } from './CleanerOpsTable.js';
import { CleanerPlaceholder, CleanerSummary } from './CleanerStatus.js';
import { CleanerThinList } from './CleanerThinList.js';
import { useDesignCleaner } from './useDesignCleaner.js';

const { createElement: h } = React;

export function DesignCleaner({ c, theme, t }) {
    const dc = t.designCleaner;
    const state = useDesignCleaner(dc);
    const { design, ops, thinList, dMin } = state;

    if (!design) return h(CleanerPlaceholder, { message: dc.noDesign, c });
    if (!design.frontLayers?.length && !design.backLayers?.length) {
        return h(CleanerPlaceholder, { message: dc.noLayers, c });
    }

    return h('div', {
        style: {
            display: 'flex', flexDirection: 'column', height: '100%',
            background: c.bg, color: c.text, overflow: 'hidden',
            fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: 12,
        }
    },
        h(CleanerControls, { ...state, c, dc }),
        h(CleanerSummary, { ...state, c, dc }),
        h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'row' } },
            h(CleanerOpsTable, { c, dc, ops, dMin }),
            h(CleanerThinList, { c, dc, thinList }),
        )
    );
}
