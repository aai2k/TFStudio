/**
 * Merit-function Z over two design parameters. It reuses buildEvalContext,
 * evaluateOperands and calcMF, so it is the same MF the optimizer minimizes
 * (the "optimization landscape").
 *
 * On a design with environments (utils/environments) the MF is scored as the
 * merit tables score it (environmentDisplay.js): each environment's rows on
 * the design that environment sees, and MF² = (1/N) Σ MF_k² over the
 * environments the merit counts, the number Refinement minimizes. One
 * environment's own MF is its rows alone, whether it is on or off. A swept
 * thickness is the recipe's, which environment k deposits f_k times as thick,
 * f_k the factor of the layer's material there times the change its
 * temperature makes (environments.js environmentDeposit), as the engines read
 * a recipe thickness.
 */

import { buildEvalContext, evaluateOperands, calcMF, withFringeSampleCounts } from '../optimizer.js';
import {
    ALL_ENVIRONMENTS, environmentDesign, environmentLayerFactors, hasEnvironments,
} from '../../environments/environments.js';
import { groupRows, meanSquareMerit, meritGroups, rowsScoredIn } from '../../environments/environmentMerit.js';
import { collectLayerOverrides, overridesFrom } from './layerOverrides.js';

// In back_only mode axis tokens (thk:i) address the back stack. The thickness
// lists are copies, so the design's own stay as they are. `factors`, where
// given, is how many times as thick the stack's environment deposits each
// layer the tokens address.
function applyLayerOverridesForMerit(evalCtx, byLayer, isBackOnly, factors) {
    const frontThicks = evalCtx.frontThicks.slice();
    const backThicks  = evalCtx.backThicks  ? evalCtx.backThicks.slice()  : [];
    const thicks = isBackOnly ? backThicks : frontThicks;
    for (const key in byLayer) {
        const thk = byLayer[key].thk;
        if (thk == null) continue;
        const factor = factors?.[+key];
        thicks[+key] = factor === undefined ? thk : thk * factor;
    }
    return { frontThicks, backThicks };
}

function buildMeritEvalCtx(evalCtx, overrides, isBackOnly) {
    const { frontThicks, backThicks } = overrides;
    const ctx = { ...evalCtx, frontThicks, backThicks, backMats: evalCtx.backMats || [] };
    if (evalCtx.surfaceMode === 'symmetric') {
        ctx.backThicks = [...frontThicks].reverse();
        ctx.backMats   = [...evalCtx.frontMats].reverse();
    }
    ctx.fullThicks = evalCtx.surfaceMode === 'both_independent'
        ? [...frontThicks, ...backThicks]
        : isBackOnly ? backThicks : frontThicks;
    return ctx;
}

// The MF of one stack with the layer overrides `byLayer` applied. `optical=true`
// gives the OMF (excludes MNT/MXT/TT thickness constraints).
function meritAt({ evalCtx, operands, factors, byLayer, optical = false }) {
    const isBackOnly = evalCtx.surfaceMode === 'back_only';
    const overrides = applyLayerOverridesForMerit(evalCtx, byLayer, isBackOnly, factors);
    const ctx = buildMeritEvalCtx(evalCtx, overrides, isBackOnly);
    const computed = evaluateOperands(operands, ctx);
    return calcMF(operands, computed, optical ? { skipConstraints: true } : undefined);
}

// The MF over `stacks` with the layer overrides `byLayer` applied: the one
// stack's own, or the mean square over the environments' stacks.
const meritOver = (stacks, byLayer) => meanSquareMerit(stacks.map(stack => meritAt({ ...stack, byLayer })));

// The rows of `sampled` scored in environment `id`, as a merit group
// (environmentMerit.js meritGroups): none when no row of them is switched on.
function ownGroup(sampled, id) {
    const own = new Set(rowsScoredIn(sampled, id));
    const rows = sampled.flatMap((op, i) => (own.has(op) ? [i] : []));
    return rows.some(i => sampled[i].enabled) ? [{ id, rows, scored: true }] : [];
}

