// ── useTargetRect — track a DOM target's viewport rect ──────────────────────────
//
// Resolves a CSS selector, or a list of them, to an element and returns its live
// bounding rect (or null if absent / zero-sized). In a list the first selector
// whose element is on screen wins, so a step can point at a control and fall
// back to the window around it while the control is hidden. Shared by the
// guided tour (GuidedTour.js, modal spotlight) and the tutorial coach panel
// (TutorialPlayer.js, non-blocking ring).

const { useState, useCallback, useLayoutEffect, useEffect, useMemo, useRef } = React;

// How often the target is looked for again while a step shows: a tool window
// mounts some frames after its step starts, a control appears when the user
// opens its tab, and a window moves when a divider is dragged.
const POLL_MS = 250;

const selectorList = selector => (Array.isArray(selector) ? selector : (selector ? [selector] : []));

// The first element of `selectors` that is on screen.
function findTarget(selectors) {
    for (const selector of selectors) {
        const el = document.querySelector(selector);
        const r = el?.getBoundingClientRect();
        if (r && (r.width || r.height)) return el;
    }
    return null;
}

const RECT_SIDES = ['top', 'left', 'width', 'height'];
const sameRect = (a, b) => !!a && RECT_SIDES.every(side => a[side] === b[side]);

// Runs `measure` now and on the next frame (ribbon/explorer layout can settle
// a tick after a scrollIntoView nudge or a freshly-opened tool window), every
// POLL_MS while there is a target to look for, and on resize and scroll.
function useMeasureLoop(active, measure) {
    useLayoutEffect(() => {
        measure();
        const raf = requestAnimationFrame(measure);
        return () => cancelAnimationFrame(raf);
    }, [measure]);
    useEffect(() => {
        const poll = active ? setInterval(measure, POLL_MS) : null;
        window.addEventListener('resize', measure);
        window.addEventListener('scroll', measure, true);
        return () => {
            clearInterval(poll);
            window.removeEventListener('resize', measure);
            window.removeEventListener('scroll', measure, true);
        };
    }, [active, measure]);
}

export function useTargetRect(selector) {
    const [rect, setRect] = useState(null);
    const key = selectorList(selector).join('\n');
    const selectors = useMemo(() => (key ? key.split('\n') : []), [key]);
    // The element last shown, so it is scrolled into view once, when it
    // becomes the target, and the user's own scrolling is left alone after.
    const shownRef = useRef(null);

    const measure = useCallback(() => {
        const el = findTarget(selectors);
        if (!el) { shownRef.current = null; setRect(null); return; }
        if (el !== shownRef.current) {
            shownRef.current = el;
            try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (_) {}
        }
        const r = el.getBoundingClientRect();
        setRect(previous => (sameRect(previous, r) ? previous
            : { top: r.top, left: r.left, width: r.width, height: r.height, right: r.right, bottom: r.bottom }));
    }, [selectors]);

    useMeasureLoop(selectors.length > 0, measure);
    return rect;
}
