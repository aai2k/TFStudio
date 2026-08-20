/**
 * PickerDropdown — generic searchable dropdown with category filter tabs.
 *
 * The shared shell behind MaterialPicker (materials grouped by catalog) and the
 * merit-function OperandTypePicker (operands grouped by category): a trigger
 * button that opens a positioned overlay with a search box, category tabs, and a
 * result list. Domain specifics — how items are produced, coloured, labelled,
 * and matched to the current value — are supplied by the caller.
 *
 * @param {string}   value       current selected id
 * @param {function} onChange    called with the picked item id
 * @param {object}   c           color palette
 * @param {boolean}  [compact]   narrow trigger (table cells) vs full-width
 * @param {string}   triggerLabel   text shown in the closed trigger
 * @param {string}   [triggerColor] dot colour in the trigger (omit for no dot)
 * @param {Array}    [groups]    [{ id, label }] filter tabs; tabs shown when >1
 * @param {string}   [openGroup] group tab selected when the list opens; the full
 *                   list when omitted or when it names no group
 * @param {function} search      (query, groupId|null) => [{ id, label, color?, badge?, title?, group? }]
 * @param {function} [isActive]  (item) => bool; defaults to item.id === value
 * @param {boolean}  [sections]  when the "all" tab is active, render group headers
 * @param {string}   searchPlaceholder
 * @param {string}   allLabel    label for the "all categories" tab
 * @param {string}   emptyText   shown when the result list is empty
 */

const { createElement: h, useState, useEffect, useRef } = React;

import { PickerTabs } from './pickerTabs.js';

function dotStyle(color) {
    return {
        width: 9, height: 9, borderRadius: '50%',
        backgroundColor: color || '#888', flexShrink: 0,
        display: 'inline-block', marginRight: 4
    };
}

// Overlay position from the trigger rect; flips upward near the viewport bottom.
function dropPositionFrom(rect, minDropWidth) {
    const dropWidth = Math.max(rect.width, minDropWidth);
    const spaceBelow = window.innerHeight - rect.bottom - 4;
    const spaceAbove = rect.top - 4;
    const flipUp = spaceBelow < 220 && spaceAbove > spaceBelow;
    const maxH = flipUp
        ? Math.min(320, Math.max(120, spaceAbove))
        : Math.min(320, Math.max(120, spaceBelow));
    return {
        top: flipUp ? rect.top - 2 - maxH : rect.bottom + 2,
        left: Math.min(rect.left, window.innerWidth - dropWidth - 4),
        width: dropWidth, maxH,
    };
}

