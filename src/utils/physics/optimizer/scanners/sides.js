/**
 * Scan-side resolution (surface-mode-forced where applicable).
 */

// Resolve effective scan side (mode-forced where applicable).
//   front_only / symmetric → 'front'  (symmetric mirrors front→back automatically)
//   back_only              → 'back'
//   both_independent       → whatever the caller requested ('front'|'back')
// UI components call this with a stored radio selection to know which layer
// array is the synthesis target for the current design.
export function resolveScanSide(surfaceMode, requestedSide) {
    if (surfaceMode === 'front_only')  return 'front';
    if (surfaceMode === 'back_only')   return 'back';
    if (surfaceMode === 'symmetric')   return 'front';   // back mirrored
    return requestedSide === 'back' ? 'back' : 'front';   // both_independent
}
