// A design's stack read at one wavelength, as the Refractive Index Profiler
// window lays it out (refractiveIndexProfiler/profileModel.js) and the Layer
// Thicknesses window lists it (layerThicknesses/thicknessModel.js).

import { computeProfileForSide, computeTotalRegions } from '../components/windows/analysis/refractiveIndexProfiler/profileModel.js';
import { PROFILER_LAMBDA_NM } from '../components/windows/analysis/refractiveIndexProfiler/sessionState.js';
import { computeThicknessRows } from '../components/windows/analysis/layerThicknesses/thicknessModel.js';
import { THICKNESS_LAMBDA_NM } from '../components/windows/analysis/layerThicknesses/sessionState.js';
import { designRangeCoverage } from '../utils/materials/materialRange.js';
import { editorLayerNumber } from '../utils/misc/layerNumbers.js';
import { resolveEvalMode } from '../utils/physics/optimizer.js';
import { requireResolved } from './materials.js';
import { checkOptions, requireValue, isPositive, isViewSide, refusal } from './check.js';

const storedLayers = (design, side) => (side === 'back' ? design.backLayers : design.frontLayers) || [];

/**
 * The side a stack view of `design` is read on: `side` when given, else what
 * the design is scored on (resolveEvalMode), as `spectrum` follows it.
 */
export function viewSide(call, design, side) {
    if (side === undefined) return resolveEvalMode(design);
    requireValue(call, 'side', side, isViewSide, "'front', 'back' or 'total'");
    return side;
}

// The wavelength a view is read at: the one given, else the design's
// reference wavelength, else the window's own when the design holds none.
function viewWavelength(call, design, wavelength, fallback) {
    const lambda = wavelength === undefined ? design.referenceWavelength || fallback : wavelength;
    requireValue(call, 'wavelength', lambda, isPositive, 'a wavelength in nm above 0');
    return lambda;
}

// Refuses a view of a side with no layers, or of a whole part with none.
function requireLayers(call, design, mode) {
    if (mode === 'total') {
        if (!storedLayers(design, 'front').length && !storedLayers(design, 'back').length) {
            throw refusal('noLayers', { call }, `${call}: the design has no layers; add them with insertLayer or stackFromFormula`);
        }
    } else if (!storedLayers(design, mode).length) {
        throw refusal('emptySide', { call, side: mode }, `${call}: the ${mode} has no ${call === 'indexProfile' ? 'layer thicker than 0 nm' : 'layers'}`);
    }
}

// profileModel.js leaves out a layer with no material or no thickness.
const isProfiled = layer => !!layer.material && layer.thickness > 0;

// The Design Editor numbers of the layers profileModel.js lays out on `side`,
// in its order. The back shown alone runs from its outer layer in, as light
// coming from the exit medium meets it; in the whole part it runs from the
// substrate out.
function profiledNumbers(layers, side, alone) {
    const numbered = layers.map((layer, i) => ({ layer, number: editorLayerNumber(side, layers.length, i) })).filter(({ layer }) => isProfiled(layer));
    return (side === 'back' && alone ? numbered.reverse() : numbered).map(({ number }) => number);
}

// The layers of a profile or region as indexProfile gives them.
function profiledLayers(valid, bounds, numbers, side) {
    return valid.map((layer, i) => ({
        ...(side ? { side } : {}),
        number: numbers[i], material: layer.materialId, n: layer.n, k: layer.k, thickness: layer.d, start: bounds[i], end: bounds[i + 1],
    }));
}

// The coating thickness and optical thickness the window's summary adds up.
function coatingSums(layers) {
    let thickness = 0, opticalThickness = 0;
    for (const layer of layers) {
        thickness += layer.d;
        opticalThickness += layer.n * layer.d;
    }
    return { thickness, opticalThickness };
}

