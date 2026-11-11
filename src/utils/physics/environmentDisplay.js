/**
 * The merit table of a design with environments (utils/environments/
 * environments.js and environmentMerit.js): the rows of each environment
 * evaluated on the design that environment sees, each row shown with its
 * value in its own environment, or for a row of every environment in the
 * first environment it is scored in, and MF² = (1/N) Σ MF_k².
 */
import { designMaterialLookup, UnresolvedDesignMaterialError } from '../materials/designMaterials.js';
import { buildEvalContext, evaluateOperands, withRowNotes } from './optimizer.js';
import { environmentDesign } from '../environments/environments.js';
import { meritGroups, groupRows, meanSquareMerit } from '../environments/environmentMerit.js';

// `displayOf` of the group's rows on the design its environment sees, or a
// group with no value and no merit when a material it names resolves to
// nothing here.
function groupDisplay(design, operands, group, displayOf, resolve) {
    const rows = groupRows(operands, group.rows);
    let computed;
    try {
        computed = evaluateOperands(rows, buildEvalContext(environmentDesign(design, group.id), resolve));
    } catch (err) {
        if (!(err instanceof UnresolvedDesignMaterialError)) throw err;
        const none = new Array(operands.length).fill(null);
        return { computed: none, errors: none, bandLevels: none, mf: null, omf: null };
    }
    return displayOf(rows, computed);
}

// Each row's value and band level in the first group it is scored in, and the
// first reason any of its groups gives for it having no value.
function shownRows(count, groups) {
    const values = new Array(count).fill(null);
    const errors = new Array(count).fill(null);
    const bandLevels = new Array(count).fill(null);
    const seen = new Set();
    for (const group of groups) {
        for (const i of group.rows) {
            errors[i] ??= group.errors[i] ?? null;
            if (seen.has(i)) continue;
            seen.add(i);
            values[i] = group.computed[i];
            bandLevels[i] = group.bandLevels[i] ?? null;
        }
    }
    return { values, errors, bandLevels };
}

/**
 * What meritDisplay gives, for a design with environments: `computed`,
 * `errors` and `bandLevels` row by row, the MF and OMF over the environments,
 * null when one environment's is, and `environments`, one entry per
 * environment the rows are scored in: `{ id, rows, scored, optical, computed,
 * errors, mf, omf }`, `rows` the positions of its rows, `scored` and
 * `optical` whether it counts in the MF and in the OMF, and its own values
 * and merits. `displayOf(rows, computed)` is the display of one evaluation.
 */
export function environmentsDisplay(design, operands, displayOf) {
    const resolve = designMaterialLookup(design);
    const groups = meritGroups(design, operands).map(group => ({
        ...group, ...groupDisplay(design, operands, group, displayOf, resolve),
    }));
    const { values, errors, bandLevels } = shownRows(operands.length, groups);
    const failed = key => groups.some(group => group[key] == null);
    return {
        computed: withRowNotes(values, errors, bandLevels), errors, bandLevels,
        mf: failed('mf') ? null : meanSquareMerit(groups.filter(group => group.scored).map(group => group.mf)),
        omf: failed('omf') ? null : meanSquareMerit(groups.filter(group => group.optical).map(group => group.omf)),
        environments: groups.map(({ id, rows, scored, optical, computed, mf, omf, ...group }) => ({
            id, rows, scored, optical, computed: Array.from(computed), errors: group.errors, mf, omf,
        })),
    };
}
