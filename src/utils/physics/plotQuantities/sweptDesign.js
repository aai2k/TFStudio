/**
 * A design with a front layer's thickness set to a swept value, for the
 * quantities computed from a design, along a curve or over a surface: phase,
 * GD, GDD, TOD, Ψ and Δ. The thickness is written into a copy of the design.
 */

import { parseAxisVar } from './axisVars.js';

/**
 * `{ design, resolveMat }` with the front layer `sweep` ('thk:i') names at
 * thickness `value`. A token naming no layer of the design leaves it as it is,
 * as it leaves a surface. Applied to its own result it sets a second thickness.
 */
export function sweptDesign({ design, resolveMat }, sweep, value) {
    const { layer } = parseAxisVar(sweep);
    const current = (design.frontLayers || [])[layer];
    if (!current) return { design, resolveMat };
    const frontLayers = design.frontLayers.slice();
    frontLayers[layer] = { ...current, thickness: value };
    return { design: { ...design, frontLayers }, resolveMat };
}
