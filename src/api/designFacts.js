// What a design's stack adds up to: its total and optical thickness, its
// layers of each material, and each layer's quarter-wave optical thickness
// (QWOT) as the Design Editor shows and takes it (designEditor/units.js).

import { nmToUnit, unitToNm, resolveMaterial } from '../components/windows/design/designEditor/units.js';
import { resolveDesignMaterial, withHerpinRecords } from '../utils/materials/designMaterials.js';
import { effectiveBackLayers } from '../utils/physics/optimizer.js';
import { coatedSide } from '../utils/synthesis/qualifiers.js';
import { checkOptions, requireValue, isPositive, isViewSide, refusal } from './check.js';

// The Design Editor's reference wavelength, nm: the design's own, or 550 nm
// for a design that holds none.
const referenceOf = design => design.referenceWavelength || 550;

// The side the TT merit row sums (coatedSide) by the API's names for a side.
const COATED_MODE = { front: 'front', back: 'back', both: 'total' };

// n of material `id` at `wavelength` as the Design Editor reads it, from the
// catalogs and the design's own `materials`; null for an id that resolves to
// nothing.
function editorIndex(materials, id, wavelength) {
    const material = resolveMaterial(id, materials);
    return material ? material.getNK(wavelength)[0] : null;
}

// The QWOT of `layer`, 4 n d / λ0 at `wavelength`, as the Design Editor's QW
// column shows it (nmToUnit); null for a layer whose material resolves to
// nothing or has n of 0 or less there, which has no quarter wave.
function layerQwot(materials, layer, wavelength) {
    if (!(editorIndex(materials, layer.material, wavelength) > 0)) return null;
    return nmToUnit(layer.thickness, layer.material, wavelength, 'QWOT', materials);
}

/**
 * The physical thickness, nm, a layer of material `id` in `design` gets for
 * a QWOT of `qwot`, as typing it in the Design Editor's QW column converts it
 * (unitToNm); refused for a material with no quarter wave. The editor reads
 * the design with the Herpin layers' materials it rebuilds (withHerpinRecords).
 */
export function qwotThickness(call, design, id, qwot) {
    requireValue(call, 'qwot', qwot, isPositive, 'a quarter-wave optical thickness above 0');
    const { materials } = withHerpinRecords(design);
    const wavelength = referenceOf(design);
    const n = editorIndex(materials, id, wavelength);
    if (!(n > 0)) {
        const why = n === null ? 'resolves to nothing' : `has n = ${n} at ${wavelength} nm`;
        throw refusal('noQwot', { call, material: id, wavelength, n }, `${call}: the layer's material '${id}' ${why}, so it has no quarter wave; give its thickness in nm`);
    }
    return unitToNm(qwot, id, wavelength, 'QWOT', materials);
}

/**
 * What a design's stack adds up to: its total physical and optical
 * thickness, its layers of each material, and each layer's quarter-wave
 * optical thickness (QWOT) as the [Design Editor](/design/design-editor/)
 * shows it. Without `side`, the sides a TT merit row sums: the front of a
 * design coated on the front or symmetric, the back of one coated on the
 * back, both of one coated on both. So a symmetric design counts its front
 * once, and a back a design coated on the front holds but does not coat
 * counts not at all. `'total'` counts the front and the back the design
 * holds, a symmetric design's back as the mirror of its front, so both count.
 *
 * @param design The design.
 * @param [options]
 * @param [options.side] `'front'`, `'back'` or `'total'`, both sides. Without it, the coated sides.
 * @returns The facts.
 * @property mode The sides counted: `'front'`, `'back'` or `'total'`.
 * @property wavelength The reference wavelength the optical thickness and the QWOT are taken at, nm; 550 for a design that holds none, as the Design Editor reads it.
 * @property thickness The physical thickness of the layers counted, nm, as the TT merit row reads it.
 * @property opticalThickness Their optical thickness, the sum of n times thickness, nm; null when a material of a layer counted resolves to nothing.
 * @property layerCounts How many layers of each material, by material id.
 * @property qwot `{ front, back }`, the QWOT of each layer counted, 4 n d / λ0, by its number on its side: `qwot.front[0]` is front layer 1, next to the substrate. A side not counted is an empty list. A layer whose material resolves to nothing, or has n of 0 or less, has no quarter wave and reads null.
 * @throws an option it does not take, or a side other than `'front'`, `'back'` or `'total'`
 * @example
 * const design = tf.stackFromFormula(tf.newDesign({ name: 'Mirror' }), { formula: '(HL)^3 H' });
 * const facts = tf.designFacts(design);
 * console.log(facts.mode, facts.thickness.toFixed(1), 'nm,', facts.opticalThickness.toFixed(1), 'nm optical');
 * console.log(facts.layerCounts, 'layer 1 is', facts.qwot.front[0].toFixed(4), 'QW');
 */
export function designFacts(design, options) {
    const { side } = checkOptions('designFacts', options, ['side']);
    if (side !== undefined) requireValue('designFacts', 'side', side, isViewSide, "'front', 'back' or 'total'");
    const mode = side ?? COATED_MODE[coatedSide(design)];
    // As stored, the front from its outer layer in and the back from the
    // substrate out, which is the order the TT row adds them in.
    const front = mode === 'back' ? [] : design.frontLayers || [];
    const back = mode === 'front' ? [] : effectiveBackLayers(design);
    const counted = [...front, ...back];
    const wavelength = referenceOf(design);
    const resolved = counted.map(layer => resolveDesignMaterial(design, layer.material));
    const layerCounts = {};
    let thickness = 0, opticalThickness = 0;
    counted.forEach((layer, i) => {
        const d = layer.thickness || 0;
        thickness += d;
        if (resolved[i].status !== 'missing') opticalThickness += resolved[i].material.getNK(wavelength)[0] * d;
        layerCounts[layer.material] = (layerCounts[layer.material] ?? 0) + 1;
    });
    const unresolved = resolved.some(({ status }) => status === 'missing');
    // The QWOT as the Design Editor shows it, which reads the design with the
    // Herpin layers' materials it rebuilds.
    const { materials } = withHerpinRecords(design);
    const qwotOf = layer => layerQwot(materials, layer, wavelength);
    const qwot = { front: [...front].reverse().map(qwotOf), back: back.map(qwotOf) };
    return { mode, wavelength, thickness, opticalThickness: unresolved ? null : opticalThickness, layerCounts, qwot };
}
