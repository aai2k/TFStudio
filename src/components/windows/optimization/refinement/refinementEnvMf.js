import { LSQEngine } from '../../../../utils/physics/optimizer.js';
import { designMaterialLookup } from '../../../../utils/materials/designMaterials.js';

// React is a renderer global (UMD build, src/index.html). Read it through
// globalThis so this module stays importable in plain Node for the pure-function
// test: there globalThis.React is undefined and `useMemo` stays undefined — the
// hook is never called there, so it is never dereferenced. In the renderer
// globalThis === window, so this is byte-identical to `const { useMemo } = React`.
const { useMemo } = globalThis.React ?? {};

/**
 * Per-environment merit values for a given design state, recomputed on demand
 * (per-state recompute — no runner/protocol changes, method-consistent).
 *
 * Replicates the validated `useEnvMf` pattern verbatim:
 *   new LSQEngine(operands, design, designMaterialLookup(design), { environments })
 *     → engine.mfAtWithPerEnv(engine.thicknesses).perEnvMf
 *
 * Single-environment mode (no meritEnvironments), missing operands, or an
 * evaluation failure return null — the caller renders nothing in those cases.
 */
export function perEnvMfFor(designState, operands) {
  if (!designState || !operands?.length) return null;
  const envs = designState.meritEnvironments || [];
  if (envs.length === 0) return null;
  try {
    const engine = new LSQEngine(operands, designState, designMaterialLookup(designState), {
      environments: envs,
    });
    return engine.mfAtWithPerEnv(engine.thicknesses).perEnvMf;
  } catch (_) {
    return null;
  }
}

/**
 * Per-env MF breakdown for the Refinement window: current design state plus the
 * saved (Reset/initial) state for comparison. Each entry is null when the state
 * has no multi-env setup (or evaluation fails) — the card hides per entry.
 */
export function useRefinementEnvMf(design, savedDesign, operands) {
  return useMemo(() => ({
    perEnvMf:        perEnvMfFor(design, operands),
    perEnvMfInitial: perEnvMfFor(savedDesign, operands),
  }), [design, savedDesign, operands]);
}
