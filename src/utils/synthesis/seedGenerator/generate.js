/**
 * Generate canonical AR seed designs from a material pool.
 *
 * @param {Object} opts
 * @param {Array}  opts.pool      [{ id, name, mat }]
 * @param {number} opts.lambda0   reference wavelength (nm)
 * @param {Object} opts.baseDesign design to clone media from (substrate, media, surfaceMode)
 * @param {number} [opts.maxLayers] drop templates with more layers than this
 * @param {number} [opts.perRole]   how many material candidates to try per role
 *                                  (default 2) — enumerating combinations makes a
 *                                  LARGER pool only ADD options, never shift the
 *                                  single low/med/high pick to a worse trio.
 * @returns {Array<{ key, name, roleDesc, frontLayers, design }>}  candidate seeds
 */

import { classifyPoolByIndex } from './classify.js';
import { AR_TEMPLATES } from './templates.js';
import { pickRoleCandidates, cartesianAssignments } from './candidates.js';
import { buildTemplateLayers, collapseAdjacentSameMaterial, describeRoles } from './layers.js';

// A template is usable when the pool covers every role it `needs`, and it
// doesn't exceed the caller's layer budget.
function templateApplicable(tpl, roleCands, maxLayers) {
    if (tpl.needs.some(r => !roleCands[r] || !roleCands[r].length)) return false;  // pool lacks a role
    return tpl.roles.length <= maxLayers;
}

// Enumerate every seed candidate for one template: cartesian product of its
// role assignments, each turned into a layer stack, collapsed, and deduped
// against `seen` (shared across templates so identical material+thickness
// sequences reached via different templates are only emitted once).
function seedsForTemplate(tpl, roleCands, lambda0, baseDesign, seen) {
    const usedRoles = [...new Set(tpl.roles.map(([r]) => r))];
    const combos = cartesianAssignments(usedRoles, roleCands);
    const seeds = [];

    for (const assign of combos) {
        const frontLayers = buildTemplateLayers(tpl, assign, lambda0);
        if (!frontLayers) continue;

        const collapsed = collapseAdjacentSameMaterial(frontLayers);

        const sig = collapsed.map(L => `${L.material}:${L.thickness.toFixed(2)}`).join('|');
        if (seen.has(sig)) continue;
        seen.add(sig);

        const roleDesc = describeRoles(tpl, assign);
        seeds.push({
            key: tpl.key,
            name: `${collapsed.length}L · ${roleDesc}`,   // structure + actual materials
            roleDesc,
            frontLayers: collapsed,
            // Canonical AR seeds are front-stack designs; start the back stack
            // empty. Media (substrate, incident/exit, surfaceMode) from baseDesign.
            design: { ...baseDesign, frontLayers: collapsed, backLayers: [] },
        });
    }
    return seeds;
}

export function generateARSeeds({ pool, lambda0 = 550, baseDesign = {}, maxLayers = Infinity, perRole = 2 }) {
    const roles = classifyPoolByIndex(pool, lambda0);
    const byN = roles.byN;
    if (!byN.length) return [];

    const roleCands = pickRoleCandidates(byN, perRole);
    const seen = new Set();   // dedupe identical material+thickness sequences across templates
    const seeds = [];

    for (const tpl of AR_TEMPLATES) {
        if (!templateApplicable(tpl, roleCands, maxLayers)) continue;
        seeds.push(...seedsForTemplate(tpl, roleCands, lambda0, baseDesign, seen));
    }
    return seeds;
}
