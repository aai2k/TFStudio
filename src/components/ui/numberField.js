/**
 * A number field that takes a comma or a dot as the decimal separator, on any
 * Windows locale.
 *
 * A text field rather than `type="number"`. A native number field reads the
 * decimal separator of the system locale and drops any other: on an English
 * Windows the comma never reaches the code, so 94,2 typed into it arrives as
 * 942, and on a Russian one a dot is refused and 0.4375 is shown as 0,4375.
 * TFStudio writes a dot everywhere and takes either separator on the way in.
 *
 * The value is taken on Enter or when the field is left, never while it is
 * being typed, so a half-typed number never reaches the calculation. An entry
 * outside `min`..`max` is clamped; text that is not a number is refused. Once
 * an entry is taken or refused the field shows the value it is given again, so
 * it always shows what the window keeps, even when the window rounds the entry
 * or holds it to a limit of its own. The up and down arrow keys step by `step`
 * and apply at once.
 *
 * `positive` is for a quantity with no bound but zero, such as a wavelength or
 * a step: zero or a negative entry is refused, and the arrow keys stop short of
 * zero.
 *
 * `integer` is for a count: the entry is cut to a whole number, as a typed
 * 2.7 iterations is 2.
 *
 * `nullable` is for a quantity that can genuinely be unknown, such as a
 * substrate diameter nobody has measured: the field shows its placeholder, an
 * emptied field gives null instead of being refused, and stepping from nothing
 * starts at `emptyStep`.
 *
 * `spin` steps the field as the Design Editor's thickness cells step. Up and
 * down arrows show at its right edge while the pointer is over it, and a held
 * arrow keeps stepping. The mouse wheel steps it while it has the focus and
 * holds no half-typed entry, and a wheel still scrolling the panel scrolls on
 * (wheelStep.js). A field the pointer only passes over is left alone, so
 * scrolling a panel of fields changes none of them. Arrows, wheel and arrow
 * keys step by `step`, Shift ten times as far, Ctrl a tenth as far. The arrows
 * are drawn in the colors `c`; `useNumberField` gives the wheel and the keys
 * only.
 *
 * A step calls `onChange(next, { continues })`, `continues` true when it
 * follows the field's last step within a second, from the value that step
 * wrote and under the same `burstKey`. A caller writing a design makes such a
 * step transient, so a wheel spin, a run of clicks or a held arrow is one undo
 * step, as for the Design Editor's thickness cells. `burstKey` names what the
 * field edits, such as the design and environment, so a step after switching
 * starts a new burst. A typed entry is an edit of its own, and a step that
 * moves nothing, at a bound, writes nothing.
 *
 * `useNumberField` returns the input's props for a field with its own look;
 * `NumberField` is the input itself, and passes any other prop, such as
 * `style`, `title`, `disabled` or `autoFocus`, to it as given. A box that keeps
 * its own text, such as one that previews every keystroke, steps with
 * `stepKeys`.
 */

import { parseNumberStrict } from '../../utils/misc/numberParsing.js';
import { getCurrentLocale, getLocale } from '../../constants/locales/index.js';
import { SPIN_WIDTH, SpinArrows } from './SpinArrows.js';
import { stepModifiers, stepScale, useWheelStep } from './wheelStep.js';

const { createElement: h, useRef, useState } = React;

// A pause this long between steps ends a burst, as it does for the thickness
// cells (useThicknessStep.js).
const BURST_GAP_MS = 1000;

/**
 * The options updateDesign takes for a number field's step: a step that
 * continues a burst is transient, so the burst is one undo step.
 */
export const stepWriteOptions = step => (step?.continues ? { transient: true, compareDirty: true } : undefined);

const textOf = value => (value == null ? '' : String(value));
const clampTo = (number, min, max) => Math.min(Math.max(number, min ?? -Infinity), max ?? Infinity);
const accepts = (number, positive) => Number.isFinite(number) && (!positive || number > 0);

// One arrow-key step from `from`, within the bounds, or null when the step is
// refused. Stepping in binary leaves 0.30000000000000004 in the field, hence
// the rounding to 12 significant figures.
function stepNumber(from, direction, { step = 1, min, max, positive = false }) {
    const next = clampTo(Number((from + direction * step).toPrecision(12)), min, max);
    return accepts(next, positive) ? next : null;
}

/**
 * The arrow keys for a box that keeps its own text: an onKeyDown that moves
 * `text` one `step` up or down within `min`, `max` and `positive`, and hands
 * the result to `setText` as text. Text that is not a number is left alone.
 */
export function stepKeys(text, setText, bounds = {}) {
    return (event) => {
        const direction = { ArrowUp: 1, ArrowDown: -1 }[event.key];
        if (!direction) return;
        event.preventDefault();
        const from = parseNumberStrict(text);
        const next = Number.isFinite(from) ? stepNumber(from, direction, bounds) : null;
        if (next != null) setText(String(next));
    };
}

/**
 * The value `ticks` steps move `from` to, up for positive ticks, or null when
 * the step is refused. `modifiers` scale the step as stepScale does; a count
 * never steps by less than one.
 */
export function stepValue(from, ticks, modifiers, { step = 1, min, max, positive = false, integer = false }) {
    const scaled = step * stepScale(modifiers);
    const size = (integer ? Math.max(1, Math.round(scaled)) : scaled) * Math.abs(ticks);
    return stepNumber(from, Math.sign(ticks), { step: size, min, max, positive });
}

const notFocused = element => element.ownerDocument.activeElement !== element;

