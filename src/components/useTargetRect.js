// ── useTargetRect — track a DOM target's viewport rect ──────────────────────────
//
// Resolves a selector, or a list of them, to elements and returns their live
// bounding rect (or null if absent / zero-sized), with `element`, the first of
// them. A selector is a CSS selector string, which takes its first match, or
// `{ all: selector }`, which takes every match and joins their rects, as for the
// thickness cells of all the layers. In a list the first selector with an
// element on screen wins, so a step can point at a control and fall back to the
// window around it while the control is hidden. Shared by the guided tour
// (GuidedTour.js, modal spotlight) and the tutorial coach panel
// (TutorialPlayer.js, non-blocking ring).

const { useState, useCallback, useLayoutEffect, useEffect, useMemo, useRef } = React;

// How often the target is looked for again while a step shows: a tool window
// mounts some frames after its step starts, a control appears when the user
// opens its tab, and a window moves when a divider is dragged.
const POLL_MS = 250;

const selectorList = selector => (Array.isArray(selector) ? selector : (selector ? [selector] : []));

const onScreen = el => {
    const r = el?.getBoundingClientRect();
    return !!r && (r.width > 0 || r.height > 0);
};

// The elements of one selector that are on screen.
const shownBy = entry => (typeof entry === 'string'
    ? [document.querySelector(entry)]
    : [...document.querySelectorAll(entry.all)]).filter(onScreen);

// The elements of the first selector in `selectors` with any on screen.
function findTargets(selectors) {
    for (const entry of selectors) {
        const elements = shownBy(entry);
        if (elements.length) return elements;
    }
    return null;
}

// The rect that holds every element of `elements`.
function joinedRect(elements) {
    const rects = elements.map(el => el.getBoundingClientRect());
    const left = Math.min(...rects.map(r => r.left));
    const top = Math.min(...rects.map(r => r.top));
    const right = Math.max(...rects.map(r => r.right));
    const bottom = Math.max(...rects.map(r => r.bottom));
    return { top, left, right, bottom, width: right - left, height: bottom - top };
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
    const key = JSON.stringify(selectorList(selector));
    const selectors = useMemo(() => JSON.parse(key), [key]);
    // The element last shown, so it is scrolled into view once, when it
    // becomes the target, and the user's own scrolling is left alone after.
    const shownRef = useRef(null);

    const measure = useCallback(() => {
        const elements = findTargets(selectors);
        if (!elements) { shownRef.current = null; setRect(null); return; }
        const [element] = elements;
        if (element !== shownRef.current) {
            shownRef.current = element;
            try { element.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (_) {}
        }
        const r = joinedRect(elements);
        setRect(previous => (sameRect(previous, r) ? previous : { ...r, element }));
    }, [selectors]);

    useMeasureLoop(selectors.length > 0, measure);
    return rect;
}
