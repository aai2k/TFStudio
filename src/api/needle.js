// The Needle Manual window's profile scan and its insertion of one needle
// (needleManual/insertion.js), on the window's factory settings.

import {
    profileScan, runOperands, scanOperands, insertForSelection, startingThickness, candidateDepth, resolveDRange, sideKey,
} from '../components/windows/optimization/needleManual/insertion.js';
import { NEEDLE_MANUAL_DEFAULTS as D, NEEDLE_MANUAL_LIMITS as L } from '../components/windows/optimization/needleManual/sessionState.js';
import { resolveScanSide } from '../utils/physics/optimizer.js';
import { designMaterialLookup } from '../utils/materials/designMaterials.js';
import { editorLayerNumber } from '../utils/misc/layerNumbers.js';
import { requireMaterial, requireResolved } from './materials.js';
import { requireKernel } from './environment.js';
import { poolOf } from './runs.js';
import { scoredSide } from './stackViews.js';
import { checkOptions, requireValue } from './check.js';

const CANDIDATE_FIELDS = ['material', 'kind', 'layer', 'position', 'fraction', 'depth', 'gradient'];

// The side scanned: `side` when given, else the front, or the back of a
// design coated on the back alone; a side the window does not scan on the
// design's surface mode is refused.
function scannedSide(call, design, side) {
    const chosen = scoredSide(call, design, side);
    const mode = design.surfaceMode || 'front_only';
    const scanned = resolveScanSide(mode, chosen);
    requireValue(call, 'side', side, () => scanned === chosen, `'${scanned}' or left out: the window scans a ${mode} design on its ${scanned}`);
    return chosen;
}

// The rows the scan and the starting thickness score on, as the window takes
// them, and the material lookup they are scored with.
function scanRows(call, design) {
    requireResolved(design);
    const resolveMat = designMaterialLookup(design);
    const rows = scanOperands(runOperands(design, resolveMat));
    if (!rows.length) throw new Error(`${call}: the design has no merit row the scan scores; MNT, MXT and PPEF rows are not scored`);
    return { resolveMat, rows };
}

// A candidate of the window's scan as needleProfile gives it, its places
// turned into Design Editor numbers on `side`, whose stored layers `layers`
// have the depth boundaries `zb`.
function candidateOf(cand, side, layers, zb) {
    const inside = !!cand.intra;
    return {
        material: cand.materialId, kind: inside ? 'inside' : 'gap',
        layer: inside ? editorLayerNumber(side, layers.length, cand.layerK) : null,
        position: inside ? null : (side === 'back' ? cand.pos : layers.length - cand.pos),
        fraction: inside ? cand.frac : null,
        depth: candidateDepth(cand, zb), gradient: cand.grad,
    };
}

// `candidate`, as needleProfile gives one, as the window's candidate on
// `side`, whose stored layers are `layers`, with its material's record.
function selectionOf(call, design, layers, side, candidate) {
    requireValue(call, 'candidate', candidate, v => !!v && typeof v === 'object' && !Array.isArray(v), 'a candidate as needleProfile gives one');
    const extra = Object.keys(candidate).find(key => !CANDIDATE_FIELDS.includes(key));
    if (extra) throw new Error(`${call}: a candidate has no field '${extra}'; its fields are ${CANDIDATE_FIELDS.join(', ')}`);
    const { material, kind, layer, position, fraction } = candidate;
    const mat = requireMaterial(design, material);
    requireValue(call, 'candidate.kind', kind, v => v === 'gap' || v === 'inside', "'gap' or 'inside'");
    const count = layers.length;
    if (kind === 'gap') {
        requireValue(call, 'candidate.position', position, v => Number.isInteger(v) && v >= 0 && v <= count,
            `a whole number from 0 to ${count}, the layers between the gap and the substrate`);
        return { selected: { pos: side === 'back' ? position : count - position, materialId: material }, mat };
    }
    requireValue(call, 'candidate.layer', layer, v => Number.isInteger(v) && v >= 1 && v <= count, `a layer number from 1 to ${count}`);
    requireValue(call, 'candidate.fraction', fraction, v => Number.isFinite(v) && v > 0 && v < 1, 'a number above 0 and below 1');
    const layerK = side === 'back' ? layer - 1 : count - layer;
    return { selected: { intra: true, layerK, frac: fraction, pos: layerK + fraction, materialId: material }, mat };
}

