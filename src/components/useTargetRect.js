// ── useTargetRect — track a DOM target's viewport rect ──────────────────────────
//
// Resolves a CSS selector to an element and returns its live bounding rect
// (or null if absent / zero-sized). Re-measures on selector change, window
// resize and scroll, and nudges the target into view first. Shared by the
// guided tour (GuidedTour.js, modal spotlight) and the tutorial coach panel
// (TutorialPlayer.js, non-blocking ring).

const { useState, useCallback, useLayoutEffect, useEffect } = React;

export function useTargetRect(selector) {
    const [rect, setRect] = useState(null);

    const measure = useCallback(() => {
        const el = selector ? document.querySelector(selector) : null;
        if (!el) { setRect(null); return; }
        try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (_) {}
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) { setRect(null); return; }
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height,
                  right: r.right, bottom: r.bottom });
    }, [selector]);

    useLayoutEffect(() => {
        measure();
        // Re-measure next frame: ribbon/explorer layout can settle a tick after
        // a scrollIntoView nudge or a freshly-opened tool window.
        const raf = requestAnimationFrame(measure);
        return () => cancelAnimationFrame(raf);
    }, [measure]);

    useEffect(() => {
        const on = () => measure();
        window.addEventListener('resize', on);
        window.addEventListener('scroll', on, true);
        return () => {
            window.removeEventListener('resize', on);
            window.removeEventListener('scroll', on, true);
        };
    }, [measure]);

    return rect;
}
