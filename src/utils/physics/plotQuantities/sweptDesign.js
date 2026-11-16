/**
 * A design with a layer's thickness set to a swept value, for the quantities
 * computed from a design, along a curve or over a surface: phase, GD, GDD,
 * TOD, Ψ and Δ. The layer is on the swept side (axisVars.js sweptSide), and
 * the thickness is written into a copy of the design.
 */

import { parseAxisVar, sweptLayersKey } from './axisVars.js';

/**
 * `{ design, resolveMat }` with the layer `sweep` ('thk:i') names at
 * thickness `value`. A token naming no layer of the design leaves it as it is,
 * as it leaves a surface. Applied to its own result it sets a second thickness.
 */
export function sweptDesign({ design, resolveMat }, sweep, value) {
    const { layer } = parseAxisVar(sweep);
    const key = sweptLayersKey(design);
    const current = (design[key] || [])[layer];
    if (!current) return { design, resolveMat };
    const layers = design[key].slice();
    layers[layer] = { ...current, thickness: value };
    return { design: { ...design, [key]: layers }, resolveMat };
}
