import { isPct } from './model.js';

const { createElement: h, useEffect, useRef, useState } = React;

export function Field({ label, c, tip, children }) {
    return h('label', {
        title: tip,
        style: { display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, color: c.textDim, cursor: tip ? 'help' : 'default' }
    },
        h('span', null, label),
        children
    );
}

// Editable numeric field with LOCAL text state. The old version was a
// controlled type=number that only committed finite numbers, so clearing the
// box (empty / "-" / "1.") never propagated and the value snapped back — making
// it impossible to delete and retype. This keeps the raw text while editing,
// commits only valid numbers upstream, and re-syncs from the external value
// when not focused. `inPct` shows/accepts percent (stores the 0..1 fraction).
export function NumberField({ value, onCommit, c, width = 64, inPct = false }) {
    const toDisp = (v) => (v == null || Number.isNaN(v))
        ? '' : String(inPct ? +(v * 100).toFixed(6) : v);
    const [text, setText] = useState(() => toDisp(value));
    const editingRef = useRef(false);

    // Re-sync from the external value, but never while the user is mid-edit
    // (otherwise their transient empty/partial text gets clobbered).
    useEffect(() => {
        if (!editingRef.current) setText(toDisp(value));
    }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

    const handle = (raw) => {
        setText(raw);
        // Transient states the user passes through while typing — don't commit.
        if (raw === '' || raw === '-' || raw === '.' || raw === '-.') return;
        const n = parseFloat(raw);
        if (Number.isFinite(n)) onCommit(inPct ? n / 100 : n);
    };

    return h('input', {
        type: 'text', inputMode: 'decimal',
        value: text,
        onFocus: () => { editingRef.current = true; },
        onBlur:  () => { editingRef.current = false; setText(toDisp(value)); },
        onChange: e => handle(e.target.value),
        style: { ...inpStyle(c), width },
    });
}

export function numInp(value, onChange, c) {
    return h(NumberField, { value, onCommit: onChange, c, width: 64 });
}

// Same as numInp but displays in % when meta.fmt = 'pct' (the user types 99 →
// the qualifier stores 0.99; vice versa on display).
export function numInpTarget(value, meta, onChange, c) {
    return h(NumberField, { value, onCommit: onChange, c, width: 70, inPct: isPct(meta) });
}

export function inpStyle(c) {
    return {
        background: c.bg, color: c.text, border: `1px solid ${c.border}`,
        borderRadius: 3, fontSize: 11, padding: '2px 5px', fontFamily: 'inherit',
        outline: 'none', width: 64,
    };
}
export function selStyle(c) {
    return {
        background: c.bg, color: c.text, border: `1px solid ${c.border}`,
        borderRadius: 3, fontSize: 11, padding: '2px 5px', fontFamily: 'inherit',
        outline: 'none',
    };
}
export function btnStyle(c) {
    return {
        background: c.bg, color: c.text, border: `1px solid ${c.border}`,
        borderRadius: 3, fontSize: 11, padding: '3px 10px', fontFamily: 'inherit',
        cursor: 'pointer', outline: 'none',
    };
}
