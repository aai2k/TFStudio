/**
 * PickerDropdown — generic searchable dropdown with category filter tabs.
 *
 * The shared shell behind MaterialPicker (materials grouped by catalog) and the
 * merit-function OperandTypePicker (operands grouped by category): a trigger
 * button that opens a positioned overlay with a search box, category tabs, and a
 * result list. Domain specifics — how items are produced, coloured, labelled,
 * and matched to the current value — are supplied by the caller.
 *
 * The list is windowed. A material picker on a machine carrying the substrate
 * and coating libraries offers a few thousand entries, and putting every one of
 * them in the DOM made opening the list, and every keystroke in its search box,
 * take the better part of a second. Only the entries on screen are built, so the
 * cost no longer grows with the size of the installed catalogs.
 *
 * @param {string}   value       current selected id
 * @param {function} onChange    called with the picked item id
 * @param {object}   c           color palette
 * @param {boolean}  [compact]   narrow trigger (table cells) vs full-width
 * @param {string}   triggerLabel   text shown in the closed trigger
 * @param {string}   [triggerColor] dot colour in the trigger (omit for no dot)
 * @param {Array}    [groups]    [{ id, label }] filter tabs; tabs shown when >1
 * @param {string}   [currentGroup] group the current value belongs to. Its tab
 *                   is marked when the list opens; the list itself opens
 *                   unfiltered, scrolled to the current value
 * @param {function} search      (query, groupId|null) => [{ id, label, color?, badge?, title?, group? }]
 * @param {function} [isActive]  (item) => bool; defaults to item.id === value
 * @param {boolean}  [sections]  when the "all" tab is active, render group headers
 * @param {string}   searchPlaceholder
 * @param {string}   allLabel    label for the "all categories" tab
 * @param {string}   emptyText   shown when the result list is empty
 */

const { createElement: h, useState, useEffect, useLayoutEffect, useMemo, useRef } = React;

import { PickerTabs } from './pickerTabs.js';

// Heights of a row and of a section header, in px. They are applied to the
// elements rather than left to the font metrics: the windowed list places an
// entry from its index alone, so both have to hold on every platform.
const ROW_H = 21;
const HEADER_H = 20;

// Entries kept in the DOM past each edge of the viewport, so a scroll of a line
// or two reveals rows that are already there.
const OVERSCAN = 6;

function stopPropagation(event) {
    event.stopPropagation();
}

function dotStyle(color) {
    return {
        width: 9, height: 9, borderRadius: '50%',
        backgroundColor: color || '#888', flexShrink: 0,
        display: 'inline-block', marginRight: 4
    };
}

// Overlay position from the trigger rect; flips upward near the viewport bottom.
//
// Opening downward the overlay hangs from its top edge, so `top` places it. A
// flipped one has to hang from its *bottom* edge instead, pinned to the top of
// the trigger. Deriving a `top` from maxH would assume the list fills all the
// room available, and a shorter one (a filter tab with three entries, say) would
// then be pushed that much too high and float away from the row it belongs to.
export function dropPositionFrom(rect, minDropWidth) {
    const dropWidth = Math.max(rect.width, minDropWidth);
    const spaceBelow = window.innerHeight - rect.bottom - 4;
    const spaceAbove = rect.top - 4;
    const flipUp = spaceBelow < 220 && spaceAbove > spaceBelow;
    const maxH = flipUp
        ? Math.min(320, Math.max(120, spaceAbove))
        : Math.min(320, Math.max(120, spaceBelow));
    return {
        top: flipUp ? null : rect.bottom + 2,
        bottom: flipUp ? Math.max(4, window.innerHeight - rect.top + 2) : null,
        left: Math.min(rect.left, window.innerWidth - dropWidth - 4),
        width: dropWidth, maxH,
    };
}

/**
 * The list flattened into one run of cells: each group's header followed by its
 * rows when sections are shown, the rows alone otherwise. Flattening is what
 * lets an entry be placed from its index instead of being measured.
 *
 * A row whose group is not among `groups` is dropped, having no header to sit
 * under.
 */