// One selectable row. The active row takes the ref the overlay scrolls to.
function itemRow(item, { c, activeOf, select, activeRef }) {
    const active = activeOf(item);
    return h('div', {
        key: item.id,
        ref: active ? activeRef : undefined,
        onClick: () => select(item.id),
        title: item.title,
        style: {
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '3px 8px', cursor: 'pointer',
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

// Flat list, or (when showHeaders) grouped under category section headers.
function renderRows(results, opts) {
    const { c, groups, showHeaders } = opts;
    if (!showHeaders) return results.map(item => itemRow(item, opts));
    const rows = [];
    for (const g of groups) {
        const inGroup = results.filter(item => item.group === g.id);
        if (inGroup.length === 0) continue;
        rows.push(h('div', {
            key: 'hdr-' + g.id,
            style: {
                padding: '3px 8px', fontSize: 10, fontWeight: 700,
                textTransform: 'uppercase', letterSpacing: '0.04em',
                color: c.textDim, backgroundColor: c.panel,
                borderBottom: `1px solid ${c.border}`,
                position: 'sticky', top: 0, zIndex: 1
            }
        }, g.label));
        for (const item of inGroup) rows.push(itemRow(item, opts));
    }
    return rows;
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
            search, catFilter, setCatFilter, allLabel, sections, emptyText,
            activeOf, select, groups, listRef, activeRef } = s;
    const results = search(query, catFilter === 'all' ? null : catFilter);
    const listBody = results.length === 0
        ? h('div', { style: { padding: '12px 8px', color: c.textDim, fontSize: 12, textAlign: 'center' } }, emptyText)
        : renderRows(results, {
            c, groups, sections, showHeaders: sections && catFilter === 'all',
            activeOf, select, activeRef,
        });
    return h('div', {
        ref: dropRef,
        style: {
            position: 'fixed', zIndex: 9999,
            top: dropPos.top, left: dropPos.left, width: dropPos.width,
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
        h(PickerTabs, { groups, catFilter, setCatFilter, allLabel, c }),
        // The list is positioned so that it, and not the fixed overlay, is the
        // offset parent of its rows: scrollToActive reads row.offsetTop, which is
        // measured from the nearest positioned ancestor. Measured from the
        // overlay instead, every row reads high by the height of the search box
        // and the tab strip, and the list scrolls past the selection by that much.
        h('div', { ref: listRef, style: { flex: 1, overflowY: 'auto', position: 'relative' } }, listBody)
    );
}

/**
 * Bring the current selection into view when the list opens, so a picker with
 * dozens of entries opens on the one already chosen instead of at the top. The
 * row is centred where the list is long enough; the sticky section header would
 * otherwise cover a row scrolled to exactly its own offset.
 */
export function scrollToActive(listRef, activeRef) {
    const list = listRef.current;
    const row = activeRef.current;
    if (!list || !row) return;
    const centred = row.offsetTop - (list.clientHeight - row.offsetHeight) / 2;
    list.scrollTop = Math.max(0, Math.min(centred, list.scrollHeight - list.clientHeight));
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
        groups = [], openGroup, search, isActive, sections = false,
        searchPlaceholder, allLabel, emptyText, minDropWidth = 240,
    } = props;

    const [open,      setOpen]      = useState(false);
    const [query,     setQuery]     = useState('');
    const [catFilter, setCatFilter] = useState('all');
    const [dropPos,   setDropPos]   = useState({ top: 0, left: 0, width: 0, maxH: 320 });

    const triggerRef = useRef(null);
    const dropRef    = useRef(null);
    const searchRef  = useRef(null);
    const listRef    = useRef(null);
    const activeRef  = useRef(null);

    // Focus the search box on open; clear the query on close.
    useEffect(() => {
        if (open) setTimeout(() => searchRef.current?.focus(), 0);
        else setQuery('');
    }, [open]);

    useEffect(() => {
        if (open) scrollToActive(listRef, activeRef);
    }, [open]);

    useDismiss(open, setOpen, dropRef, triggerRef);

    // The trigger toggles. Outside-click dismissal ignores the trigger, so
    // without this a click on an open picker would be swallowed by the exclusion
    // and then re-open, leaving the only ways out a pick, Escape, or a click
    // somewhere else entirely.
    const onTrigger = () => {
        if (open) { setOpen(false); return; }
        if (triggerRef.current) setDropPos(dropPositionFrom(triggerRef.current.getBoundingClientRect(), minDropWidth));
        // Open on the group the current value belongs to, so the list says where
        // the selection comes from. Anything else falls back to the full list: a
        // tab left over from an earlier visit can exclude the current selection
        // entirely, which is the one entry the list has to show.
        setCatFilter(groups.some(g => g.id === openGroup) ? openGroup : 'all');
        setOpen(true);
    };
    const select = (id) => { onChange(id); setOpen(false); };
    const activeOf = isActive || (item => item.id === value);

    const shared = {
        triggerRef, dropRef, searchRef, listRef, activeRef, onTrigger, open, compact, c,
        triggerColor, triggerLabel, groups, catFilter, setCatFilter, allLabel,
        dropPos, query, setQuery, searchPlaceholder, search, sections, emptyText,
        activeOf, select,
    };

    if (!open) return triggerEl(shared);
    return h(React.Fragment, null, triggerEl(shared), overlayEl(shared));
}
