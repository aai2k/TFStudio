const { createElement: h, useEffect, useRef, useState } = React;

/** Width of the arrow column at the right edge of a hovered thickness cell (px). */
export const SPIN_WIDTH = 10;

// A held arrow waits long enough that a single click never steps twice, then
// steps twenty times a second until it is released.
const HOLD_DELAY_MS = 400;
const HOLD_REPEAT_MS = 50;

// Chromium reports one notch of a mouse wheel as 100 px of travel. Firefox, for
// the browser demo, reports lines instead, three to a notch.
const NOTCH_PX = 100;
const LINE_PX = NOTCH_PX / 3;

// Ctrl on Windows and Linux, Cmd on a Mac.
const stepModifiers = event => ({
    shiftKey: event.shiftKey,
    ctrlKey: event.ctrlKey || event.metaKey,
});

/**
 * True while a thickness cell in the element's document has its text input
 * open. A step then would be undone when that input commits the value it
 * opened with, so the arrows and the wheel leave the table alone until it
 * closes.
 */
function editOpen(element) {
    return element.ownerDocument.activeElement?.hasAttribute?.('data-thickness-edit') === true;
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

/**
 * Steps a thickness with the mouse wheel while the pointer is over the element
 * in `ref`, calling `onStep(ticks, modifiers)`. The listener is registered
 * directly, not through React, because React's wheel handlers are passive and
 * cannot call preventDefault, which is what stops the list scrolling, and
 * Ctrl+wheel zooming the page, under a step.
 */
export function useWheelStep(ref, enabled, onStep) {
    const onStepRef = useRef(onStep);
    onStepRef.current = onStep;
    useEffect(() => {
        const element = ref.current;
        if (!enabled || !element) return undefined;
        let carry = 0;
        const handleWheel = event => {
            const travel = wheelTravel(event);
            if (!travel || editOpen(element)) return;
            event.preventDefault();
            const result = wheelTicks(travel, carry);
            carry = result.carry;
            if (result.ticks) onStepRef.current(result.ticks, stepModifiers(event));
        };
        element.addEventListener('wheel', handleWheel, { passive: false });
        return () => element.removeEventListener('wheel', handleWheel);
    }, [ref, enabled]);
}

// One half of the arrow column. A press steps once, and a held press keeps
// stepping after a pause until the button is released. Clicks stop here so an
// arrow never changes the selection it is stepping. The repeat timers come
// from the window the arrow is drawn in: a Design Editor torn off into its own
// window would otherwise repeat at the rate of a minimized main window.
function SpinArrow({ direction, title, onStep, c }) {
    const [hover, setHover] = useState(false);
    const onStepRef = useRef(onStep);
    onStepRef.current = onStep;
    const timerRef = useRef(null);
    const stop = () => {
        const timer = timerRef.current;
        if (timer) {
            timer.view.clearTimeout(timer.id);
            timer.view.clearInterval(timer.id);
        }
        timerRef.current = null;
    };
    useEffect(() => stop, []);

    const start = event => {
        if (event.button !== 0 || editOpen(event.currentTarget)) return;
        event.stopPropagation();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        const modifiers = stepModifiers(event);
        const view = event.currentTarget.ownerDocument.defaultView;
        stop();
        onStepRef.current(direction, modifiers);
        const timer = { view, id: 0 };
        timer.id = view.setTimeout(() => {
            timer.id = view.setInterval(() => onStepRef.current(direction, modifiers), HOLD_REPEAT_MS);
        }, HOLD_DELAY_MS);
        timerRef.current = timer;
    };

    return h('div', {
        role: 'button', title, 'aria-label': title,
        onPointerDown: start,
        onPointerUp: stop,
        onPointerCancel: stop,
        onLostPointerCapture: stop,
        onPointerEnter: () => setHover(true),
        onPointerLeave: () => setHover(false),
        onClick: event => event.stopPropagation(),
        onDoubleClick: event => event.stopPropagation(),
        style: {
            flex: 1, minHeight: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
            color: hover ? c.text : c.textDim,
            backgroundColor: hover ? (c.hover || c.border) : 'transparent',
        },
    }, h('svg', { width: 7, height: 5, viewBox: '0 0 7 5', fill: 'none', style: { display: 'block' } },
        h('path', {
            d: direction > 0 ? 'M1 4L3.5 1.5 6 4' : 'M1 1l2.5 2.5L6 1',
            stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round',
        })));
}

/** Up and down arrows at the right edge of a hovered thickness cell. */
export function SpinArrows({ titles, onStep, c }) {
    return h('div', {
        style: {
            position: 'absolute', top: 0, right: 0, bottom: 0, width: SPIN_WIDTH,
            display: 'flex', flexDirection: 'column',
            borderLeft: `1px solid ${c.border}`,
        },
    },
        h(SpinArrow, { direction: 1, title: titles.up, onStep, c }),
        h(SpinArrow, { direction: -1, title: titles.down, onStep, c }));
}
