/**
 * The text editor a grid cell opens while it is being typed into. It commits
 * when it loses focus or on Enter, Tab or an up or down arrow, which also move
 * on to the next cell, and Escape leaves the cell as it was.
 *
 * It opens with its text selected, so typing replaces it. `typed` is for an
 * editor opened by a key typed on the cell: that key is its text, and the caret
 * goes after it so the next key adds to it.
 */
const { createElement: h, useState, useEffect, useRef, useCallback } = React;

export function CellInput({ initValue, onCommit, onCancel, onNavigate, c, typed = false }) {
    const [draft, setDraft] = useState(initValue);
    const ref = useRef(null);
    useEffect(() => {
        const input = ref.current;
        if (!input) return;
        input.focus();
        if (typed) input.setSelectionRange(input.value.length, input.value.length);
        else input.select();
    }, []);
    const commit = useCallback(() => onCommit(draft), [draft, onCommit]);

    return h('input', {
        ref,
        value: draft,
        onChange: event => setDraft(event.target.value),
        onBlur: commit,
        onKeyDown: event => {
            if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); commit(); onNavigate('down'); }
            if (event.key === 'Tab') { event.preventDefault(); event.stopPropagation(); commit(); onNavigate(event.shiftKey ? 'left' : 'right'); }
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel(); }
            if (event.key === 'ArrowDown') { event.preventDefault(); event.stopPropagation(); commit(); onNavigate('down'); }
            if (event.key === 'ArrowUp') { event.preventDefault(); event.stopPropagation(); commit(); onNavigate('up'); }
        },
        style: {
            width: '100%', background: c.bg, color: c.text,
            border: `1px solid ${c.accent}`, borderRadius: 2,
            fontSize: 11, padding: '1px 3px', fontFamily: 'inherit',
            outline: 'none', boxSizing: 'border-box',
        },
    });
}
