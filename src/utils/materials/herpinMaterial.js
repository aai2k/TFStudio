/**
 * The material of a Herpin equivalent layer: a constant index E with no
 * absorption, at the reference wavelength the group was collapsed at. It exists
 * only in the design that holds the layer, under an id that starts with
 * `herpin-`.
 */
export function herpinMaterialRecord(id, equivalentIndex, referenceWavelength) {
    return {
        id,
        name: `Herpin E=${equivalentIndex.toFixed(6)} @ ${referenceWavelength} nm`,
        color: '#8b5cf6', group: 'Herpin', formulaNum: -1,
        coefficients: [], kTable: [],
        tabData: [[1, equivalentIndex, 0], [10000000, equivalentIndex, 0]],
    };
}

/** True for the material of a Herpin equivalent layer. */
export function isHerpinMaterial(id, material) {
    return material?.group === 'Herpin' || String(id).startsWith('herpin-');
}
