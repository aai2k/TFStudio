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
//   Arrow keys    — optional host-provided row/column navigation
//   Shift+Arrow   — same, extending the selection instead of replacing it
//   Enter / F2    — optional host-provided cell activation
//   0-9 . , -     — the same activation, seeded with the typed character
//   Ctrl+C / V    — optional host-provided copy and paste
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

/**
 * Whether `e` is the Ctrl (or Cmd) chord for a physical key position.
 *
 * Matching is on `e.code` rather than `e.key`, because `e.key` carries the
 * character the active keyboard layout produces: under a Cyrillic layout the C
 * key reports 'с' and the V key 'м', which would put copy and paste out of
 * reach entirely. The chord is the key position, the same one on every layout.
 *
 * Alt is excluded because Windows reports AltGr as Ctrl+Alt, so a chord with
 * Alt held is someone typing a third-level character, not invoking a shortcut.
 */
function isCtrlChord(e, code) {
    return (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.code === code;
}

/**
 * Whether `e` is a bare character that should open the focused cell's editor
 * on that character, the way typing into a spreadsheet cell does.
 *
 * Restricted to what a number can start with: digits, a minus sign, and either
 * decimal separator — the numpad decimal key sends a comma under a Russian or
 * German layout, and the cells parse both. A letter is left alone rather than
 * opening an editor that would reject the very character it was opened with.
 * Modifiers are excluded because a chord is a shortcut, not typing.
 */
function isCellEntryChar(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    if (e.key.length !== 1) return false;
    return (e.key >= '0' && e.key <= '9') || e.key === '.' || e.key === ',' || e.key === '-';
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
        onMoveFocus,
        onMoveColumn,
        onActivate,
        onCopy,
        onPaste,
        enabled = true,
    } = opts || {};

    const onKeyDown = useCallback((e) => {
        if (!enabled || isEditingInside(e)) return;

        if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && onMoveFocus) {
            e.preventDefault();
            // Shift extends from the anchor rather than moving a single
            // selection, matching what Shift-click already does.
            return onMoveFocus(e.key === 'ArrowUp' ? -1 : 1, { extend: e.shiftKey });
        }

        if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && onMoveColumn) {
            e.preventDefault();
            return onMoveColumn(e.key === 'ArrowLeft' ? -1 : 1);
        }

        if ((e.key === 'Enter' || e.key === 'F2') && onActivate) {
            e.preventDefault();
            return onActivate(focusIdx);
        }

        // Typing a digit starts the edit and becomes the cell's new content;
        // Enter and F2 open the editor on the existing value instead, so
        // replacing a number and correcting one digit stay separate gestures.
        if (onActivate && isCellEntryChar(e)) {
            e.preventDefault();
            return onActivate(focusIdx, e.key);
        }

        if (isCtrlChord(e, 'KeyC') && onCopy) {
            e.preventDefault();
            return onCopy();
        }

        if (isCtrlChord(e, 'KeyV') && onPaste) {
            e.preventDefault();
            return onPaste();
        }

        if (e.key === 'Insert') {
            return insertRowKey(e, { focusIdx, rows, onInsertAbove, onInsertBelow });
        }

        if (e.key === 'Delete') {
            return deleteRowKey(e, { focusIdx, rows, isLocked, onDelete, onBlockedDelete });
        }

        // Ctrl+D — duplicate (note: in Chromium this is "Bookmark this page",
        // which is suppressed inside Electron BrowserWindows anyway).
        if (isCtrlChord(e, 'KeyD')) {
            return duplicateRowKey(e, { focusIdx, onDuplicate });
        }
    }, [enabled, focusIdx, rows, isLocked, onInsertAbove, onInsertBelow, onDelete,
        onDuplicate, onBlockedDelete, onMoveFocus, onMoveColumn, onActivate, onCopy, onPaste]);

    return { onKeyDown };
}