function oneSideProfile(design, lambda, side) {
    const profile = computeProfileForSide(design, lambda, side);
    if (!profile) throw refusal('emptySide', { call: 'indexProfile', side }, `indexProfile: the ${side} has no layer thicker than 0 nm`);
    return {
        incident: { material: side === 'back' ? design.exitMedium : design.incidentMedium, n: profile.n0.n, k: profile.n0.k },
        substrate: { material: design.substrate?.material, n: profile.ns.n, k: profile.ns.k },
        layers: profiledLayers(profile.validLayers, profile.layerBounds, profiledNumbers(storedLayers(design, side), side, true)),
        ...coatingSums(profile.validLayers),
    };
}

function wholePartProfile(design, lambda) {
    const regions = computeTotalRegions(design, lambda);
    const coats = regions.filter(region => region.key !== 'substrate');
    // `thin`: the design has layers, but none the profile lays out.
    if (!coats.length) throw refusal('noLayers', { call: 'indexProfile', thin: true }, 'indexProfile: the design has no layer thicker than 0 nm');
    const substrate = regions.find(region => region.key === 'substrate');
    return {
        incident: null,
        substrate: substrate ? { material: design.substrate.material, n: substrate.n[0], k: substrate.k[0], thickness: substrate.totalThk } : null,
        layers: coats.flatMap(region => profiledLayers(region.validLayers, region.layerBounds,
            profiledNumbers(storedLayers(design, region.key), region.key, false), region.key)),
        ...coatingSums(coats.flatMap(region => region.validLayers)),
    };
}

/**
 * The refractive index of a design's layers at one wavelength, laid out by
 * depth, as the [Refractive Index Profile](/analysis/refractive-index-profile/)
 * window shows it. The sides follow the design's
 * [evaluation mode](/design/evaluation-modes/), as `spectrum` does, unless
 * `side` is given: on one side, the layers in the order light meets them
 * coming from that side's medium; on the whole part, the front, the
 * substrate and the back, as the window's Total view lays them. A layer with
 * no thickness is left out, as the window leaves it out. The short stretch of
 * medium and substrate the window draws at each end of a side is drawing
 * alone, and is not part of the result.
 *
 * @param design The design.
 * @param [options]
 * @param [options.wavelength] The wavelength n and k are read at, nm. Without it, the design's reference wavelength, as the window opens at it.
 * @param [options.side] `'front'`, `'back'` or `'total'`, the whole part. Without it, what the design is scored on.
 * @returns The profile.
 * @property mode What it was laid out on: `'front'`, `'back'` or `'total'`.
 * @property wavelength The wavelength, nm.
 * @property incident The medium light comes from, `{ material, n, k }`: the incident medium on the front, the exit medium on the back; null on the whole part.
 * @property substrate `{ material, n, k }`; on the whole part also `thickness`, mm, and null when the design gives the substrate no thickness, which the window then leaves out.
 * @property layers One per layer, `{ number, material, n, k, thickness, start, end }`: number as the Design Editor numbers it, 1 next to the substrate; material by id; thickness, start and end in nm, start and end the layer's depth from the side's outer surface. On one side the layers run from the outer surface in. On the whole part each layer also has `side`, the front's come first from its outer surface in, then the back's from the substrate out, with start and end from the substrate.
 * @property thickness The physical thickness of the layers listed, nm.
 * @property opticalThickness Their optical thickness, the sum of n times thickness, nm.
 * @property outOfRange The materials whose data do not reach the wavelength, each `{ id, name, rangeNm, heldFlat }`: their n and k there are held at the last value (`heldFlat` is `true`) or extrapolated.
 * @throws an option it does not take, a wavelength of 0 or less, or a side other than `'front'`, `'back'` or `'total'`
 * @throws a side with no layer thicker than 0 nm, or on the whole part a design with none
 * @throws a design that names a material that resolves to nothing
 * @example
 * const design = tf.stackFromFormula(tf.newDesign({ name: 'Mirror' }), { formula: '(HL)^3 H' });
 * const profile = tf.indexProfile(design, { wavelength: 633 });
 * for (const l of profile.layers) console.log(l.number, l.material, l.n.toFixed(4), l.start.toFixed(1), 'to', l.end.toFixed(1), 'nm');
 * console.log(profile.mode, 'side,', profile.thickness.toFixed(1), 'nm thick');
 */