export function listCells(results, groups, showHeaders) {
    if (!showHeaders) return results.map(item => ({ item, group: null }));
    const byGroup = new Map();
    for (const item of results) {
        const rows = byGroup.get(item.group);
        if (rows) rows.push(item);
        else byGroup.set(item.group, [item]);
    }
    const cells = [];
    for (const group of groups) {
        const rows = byGroup.get(group.id);
        if (!rows) continue;
        cells.push({ header: group, group });
        for (const item of rows) cells.push({ item, group });
    }
    return cells;
}

/** Offset of every cell from the top of the list, plus the total as a last entry. */
export function cellTops(cells) {
    const tops = new Array(cells.length + 1);
    let y = 0;
    for (let i = 0; i < cells.length; i++) {
        tops[i] = y;
        y += cells[i].header ? HEADER_H : ROW_H;
    }
    tops[cells.length] = y;
    return tops;
}

// Index of the cell covering offset y.
function cellAt(tops, y) {
    let lo = 0;
    let hi = tops.length - 2;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (tops[mid] <= y) lo = mid;
        else hi = mid - 1;
    }
    return lo;
}

/**
 * The cells to render at a given scroll offset, with the blank space that stands
 * in for those above and below them.
 *
 * `stuck` is the header of the group the window starts inside, for the case
 * where that header lies above the window. It is rendered at the head of the
 * window so a list scrolled well into a long catalog still says which catalog,
 * and the space above it is shortened by its height so the rows keep their
 * offsets.
 */
export function visibleWindow(cells, tops, scrollTop, viewportH) {
    if (cells.length === 0) return { from: 0, to: -1, padTop: 0, padBottom: 0, stuck: null };
    const from = Math.max(0, cellAt(tops, scrollTop) - OVERSCAN);
    const to = Math.min(cells.length - 1, cellAt(tops, scrollTop + viewportH) + OVERSCAN);
    const stuck = cells[from].header ? null : cells[from].group;
    return {
        from, to, stuck,
        padTop: tops[from] - (stuck ? HEADER_H : 0),
        padBottom: tops[cells.length] - tops[to + 1],
    };
}

/**
 * Where the list rests when it opens: the current entry centred, so a picker
 * with thousands of entries opens on the one already chosen instead of at the
 * top. Clamped to both ends, and 0 when nothing in the list is current.
 */
export function scrollTopFor(tops, index, viewportH) {
    if (!(index >= 0) || index >= tops.length - 1) return 0;
    const centred = tops[index] - (viewportH - (tops[index + 1] - tops[index])) / 2;
    return Math.max(0, Math.min(centred, tops[tops.length - 1] - viewportH));
}

