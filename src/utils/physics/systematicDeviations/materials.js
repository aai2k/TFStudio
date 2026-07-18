/**
 * Material enumeration and combined (global + per-material) perturbation
 * lookups used to turn a deviation spec into concrete Δn/Δk/scale/offset
 * numbers for a given material id.
 */

import { offsetToPhysicalNm } from './deviationSpec.js';

/**
 * Enumerate unique materials referenced in the design — front + back + media.
 * Returns [{ id, source }] in stable insertion order (front first, then back,
 * then substrate/incident/exit). `source` is purely informational for the UI.
 */
export function enumerateUniqueMaterials(design) {
    if (!design) return [];
    // One entry per unique material id (deviations are keyed by material id, so a
    // single perturbation governs every place that material appears). We still
    // collect ALL roles it plays so the UI can show e.g. "Air (incident, exit)" —
    // previously only the first role was kept, which made the exit medium look
    // missing whenever it shared a material (the common Air|…|Air case).
    const order = [];
    const roles = new Map();   // id → ['incident', 'exit', …] (insertion order, deduped)
    const add = (id, role) => {
        if (!id) return;
        if (!roles.has(id)) { roles.set(id, []); order.push(id); }
        const r = roles.get(id);
        if (!r.includes(role)) r.push(role);
    };
    for (const l of (design.frontLayers || [])) add(l.material, 'front');
    for (const l of (design.backLayers  || [])) add(l.material, 'back');
    add(design.substrate?.material, 'substrate');
    add(design.incidentMedium, 'incident');
    add(design.exitMedium, 'exit');
    return order.map(id => ({ id, roles: roles.get(id), source: roles.get(id).join(', ') }));
}

// ── Effective (combined) per-material perturbation ───────────────────────────

export function effectiveForMaterial(dev, matId) {
    const pm = (dev?.perMaterial && matId && dev.perMaterial[matId]) || null;
    return {
        dn:     (dev?.globalDeltaN || 0)            + (pm?.dn || 0),
        dk:     (dev?.globalDeltaK || 0)            + (pm?.dk || 0),
        dScale: (dev?.globalThicknessScale ?? 1)    * (pm?.dScale ?? 1),
    };
}

/**
 * Combined physical thickness offset (nm) for a layer of material `matId`.
 * Global and per-material offsets are converted to physical nm (using the
 * layer material's n at λ₀ for optical units) and summed.
 *
 * @param {object} dev
 * @param {string} matId
 * @param {number} nAtRef   the layer material's n(λ₀) — only used for ot/qw/fw
 * @param {number} lamRef   reference wavelength λ₀ in nm
 */
export function effectiveOffsetNm(dev, matId, nAtRef, lamRef) {
    const pm = (dev?.perMaterial && matId && dev.perMaterial[matId]) || null;
    const g = offsetToPhysicalNm(dev?.globalThicknessOffset || 0,
                                 dev?.globalThicknessOffsetUnit || 'nm', nAtRef, lamRef);
    const m = offsetToPhysicalNm(pm?.dOffset || 0, pm?.dOffsetUnit || 'nm', nAtRef, lamRef);
    return g + m;
}