/**
 * Where a thin layer of each material would lower the merit, as the
 * [Needle Manual](/synthesis/needle/#needle-manual) window's Compute P-function finds
 * it: the slope of the optical merit against the thickness of a needle of
 * each pool material put in at each interface of one side's layers and at
 * points inside each layer (Tikhonravov et al., Appl. Opt. 35, 5493, 1996).
 * A negative gradient is a place where a needle lowers the merit. The scan
 * scores the design's enabled merit rows less the MNT, MXT and PPEF rows, as
 * the window does.
 *
 * @param design The design; it needs a merit row the scan scores.
 * @param options
 * @param options.pool The materials a needle may be, by id: one or more, none twice. The window's pool is a catalog selection; here it is the ids.
 * @param [options.side] `'front'` or `'back'`. Without it, the front, or the back of a design coated on the back alone. A side the window does not scan is refused: the back of a symmetric design, whose back mirrors its front, or the uncoated side of a one-sided design.
 * @param [options.step=0.5] The probe needle's thickness, nm, 0.05 or more, over which a slope with no exact formula is differenced: the window's Probe δ.
 * @param [options.intraSamples=16] Points inside each layer, a whole number from 2 to 60: the window's Profile pts / layer.
 * @returns The profile.
 * @property mode The side scanned, `'front'` or `'back'`.
 * @property mf0 The optical merit of the design as it is, as the scan scores it; null when there is no candidate.
 * @property candidates Each place and material scanned, in the scan's order; none means the window would call the design needle-optimal there.
 * @property candidates[].material The needle's material, by id.
 * @property candidates[].kind `'gap'`, between two layers or at the stack's ends, or `'inside'`, splitting a layer.
 * @property candidates[].layer For `'inside'`, the number of the layer split, 1 next to the substrate, as the Design Editor numbers it; null for a gap. The needle becomes layer `layer + 1`.
 * @property candidates[].position For `'gap'`, how many layers lie between the gap and the substrate, 0 on the substrate; null inside a layer. The needle becomes layer `position + 1`.
 * @property candidates[].fraction For `'inside'`, where the layer is split, a fraction of its thickness from the side light reaches first: from the incident medium on the front, from the substrate on the back; null for a gap.
 * @property candidates[].depth How deep the place is in the side's coating, nm, from the incident medium on the front and from the substrate on the back, as the window's plot lays it out.
 * @property candidates[].gradient The slope of the optical merit against the needle's thickness, per nm.
 * @throws an option it does not take, a step below 0.05 nm, or intraSamples that are not a whole number from 2 to 60
 * @throws a side other than `'front'` or `'back'`, or one the window does not scan on the design
 * @throws a design with no merit row the scan scores, or that names a material that resolves to nothing
 * @throws a pool that is not a list of material ids, names one twice, or names one that resolves to nothing
 * @example
 * const ar = tf.stackFromFormula(tf.newDesign({ name: 'AR' }), { formula: 'H L' });
 * const design = tf.setMerit(ar, [{ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, target: 0 }]);
 * const profile = tf.needleProfile(design, { pool: ['TiO2', 'SiO2', 'MgF2'] });
 * const best = profile.candidates.reduce((a, b) => (b.gradient < a.gradient ? b : a));
 * console.log(profile.candidates.length, 'candidates; merit', profile.mf0.toFixed(5));
 * console.log('steepest:', best.material, best.kind, best.kind === 'gap' ? best.position : best.layer, best.gradient.toExponential(3));
 */
