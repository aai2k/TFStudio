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
export function applyParamValue(dev, param, v) {
    if (param === 'globalDeltaN') {
        dev.globalDeltaN = v;
    } else if (param === 'globalDeltaK') {
        dev.globalDeltaK = v;
    } else if (param === 'globalThicknessScale') {
        dev.globalThicknessScale = v;
    } else if (param === 'globalThicknessOffset') {
        dev.globalThicknessOffset = v;
    } else if (param && param.startsWith('mat:')) {
        const parts = param.split(':');
        if (parts.length === 3) {
            const id = parts[1], field = parts[2];
            dev.perMaterial = dev.perMaterial || {};
            dev.perMaterial[id] = dev.perMaterial[id] || { dn: 0, dk: 0, dScale: 1, dOffset: 0, dOffsetUnit: 'nm' };
            if (field === 'dn' || field === 'dk' || field === 'dScale' || field === 'dOffset') {
                dev.perMaterial[id][field] = v;
            }
        }
    }
    return dev;
}

/**
 * Human label for a sweep parameter (for UI / hover text).
 */
export function paramLabel(param) {
    let result;
    if (param === 'globalDeltaN') {
        result = 'Global Δn';
    } else if (param === 'globalDeltaK') {
        result = 'Global Δk';
    } else if (param === 'globalThicknessScale') {
        result = 'Global thickness scale';
    } else if (param === 'globalThicknessOffset') {
        result = 'Global thickness offset';
    } else if (param && param.startsWith('mat:')) {
        const [, id, field] = param.split(':');
        const f = field === 'dn' ? 'Δn' : field === 'dk' ? 'Δk'
                : field === 'dOffset' ? 'd-offset' : 'd-scale';
        result = `${id} ${f}`;
    } else {
        result = param || '';
    }
    return result;
}
