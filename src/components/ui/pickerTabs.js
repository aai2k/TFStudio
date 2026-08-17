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

// Fraction of the visible width one arrow click moves, leaving a tab or so of
// overlap so nothing is stepped over between one click and the next.
const PAGE = 0.8;

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
 * Bring a tab fully into view, moving no further than it takes. The picker opens
 * filtered to the group holding the current value, and that group's tab can sit
 * past the right edge, leaving a filtered list with nothing on screen saying what
 * filtered it.
 */
export function scrollTabIntoView(strip, tab) {
    if (!strip || !tab) return;
    const right = tab.offsetLeft + tab.offsetWidth;
    if (tab.offsetLeft < strip.scrollLeft) strip.scrollLeft = tab.offsetLeft;
    else if (right > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = right - strip.clientWidth;
}

function arrowEl(glyph, disabled, onClick, c) {
    return h('button', {
        onClick: disabled ? undefined : onClick,
        style: {
            flexShrink: 0, padding: '1px 3px', fontSize: 11, lineHeight: '14px',
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
        strip.scrollLeft += direction * strip.clientWidth * PAGE;
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
        edges.overflowing && arrowEl('‹', edges.atStart, () => page(-1), c),
        h('div', {
            ref: stripRef, className: 'tabstrip-noscrollbar', onScroll: measure,
            style: {
                display: 'flex', gap: 2, flex: 1, minWidth: 0,
                overflowX: 'auto', overflowY: 'hidden', position: 'relative'
            }
        },
            groups.map(g => h('button', {
                key: g.id,
                ref: g.id === catFilter ? activeTabRef : undefined,
                onClick: () => setCatFilter(g.id),
                style: tabStyle(catFilter === g.id, c)
            }, g.label))
        ),
        edges.overflowing && arrowEl('›', edges.atEnd, () => page(1), c)
    );
}
