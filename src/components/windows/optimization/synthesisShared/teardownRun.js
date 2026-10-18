// Ending the run a synthesis window shows (Needle, Gradual Evolution).

/**
 * Let go of the run the window shows and stop it; the run then terminates its
 * worker pool. Nothing the run reports after this is shown.
 */
export function teardownRun({ runningRef, activeRunRef, abortRef }) {
    runningRef.current = false;
    activeRunRef.current = null;
    if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
    }
}
