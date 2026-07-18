import { isLayerVar } from './axisVars.js';
import { computeMeritSurface } from './meritSurface.js';
import { computeOpticalSurface } from './opticalSurface.js';
import { linspace, MAX_GRID_POINTS } from './surfaceSpec.js';

/**
 * Compute a Z(x, y) surface grid.
 *
 * @param {object} spec      a surface spec (see makeDefaultSurfaceSpec)
 * @param {object} design    the active design
 * @param {(id:any)=>object} resolveMat  material resolver (id → {getNK})
 * @param {{rowFrom?:number, rowTo?:number}} [opts]  fill only rows [rowFrom,rowTo)
 *          (the rest of z stays empty) — used to fan the sweep across a worker
 *          pool by Y-row chunk. Defaults to the full grid.
 * @returns {{ ok:boolean, error?:string, x:number[], y:number[], z:number[][],
 *             zLabel:string, nPoints:number }}
 *          z[j][i] = Z at (x[i], y[j]) — Plotly surface/heatmap row-major order.
 */
export function computeSurface(spec, design, resolveMat, opts = {}) {
    if (!spec || !design) return { ok: false, error: 'no spec/design', x: [], y: [], z: [] };
    const isMF = spec.z === 'MF';

    // Guard: MF axes must be design parameters (λ/AOI are integrated out in MF).
    if (isMF && (!isLayerVar(spec.xVar) || !isLayerVar(spec.yVar))) {
        return { ok: false, error: 'MF axes must be layer parameters (thickness / n / k).', x: [], y: [], z: [] };
    }

    const x = linspace(spec.xFrom, spec.xTo, spec.xSteps);
    const y = linspace(spec.yFrom, spec.yTo, spec.ySteps);
    const nPoints = x.length * y.length;
    if (nPoints > MAX_GRID_POINTS) {
        return { ok: false, error: `Grid too large (${nPoints} > ${MAX_GRID_POINTS} points). Reduce steps.`, x: [], y: [], z: [] };
    }

    const rowFrom = Math.max(0, opts.rowFrom ?? 0);
    const rowTo   = Math.min(y.length, opts.rowTo ?? y.length);
    const fullRange = rowFrom === 0 && rowTo === y.length;
    const grid = { x, y, rowFrom, rowTo, nPoints };

    return isMF
        ? computeMeritSurface(spec, design, resolveMat, grid)
        : computeOpticalSurface(spec, design, resolveMat, grid, fullRange);
}