// One selectable row.
function itemRow(item, key, { c, activeOf, select }) {
    const active = activeOf(item);
    return h('div', {
        key,
        onClick: () => select(item.id),
        title: item.title,
        style: {
            display: 'flex', alignItems: 'center', gap: 6,
            height: ROW_H, boxSizing: 'border-box',
            padding: '3px 8px', lineHeight: '15px', cursor: 'pointer',
            backgroundColor: active ? c.accent + '33' : 'transparent',
            color: active ? c.accent : c.text, fontSize: 12,
        },
        onMouseEnter: (e) => { e.currentTarget.style.backgroundColor = c.hover; },
        onMouseLeave: (e) => { e.currentTarget.style.backgroundColor = active ? c.accent + '33' : 'transparent'; }
    },
        item.color != null && h('span', { style: dotStyle(item.color) }),
        h('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, item.label),
        item.badge && h('span', { style: { fontSize: 10, color: c.textDim, flexShrink: 0 } }, item.badge)
    );
}

// One group heading. It is opaque and sticky, so the rows of a group scroll
// under its name rather than through it.
function headerRow(group, c) {
    return h('div', {
        key: 'hdr-' + group.id,
        style: {
            height: HEADER_H, boxSizing: 'border-box',
            padding: '3px 8px', fontSize: 10, fontWeight: 700, lineHeight: '13px',
            textTransform: 'uppercase', letterSpacing: '0.04em',
            color: c.textDim, backgroundColor: c.panel,
            borderBottom: `1px solid ${c.border}`,
            position: 'sticky', top: 0, zIndex: 1
        }
    }, group.label);
}

// The children of the scrolling list: a spacer, the cells in the window, a
// second spacer. A row is keyed by its group as well as its id, because the
// same material is listed both under the design that uses it and under the
// catalog it came from.
function listBody(s, win) {
    const { c, cells, emptyText, activeOf, select } = s;
    if (cells.length === 0) {
        return h('div', { style: { padding: '12px 8px', color: c.textDim, fontSize: 12, textAlign: 'center' } }, emptyText);
    }
    const children = [];
    if (win.padTop > 0) children.push(h('div', { key: 'pad-top', style: { height: win.padTop } }));
    if (win.stuck) children.push(headerRow(win.stuck, c));
    for (let i = win.from; i <= win.to; i++) {
        const cell = cells[i];
        children.push(cell.header
            ? headerRow(cell.header, c)
            : itemRow(cell.item, `${cell.group ? cell.group.id + '/' : ''}${cell.item.id}`, { c, activeOf, select }));
    }
    if (win.padBottom > 0) children.push(h('div', { key: 'pad-bottom', style: { height: win.padBottom } }));
    return children;
}

// Closed-state trigger button.
function triggerEl(s) {
    const { triggerRef, onTrigger, compact, c, open, triggerColor, triggerLabel } = s;
    return h('div', {
        ref: triggerRef,
        onClick: onTrigger,
        style: {
            display: 'flex', alignItems: 'center', boxSizing: 'border-box',
            flex: compact ? undefined : 1,
            width: compact ? '100%' : undefined,
            minWidth: 0,
            height: 22, padding: '0 4px',
            backgroundColor: c.panel, color: c.text,
            border: `1px solid ${open ? c.accent : c.border}`, borderRadius: 3,
            fontSize: 12, fontFamily: 'system-ui, -apple-system, sans-serif',
            cursor: 'pointer', userSelect: 'none', gap: 4, overflow: 'hidden'
        }
    },
        triggerColor != null && h('span', { style: dotStyle(triggerColor) }),
        h('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, triggerLabel),
        h('span', { style: { color: c.textDim, fontSize: 10, flexShrink: 0 } }, '▾')
    );
}

// Open-state positioned overlay: search box, filter tabs, result list.
export function overlayEl(s) {
    const { dropRef, dropPos, c, searchRef, query, setQuery, searchPlaceholder,
            catFilter, setCatFilter, currentGroup, allLabel, groups,
            listRef, onListScroll, cells, tops, scrollTop } = s;
    // The window is measured against the overlay's maximum height rather than
    // the list's own: the list is the shorter of the two by a search box and a
    // tab strip, so this errs by a couple of rows in the direction of rendering
    // one too many, and needs no measurement of the DOM to render the first time.
    const win = visibleWindow(cells, tops, scrollTop, dropPos.maxH);
    return h('div', {
        ref: dropRef,
        // The overlay is a descendant of whatever cell holds the trigger, so a
        // click on a tab or an arrow would bubble to that host: a layer row
        // answers a click by focusing its table, which takes focus off the
        // search box mid-word. Nothing inside the list is the host's business.
        onClick: stopPropagation,
        onContextMenu: stopPropagation,
        style: {
            position: 'fixed', zIndex: 9999,
            ...(dropPos.top != null ? { top: dropPos.top } : { bottom: dropPos.bottom }),
            left: dropPos.left, width: dropPos.width,
            maxHeight: dropPos.maxH, display: 'flex', flexDirection: 'column',
            backgroundColor: c.bg, border: `1px solid ${c.accent}`,
            borderRadius: 4, boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            overflow: 'hidden'
        }
    },
        h('div', { style: { padding: '4px 6px', borderBottom: `1px solid ${c.border}` } },
            h('input', {
                ref: searchRef, value: query,
                onChange: (e) => setQuery(e.target.value),
                placeholder: searchPlaceholder,
                style: {
                    width: '100%', height: 22, boxSizing: 'border-box',
                    backgroundColor: c.panel, color: c.text,
                    border: `1px solid ${c.border}`, borderRadius: 3,
                    fontSize: 12, padding: '0 6px', outline: 'none'
                }
            })
        ),
        h(PickerTabs, { groups, catFilter, setCatFilter, currentGroup, allLabel, c }),
        h('div', {
            ref: listRef, onScroll: onListScroll,
            style: { flex: 1, overflowY: 'auto' }
        }, listBody(s, win))
    );
}

// Close the overlay on outside-click or Escape while it is open.
function useDismiss(open, setOpen, dropRef, triggerRef) {
    useEffect(() => {
        if (!open) return undefined;
        const onDown = (e) => {
            if (!dropRef.current?.contains(e.target) && !triggerRef.current?.contains(e.target)) setOpen(false);
        };
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]); // eslint-disable-line
}

export function PickerDropdown(props) {
    const {
        value, onChange, c, compact, triggerLabel, triggerColor,
        groups = [], currentGroup = null, search, isActive, sections = false,
        searchPlaceholder, allLabel, emptyText, minDropWidth = 240,
    } = props;

    const [open,      setOpen]      = useState(false);
    const [query,     setQuery]     = useState('');
    const [catFilter, setCatFilter] = useState('all');
    const [scrollTop, setScrollTop] = useState(0);
    const [dropPos,   setDropPos]   = useState({ top: 0, left: 0, width: 0, maxH: 320 });

    const triggerRef = useRef(null);
    const dropRef    = useRef(null);
    const searchRef  = useRef(null);
    const listRef    = useRef(null);
    const opening    = useRef(false);

    const activeOf = isActive || (item => item.id === value);

    // The result list, rebuilt when the query or the filter changes rather than
    // on every render of the row the picker sits in. A picker is mounted per
    // layer, and searching thousands of materials is not free. `search` is left
    // out of the dependencies on purpose: callers rebuild that closure every
    // render, and nothing it reads changes while the list is open.
    const { cells, tops } = useMemo(() => {
        if (!open) return { cells: [], tops: [0] };
        const results = search(query, catFilter === 'all' ? null : catFilter);
        const next = listCells(results, groups, sections && catFilter === 'all');
        return { cells: next, tops: cellTops(next) };
    }, [open, query, catFilter, sections, groups.length]); // eslint-disable-line

    // Focus the search box on open; clear the query on close.
    useEffect(() => {
        if (open) setTimeout(() => searchRef.current?.focus(), 0);
        else setQuery('');
    }, [open]);

    // The list opens on the current entry, and goes back to the top whenever a
    // query or a filter changes what is in it: the best matches for what was
    // just typed are at the top, and jumping to the old value would hide them.
    useLayoutEffect(() => {
        if (!open) { opening.current = false; return; }
        const list = listRef.current;
        if (!list) return;
        const current = cells.findIndex(cell => cell.item && activeOf(cell.item));
        const top = opening.current ? scrollTopFor(tops, current, list.clientHeight) : 0;
        opening.current = false;
        list.scrollTop = top;
        setScrollTop(top);
    }, [open, query, catFilter]); // eslint-disable-line

    useDismiss(open, setOpen, dropRef, triggerRef);

    // The trigger toggles. Outside-click dismissal ignores the trigger, so
    // without this a click on an open picker would be swallowed by the exclusion
    // and then re-open, leaving the only ways out a pick, Escape, or a click
    // somewhere else entirely.
    const onTrigger = () => {
        if (open) { setOpen(false); return; }
        if (triggerRef.current) setDropPos(dropPositionFrom(triggerRef.current.getBoundingClientRect(), minDropWidth));
        // The list opens unfiltered every time: a tab left over from an earlier
        // visit can hide the current value, and a filtered view hides the other
        // groups the user may want next. Where the value comes from is said by
        // marking its group's tab instead.
        setCatFilter('all');
        opening.current = true;
        setOpen(true);
    };
    const select = (id) => { onChange(id); setOpen(false); };
    const onListScroll = (e) => setScrollTop(e.currentTarget.scrollTop);

    const shared = {
        triggerRef, dropRef, searchRef, listRef, onTrigger, open, compact, c,
        triggerColor, triggerLabel, groups, catFilter, setCatFilter, currentGroup, allLabel,
        dropPos, query, setQuery, searchPlaceholder, emptyText,
        cells, tops, scrollTop, onListScroll, activeOf, select,
    };

    if (!open) return triggerEl(shared);
    return h(React.Fragment, null, triggerEl(shared), overlayEl(shared));
}
