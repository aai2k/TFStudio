/**
 * Min thickness in the synthesis windows (synthesisShared/minThickness.js).
 *
 *   1. The strictest enabled MNT row sets the floor GE and Structural propose.
 *   2. The field follows the proposal on the first open and on a design
 *      switch; a typed or stored value stays until the next switch; a run in
 *      progress is never changed.
 *   3. Structural shows a note under Min thickness when it differs from the
 *      MNT row, saying which way.
 *   4. Needle Automatic keeps Min thickness and its MNT note in Advanced: its
 *      1 nm floor is meant to differ from the MNT row, and among the everyday
 *      settings the note reads as something to fix.
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
const { LeftSidebar: NeedleSidebar } = await import(
    '../src/components/windows/optimization/needleVariation/needlePanels.js');
const { synthesisSidebarSession } = await import(
    '../src/components/windows/optimization/synthesisShared/sessionState.js');

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

// ── 4. Needle Automatic's Min thickness sits in Advanced ─────────────────────
{
    const t = makeLocale('en');
    const tn = t.needle;
    const c = makeTheme();
    const noop = () => {};
    const sidebar = () => renderToStaticMarkup(React.createElement(NeedleSidebar, {
        catalogs: [], selectedCats: new Set(), excludedMats: new Set(),
        onToggleCat: noop, onSelectAllCats: noop, onClearCats: noop, onToggleMat: noop,
        maxLayers: 60, deltaNm: 0.5, dlsIter: 60, dMin: 1, targetMF: 5e-4, maxMNT: 40,
        onMaxLayers: noop, onDeltaNm: noop, onDlsIter: noop, onDMin: noop, onTargetMF: noop,
        running: false, c, t,
    }));
    const advanced = open => synthesisSidebarSession.write(
        null, { advOpen: { 'needle-variation': open } }, null);

    advanced(false);
    const closed = sidebar();
    assert.ok(closed.includes(tn.maxLayers), 'the everyday settings show');
    assert.ok(!closed.includes(tn.dMin), 'Min thickness is not among the everyday settings');
    assert.ok(!closed.includes(tn.mntHint(40)), 'nor is its MNT note');

    advanced(true);
    const open = sidebar();
    const at = label => open.indexOf(label);
    assert.ok(at(tn.dMin) > at(tn.deltaNm), 'Min thickness shows in Advanced, after the needle probe');
    assert.ok(at(tn.dMin) < at(tn.dlsIter), 'and before the refine iterations');
    assert.ok(open.includes(tn.mntHint(40)), 'its note comes with it');
    advanced(false);
}

console.log('Synthesis Min thickness tests passed.');