// `stepTo(from, next)`, which hands a step to `onChange` with whether it
// continues a burst, and returns whether it did. A step that is refused
// (null) or leaves `value` as it is writes nothing, and keeps a burst held at
// a bound going. The last step is `{ at, key, next }`; each is drawn before
// the next tick arrives, so a field showing anything but `next`, after an
// undo or an edit elsewhere, has left the burst.
function useStepBursts(onChange, burstKey, value) {
    const burstRef = useRef(null);
    return (from, next) => {
        const now = performance.now();
        if (next == null || next === value) {
            if (burstRef.current) burstRef.current.at = now;
            return false;
        }
        const last = burstRef.current;
        const sameBurst = !!last && last.key === burstKey && now - last.at <= BURST_GAP_MS;
        burstRef.current = { at: now, key: burstKey, next };
        ReactDOM.flushSync(() => onChange(next, { continues: sameBurst && from === last.next }));
        return true;
    };
}

// The input's props, and `nudge(direction, modifiers)`, which steps from the
// half-typed entry when there is one and from the value otherwise.
function useField({
    value, onChange, min, max, step = 1, positive = false, integer = false,
    nullable = false, emptyStep = 0, spin = false, burstKey,
}) {
    // What is being typed, or null while the field shows `value`.
    const [draft, setDraft] = useState(null);
    const stepTo = useStepBursts(onChange, burstKey, value);
    const read = (text) => {
        const parsed = parseNumberStrict(text);
        return integer ? Math.trunc(parsed) : parsed;
    };
    const commit = () => {
        if (draft == null) return;
        setDraft(null);
        const parsed = read(draft);
        if (accepts(parsed, positive)) {
            const next = clampTo(parsed, min, max);
            if (next !== value) onChange(next);
        } else if (nullable && draft.trim() === '' && value != null) onChange(null);
    };
    const nudge = (direction, modifiers = {}) => {
        const parsed = draft == null ? NaN : read(draft);
        const from = Number.isFinite(parsed) ? parsed : value;
        // Nothing to step from: the first press lands ON emptyStep, which is
        // where the caller wants an empty field to start, not a step past it.
        const next = from == null
            ? stepNumber(emptyStep, 0, { min, max, positive })
            : stepValue(from, direction, modifiers, { step, min, max, positive, integer });
        // A step taken shows the value it wrote in place of what was typed.
        if (stepTo(from, next)) setDraft(null);
    };
    const ref = useRef(null);
    useWheelStep(ref, spin && draft == null && value != null, (ticks, modifiers) => {
        stepTo(value, stepValue(value, ticks, modifiers, { step, min, max, positive, integer }));
    }, { blocked: notFocused });
    const props = {
        ...(spin ? { ref } : {}),
        type: 'text', inputMode: 'decimal', value: draft ?? textOf(value),
        // See `.tfs-number` in styles.css.
        className: 'tfs-number',
        onChange: event => setDraft(event.target.value),
        onBlur: commit,
        onKeyDown: (event) => {
            const direction = { ArrowUp: 1, ArrowDown: -1 }[event.key];
            if (event.key === 'Enter') commit();
            else if (direction) {
                event.preventDefault();
                nudge(direction, spin ? stepModifiers(event) : {});
            }
        },
    };
    return { props, nudge };
}

export function useNumberField(options) {
    return useField(options).props;
}

// `style` with a `padding` shorthand written as its four sides, the right one
// `right` when given. The arrows' room is a right padding set and taken away
// on every hover. Over a shorthand, taking it away leaves no right padding at
// all: React deletes the paddingRight it set and does not write the unchanged
// shorthand again. With four sides in every state only their values change.
export function sidePadding(style, right) {
    const { padding, ...rest } = style || {};
    if (padding == null) return right == null ? rest : { ...rest, paddingRight: right };
    const parts = typeof padding === 'number' ? [padding] : String(padding).trim().split(/\s+/);
    const [top, side = top, bottom = top, left = side] = parts;
    return { ...rest, paddingTop: top, paddingRight: right ?? side, paddingBottom: bottom, paddingLeft: left };
}

// A `spin` field: the input, with the arrows over its right edge while the
// pointer is over it and the text moved clear of them. A press on an arrow
// keeps the focus in the field, or puts it there, so a half-typed entry steps
// from what is typed and the wheel steps the field next.
function SpinInput({ input, onStep, c }) {
    const [hover, setHover] = useState(false);
    const shown = hover && !input.disabled;
    const { stepUp, stepDown } = getLocale(getCurrentLocale()).numberField;
    return h('span', {
        style: { position: 'relative', display: 'inline-flex', flexShrink: 0 },
        onMouseEnter: () => setHover(true),
        onMouseLeave: () => setHover(false),
        onMouseDown: (event) => {
            const field = input.ref.current;
            if (!field || event.target === field) return;
            event.preventDefault();
            field.focus();
        },
    },
        h('input', { ...input, style: sidePadding(input.style, shown ? SPIN_WIDTH + 2 : undefined) }),
        shown && h(SpinArrows, { titles: { up: stepUp, down: stepDown }, onStep, c }));
}

export function NumberField({
    value, onChange, min, max, step, positive, integer, nullable, emptyStep, spin, burstKey, c, ...rest
}) {
    const field = useField({ value, onChange, min, max, step, positive, integer, nullable, emptyStep, spin, burstKey });
    const input = { ...rest, ...field.props };
    return spin ? h(SpinInput, { input, onStep: field.nudge, c }) : h('input', input);
}
