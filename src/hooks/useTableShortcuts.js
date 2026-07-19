// Shared Excel-like row-shortcut hook for any tabular row list
// (Design Editor layer table, Merit Function Editor operand table,
// Specification qualifier table, etc.). See PLAN.md §12.10.
//
// Keys handled (when the host container has DOM focus):
//   Insert        — insert a new row ABOVE the focused row
//   Shift+Insert  — insert a new row BELOW the focused row
//   Delete        — delete the focused row(s); no-op if all selected rows
//                   are locked, with optional onBlockedDelete() flash
//   Ctrl+D        — duplicate the focused row(s) BELOW
//
// The host owns rows + focus + selection state; this hook only routes
// keys to the host-provided callbacks. To enable, attach the returned
// `onKeyDown` to a `tabIndex: 0` element and ensure the focused row
// belongs to that element's keyboard scope (don't bubble Insert/Delete
// out of unrelated focused inputs — the hook auto-ignores events that
// originated inside <input>/<textarea>/<select> or contentEditable).

const { useCallback } = React;

function isEditingInside(e) {
    const tgt = e.target;
    if (!tgt || !tgt.tagName) return false;
    const tag = tgt.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tgt.isContentEditable) return true;
    return false;
}

function insertRowKey(e, { focusIdx, rows, onInsertAbove, onInsertBelow }) {
    e.preventDefault();
    const haveFocus = focusIdx != null && focusIdx >= 0;
    const at = haveFocus ? focusIdx : (rows ? rows.length - 1 : -1);
    if (e.shiftKey) {
        onInsertBelow && onInsertBelow(at);
    } else {
        onInsertAbove && onInsertAbove(at);
    }
}

function deleteRowKey(e, { focusIdx, rows, isLocked, onDelete, onBlockedDelete }) {
    const haveFocus = focusIdx != null && focusIdx >= 0;
    if (!haveFocus) return;
    const row = rows ? rows[focusIdx] : null;
    if (row && isLocked(row)) {
        e.preventDefault();
        onBlockedDelete && onBlockedDelete();
        return;
    }
    e.preventDefault();
    onDelete && onDelete(focusIdx);
}

function duplicateRowKey(e, { focusIdx, onDuplicate }) {
    const haveFocus = focusIdx != null && focusIdx >= 0;
    if (!haveFocus) return;
    e.preventDefault();
    onDuplicate && onDuplicate(focusIdx);
}

// opts:
//   focusIdx        : number | null   (index into rows; -1/null = none)
//   rows            : array           (used only for length / locked check)
//   isLocked(row)   : optional        (default: row.locked === true)
//   onInsertAbove(focusIdx)
//   onInsertBelow(focusIdx)
//   onDelete(focusIdx)                // host decides single vs multi-select
//   onDuplicate(focusIdx)
//   onBlockedDelete()  : optional     // called when all selected rows locked
//   enabled         : optional bool   (default true)
export function useTableShortcuts(opts) {
    const {
        focusIdx,
        rows,
        isLocked = (r) => !!(r && r.locked),
        onInsertAbove,
        onInsertBelow,
        onDelete,
        onDuplicate,
        onBlockedDelete,
        enabled = true,
    } = opts || {};

    const onKeyDown = useCallback((e) => {
        if (!enabled || isEditingInside(e)) return;

        if (e.key === 'Insert') {
            return insertRowKey(e, { focusIdx, rows, onInsertAbove, onInsertBelow });
        }

        if (e.key === 'Delete') {
            return deleteRowKey(e, { focusIdx, rows, isLocked, onDelete, onBlockedDelete });
        }

        // Ctrl+D — duplicate (note: in Chromium this is "Bookmark this page",
        // which is suppressed inside Electron BrowserWindows anyway).
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'd' || e.key === 'D')) {
            return duplicateRowKey(e, { focusIdx, onDuplicate });
        }
    }, [enabled, focusIdx, rows, isLocked, onInsertAbove, onInsertBelow, onDelete, onDuplicate, onBlockedDelete]);

    return { onKeyDown };
}
