/**
 * Picking from an open PickerDropdown list by keys. A highlight sits on one row
 * of the list; Up and Down move it over the rows, past the group headings, and
 * Enter picks the row it is on. Where the highlight starts is PickerDropdown's
 * restingPlace.
 *
 * The list is PickerDropdown's run of cells (listCells), headings and rows,
 * with `tops` the offset of each from the top of the list (cellTops).
 */

/** Index of the first row in `cells`, past any heading, or -1 when there is none. */
export function firstRow(cells) {
    return cells.findIndex(cell => cell.item);
}

/**
 * The row the highlight moves to from `from` on an arrow key: the next row in
 * the direction of `step`, past any heading. At either end of the list it stays
 * where it is.
 */
export function nextRow(cells, from, step) {
    for (let i = from + step; i >= 0 && i < cells.length; i += step) {
        if (cells[i].item) return i;
    }
    return from;
}

/**
 * The scroll offset that brings cell `index` whole into view with the least
 * movement, or `scrollTop` when it is in view already. `cover` is the height of
 * the sticky heading over the top of a sectioned list, under which a row at the
 * top edge would be hidden.
 */
export function scrollToShow(tops, index, scrollTop, viewportH, cover = 0) {
    const above = tops[index] - cover < scrollTop;
    const below = tops[index + 1] > scrollTop + viewportH;
    if (above) return Math.max(0, tops[index] - cover);
    return below ? tops[index + 1] - viewportH : scrollTop;
}

/**
 * What a key pressed in the open list does: `{ highlight }` for an arrow, the
 * row it moves to; `{ pick }` for Enter on a highlighted row, its id; `{}` for
 * Enter with nothing highlighted; null for any other key, which is left to the
 * search box.
 */
export function listKeyAction(key, cells, highlight) {
    if (key === 'ArrowDown' || key === 'ArrowUp') {
        return { highlight: nextRow(cells, highlight, key === 'ArrowDown' ? 1 : -1) };
    }
    if (key !== 'Enter') return null;
    const cell = cells[highlight];
    return cell?.item ? { pick: cell.item.id } : {};
}

// Moves the highlight to `index` and scrolls the list as far as it takes to show
// that row. A sectioned list opens with its first heading, which is the height
// a sticky heading covers.
function showRow(list, index) {
    list.setHighlight(index);
    const el = list.listRef.current;
    if (!el) return;
    const cover = list.cells[0]?.header ? list.tops[1] - list.tops[0] : 0;
    const top = scrollToShow(list.tops, index, el.scrollTop, el.clientHeight, cover);
    if (top === el.scrollTop) return;
    el.scrollTop = top;
    list.setScrollTop(top);
}

/**
 * The open list's key handler. `list` is { cells, tops, highlight,
 * setHighlight, select, listRef, setScrollTop }. A key it acts on is kept from
 * the host: a table holding the picker would otherwise move its own selection
 * on the same arrow, or take the same Enter.
 */
export function handleListKey(event, list) {
    const action = listKeyAction(event.key, list.cells, list.highlight);
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    if (action.pick != null) list.select(action.pick);
    else if (action.highlight >= 0) showRow(list, action.highlight);
}
