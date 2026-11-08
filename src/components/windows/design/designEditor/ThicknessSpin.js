import { stepModifiers } from '../../../ui/wheelStep.js';

const { createElement: h, useEffect, useRef, useState } = React;

/** Width of the arrow column at the right edge of a hovered thickness cell (px). */
export const SPIN_WIDTH = 10;

// A held arrow waits long enough that a single click never steps twice, then
// steps twenty times a second until it is released.
const HOLD_DELAY_MS = 400;
const HOLD_REPEAT_MS = 50;

/**
 * True while a thickness cell in the element's document has its text input
 * open. A step then would be undone when that input commits the value it
 * opened with, so the arrows and the wheel leave the table alone until it
 * closes.
 */
export function editOpen(element) {
    return element.ownerDocument.activeElement?.hasAttribute?.('data-thickness-edit') === true;
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
