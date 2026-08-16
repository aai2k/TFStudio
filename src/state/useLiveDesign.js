import { useDesign } from './DesignContext.js';

const { useEffect, useRef, useState } = React;

// Redraw interval for live previews while an optimizer run is in progress.
// Optical Evaluation has used this cadence since live preview was introduced;
// every window that follows a run shares it so they redraw together.
export const OPTIMIZATION_PREVIEW_MS = 250;

/**
 * The active design, sampled at a fixed rate while an optimizer run is driving
 * it.
 *
 * A run replaces the design far faster than any analysis window can redraw. A
 * window that recomputes on every update saturates the main thread and the
 * whole interface stops responding, so live-preview consumers follow this
 * value instead of the design itself.
 *
 * `preview` is true while the design is being sampled. An expensive window can
 * use it to compute something cheaper than its final result, since a curve
 * being watched while it moves does not need the resolution of one being read.
 *
 * With the live-update setting off, a run is not followed at all: the design
 * holds where it was when the run started, and the window updates once when it
 * stops. Nothing here affects ordinary edits, which always show immediately.
 */
export function useLiveDesign(intervalMs = OPTIMIZATION_PREVIEW_MS) {
    const { design, isOptimizing, liveUpdate } = useDesign();
    const latest = useRef(design);
    latest.current = design;
    const [sampled, setSampled] = useState(design);

    useEffect(() => {
        if (!isOptimizing) return undefined;
        // One frame at the start, then either keep sampling or hold that frame
        // for the rest of the run.
        setSampled(latest.current);
        if (!liveUpdate) return undefined;
        const timer = setInterval(() => setSampled(latest.current), intervalMs);
        return () => clearInterval(timer);
    }, [isOptimizing, liveUpdate, intervalMs]);

    const following = isOptimizing && liveUpdate;
    return { design: isOptimizing ? sampled : design, preview: following };
}
