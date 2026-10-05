import { DEFAULT_SYMBOL_MAP } from '../../../../utils/synthesis/stackFormula.js';
import { resolveMaterial, unitToNm } from './units.js';

// The high and low materials a stack starts from: the Stack Formula's H and L.
const HIGH = DEFAULT_SYMBOL_MAP.H;
const LOW = DEFAULT_SYMBOL_MAP.L;

const indexAt = (material, refLambda, designMaterials) =>
    resolveMaterial(material, designMaterials)?.getNK(refLambda)[0];

function quarterWave(material, refLambda, designMaterials) {
    const thickness = unitToNm(1, material, refLambda, 'QWOT', designMaterials);
    return { material, thickness, locked: false };
}

/**
 * The layer to add at row `index` of `displayedLayers`, a side's layers in
 * table order (substrate first, the order they are deposited), chosen so the
 * stack carries on rather than gaining a placeholder.
 *
 * It follows the rows on the side it is added from: `follows: 'above'` for a
 * layer added below a row, 'below' for one added above a row. It is a copy of
 * the layer two rows away on that side, so H L H L goes on as H L H L H, and
 * inserting again and again at the new row keeps alternating. At an end of the
 * table, with no row on that side, it follows the other side. With no such
 * layer, or one of the same material as the new layer's neighbour, it is a
 * quarter wave at λ₀ of L next to anything of higher index than L, and of H
 * otherwise. An empty side starts with an L quarter wave. Where L has no index
 * at λ₀ (the SiO2 formula has none near 9 µm) it is H.
 *
 * The result has no id and is unlocked.
 */
export function followingLayer(displayedLayers, index, { refLambda, designMaterials, follows = 'above' }) {
    const fromAbove = follows === 'below' ? index === displayedLayers.length : index > 0;
    const neighbour = displayedLayers[fromAbove ? index - 1 : index];
    const pattern = displayedLayers[fromAbove ? index - 2 : index + 1];
    if (neighbour && pattern && pattern.material !== neighbour.material) {
        const { id, ...copy } = pattern;
        return { ...copy, locked: false };
    }
    const nLow = indexAt(LOW, refLambda, designMaterials);
    const low = neighbour ? indexAt(neighbour.material, refLambda, designMaterials) > nLow : nLow > 0;
    return quarterWave(low ? LOW : HIGH, refLambda, designMaterials);
}
