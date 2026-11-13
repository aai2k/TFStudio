/**
 * The least-squares engine's merit over a design with environments
 * (utils/environments/environments.js, environmentMerit.js).
 *
 * The engine keeps one variable vector, the layer thicknesses as the design
 * holds them. Each group, one per environment the merit scores, computes with
 * its own media, substrate, swapped materials, cone of incidence, back side
 * and temperature in an engine of its own (`stack`), built on the design that
 * environment sees and on every row with the rows of other environments
 * switched off, so its evaluation context, its cone rays and its row numbers
 * are those of a design without environments. Group k sees the thicknesses x
 * scaled by the factor f of each layer, its material's thickness factor times
 * the change its temperature makes (environmentLayerFactors), xₖ = f ⊙ x.
 *
 * MF² = (1/N) Σ MF_k², and MF_k² = Σ w·(r/σ)² / D_k, D_k the weight sum of
 * group k's merit. Group k's residuals are its own, √w·r/σ, times
 * √(D̄ / (N·D_k)), D̄ the mean of the D_k, so that Σ r² = D̄·MF²: the same sum
 * of squares as weighting each row by w/(N·D_k), times the constant D̄, which
 * leaves the least-squares step as it is. With one group the scale is 1, and
 * the residuals are those of the design that environment sees, without
 * environments. Group k's Jacobian is ∂r/∂xₖ · diag(f) times the same scale:
 * each of its columns times the factor of that layer's material. MF and OMF
 * are combined from each group's own merit, never from one sum over the rows,
 * so a group of manufacturing rows alone counts as it does in the merit table.
 */
import { environmentLayerFactors, oneEnvironmentDesign } from '../../environments/environments.js';
import { meritGroups, groupRows, meanSquareMerit } from '../../environments/environmentMerit.js';
import { evaluateOperands, calcMF, mfWeightDenominator } from './evalCore.js';
import { variableOrder } from './engineLayout.js';

export class EnvironmentGroups {
    /**
     * @param design      the design, with its environments
     * @param operands    the merit rows as given to the engine
     * @param surfaceMode the design's surface mode, which says what the variables are
     * @param makeStack   (rows, design) => an engine on that design without environments
     * @param resolveMat  the engine's (id) => material, which the temperature's constants are read from
     */
    constructor(design, operands, surfaceMode, makeStack, resolveMat) {
        const layers = variableOrder(surfaceMode, design.frontLayers || [], design.backLayers || []);
        const scored = meritGroups(design, operands).filter(group => group.scored);
        this.groups = scored.map(group => {
            const factors = environmentLayerFactors(design, group.id, layers, resolveMat);
            return {
                optical: group.optical,
                factors,
                scaled: factors.some(f => f !== 1),
                stack: makeStack(groupRows(operands, group.rows), oneEnvironmentDesign(design, group.id, resolveMat)),
            };
        });
        this.count = this.groups.length;
        /** The positions in `operands` of the rows some group scores. */
        this.rows = [...new Set(scored.flatMap(group => group.rows))];
    }

    // Group g's thicknesses at the engine's point x.
    _point(group, x) {
        return group.scaled ? x.map((d, i) => d * group.factors[i]) : x;
    }

    /** Each group's evaluation of its rows at the engine's point x. */
    evaluate(x) {
        return this.groups.map(group => evaluateOperands(group.stack.operands, group.stack._ctxFor(this._point(group, x))));
    }

    /** MF from the groups' evaluations, or with `skipConstraints` the OMF, the mean over the groups holding an optical row. */
    merit(comps, opts = {}) {
        const merits = [];
        this.groups.forEach((group, k) => {
            if (!opts.skipConstraints || group.optical) merits.push(calcMF(group.stack.operands, comps[k], opts));
        });
        return meanSquareMerit(merits);
    }

    // Each group's weight sum D_k, and their mean D̄.
    _weights(comps) {
        const each = this.groups.map((group, k) => mfWeightDenominator(group.stack.operands, comps[k]));
        let sum = 0;
        for (const weight of each) sum += weight;
        return { each, mean: this.count > 0 ? sum / this.count : 0 };
    }

    /** D̄, the weight sum of the merit residuals() score: Σ r² = D̄·MF². */
    weightSum(comps) {
        return this._weights(comps).mean;
    }

    // √(D̄ / (N·D_k)), the scale of each group's residuals; 0 for a group whose rows weigh nothing.
    _scales(comps) {
        const { each, mean } = this._weights(comps);
        return each.map(weight => (weight > 0 ? Math.sqrt(mean / (this.count * weight)) : 0));
    }

    /** The residuals at x, each group's in turn; `comps` its evaluation at x when the caller has it. */
    residuals(x, comps = this.evaluate(x)) {
        const scales = this._scales(comps);
        const out = [];
        this.groups.forEach((group, k) => {
            for (const r of group.stack._residuals(this._point(group, x), comps[k])) out.push(r * scales[k]);
        });
        return out;
    }

    /**
     * The analytic Jacobian of residuals() over the variables freeIdx, or null
     * when a group's rows have no analytic chain rule, so the engine takes
     * finite differences of residuals() instead.
     */
    jacobian(x, freeIdx, comps = this.evaluate(x)) {
        const scales = this._scales(comps);
        const J = [];
        for (let k = 0; k < this.count; k++) {
            const group = this.groups[k];
            const block = group.stack._analyticJacobian(this._point(group, x), freeIdx, comps[k]);
            if (!block) return null;
            const columns = freeIdx.map(i => scales[k] * group.factors[i]);
            for (const row of block) J.push(row.map((value, c) => value * columns[c]));
        }
        return J;
    }

    /**
     * Each group's enabled rows that pass `test`, as `{ op, factors }` with the
     * group's factor per variable: a row scored in several environments once
     * for each.
     */
    rowsWithFactors(test) {
        return this.groups.flatMap(group => group.stack.operands
            .filter(op => op.enabled && test(op)).map(op => ({ op, factors: group.factors })));
    }

    /**
     * The step span of each of `count` variables, nm (halfWaveSpan.js): the
     * shortest over the groups, each group's own span divided by the factor
     * that scales the layer there.
     */
    stepSpans(count) {
        return Array.from({ length: count }, (_, i) => Math.min(...this.groups.map(group => group.stack.stepSpans[i] / group.factors[i])));
    }
}
