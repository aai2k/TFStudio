/**
 * Run blocks for the synthesis windows (Needle Automatic, Gradual Evolution,
 * Structural Search).
 *
 * A synthesis window is used in a loop with the rest of the program: synthesize,
 * refine, clean, edit a layer by hand, come back. Its history has to survive that
 * loop and stay readable, which one flat list of generations and one baseline
 * taken at the first Run cannot do. The old behaviour left an earlier run's rows
 * on screen next to a design they no longer described, and made Reset restore the
 * state from before the *first* run while wiping every run's rows.
 *
 * A block is one press of Run. It holds the design as it stood when that press
 * happened, and the generations that press produced:
 *
 *     runs: [{ runNum, baseline: { frontLayers, backLayers }, openedAt }]
 *     gens: flat, newest last, each tagged with the runNum that produced it
 *
 * Generations stay one flat array so everything reading them (Pareto set, best
 * merit, per-side filters) is unchanged; the block is a tag and a baseline, not
 * a different container.
 *
 * A block stays open across Stop then Run, so pausing to look at something and
 * carrying on is still one run. It closes when the engine stops on its own, or
 * when the design is edited outside the window, because at that point the next
 * Run starts from something else and belongs to its own block.
 */

/**
 * Line colours for the per-run trend series, cycled by block. Kept here so the
 * three synthesis windows draw the same run in the same colour.
 */
export const RUN_COLORS = Object.freeze(['#42a5f5', '#66bb6a', '#ab47bc', '#ffa726', '#26c6da']);

/** The block a new generation belongs to, or 0 when no run has been opened. */
export const activeRunNum = (runs) => (runs.length ? runs[runs.length - 1].runNum : 0);

/** The design a Reset would restore, or null when there is nothing to undo. */
export const activeBaseline = (runs) => (runs.length ? runs[runs.length - 1].baseline : null);

/** Open a block for a Run press. `baseline` is the design as it stands now. */
export function openRunBlock(runs, baseline) {
    return [...runs, {
        runNum: activeRunNum(runs) + 1,
        baseline: {
            frontLayers: JSON.parse(JSON.stringify(baseline?.frontLayers || [])),
            backLayers:  JSON.parse(JSON.stringify(baseline?.backLayers  || [])),
        },
        openedAt: Date.now(),
    }];
}

/**
 * Undo the newest block: drop its generations and hand back the design it
 * started from. The blocks before it, and their rows, are left alone, so a
 * second Reset undoes the run before this one.
 *
 * Returns null when there is no block to undo.
 */
export function undoRunBlock(runs, gens) {
    if (!runs.length) return null;
    const dropped = runs[runs.length - 1];
    return {
        runs: runs.slice(0, -1),
        gens: gens.filter(g => g.runNum !== dropped.runNum),
        baseline: dropped.baseline,
        runNum: dropped.runNum,
    };
}

/**
 * Row ids that open a block **in the order given**, so the history table can
 * draw a separator above them. Pass the rows in the order they are rendered.
 * Generations from before run blocks existed carry no runNum; they read as one
 * block and get no separator.
 */
export function runSeparatorIds(rows) {
    const ids = new Set();
    let seen = null;
    for (const row of rows) {
        if (row.runNum == null) { seen = null; continue; }
        if (row.runNum !== seen) ids.add(row.id);
        seen = row.runNum;
    }
    return ids;
}

/**
 * Split rows into their blocks, oldest first, for a chart that plots one line per
 * Run press. Generations are numbered within their run, so plotting every row on
 * one line against its generation number would fold the runs on top of each
 * other; one line per block keeps each run's curve its own.
 *
 * Rows recorded before run blocks existed carry no runNum and come back as a
 * single unlabelled group.
 */
export function groupRowsByRun(rows) {
    const groups = [];
    for (const row of rows) {
        const key = row.runNum ?? null;
        const last = groups[groups.length - 1];
        if (last && last.runNum === key) last.rows.push(row);
        else groups.push({ runNum: key, rows: [row] });
    }
    return groups;
}

/** Summary of one block for its separator row: rows, layers and merit reached. */
export function runBlockSummary(runs, gens, runNum) {
    const rows = gens.filter(g => g.runNum === runNum);
    const run  = runs.find(r => r.runNum === runNum);
    return {
        runNum,
        count: rows.length,
        bestMF: rows.length ? Math.min(...rows.map(g => g.mf)) : null,
        startLayers: (run?.baseline?.frontLayers?.length || 0) + (run?.baseline?.backLayers?.length || 0),
    };
}
