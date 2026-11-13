import {
    ALL_ENVIRONMENTS, BASE_ENVIRONMENT, environmentDesign, environmentLayerFactors, hasEnvironments,
} from '../../environments/environments.js';
import { isLayerVar, parseAxisVar } from './axisVars.js';
import { computeMeritSurface } from './meritSurface.js';
import { computeOpticalSurface } from './opticalSurface.js';
import { computePointSurface } from './pointSurface.js';
import { quantityFamily } from './quantities.js';
import { linspace } from './surfaceSpec.js';

/**
 * The design and the grid a surface of a quantity other than MF computes on,
 * in environment `spec.env` of a design with environments (utils/environments):
 * the design that environment sees, and each layer axis at the thickness that
 * environment deposits the recipe's layer at, f times the axis value, f the
 * factor of the layer's material there times the change its temperature makes
 * (environments.js environmentDeposit). Environment 1, and a design without
 * environments, compute `design` on `grid` as they are.
 */
function environmentGrid(spec, design, resolveMat, grid) {
    const env = spec.env;
    if (!hasEnvironments(design) || env == null || env === BASE_ENVIRONMENT || env === ALL_ENVIRONMENTS) return { design, grid };
    const factors = environmentLayerFactors(design, env, design.frontLayers || [], resolveMat);
    const deposited = (token, values) => {
        const { kind, layer } = parseAxisVar(token);
        const factor = kind === 'thk' ? factors[layer] : undefined;
        return factor === undefined || factor === 1 ? values : values.map(value => value * factor);
    };
    return {
        design: environmentDesign(design, env, resolveMat),
        grid: { ...grid, x: deposited(spec.xVar, grid.x), y: deposited(spec.yVar, grid.y) },
    };
}

/**
 * Compute a Z(x, y) surface grid.
 *
 * @param {object} spec      a surface spec (see makeDefaultSurfaceSpec); on a
 *          design with environments `spec.env` names the environment it is
 *          computed in. For MF, 'all' or no env gives the total over the
 *          environments that are on (meritSurface.js); for any other quantity
 *          no env gives environment 1.
 * @param {object} design    the active design
 * @param {(id:any)=>object} resolveMat  material resolver (id → {getNK})
 * @param {{rowFrom?:number, rowTo?:number}} [opts]  fill only rows [rowFrom,rowTo)
 *          (the rest of z stays empty), used to fan the sweep across a worker
 *          pool by Y-row chunk. Defaults to the full grid.
 * @returns {{ ok:boolean, errorKey?:string, x:number[],
 *             y:number[], z:number[][], zKey:string, nPoints:number }}
 *          z[j][i] = Z at (x[i], y[j]) in row-major order, x and y the axis
 *          values as set. `errorKey` and `zKey` are resolved to display text by
 *          the window that draws them.
 */
export function computeSurface(spec, design, resolveMat, opts = {}) {
    if (!spec || !design) return { ok: false, errorKey: 'noDesign', x: [], y: [], z: [] };
    const isMF = spec.z === 'MF';

    // Guard: MF axes must be design parameters (λ/AOI are integrated out in MF).
    if (isMF && (!isLayerVar(spec.xVar) || !isLayerVar(spec.yVar))) {
        return { ok: false, errorKey: 'errMfAxes', x: [], y: [], z: [] };
    }

    const x = linspace(spec.xFrom, spec.xTo, spec.xSteps);
    const y = linspace(spec.yFrom, spec.yTo, spec.ySteps);
    const nPoints = x.length * y.length;

    const rowFrom = Math.max(0, opts.rowFrom ?? 0);
    const rowTo   = Math.min(y.length, opts.rowTo ?? y.length);
    const fullRange = rowFrom === 0 && rowTo === y.length;
    const grid = { x, y, rowFrom, rowTo, nPoints };

    if (isMF) return computeMeritSurface(spec, design, resolveMat, grid);
    const seen = environmentGrid(spec, design, resolveMat, grid);
    const result = quantityFamily(spec.z) === 'optical'
        ? computeOpticalSurface(spec, seen.design, resolveMat, seen.grid, fullRange)
        : computePointSurface(spec, seen.design, resolveMat, seen.grid);
    return seen.grid === grid ? result : { ...result, x, y };
}