export function indexProfile(design, options) {
    const { wavelength, side } = checkOptions('indexProfile', options, ['wavelength', 'side']);
    const mode = viewSide('indexProfile', design, side);
    const lambda = viewWavelength('indexProfile', design, wavelength, PROFILER_LAMBDA_NM);
    requireLayers('indexProfile', design, mode);
    requireResolved(design);
    const laid = mode === 'total' ? wholePartProfile(design, lambda) : oneSideProfile(design, lambda, mode);
    return { mode, wavelength: lambda, ...laid, outOfRange: designRangeCoverage(design, [lambda, lambda], mode).offenders };
}

/**
 * Each layer's physical and optical thickness, as the
 * [Layer Thicknesses](/analysis/layer-thicknesses/) window lists them, with
 * the optical ones taken at one wavelength. The sides follow the design's
 * [evaluation mode](/design/evaluation-modes/), as `spectrum` does, unless
 * `side` is given; on the whole part, the front's layers and then the
 * back's. Every layer has its row, one with no thickness too.
 *
 * @param design The design.
 * @param [options]
 * @param [options.wavelength] The wavelength λ0 the optical thicknesses are taken at, nm. Without it, the design's reference wavelength, as the window opens at it.
 * @param [options.side] `'front'`, `'back'` or `'total'`, both sides. Without it, what the design is scored on.
 * @returns The rows.
 * @property mode What was listed: `'front'`, `'back'` or `'total'`.
 * @property wavelength The wavelength, nm.
 * @property rows One per layer, from layer 1 next to the substrate outward, `{ number, material, thickness, opticalThickness, qwot, fwot }`: number as the Design Editor numbers it; material by id; thickness, nm; opticalThickness, n times thickness, nm; qwot, 4 n d / λ0, and fwot, n d / λ0, with n the material's index at the wavelength. The three optical values are null for a layer with no material. On the whole part each row also has `side`.
 * @property outOfRange The materials whose data do not reach the wavelength, each `{ id, name, rangeNm, heldFlat }`, as for `indexProfile`.
 * @throws an option it does not take, a wavelength of 0 or less, or a side other than `'front'`, `'back'` or `'total'`
 * @throws a side with no layers, or on the whole part a design with none
 * @throws a design that names a material that resolves to nothing
 * @example
 * const design = tf.stackFromFormula(tf.newDesign({ name: 'Mirror' }), { formula: '(HL)^3 H' });
 * for (const row of tf.layerThicknesses(design, { wavelength: 600 }).rows) {
 *     console.log(row.number, row.material, row.thickness.toFixed(2), 'nm, QWOT', row.qwot.toFixed(4));
 * }
 */
export function layerThicknesses(design, options) {
    const { wavelength, side } = checkOptions('layerThicknesses', options, ['wavelength', 'side']);
    const mode = viewSide('layerThicknesses', design, side);
    const lambda = viewWavelength('layerThicknesses', design, wavelength, THICKNESS_LAMBDA_NM);
    requireLayers('layerThicknesses', design, mode);
    requireResolved(design);
    const sides = mode === 'total' ? ['front', 'back'] : [mode];
    const rows = sides.flatMap(listed => computeThicknessRows(design, listed, lambda).map(row => ({
        ...(mode === 'total' ? { side: listed } : {}),
        number: row.layerNumber, material: row.materialId, thickness: row.d, opticalThickness: row.ot, qwot: row.qwot, fwot: row.fwot,
    })));
    return { mode, wavelength: lambda, rows, outOfRange: designRangeCoverage(design, [lambda, lambda], mode).offenders };
}
