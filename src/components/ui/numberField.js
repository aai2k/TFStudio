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
 * outside `min`..`max` is clamped; text that is not a number puts the value
 * back. The up and down arrow keys step by `step` and apply at once.
 *
 * `positive` is for a quantity with no bound but zero, such as a wavelength or
 * a step: zero or a negative entry puts the value back, and the arrow keys stop
 * short of zero.
 *
 * `integer` is for a count: the entry is cut to a whole number, as a typed
 * 2.7 iterations is 2.
 *
 * `nullable` is for a quantity that can genuinely be unknown, such as a
 * substrate diameter nobody has measured: the field shows its placeholder, an
 * emptied field gives null instead of putting the value back, and stepping
 * from nothing starts at `emptyStep`.
 *
 * `useNumberField` returns the input's props for a field with its own look;
 * `NumberField` is the input itself, and passes any other prop, such as
 * `style`, `title`, `disabled` or `autoFocus`, to it as given.
 */

import { parseNumberStrict } from '../../utils/misc/numberParsing.js';

const { createElement: h, useState, useEffect } = React;

const textOf = value => (value == null ? '' : String(value));

export function useNumberField({
    value, onChange, min, max, step = 1, positive = false, integer = false,
    nullable = false, emptyStep = 0,
}) {
    const [raw, setRaw] = useState(textOf(value));
    useEffect(() => { setRaw(textOf(value)); }, [value]);
    const clamp = number => Math.min(Math.max(number, min ?? -Infinity), max ?? Infinity);
    const accepts = number => Number.isFinite(number) && (!positive || number > 0);
    const read = text => {
        const parsed = parseNumberStrict(text);
        return integer ? Math.trunc(parsed) : parsed;
    };
    const commit = () => {
        if (raw === textOf(value)) return;
        const parsed = read(raw);
        if (accepts(parsed)) {
            const next = clamp(parsed);
            setRaw(textOf(next));
            if (next !== value) onChange(next);
        } else if (nullable && raw.trim() === '') onChange(null);
        else setRaw(textOf(value));
    };
    const nudge = (direction) => {
        const parsed = read(raw);
        const from = Number.isFinite(parsed) ? parsed : value;
        // Nothing to step from: the first press lands ON emptyStep, which is
        // where the caller wants an empty field to start, not a step past it.
        // Stepping in binary leaves 0.30000000000000004 in the field.
        const next = from == null
            ? clamp(emptyStep)
            : clamp(Number((from + direction * step).toPrecision(12)));
        if (!accepts(next)) return;
        setRaw(String(next));
        onChange(next);
    };
    return {
        type: 'text', inputMode: 'decimal', value: raw,
        // See `.tfs-number` in styles.css.
        className: 'tfs-number',
        onChange: event => setRaw(event.target.value),
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
