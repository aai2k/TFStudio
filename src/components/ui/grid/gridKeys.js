/**
 * The keys that move a spreadsheet selection, shared by every table built on
 * gridModel.js.
 *
 * Each takes the key press as `ctx`: the `event`, the focused cell as
 * `rowIdx` and `colKey`, `rowCount`, `stepTarget(direction)` giving the cell a
 * sideways step reaches (gridModel's navigationTarget from the focused cell),
 * and the selection's own handlers.
 */

// With Shift held an arrow stretches the range from the anchor instead of
// moving the focus.
export function moveVertical(ctx, step) {
    ctx.event.preventDefault();
    const rowIdx = Math.max(0, Math.min(ctx.rowIdx + step, ctx.rowCount - 1));
    if (ctx.event.shiftKey && ctx.extendTo) ctx.extendTo(rowIdx, ctx.colKey);
    else ctx.focusAt(rowIdx, ctx.colKey);
}

// Sideways, a stretched range stays on the focused row: a step that would wrap
// onto the next row does nothing.
export function moveHorizontal(ctx, direction) {
    ctx.event.preventDefault();
    if (ctx.event.shiftKey && ctx.extendTo) {
        const target = ctx.stepTarget(direction);
        if (target && !target.focus) ctx.extendTo(ctx.rowIdx, target.colKey);
        return;
    }
    ctx.navigate(ctx.rowIdx, ctx.colKey, direction);
}

export function moveTab(ctx) {
    ctx.event.preventDefault();
    ctx.navigate(ctx.rowIdx, ctx.colKey, ctx.event.shiftKey ? 'left' : 'right');
}

export function beginEdit(ctx) {
    ctx.event.preventDefault();
    ctx.startEdit(ctx.rowIdx, ctx.colKey, null);
}

// Escape with no range is left to whoever else wants it.
export function collapseRange(ctx) {
    if (!ctx.range || !ctx.collapseRange) return;
    ctx.event.preventDefault();
    ctx.collapseRange();
}

/**
 * Whether the event came from a control that takes typing itself: a comment
 * row's input, a select, the cell editor. Keys typed there belong to it, not to
 * the focused cell, or text would land in whichever cell was last focused.
 */
export function isTextControl(target) {
    const tag = target?.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/** A key that types into a cell: one character with no Ctrl, Alt or Meta. */
export function isPrintableEditKey(event) {
    const hasModifier = [event.ctrlKey, event.altKey, event.metaKey].some(Boolean);
    return !hasModifier && event.key.length === 1;
}
