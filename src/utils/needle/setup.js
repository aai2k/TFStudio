// What a Needle run works on: the operand rows a synthesis keeps, the sides it
// scans, the materials sampled on the run's wavelength grid, the per-run design
// snapshot helpers, and moving the run onto a finer grid as the design grows.

import { isConstraint } from '../physics/optimizer.js';
import { designMaterialLookup } from '../materials/designMaterials.js';
import {
    densifyForRun, withoutPPEF, activeSide, serializableMedia,
} from '../../components/windows/optimization/synthesisShared/synthesisMath.js';
import {
    regridForDesign, meritOf, presampleSynthesisMaterials,
} from '../../components/windows/optimization/synthesisShared/runGrid.js';

// The operand rows a Needle run fits, the sides it scans and the materials on
// its grid, or the reason the run cannot start. Needle is a synthesis step
// with no forced thickness step to escape a local minimum, so an active MNT or
// MXT penalty can wipe out every improving candidate and end the run as
// needle-optimal too early: those rows are left out, for a Refinement run
// afterwards. So are the PPEF rows (synthesisMath.js withoutPPEF).
export function prepare(design, operands, pool) {
    const enabled = withoutPPEF(operands.filter(op => op.enabled));
    const ops = densifyForRun(enabled.filter(op => !isConstraint(op.type)), design);
    if (ops.length === 0) return { failed: 'noOperands' };
    const dropped = enabled.length - ops.length;
    if (dropped > 0) {
        console.log(`[Needle] Ignoring ${dropped} MNT/MXT operand${dropped > 1 ? 's' : ''} for synthesis (re-enable for Refinement after)`);
    }
    if (!pool.length) return { failed: 'noMaterials' };
    let materials;
    try { materials = presampleSynthesisMaterials(design, ops, pool); }
    catch (err) {
        console.error('[Needle] Pre-sampling failed:', err);
        return { failed: 'presampleFailed' };
    }
    // Sides to scan per cycle. For both_independent we scan BOTH front and back
    // and pick the global best needle (regardless of side) each generation.
    // Mode-forced cases (front_only / symmetric / back_only) scan just one side.
    const scanSides = (design.surfaceMode || 'front_only') === 'both_independent'
        ? ['front', 'back'] : [activeSide(design)];
    return { operands: ops, materials, scanSides };
}

// Move the run onto `operands`: material tables sampled on them, and `best`,
// the pre-rescue design and the ΔMF baseline re-scored so the next comparisons
// are made on one grid.
function useGrid(run, operands, resolveMat) {
    run.operands = operands;
    run.materials = presampleSynthesisMaterials(run.curDes, operands, run.pool);
    const rescore = d => meritOf(operands, run.designSnap(d.frontLayers, d.backLayers), resolveMat);
    const { best } = run;
    if (best.frontLayers || best.backLayers) {
        best.mf = rescore(best);
        run.prevBestMF = best.mf;
    }
    if (run.preRescueBest) run.preRescueBest.mf = rescore(run.preRescueBest);
    console.log(`[Needle] Grid re-sampled for the design: bestMF=${best.mf.toFixed(6)}`);
}

// When the design about to be worked on (`front`/`back`) has outgrown the run's
// sampling grid (runGrid.js), move the run onto a grid for it.
export function regridIfGrown(run, front, back) {
    const resolveMat = designMaterialLookup(run.curDes);
    const operands = regridForDesign(run.operands, run.designSnap(front, back), resolveMat);
    if (operands) useGrid(run, operands, resolveMat);
}

// Move the run onto the grid `front`/`back` needs, grown from `base`: a grid
// the run held before it sampled for a thicker design than the one it goes on
// with. Unlike regridIfGrown, this can lower the sample counts.
export function regridFrom(run, base, front, back) {
    const resolveMat = designMaterialLookup(run.curDes);
    const operands = regridForDesign(base, run.designSnap(front, back), resolveMat) || base;
    if (operands !== run.operands) useGrid(run, operands, resolveMat);
}

// Per-run design snapshot + layer helpers. designSnap builds a full design from
// the CURRENT both-side state; for both_independent every cycle re-snaps both
// sides from `best`, so both stacks evolve through the run.
export function designHelpers(curDes, poolSlices) {
    const media = serializableMedia(curDes);
    const mkLayers = arr => (arr || []).map(l => ({
        id: l.id, material: l.material, thickness: l.thickness || 0, locked: !!l.locked }));
    const designSnap = (front, back) => ({ ...media, frontLayers: mkLayers(front), backLayers: mkLayers(back) });
    return { mkLayers, designSnap, deep: x => JSON.parse(JSON.stringify(x)), poolSlices };
}