export function needleProfile(design, options) {
    const { pool, side, step = D.deltaNm, intraSamples = D.nIntra } =
        checkOptions('needleProfile', options, ['pool', 'side', 'step', 'intraSamples']);
    requireValue('needleProfile', 'step', step, v => Number.isFinite(v) && v >= L.deltaNmMin, `a needle thickness in nm of ${L.deltaNmMin} or more`);
    requireValue('needleProfile', 'intraSamples', intraSamples, v => Number.isInteger(v) && v >= L.nIntraMin && v <= L.nIntraMax,
        `a whole number from ${L.nIntraMin} to ${L.nIntraMax}`);
    const onSide = scannedSide('needleProfile', design, side);
    const { resolveMat, rows } = scanRows('needleProfile', design);
    const candidateMats = poolOf('needleProfile', design, pool);
    requireKernel();
    const scan = profileScan({ operands: rows, design, resolveMat, candidateMats, deltaNm: step, nIntra: intraSamples, side: onSide });
    if (!scan) return { mode: onSide, mf0: null, candidates: [] };
    return { mode: onSide, mf0: scan.mf0, candidates: scan.candidates.map(cand => candidateOf(cand, onSide, scan.layers, scan.zb)) };
}

/**
 * A design with one needle put in, as the [Needle Manual](/synthesis/needle/#needle-manual)
 * window's Apply puts in the candidate picked from its profile: a layer of
 * the candidate's material at its gap, or splitting its layer in two at its
 * fraction. A symmetric design's back becomes the mirror of its front. The
 * design given is left as it was.
 *
 * Without `thickness` the needle starts where the window starts it when the
 * candidate is picked: at the thickness between 1 nm, the window's Min
 * thickness, and 60 nm where golden-section search to 0.5 nm finds the
 * optical merit lowest, or at 1 nm when no thickness there beats it, and no
 * thicker than the window's slider allows. To do what the window's Apply does with Refine after insert, add an
 * MNT row at 1 nm, the window's minimum thickness, with setMerit and refine
 * with method `'sqp'` and `maxIter: 80`: the layers end on the thicknesses
 * the window's refine gives.
 *
 * @param design The design the candidate was found on.
 * @param candidate A candidate from needleProfile on this design and side.
 * @param [options]
 * @param [options.thickness] The needle's thickness, nm, from 1 to 200 at a gap and from 1 to the split layer's thickness less 1 inside one (at least 2): the window's slider range. Without it, the window's starting thickness.
 * @param [options.side] needleProfile's side.
 * @returns The design with the needle.
 * @throws an option it does not take, a side needleProfile refuses, or a thickness outside the window's range there
 * @throws a candidate with a field it does not have, a kind other than `'gap'` or `'inside'`, a position, layer or fraction the side does not have, or a material that resolves to nothing
 * @throws without a thickness, what needleProfile throws for the design's merit rows
 * @example
 * const ar = tf.stackFromFormula(tf.newDesign({ name: 'AR' }), { formula: 'H L' });
 * const design = tf.setMerit(ar, [{ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, target: 0 }]);
 * const { candidates } = tf.needleProfile(design, { pool: ['TiO2', 'SiO2', 'MgF2'] });
 * const best = candidates.reduce((a, b) => (b.gradient < a.gradient ? b : a));
 * const inserted = tf.insertNeedle(design, best);
 * console.log(design.frontLayers.length, 'layers before,', inserted.frontLayers.length, 'after');
 * console.log('optical merit', tf.merit(design).optical.toFixed(5), '->', tf.merit(inserted).optical.toFixed(5));
 */
export function insertNeedle(design, candidate, options) {
    const { thickness, side } = checkOptions('insertNeedle', options, ['thickness', 'side']);
    const onSide = scannedSide('insertNeedle', design, side);
    const layers = design[sideKey(onSide)] || [];
    const { selected, mat } = selectionOf('insertNeedle', design, layers, onSide, candidate);
    let dNew = thickness;
    if (dNew === undefined) {
        const { resolveMat, rows } = scanRows('insertNeedle', design);
        requireKernel();
        dNew = startingThickness({ operands: rows, design, resolveMat, candidate: selected, mat, dMin: D.dMin, side: onSide });
    } else {
        const [lo, hi] = resolveDRange(selected, { hostThickness: layers[selected.layerK]?.thickness || 0 }, D.dMin);
        requireValue('insertNeedle', 'thickness', thickness, v => Number.isFinite(v) && v >= lo && v <= hi, `a needle thickness in nm from ${lo} to ${hi} there`);
    }
    return insertForSelection(selected, design, dNew, onSide);
}
