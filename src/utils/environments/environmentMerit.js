/**
 * How the merit function scores a design with environments (environments.js).
 *
 * The rows are scored in groups, one per environment that is switched on and
 * has a row to evaluate there. Group k computes with the design environment k
 * sees (environmentDesign) and holds the rows scored in it: the rows of every
 * environment and its own. Its merit MF_k is the merit of a design without
 * environments over those rows, and
 *
 *     MF² = (1/N) Σ MF_k²,
 *
 * N counting the groups that hold a row the merit scores, the form OptiLayer
 * documents for a merit over several conditions. The optical merit is the same
 * mean over the groups that hold an optical row. A design without
 * environments is never grouped; its merit is the one function it always was.
 * Nor is the merit of a design that counts environment 1 alone, every other
 * environment being off or holding no row it counts (environmentOneAlone):
 * the engines score it as that design without environments.
 */
import { isBlank, isConstant, isDmfs, isManufacturability, isMath, isPPEF } from '../physics/optimizer/operandModel.js';
import { BASE_ENVIRONMENT, environmentsOf, isEnvironmentOn, oneEnvironmentDesign } from './environments.js';

const readsOf = op => [op.refId, op.refId1, op.refId2].filter(id => id != null);

// Rows that read other rows: a math row, and a PPEF row, which reads its
// curve block.
const readsRows = type => isMath(type) || isPPEF(type);

// The rows `id` names in `operands`: the row of that id, or the point rows a
// run expanded the curve block of that id into (measuredCurveOperand.js).
function rowsNamed(operands) {
    const byId = new Map(operands.map(op => [op.id, op]));
    const points = new Map();
    for (const op of operands) {
        const block = op.measuredCurveBlockId;
        if (block == null) continue;
        if (!points.has(block)) points.set(block, []);
        points.get(block).push(op);
    }
    return id => (byId.has(id) ? [byId.get(id)] : points.get(id) || []);
}

// The environment each row is scored in, by id, or null for every
// environment. A math or PPEF row without an `env` of its own is scored where
// the rows it reads are: in the one environment they name between them, if
// they name one. Such a row reading rows of two environments is left to every
// environment, where the row it cannot find gives it no value and the merit
// says why.
function rowEnvironments(operands) {
    const rowsOf = rowsNamed(operands);
    const found = new Map();
    const reading = new Set();
    const envOf = (op) => {
        if (op.env != null) return op.env;
        if (!readsRows(op.type) || reading.has(op)) return null;
        if (found.has(op)) return found.get(op);
        reading.add(op);
        const named = new Set(readsOf(op).flatMap(rowsOf).map(envOf).filter(env => env != null));
        reading.delete(op);
        const env = named.size === 1 ? [...named][0] : null;
        found.set(op, env);
        return env;
    };
    return operands.map(envOf);
}

// Whether a row whose environment is `env` (rowEnvironments) is scored in environment `id`.
const scoredIn = (env, id) => env == null || env === id;

/**
 * The rows of `operands` scored in environment `id`, in their order: the rows
 * of every environment and its own, a math row being scored where the rows it
 * reads are.
 */
export function rowsScoredIn(operands, id) {
    const envOf = rowEnvironments(operands);
    return operands.filter((op, i) => scoredIn(envOf[i], id));
}

// A row with a value: switched on and not a comment (BLNK, or the DMFS marker).
const evaluated = op => !!op.enabled && !isBlank(op.type) && !isDmfs(op.type);

// A row the merit adds to its sum: one with a value, other than a constant, of
// a weight above 0.
const scores = op => evaluated(op) && !isConstant(op.type) && op.weight > 0;

/**
 * The groups `operands` (merit rows, as the design holds them or as a run
 * samples them) are scored in on `design`, in the order of its environments:
 * `{ id, rows, scored, optical }`, `rows` the positions in `operands` of the
 * rows scored in environment `id`, `scored` whether one of them counts in the
 * merit and `optical` whether one of those is an optical row. An environment
 * switched off, or with no row but comments, has no group.
 */
export function meritGroups(design, operands) {
    const envOf = rowEnvironments(operands);
    return environmentsOf(design).filter(isEnvironmentOn).map(env => {
        const rows = operands.flatMap((op, i) => (scoredIn(envOf[i], env.id) ? [i] : []));
        const counted = rows.map(i => operands[i]).filter(scores);
        return {
            id: env.id, rows,
            scored: counted.length > 0,
            optical: counted.some(op => !isManufacturability(op.type)),
        };
    }).filter(group => group.rows.some(i => evaluated(operands[i])));
}

/**
 * `operands` with every row outside `rows` (positions) switched off, so an
 * evaluation of the list scores the group's rows and leaves the others
 * without a value, and a row keeps its position and its number.
 */
export function groupRows(operands, rows) {
    const inGroup = new Set(rows);
    return operands.map((op, i) => (inGroup.has(i) || !op.enabled ? op : { ...op, enabled: false }));
}

/**
 * The design and rows a merit that counts environment 1 alone is scored on:
 * environment 1 as a design without environments, and the rows scored there.
 * Null when the merit counts another environment, or none: such a merit is
 * scored over its groups.
 */
export function environmentOneAlone(design, operands) {
    const counted = meritGroups(design, operands).filter(group => group.scored);
    if (counted.length !== 1 || counted[0].id !== BASE_ENVIRONMENT) return null;
    return { design: oneEnvironmentDesign(design), operands: counted[0].rows.map(i => operands[i]) };
}

/**
 * √((1/N) Σ MF_k²) over the N merits given: null when one of them is null, 0
 * when none is given, as the merit of a design with no row to score is 0, and
 * the merit itself when one is given.
 */
export function meanSquareMerit(merits) {
    if (merits.some(mf => mf == null)) return null;
    if (merits.length === 0) return 0;
    if (merits.length === 1) return merits[0];
    let sum = 0;
    for (const mf of merits) sum += mf * mf;
    return Math.sqrt(sum / merits.length);
}
