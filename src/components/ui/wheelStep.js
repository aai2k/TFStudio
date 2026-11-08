/**
 * Stepping a value with the mouse wheel, shared by the Design Editor's
 * thickness cells and the number fields.
 *
 * A notch of the wheel is one step, away from the user up and towards the user
 * down. Shift steps ten times as far, Ctrl (Cmd on a Mac) a tenth as far. A
 * wheel that is still scrolling the panel scrolls on when a field is carried
 * under the pointer, and steps it only after a pause or a click.
 */

const { useEffect, useRef } = React;

// Chromium reports one notch of a mouse wheel as 100 px of travel. Firefox, for
// the browser demo, reports lines instead, three to a notch.
const NOTCH_PX = 100;
const LINE_PX = NOTCH_PX / 3;

// Ticks within one wheel spin arrive tens of milliseconds apart, so a second
// without one ends the scroll. The same pause ends a burst of thickness steps
// (useThicknessStep.js).
const SCROLL_GAP_MS = 1000;

/** The modifier keys of a step: Shift for ten times, Ctrl or Cmd for a tenth. */
export const stepModifiers = event => ({
    shiftKey: event.shiftKey,
    ctrlKey: event.ctrlKey || event.metaKey,
});

/** How far `modifiers` scale a step: Shift ten times, Ctrl a tenth. */
export function stepScale({ shiftKey = false, ctrlKey = false } = {}) {
    return (shiftKey ? 10 : 1) / (ctrlKey ? 10 : 1);
}

/**
 * Wheel travel of one event in px, positive for a wheel turned away from the
 * user. Shift+wheel arrives as a sideways scroll on Windows, so with Shift held
 * the sideways delta counts when the vertical one is zero.
 */
export function wheelTravel(event) {
    const delta = event.deltaY !== 0 ? event.deltaY : (event.shiftKey ? event.deltaX : 0);
    const scale = event.deltaMode === 1 ? LINE_PX : (event.deltaMode === 2 ? NOTCH_PX : 1);
    return delta === 0 ? 0 : -delta * scale;
}

/**
 * Steps a wheel event is worth, with the travel `carry` held over from the
 * events before it. A notch is one step and several notches arriving in one
 * event are several. A notch a little off 100 px, as on a zoomed page, still
 * counts once, and a wheel or touchpad that sends a notch in small pieces steps
 * when they add up to three quarters of one. Returns `{ ticks, carry }`, ticks
 * signed like the travel.
 */
export function wheelTicks(travel, carry) {
    const total = Math.sign(travel) === Math.sign(carry) ? carry + travel : travel;
    const ticks = Math.sign(total) * Math.floor(Math.abs(total) / NOTCH_PX + 0.25) || 0;
    return { ticks, carry: ticks ? 0 : total };
}

const scrollLatches = new WeakMap();

/**
 * When the wheel last scrolled rather than stepped, per document. A wheel event
 * no stepping element took is left to scroll; a press anywhere ends that
 * scroll, so an element clicked straight after it steps at the next tick.
 */
function scrollLatch(doc) {
    let latch = scrollLatches.get(doc);
    if (!latch) {
        const created = { lastScroll: -Infinity };
        doc.addEventListener('wheel', event => {
            if (!event.defaultPrevented) created.lastScroll = event.timeStamp;
        }, { passive: true });
        doc.addEventListener('pointerdown', () => { created.lastScroll = -Infinity; },
            { capture: true, passive: true });
        scrollLatches.set(doc, created);
        latch = created;
    }
    return latch;
}

/**
 * Steps a value with the mouse wheel while the pointer is over the element in
 * `ref`, calling `onStep(ticks, modifiers)`. `blocked(element)`, when given,
 * leaves a wheel event to scroll whenever it returns true. The listener is
 * registered directly, not through React, because React's wheel handlers are
 * passive and cannot call preventDefault, which is what stops the panel
 * scrolling, and Ctrl+wheel zooming the page, under a step.
 */
export function useWheelStep(ref, enabled, onStep, { blocked } = {}) {
    const onStepRef = useRef(onStep);
    onStepRef.current = onStep;
    const blockedRef = useRef(blocked);
    blockedRef.current = blocked;
    useEffect(() => {
        const element = ref.current;
        if (!enabled || !element) return undefined;
        const latch = scrollLatch(element.ownerDocument);
        let carry = 0;
        const handleWheel = event => {
            const travel = wheelTravel(event);
            if (!travel || blockedRef.current?.(element)) return;
            if (event.timeStamp - latch.lastScroll < SCROLL_GAP_MS) return;
            event.preventDefault();
            const result = wheelTicks(travel, carry);
            carry = result.carry;
            if (result.ticks) onStepRef.current(result.ticks, stepModifiers(event));
        };
        element.addEventListener('wheel', handleWheel, { passive: false });
        return () => element.removeEventListener('wheel', handleWheel);
    }, [ref, enabled]);
}
