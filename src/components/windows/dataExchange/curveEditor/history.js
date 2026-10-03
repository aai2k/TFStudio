/**
 * Undo and redo over the tables a curve editor has held. Every edit commits
 * the table it produced; undo steps back one commit and redo forward again,
 * until a new edit drops whatever was ahead.
 */

export function startHistory(table) {
    return { past: [], present: table, future: [] };
}

/** History with `table` as the newest state, or unchanged when nothing moved. */
export function commitTable(history, table) {
    if (table === history.present) return history;
    return { past: [...history.past, history.present], present: table, future: [] };
}

export function undoTable(history) {
    if (!history.past.length) return history;
    return {
        past: history.past.slice(0, -1),
        present: history.past[history.past.length - 1],
        future: [history.present, ...history.future],
    };
}

export function redoTable(history) {
    if (!history.future.length) return history;
    return {
        past: [...history.past, history.present],
        present: history.future[0],
        future: history.future.slice(1),
    };
}
