/**
 * The text editor a grid cell opens while it is being typed into. It commits
 * when it loses focus or on Enter, Tab or an up or down arrow, which also move
 * on to the next cell, and Escape leaves the cell as it was.
 *
 * It opens with its text selected, so typing replaces it. `typed` is for an
 * editor opened by a key typed on the cell: that key is its text, and the caret
 * goes after it so the next key adds to it.
 *
 * A table takes the keyboard focus back as a key closes the editor, while this
 * input is still on the page. The blur that follows is part of that close and
 * commits nothing: after Escape the cell keeps its value, and after the other
 * keys the value is committed once.
 */
const { createElement: h, useState, useEffect, useRef, useCallback } = React;

// The keys that commit, and the way each moves on from the cell. Escape closes
// the editor where it is and commits nothing.
const MOVES = {
    Enter: () => 'down',
    ArrowDown: () => 'down',
    ArrowUp: () => 'up',
    Tab: event => (event.shiftKey ? 'left' : 'right'),
};

export function CellInput({ initValue, onCommit, onCancel, onNavigate, c, typed = false }) {
    const [draft, setDraft] = useState(initValue);
    const ref = useRef(null);
    const closedByKey = useRef(false);
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
        onBlur: () => { if (!closedByKey.current) commit(); },
        onKeyDown: event => {
            const move = MOVES[event.key];
            if (!move && event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            closedByKey.current = true;
            if (!move) { onCancel(); return; }
            commit();
            onNavigate(move(event));
        },
        style: {
            width: '100%', background: c.bg, color: c.text,
            border: `1px solid ${c.accent}`, borderRadius: 2,
            fontSize: 11, padding: '1px 3px', fontFamily: 'inherit',
            outline: 'none', boxSizing: 'border-box',
        },
    });
}
