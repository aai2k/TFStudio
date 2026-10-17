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
 * `useNumberField` returns the input's props for a field with its own look;
 * `NumberField` is the input itself, and passes any other prop, such as
 * `style`, `title`, `disabled` or `autoFocus`, to it as given. A box that keeps
 * its own text, such as one that previews every keystroke, steps with
 * `steppedText`.
 */

import { parseNumberStrict } from '../../utils/misc/numberParsing.js';

const { createElement: h, useState } = React;

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
 * `text` moved one `step` up (`direction` 1) or down (-1) within `min`, `max`
 * and `positive`, as text, or null when the text is not a number or the step
 * is refused.
 */
export function steppedText(text, direction, bounds = {}) {
    const from = parseNumberStrict(text);
    if (!Number.isFinite(from)) return null;
    const next = stepNumber(from, direction, bounds);
    return next == null ? null : String(next);
}

export function useNumberField({
    value, onChange, min, max, step = 1, positive = false, integer = false,
    nullable = false, emptyStep = 0,
}) {
    // What is being typed, or null while the field shows `value`.
    const [draft, setDraft] = useState(null);
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
    const nudge = (direction) => {
        const parsed = draft == null ? NaN : read(draft);
        const from = Number.isFinite(parsed) ? parsed : value;
        // Nothing to step from: the first press lands ON emptyStep, which is
        // where the caller wants an empty field to start, not a step past it.
        const next = from == null
            ? stepNumber(emptyStep, 0, { min, max, positive })
            : stepNumber(from, direction, { step, min, max, positive });
        if (next == null) return;
        setDraft(null);
        onChange(next);
    };
    return {
        type: 'text', inputMode: 'decimal', value: draft ?? textOf(value),
        // See `.tfs-number` in styles.css.
        className: 'tfs-number',
        onChange: event => setDraft(event.target.value),
        onBlur: commit,
        onKeyDown: (event) => {
            if (event.key === 'Enter') commit();
            else if (event.key === 'ArrowUp') { event.preventDefault(); nudge(1); }
            else if (event.key === 'ArrowDown') { event.preventDefault(); nudge(-1); }
        },
    };
}

export function NumberField({
    value, onChange, min, max, step, positive, integer, nullable, emptyStep, ...rest
}) {
    return h('input', {
        ...rest,
        ...useNumberField({ value, onChange, min, max, step, positive, integer, nullable, emptyStep }),
    });
}
