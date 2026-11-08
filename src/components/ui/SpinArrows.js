/**
 * Up and down step arrows at the right edge of a value, shown while the pointer
 * is over it: the Design Editor's thickness cells and the number fields.
 */

import { stepModifiers } from './wheelStep.js';

const { createElement: h, useEffect, useRef, useState } = React;

/** Width of the arrow column at the right edge of the value (px). */
export const SPIN_WIDTH = 10;

// A held arrow waits long enough that a single click never steps twice, then
// steps twenty times a second until it is released.
const HOLD_DELAY_MS = 400;
const HOLD_REPEAT_MS = 50;

// One half of the arrow column. A press steps once, and a held press keeps
// stepping after a pause until the button is released. Clicks stop here so an
// arrow never changes the selection it is stepping. The repeat timers come
// from the window the arrow is drawn in: a window torn off into its own
// window would otherwise repeat at the rate of a minimized main window.
function SpinArrow({ direction, title, onStep, blocked, c }) {
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
        if (event.button !== 0 || blocked?.(event.currentTarget)) return;
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

/**
 * The arrows, laid over the right edge of the positioned element they sit in.
 * `onStep(direction, modifiers)` steps once per press and repeatedly while one
 * is held; Shift and Ctrl scale the step as stepScale does. `titles` holds the
 * `up` and `down` tooltips. `blocked(element)`, when given, ignores a press
 * whenever it returns true.
 */
export function SpinArrows({ titles, onStep, blocked, c }) {
    return h('div', {
        style: {
            position: 'absolute', top: 0, right: 0, bottom: 0, width: SPIN_WIDTH,
            display: 'flex', flexDirection: 'column',
            borderLeft: `1px solid ${c.border}`,
        },
    },
        h(SpinArrow, { direction: 1, title: titles.up, onStep, blocked, c }),
        h(SpinArrow, { direction: -1, title: titles.down, onStep, blocked, c }));
}
