/**
 * useTableShortcuts hook — key-routing tests.
 *
 * Run: node tests/table_shortcuts.mjs
 *
 * The hook is the shared Ins / Shift+Ins / Del / Ctrl+D handler used by the
 * Design Editor layer table, the Merit Function Editor operand table, and the
 * Specification qualifier table. It owns no state — it just
 * routes DOM key events to host-provided callbacks. These tests:
 *
 *   • Verify each key dispatches the right callback with the right index.
 *   • Verify it ignores events sourced from <input>/<textarea>/<select>
 *     and contentEditable, so typing inside a row cell never triggers
 *     a row-level Insert/Delete.
 *   • Verify locked-row delete is blocked and routes through onBlockedDelete.
 *   • Verify the "no focus" path: Insert without a focused row inserts at
 *     the end of the list; Delete with no focus is a no-op.
 */

// Provide a minimal global React stub so the hook (which destructures
// useCallback off `React`) loads without a real React install.
globalThis.React = {
    useCallback: (fn /*, deps */) => fn,
};

const { useTableShortcuts } = await import('../src/hooks/useTableShortcuts.js');

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };

function makeEvent(opts) {
    let prevented = false;
    return {
        key: opts.key,
        shiftKey: !!opts.shift,
        ctrlKey:  !!opts.ctrl,
        metaKey:  !!opts.meta,
        altKey:   !!opts.alt,
        target: opts.target || { tagName: 'DIV', isContentEditable: false },
        preventDefault() { prevented = true; },
        get prevented() { return prevented; },
    };
}

function makeHost(opts = {}) {
    const calls = [];
    const rows = opts.rows || [{ id: 'r1' }, { id: 'r2', locked: true }, { id: 'r3' }];
    const { onKeyDown } = useTableShortcuts({
        focusIdx: opts.focusIdx !== undefined ? opts.focusIdx : 0,
        rows,
        isLocked: opts.isLocked,
        onInsertAbove: (i) => calls.push(['above', i]),
        onInsertBelow: (i) => calls.push(['below', i]),
        onDelete:      (i) => calls.push(['delete', i]),
        onDuplicate:   (i) => calls.push(['dup', i]),
        onBlockedDelete: () => calls.push(['blocked']),
    });
    return { onKeyDown, calls, rows };
}

// ── 1. Insert (above) routes to onInsertAbove with focusIdx ────────────────
console.log('— Insert above —');
{
    const host = makeHost({ focusIdx: 2 });
    const e = makeEvent({ key: 'Insert' });
    host.onKeyDown(e);
    ok(e.prevented, 'preventDefault called for Insert');
    ok(host.calls.length === 1 && host.calls[0][0] === 'above' && host.calls[0][1] === 2,
       'onInsertAbove(2)');
}

// ── 2. Shift+Insert routes to onInsertBelow ────────────────────────────────
console.log('— Shift+Insert below —');
{
    const host = makeHost({ focusIdx: 1 });
    const e = makeEvent({ key: 'Insert', shift: true });
    host.onKeyDown(e);
    ok(e.prevented, 'preventDefault called for Shift+Insert');
    ok(host.calls.length === 1 && host.calls[0][0] === 'below' && host.calls[0][1] === 1,
       'onInsertBelow(1)');
}

// ── 3. Delete on UNLOCKED row routes to onDelete ───────────────────────────
console.log('— Delete unlocked —');
{
    const host = makeHost({ focusIdx: 0 }); // r1, not locked
    const e = makeEvent({ key: 'Delete' });
    host.onKeyDown(e);
    ok(e.prevented, 'preventDefault called for Delete');
    ok(host.calls.length === 1 && host.calls[0][0] === 'delete' && host.calls[0][1] === 0,
       'onDelete(0)');
}

// ── 4. Delete on LOCKED row routes to onBlockedDelete only ─────────────────
console.log('— Delete locked —');
{
    const host = makeHost({ focusIdx: 1 }); // r2, locked
    const e = makeEvent({ key: 'Delete' });
    host.onKeyDown(e);
    ok(e.prevented, 'preventDefault called even when blocked');
    ok(host.calls.length === 1 && host.calls[0][0] === 'blocked',
       'onBlockedDelete (not onDelete)');
}

