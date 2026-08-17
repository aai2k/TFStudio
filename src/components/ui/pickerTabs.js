/**
 * Group filter tabs for PickerDropdown: the full-list button, then one scrolling
 * row of groups.
 *
 * The row scrolls sideways rather than wrapping. A wrapped strip takes its height
 * out of the result list below it, and a machine with a dozen catalogs grew it to
 * six rows, leaving the list a few entries tall in a 320 px overlay. Sideways
 * scrolling is not discoverable by itself and cannot be reached at all without a
 * wheel, so the arrows appear whenever the row is wider than the space it has.
 */

const { createElement: h, useState, useRef, useEffect, useCallback } = React;

import { attachTabWheelScroll } from '../docking/tabWheel.js';

// Fraction of the visible width one arrow click aims to move, leaving a tab or so
// of overlap so nothing is stepped over between one click and the next.
const PAGE = 0.8;

// Width of the soft edge where the row continues past the boundary.
const FADE = 14;

function tabStyle(active, c) {
    return {
        padding: '1px 7px', fontSize: 11, flexShrink: 0, whiteSpace: 'nowrap',
        border: `1px solid ${active ? c.accent : c.border}`,
        borderRadius: 3,
        backgroundColor: active ? c.accent + '33' : 'transparent',
        color: active ? c.accent : c.textDim,
        cursor: 'pointer', outline: 'none',
        fontFamily: 'system-ui, -apple-system, sans-serif'
    };
}

/** Whether the row overflows, and whether it is scrolled to either end. */
export function stripEdges(strip) {
    const travel = strip.scrollWidth - strip.clientWidth;
    return {
        overflowing: travel > 1,
        atStart: strip.scrollLeft <= 0,
        atEnd: strip.scrollLeft >= travel - 1,
    };
}

/**
 * Bring a tab into view, aligned to the left edge. The picker opens filtered to
 * the group holding the current value, and that group's tab can sit past the
 * right edge, leaving a filtered list with nothing on screen saying what
 * filtered it.
 */
export function scrollTabIntoView(strip, tab) {
    if (!strip || !tab) return;
    const visible = tab.offsetLeft >= strip.scrollLeft
        && tab.offsetLeft + tab.offsetWidth <= strip.scrollLeft + strip.clientWidth;
    if (!visible) strip.scrollLeft = tab.offsetLeft;
}

/**
 * Where an arrow click leaves the row: about a screenful along, rounded to a tab
 * boundary. The row rests only on boundaries, because a name sliced down the
 * middle by the edge of the strip reads as a truncated catalog name rather than
 * as a row that continues.
 *
 * @param {number[]} starts    left edge of every tab
 * @param {number}   from      current scroll offset
 * @param {number}   viewport  visible width of the row
 * @param {number}   direction -1 back, +1 forward
 */
export function pagedOffset(starts, from, viewport, direction) {
    const target = from + direction * viewport * PAGE;
    const ahead = starts.filter(start => (direction > 0 ? start > from + 1 : start < from - 1));
    if (ahead.length === 0) return from;
    return ahead.reduce((best, start) => Math.abs(start - target) < Math.abs(best - target) ? start : best);
}

// Soft edge wherever the row continues, so the tab the boundary cuts reads as
// more to come. No fade at an end there is nothing beyond.
export function fadeMask({ overflowing, atStart, atEnd }) {
    if (!overflowing) return undefined;
    const stops = [
        atStart ? 'black 0' : `transparent 0, black ${FADE}px`,
        atEnd ? 'black 100%' : `black calc(100% - ${FADE}px), transparent 100%`,
    ];
    return `linear-gradient(to right, ${stops.join(', ')})`;
}

function arrowEl(glyph, disabled, onClick, c) {
    return h('button', {
        onClick: disabled ? undefined : onClick,
        style: {
            flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 14, height: 17, padding: 0, fontSize: 10, lineHeight: 1,
            border: 'none', background: 'transparent',
            color: c.textDim, opacity: disabled ? 0.3 : 1,
            cursor: disabled ? 'default' : 'pointer', outline: 'none',
        }
    }, glyph);
}

export function PickerTabs({ groups, catFilter, setCatFilter, allLabel, c }) {
    const stripRef     = useRef(null);
    const activeTabRef = useRef(null);
    const [edges, setEdges] = useState({ overflowing: false, atStart: true, atEnd: true });

    const measure = useCallback(() => {
        if (stripRef.current) setEdges(stripEdges(stripRef.current));
    }, []);

    // React delegates wheel events through a passive listener, which cannot stop
    // the page scrolling instead. tabWheel attaches a native one.
    useEffect(() => (stripRef.current ? attachTabWheelScroll(stripRef.current) : undefined), []);

    useEffect(() => {
        const strip = stripRef.current;
        if (!strip) return undefined;
        measure();
        const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
        if (observer) observer.observe(strip);
        return () => { if (observer) observer.disconnect(); };
    }, [groups.length, measure]);

    useEffect(() => {
        scrollTabIntoView(stripRef.current, activeTabRef.current);
        measure();
    }, [catFilter, measure]);

    const page = (direction) => {
        const strip = stripRef.current;
        if (!strip) return;
        const starts = [...strip.children].map(tab => tab.offsetLeft);
        strip.scrollLeft = pagedOffset(starts, strip.scrollLeft, strip.clientWidth, direction);
        measure();
    };

    if (groups.length <= 1) return null;
    return h('div', {
        style: {
            display: 'flex', alignItems: 'center', gap: 2, padding: '3px 6px',
            borderBottom: `1px solid ${c.border}`
        }
    },
        // The full list stays out of the scrolling part. It is the way out of a
        // filtered view, and the picker opens filtered to the current selection.
        h('button', {
            onClick: () => setCatFilter('all'),
            style: tabStyle(catFilter === 'all', c)
        }, allLabel),
        edges.overflowing && arrowEl('◂', edges.atStart, () => page(-1), c),
        h('div', {
            ref: stripRef, className: 'tabstrip-noscrollbar', onScroll: measure,
            style: {
                display: 'flex', gap: 2, flex: 1, minWidth: 0,
                overflowX: 'auto', overflowY: 'hidden', position: 'relative',
                // Wheel scrolling lands wherever it lands; snapping keeps it on
                // the same boundaries the arrows use.
                scrollSnapType: 'x mandatory',
                maskImage: fadeMask(edges), WebkitMaskImage: fadeMask(edges),
            }
        },
            groups.map(g => h('button', {
                key: g.id,
                ref: g.id === catFilter ? activeTabRef : undefined,
                onClick: () => setCatFilter(g.id),
                style: { ...tabStyle(catFilter === g.id, c), scrollSnapAlign: 'start' }
            }, g.label))
        ),
        edges.overflowing && arrowEl('▸', edges.atEnd, () => page(1), c)
    );
}
