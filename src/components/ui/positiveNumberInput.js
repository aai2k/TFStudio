/**
 * A number field that takes every keystroke, for a quantity whose only bound is
 * zero, such as a wavelength.
 *
 * What is typed stays in the field while it is typed, so an entry can pass
 * through "" or "0." on its way to 0.5. Only a positive number reaches
 * `onChange`, and leaving the field shows the value it holds.
 */

const { createElement: h, useState } = React;

export function PositiveNumberInput({ value, onChange, ...rest }) {
    const [text, setText] = useState(null);
    return h('input', {
        ...rest,
        type: 'number',
        value: text ?? value,
        onChange: (e) => {
            setText(e.target.value);
            const v = parseFloat(e.target.value);
            if (v > 0) onChange(v);
        },
        onBlur: () => setText(null),
    });
}
