import { resolveColor } from '../../../../utils/materials/catalogManager.js';
import { designMaterialLookup } from '../../../../utils/materials/designMaterials.js';

// Y-axis units, matching the Design Editor's thickness column:
//   'nm'   — physical thickness in nm                           d
//   'OT'   — optical thickness in nm                           n·d
//   'QWOT' — quarter-wave optical thickness (dimensionless)    4·n·d / λ₀
//   'FWOT' — full-wave optical thickness (dimensionless)       n·d / λ₀
// n is each layer material's index at λ₀ (Macleod, Thin-Film Optical Filters,
// 5th ed., §3.1, Quarter- and Half-Wave Optical Thicknesses).
export const THICKNESS_UNIT_IDS = ['nm', 'OT', 'QWOT', 'FWOT'];

export function buildMatColorMap(design, rows) {
    const resolveMaterial = designMaterialLookup(design);
    const map = {};
    for (const row of rows) {
        const key = row.materialId;
        if (key && !map[key]) {
            const mat = resolveMaterial(key);
            map[key] = mat ? resolveColor(mat) : '#555555';
        }
    }
    return map;
}

/**
 * One row per layer of the chosen coating, numbered 1 at the substrate, which
 * is how the Design Editor and Layer Sensitivity count them. Front stacks are
 * stored air-first, so the front is walked in reverse.
 *
 * Every layer keeps its row so the numbering matches the Design Editor even
 * when a thickness is zero. The optical units are null for a layer with no
 * material assigned, since there is no index to read.
 */
export function computeThicknessRows(design, side, lambda_nm) {
    const rawLayers = side === 'back'
        ? (design?.backLayers || [])
        : (design?.frontLayers || []);
    if (!rawLayers.length) return [];

    const resolveMaterial = designMaterialLookup(design);
    const ordered = side === 'back' ? rawLayers : [...rawLayers].reverse();
    return ordered.map((layer, index) => {
        const mat = layer.material ? resolveMaterial(layer.material) : null;
        const n = mat && lambda_nm > 0 ? mat.getNK(lambda_nm)[0] : null;
        const d = layer.thickness || 0;
        return {
            layerNumber: index + 1,
            materialId: layer.material || null,
            materialName: mat?.name || layer.material || '?',
            d,
            ot: n != null ? n * d : null,
            qwot: n != null ? (4 * n * d) / lambda_nm : null,
            fwot: n != null ? (n * d) / lambda_nm : null,
        };
    });
}

/** A row's thickness in the selected unit. */
export function rowValue(row, unit) {
    if (unit === 'OT') return row.ot;
    if (unit === 'QWOT') return row.qwot;
    if (unit === 'FWOT') return row.fwot;
    return row.d;
}