// ── 5. Ctrl+D routes to onDuplicate ────────────────────────────────────────
console.log('— Ctrl+D duplicate —');
{
    const host = makeHost({ focusIdx: 2 });
    const e = makeEvent({ key: 'd', ctrl: true });
    host.onKeyDown(e);
    ok(e.prevented, 'preventDefault called for Ctrl+D');
    ok(host.calls.length === 1 && host.calls[0][0] === 'dup' && host.calls[0][1] === 2,
       'onDuplicate(2)');
}

// ── 6. Cmd+D (metaKey) also routes to duplicate ────────────────────────────
console.log('— Cmd+D duplicate (Mac) —');
{
    const host = makeHost({ focusIdx: 0 });
    const e = makeEvent({ key: 'D', meta: true });
    host.onKeyDown(e);
    ok(host.calls.length === 1 && host.calls[0][0] === 'dup',
       'onDuplicate fires on metaKey+D');
}

// ── 7. Ctrl+Shift+D does NOT fire duplicate (avoids browser shortcut) ──────
console.log('— Ctrl+Shift+D is ignored —');
{
    const host = makeHost({ focusIdx: 0 });
    const e = makeEvent({ key: 'D', ctrl: true, shift: true });
    host.onKeyDown(e);
    ok(host.calls.length === 0, 'Ctrl+Shift+D does not duplicate');
}

// ── 8. Events from INPUT/TEXTAREA/SELECT are ignored ───────────────────────
console.log('— Editing inside input is ignored —');
{
    const host = makeHost({ focusIdx: 0 });
    for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
        const e = makeEvent({ key: 'Delete', target: { tagName: tag } });
        host.onKeyDown(e);
        ok(!e.prevented, `Delete inside <${tag}> not intercepted`);
    }
    const e2 = makeEvent({ key: 'Insert', target: { tagName: 'DIV', isContentEditable: true } });
    host.onKeyDown(e2);
    ok(!e2.prevented, 'Insert inside contentEditable not intercepted');
    ok(host.calls.length === 0, 'No callbacks fired from editing context');
}

// ── 9. Insert with NO focus falls back to "end of list" ────────────────────
console.log('— Insert with no focus —');
{
    const host = makeHost({ focusIdx: -1 });
    const e = makeEvent({ key: 'Insert' });
    host.onKeyDown(e);
    // rows.length - 1 = 2 (three rows)
    ok(host.calls.length === 1 && host.calls[0][0] === 'above' && host.calls[0][1] === 2,
       'onInsertAbove(rows.length-1) when no focus');
}

// ── 10. Delete with NO focus is a no-op ────────────────────────────────────
console.log('— Delete with no focus —');
{
    const host = makeHost({ focusIdx: -1 });
    const e = makeEvent({ key: 'Delete' });
    host.onKeyDown(e);
    ok(!e.prevented && host.calls.length === 0, 'Delete with no focus = no-op');
}

// ── 11. Custom isLocked predicate is honored ───────────────────────────────
console.log('— Custom isLocked —');
{
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const host = makeHost({
        rows,
        focusIdx: 1,
        isLocked: (r) => r.id === 'b',     // mark "b" locked even though no .locked flag
    });
    const e = makeEvent({ key: 'Delete' });
    host.onKeyDown(e);
    ok(host.calls.length === 1 && host.calls[0][0] === 'blocked',
       'custom isLocked predicate blocks delete');
}

// ── 12. Unrelated keys are ignored (no preventDefault) ─────────────────────
console.log('— Unrelated keys —');
{
    const host = makeHost({ focusIdx: 0 });
    for (const k of ['a', 'Tab', 'Enter', 'ArrowDown', 'F2', 'Escape']) {
        const e = makeEvent({ key: k });
        host.onKeyDown(e);
        ok(!e.prevented, `key "${k}" not intercepted`);
    }
    ok(host.calls.length === 0, 'No row callbacks for unrelated keys');
}

if (fails) {
    console.error(`\n${fails} test(s) FAILED`);
    process.exit(1);
}
console.log('\nAll tests passed.');
