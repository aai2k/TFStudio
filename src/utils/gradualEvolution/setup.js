// What a Gradual Evolution run works on: the operand rows it fits, the sides
// it scans, and the materials sampled on the run's wavelength grid.

import {
    activeSide, densifyForRun, withoutPPEF,
} from '../../components/windows/optimization/synthesisShared/synthesisMath.js';
import { presampleSynthesisMaterials } from '../../components/windows/optimization/synthesisShared/runGrid.js';

// The operand rows, scan sides and sampled materials of a run, or the reason
// it cannot start. Unlike Needle, Gradual Evolution keeps the MNT and MXT rows:
// its forced thickness step escapes the local minimum a floor penalty makes.
// The PPEF rows are left out (synthesisMath.js withoutPPEF).
export function prepare(design, operands, pool) {
    const ops = densifyForRun(withoutPPEF(operands.filter(op => op.enabled)), design);
    if (ops.length === 0) return { failed: 'noOperands' };
    // Sides to scan per cycle. For both_independent we scan BOTH front and back
    // and pick the global best needle (regardless of side); for forced modes we
    // scan one side. Seed refines and candidate refines in both_independent
    // vary BOTH sides simultaneously regardless.
    const scanSides = (design.surfaceMode || 'front_only') === 'both_independent' ? ['front', 'back'] : [activeSide(design)];
    if (!pool.length) return { failed: 'noMaterials' };
    let materials;
    try { materials = presampleSynthesisMaterials(design, ops, pool); }
    catch (err) {
        console.error('[GE] Pre-sampling failed:', err);
        return { failed: 'presampleFailed' };
    }
    return { operands: ops, materials, scanSides };
}
