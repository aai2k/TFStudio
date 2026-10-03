/**
 * The lines under the curve editor's table: the last action's message, values
 * outside their quantity's physical range, a Ψ or Δ curve with no angle, and a
 * design whose own curve cannot be drawn.
 */
import { isValueTable } from './curveTable.js';
import { valueProblem, xProblem } from './units.js';

/** How many cells hold a value outside its quantity's physical range (units.js). */
export function outOfRangeCount(table) {
    let count = 0;
    for (const row of table.rows) {
        if (xProblem(row[0])) count++;
        table.columns.forEach((column, index) => {
            if (valueProblem(column.quantity, column.unit, row[index + 1])) count++;
        });
    }
    return count;
}

/**
 * A Ψ or Δ curve at normal incidence carries nothing about the film, and the
 * importer says so before such a curve is added; the editor says it too, as
 * the angle is set on the curve's card.
 */
function missingAngle(table, conditions) {
    return table.kind === 'ellipsometry' && !((conditions?.aoi ?? 0) > 0);
}

export function editorNotices({ editor, conditions, missing, t }) {
    const ce = t.curveEditor;
    const { table } = editor;
    const outside = outOfRangeCount(table);
    return [
        editor.status,
        outside > 0 && { tone: 'warning', text: ce.outOfRange(outside) },
        missingAngle(table, conditions) && { tone: 'error', text: ce.aoiOnCard },
        missing.length > 0 && !isValueTable(table.kind)
            && { tone: 'info', text: t.spectrumExchange.previewErrors.materials },
    ].filter(Boolean);
}
