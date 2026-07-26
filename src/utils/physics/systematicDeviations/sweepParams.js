/**
 * Sweep parameter encoding:
 *   - 'globalDeltaN' | 'globalDeltaK' | 'globalThicknessScale' | 'globalThicknessOffset'
 *   - 'mat:<materialId>:dn'
 *   - 'mat:<materialId>:dk'
 *   - 'mat:<materialId>:dScale'
 *   - 'mat:<materialId>:dOffset'
 *
 * For the *Offset params the swept value is in the deviation's current offset
 * unit (globalThicknessOffsetUnit / perMaterial[id].dOffsetUnit) — the sweep
 * varies the magnitude, the unit is fixed by the setup.
 */

// The per-material fields a sweep can vary, with their display labels.
const MATERIAL_FIELDS = { dn: 'Δn', dk: 'Δk', dScale: 'd-scale', dOffset: 'd-offset' };

const GLOBAL_LABELS = {
    globalDeltaN:          'Global Δn',
    globalDeltaK:          'Global Δk',
    globalThicknessScale:  'Global thickness scale',
    globalThicknessOffset: 'Global thickness offset',
};

/**
 * Split `mat:<materialId>:<field>` into its parts, or null if `param` is not a
 * per-material parameter. Material ids are source-qualified and contain a colon
 * of their own (`builtin:SiO2`), so the field is the last segment and the id is
 * everything before it.
 */
export function parseMaterialParam(param) {
    if (typeof param !== 'string' || !param.startsWith('mat:')) return null;
    const rest = param.slice('mat:'.length);
    const cut = rest.lastIndexOf(':');
    if (cut <= 0) return null;
    const field = rest.slice(cut + 1);
    if (!Object.hasOwn(MATERIAL_FIELDS, field)) return null;
    return { id: rest.slice(0, cut), field };
}

export function applyParamValue(dev, param, v) {
    if (param === 'globalDeltaN') {
        dev.globalDeltaN = v;
    } else if (param === 'globalDeltaK') {
        dev.globalDeltaK = v;
    } else if (param === 'globalThicknessScale') {
        dev.globalThicknessScale = v;
    } else if (param === 'globalThicknessOffset') {
        dev.globalThicknessOffset = v;
    } else {
        const mat = parseMaterialParam(param);
        if (mat) {
            dev.perMaterial = dev.perMaterial || {};
            dev.perMaterial[mat.id] = dev.perMaterial[mat.id]
                || { dn: 0, dk: 0, dScale: 1, dOffset: 0, dOffsetUnit: 'nm' };
            dev.perMaterial[mat.id][mat.field] = v;
        }
    }
    return dev;
}

/**
 * Human label for a sweep parameter (for UI / hover text).
 */
export function paramLabel(param) {
    if (GLOBAL_LABELS[param]) return GLOBAL_LABELS[param];
    const mat = parseMaterialParam(param);
    return mat ? `${mat.id} ${MATERIAL_FIELDS[mat.field]}` : (param || '');
}
