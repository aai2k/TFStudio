// How a .tfs file holds the merit rows of a design's other environments
// (src/utils/environments/environments.js describes environments).
//
// A merit row scored in environment 2 or later alone is written switched off,
// with its own switch in `envEnabled`. A build without environments then
// leaves the row out instead of scoring it against environment 1's media and
// substrate, and the reader puts the switch back. A row that reads such a row
// (a math row through refId, refId1 or refId2) is written the same way, since
// a build that left out the row it reads could not score it.
//
// CommonJS, Electron-free.

const isRow = op => !!op && typeof op === 'object';
const scoredElsewhere = op => isRow(op) && op.env != null && op.env !== 'base';
const readsAny = (op, ids) => [op.refId, op.refId1, op.refId2].some(id => id != null && ids.has(id));

// The rows written switched off: those of other environments, and every row
// that reads one of them, however many rows lie between.
function guardedRows(operands) {
  const rows = new Set(operands.filter(scoredElsewhere));
  const ids = new Set([...rows].map(op => op.id).filter(id => id != null));
  let size;
  do {
    size = rows.size;
    for (const op of operands) {
      if (!isRow(op) || rows.has(op) || !readsAny(op, ids)) continue;
      rows.add(op);
      if (op.id != null) ids.add(op.id);
    }
  } while (rows.size !== size);
  return rows;
}

// The rows as the file writes them. The rows given are left as they are.
function guardRowSwitches(meritOperands) {
  if (!Array.isArray(meritOperands)) return meritOperands;
  const rows = guardedRows(meritOperands);
  return meritOperands.map(op => (rows.has(op) ? { ...op, enabled: false, envEnabled: Boolean(op.enabled) } : op));
}

// Each row read with `envEnabled` takes its own switch back, in place.
function restoreRowSwitches(design) {
  const operands = Array.isArray(design.meritOperands) ? design.meritOperands : [];
  for (const op of operands) {
    if (!isRow(op) || !('envEnabled' in op)) continue;
    op.enabled = op.envEnabled;
    delete op.envEnabled;
  }
}

module.exports = { guardRowSwitches, restoreRowSwitches };
