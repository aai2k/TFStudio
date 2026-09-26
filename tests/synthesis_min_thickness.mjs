/**
 * Min thickness in the synthesis windows (synthesisShared/minThickness.js).
 *
 *   1. The strictest enabled MNT row sets the floor GE and Structural propose.
 *   2. The field follows the proposal on the first open and on a design
 *      switch; a typed or stored value stays until the next switch; a run in
 *      progress is never changed.
 *   3. Structural shows a note under Min thickness when it differs from the
 *      MNT row, saying which way.
 *
 * Run: node tests/synthesis_min_thickness.mjs
 */
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const { strictestMnt, deriveDMinDefault } = await import(
    '../src/components/windows/optimization/synthesisShared/minThickness.js');
const { LeftSidebar } = await import(
    '../src/components/windows/optimization/structuralOptimizer/structuralPanels.js');

// ── 1. The strictest enabled MNT row ─────────────────────────────────────────
assert.equal(strictestMnt([
    { type: 'MNT', target: 15, enabled: true }, { type: 'MNT', target: 40, enabled: true },
    { type: 'MNT', target: 60, enabled: false }, { type: 'RAV', target: 0, enabled: true },
]), 40, 'the largest enabled MNT target');
assert.equal(strictestMnt([{ type: 'RAV', target: 0, enabled: true }]), 0, 'none without an MNT row');
assert.equal(strictestMnt(undefined), 0, 'none without operands');

// ── 2. Following the proposal ────────────────────────────────────────────────
function field(stored, typed) {
    const calls = [];
    const ctx = {
        dMinTouchedRef: { current: typed }, lastIdForDMin: { current: null }, runningRef: { current: false },
        dMinRef: { current: stored }, setDMin: v => calls.push(v),
    };
    return { ctx, calls };
}
{
    const { ctx, calls } = field(40, false);
    deriveDMinDefault({ id: 'A' }, 15, ctx);
    assert.deepEqual(calls, [15], 'a field never typed in takes the MNT row on first open');
    ctx.dMinTouchedRef.current = true;
    ctx.dMinRef.current = 25;
    deriveDMinDefault({ id: 'A' }, 15, ctx);
    assert.deepEqual(calls, [15], 'a typed value stays while the design is the same');
    deriveDMinDefault({ id: 'B' }, 15, ctx);
    assert.deepEqual(calls, [15, 15], 'switching designs takes the MNT row again');
    ctx.runningRef.current = true;
    deriveDMinDefault({ id: 'C' }, 30, ctx);
    assert.deepEqual(calls, [15, 15], 'a running synthesis keeps its floor');
}
{
    const { ctx, calls } = field(40, true);
    deriveDMinDefault({ id: 'A' }, 15, ctx);
    assert.deepEqual(calls, [], 'a stored value counts as typed when the window opens');
    deriveDMinDefault({ id: 'B' }, 15, ctx);
    assert.deepEqual(calls, [15], 'and gives way on the next design switch');
}

// ── 3. Structural's note under Min thickness ─────────────────────────────────
{
    const t = makeLocale('en');
    const c = makeTheme();
    const noop = () => {};
    const sidebar = (dMin, maxMNT) => renderToStaticMarkup(React.createElement(LeftSidebar, {
        catalogs: [], selectedCats: new Set(), excludedMats: new Set(), kinds: new Set(['add']),
        onToggleCat: noop, onSelectAllCats: noop, onClearCats: noop, onToggleMat: noop, onToggleKind: noop,
        maxIter: 80, targetMF: 5e-4, T0: 0.08, jitterPct: 0.15, refineIter: 60, dMin, maxMNT,
        addMaxNm: 500, maxLayers: 80, deepMode: 0, onDeepMode: noop, deepMaxMin: 0, onDeepMaxMin: noop,
        seed: null, onSeed: noop, onMaxIter: noop, onTargetMF: noop, onT0: noop, onJitter: noop,
        onRefineIter: noop, onDMin: noop, onAddMax: noop, onMaxLayers: noop, running: false, c, t,
    }));
    const note = html => html.match(/data-structural-mnt-hint="true"[^>]*>([^<]*)</)?.[1] ?? null;
    assert.equal(note(sidebar(40, 15)), t.structural.mntHintAbove(15), 'a stricter floor than the MNT row says so');
    assert.equal(note(sidebar(1, 40)), t.structural.mntHintBelow(40), 'a looser floor says Run uses the MNT value');
    assert.equal(note(sidebar(15, 15)), null, 'no note when they agree');
    assert.equal(note(sidebar(40, 0)), null, 'no note without an MNT row');
}

console.log('Synthesis Min thickness tests passed.');
