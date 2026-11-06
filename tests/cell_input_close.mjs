/**
 * A key that closes a cell's text editor is the editor's only close: the blur
 * after it commits nothing.
 *
 * A table takes the keyboard focus back as a key closes the editor, while the
 * editor's input is still on the page, and the input commits when it loses the
 * focus. So Escape, which leaves the cell as it was, committed what was typed
 * after all, as it did in the curve editor, and Enter, Tab, Up and Down
 * committed twice. A blur with no key before it, from a click elsewhere, still
 * commits.
 * Run: node tests/cell_input_close.mjs
 */
import assert from 'node:assert/strict';
import { makeEffectRuntime } from './_effectRuntime.mjs';

// The editor is drawn with a React that hands back plain elements, so its
// input's handlers can be called the way the browser calls them.
const inputReact = makeEffectRuntime({
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
});
const realReact = globalThis.React;
globalThis.React = inputReact;
const { CellInput } = await import('../src/components/ui/grid/CellInput.js?close');
globalThis.React = realReact;

const c = { bg: '#fff', text: '#000', accent: '#06c' };
const keyEvent = (key, shiftKey = false) => ({ key, shiftKey, preventDefault() {}, stopPropagation() {} });

// An editor opened on a cell holding 5, with 7 typed over it. `log` gets what
// it tells the table.
function typedSeven(log) {
    inputReact.unmount();
    const props = {
        initValue: '5', c,
        onCommit: draft => log.push(['commit', draft]),
        onCancel: () => log.push(['cancel']),
        onNavigate: direction => log.push(['move', direction]),
    };
    const draw = () => inputReact.run(() => CellInput(props));
    draw().props.onChange({ target: { value: '7' } });
    return draw();
}

{
    const log = [];
    const input = typedSeven(log);
    input.props.onKeyDown(keyEvent('Escape'));
    input.props.onBlur();
    assert.deepEqual(log, [['cancel']], 'Escape commits nothing, and neither does the blur after it');
}

for (const [key, shift, direction] of [
    ['Enter', false, 'down'], ['ArrowDown', false, 'down'], ['ArrowUp', false, 'up'],
    ['Tab', false, 'right'], ['Tab', true, 'left'],
]) {
    const log = [];
    const input = typedSeven(log);
    input.props.onKeyDown(keyEvent(key, shift));
    input.props.onBlur();
    assert.deepEqual(log, [['commit', '7'], ['move', direction]],
        `${shift ? 'Shift+' : ''}${key} commits once and moves ${direction}`);
}

{
    const log = [];
    const input = typedSeven(log);
    input.props.onBlur();
    assert.deepEqual(log, [['commit', '7']], 'a blur alone, from a click elsewhere, commits');
}

{
    const log = [];
    const input = typedSeven(log);
    input.props.onKeyDown(keyEvent('ArrowLeft'));
    assert.deepEqual(log, [], 'Left stays in the text');
    input.props.onBlur();
    assert.deepEqual(log, [['commit', '7']], 'and leaves the blur to commit');
}

inputReact.unmount();
console.log('cell_input_close: passed');
