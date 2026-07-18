/**
 * Layer-stack construction for one AR_TEMPLATES entry + material assignment.
 */

import { qwThickness } from './thickness.js';
import { seedLayerId } from './templates.js';

// Build the front-layer stack for one template + material assignment.
// Returns null if any role lacks a valid (n>0) assigned material.
export function buildTemplateLayers(tpl, assign, lambda0) {
    const frontLayers = [];
    for (const [role, qw] of tpl.roles) {
        const m = assign[role];
        if (!m) return null;
        const thickness = qwThickness(m.n, lambda0, qw);
        if (!(thickness > 0)) return null;
        frontLayers.push({ id: seedLayerId(), material: m.id, thickness, locked: false });
    }
    return frontLayers;
}

// Collapse adjacent same-material entries (e.g. a role repeat or a combo that
// assigned the same material to two roles) → no mergeable neighbours.
export function collapseAdjacentSameMaterial(frontLayers) {
    const collapsed = [];
    for (const L of frontLayers) {
        const prev = collapsed[collapsed.length - 1];
        if (prev && prev.material === L.material) prev.thickness += L.thickness;
        else collapsed.push({ ...L });
    }
    return collapsed;
}

// Human-readable role/material/QW-or-HW description, e.g. "MgF2¼ TiO2½ Al2O3¼".
export function describeRoles(tpl, assign) {
    return tpl.roles.map(([r, qw]) => `${assign[r]?.name}${qw === 2 ? '½' : '¼'}`).join(' ');
}
