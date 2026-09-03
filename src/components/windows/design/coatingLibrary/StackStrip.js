import { entryDesign } from '../../../../utils/coatingLibrary/entryModel.js';
import { resolveDesignMaterial } from '../../../../utils/materials/designMaterials.js';
import { materialLabel, resolveColor } from '../../../../utils/materials/catalogManager.js';

const { createElement: h, useMemo } = React;

/**
 * Display color of every material an entry uses, resolved the way the entry
 * is evaluated (embedded definitions first) and colored the way the Design
 * Editor colors materials.
 */
export function entryMaterialColors(entry) {
    const design = entryDesign(entry);
    const colors = new Map();
    for (const id of [entry.substrate, ...entry.layers.map(layer => layer.material)]) {
        if (colors.has(id)) continue;
        const { material, status } = resolveDesignMaterial(design, id);
        colors.set(id, status === 'missing' ? null : resolveColor(material));
    }
    return colors;
}

/**
 * The stack as a strip of material-colored blocks, substrate side on the
 * left, each block's width following the square root of its thickness so a
 * thin layer next to a thick one stays visible.
 */
export function StackStrip({ entry, c, height = 6 }) {
    const colors = useMemo(() => entryMaterialColors(entry), [entry]);
    return h('div', {
        style: {
            display: 'flex', height, width: '100%', borderRadius: 2, overflow: 'hidden',
            background: c.border,
        },
    }, entry.layers.map((layer, i) => h('div', {
        key: i,
        title: `${i + 1}: ${materialLabel(layer.material)} ${layer.thickness.toFixed(1)} nm`,
        style: {
            flex: `${Math.sqrt(Math.max(layer.thickness, 1))} 0 2px`,
            background: colors.get(layer.material) || c.textDim,
            borderRight: `1px solid ${c.bg}`,
        },
    })));
}