// The stacks the MF of a design with environments is scored on: for `env`
// 'all' one per environment the merit tables count in the MF, for an
// environment's id that environment alone. With no row to score there, the
// t.plotEngine key that says so.
function environmentStacks(design, resolveMat, env, sampled) {
    const groups = env === ALL_ENVIRONMENTS ? meritGroups(design, sampled) : ownGroup(sampled, env);
    if (!groups.length) return { errorKey: env === ALL_ENVIRONMENTS ? 'errNoRowsOn' : 'errNoRowsHere' };
    const swept = (design.surfaceMode || 'front_only') === 'back_only' ? design.backLayers : design.frontLayers;
    return {
        stacks: groups.filter(group => group.scored).map(group => ({
            evalCtx: buildEvalContext(environmentDesign(design, group.id, resolveMat), resolveMat),
            operands: groupRows(sampled, group.rows),
            factors: environmentLayerFactors(design, group.id, swept || [], resolveMat),
        })),
    };
}

// `{ stacks }`, the stacks every point of an MF surface or curve is scored on,
// or `{ errorKey }`, the t.plotEngine key saying why there is nothing to score:
// no merit operand enabled, or on a design with environments none scored where
// `env` reads the merit. Band operands are sampled for the design's fringes, as
// the Merit Function Editor samples them, and on that one grid at every point
// and in every environment, as a run launched from the design keeps it, so a
// point at the design's own parameters reads the editor's MF. `env` is 'all'
// or an environment's id on a design with environments, the total when not
// given.
function meritSetup(design, resolveMat, env) {
    const enabled = (design.meritOperands || []).filter(op => op && op.enabled);
    if (!enabled.length) return { errorKey: 'errNoOperands' };
    const evalCtx = buildEvalContext(design, resolveMat);
    if (!hasEnvironments(design)) return { stacks: [{ evalCtx, operands: withFringeSampleCounts(enabled, evalCtx) }] };
    return environmentStacks(design, resolveMat, env ?? ALL_ENVIRONMENTS, withFringeSampleCounts(design.meritOperands, evalCtx));
}

/**
 * Compute the MF surface over `grid` = {x, y, rowFrom, rowTo, nPoints}, in
 * `spec.env` on a design with environments: 'all' for the total over the
 * environments that are on, or one environment's id for its own MF.
 * Returns an error result (ok:false, errorKey) when there is no enabled merit
 * operand to score there.
 */
export function computeMeritSurface(spec, design, resolveMat, grid) {
    const { x, y, rowFrom, rowTo, nPoints } = grid;
    const { stacks, errorKey } = meritSetup(design, resolveMat, spec.env);
    if (!stacks) {
        return { ok: false, errorKey, x: [], y: [], z: [] };
    }
    const z = new Array(y.length);
    for (let j = rowFrom; j < rowTo; j++) {
        const row = new Array(x.length);
        for (let i = 0; i < x.length; i++) {
            row[i] = meritOver(stacks, collectLayerOverrides(spec, x[i], y[j]).byLayer);
        }
        z[j] = row;
    }
    return { ok: true, x, y, z, zKey: 'MF', nPoints };
}

/**
 * The MF along one layer thickness, `sweep` a layer token (axisVars.js), at
 * each of `values`: the points an MF surface over that thickness reads, in
 * `env` as computeMeritSurface reads `spec.env`. Returns an error result
 * (ok:false, errorKey) when there is no enabled merit operand to score there.
 */
export function computeMeritCurve(sweep, values, design, resolveMat, env) {
    const { stacks, errorKey } = meritSetup(design, resolveMat, env);
    if (!stacks) return { ok: false, errorKey, mf: [] };
    const mf = values.map(value => meritOver(stacks, overridesFrom([[sweep, value]]).byLayer));
    return { ok: true, mf };
}
