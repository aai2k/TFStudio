/**
 * The drawing rules every Plotly chart follows, and why each one exists.
 *
 * A plot tracks a window being resized only when TWO things are true together,
 * which is what made this hard to find: each one alone looks like it does
 * nothing.
 *
 *   - the chart redraws on every render, because dragging a window edge updates
 *     the docking layout on every mouse move
 *   - the layout says `autosize`, because without it Plotly reuses the size it
 *     measured at the first draw
 *
 * With only the first, every frame redraws at the stale size. With only the
 * second, nothing redraws during a drag at all, because the data has not
 * changed. Optical Evaluation had both by accident and was the one window that
 * felt right; Admittance had only the second, and recovered from a collapsed
 * window while still lagging.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const calls = [];
globalThis.Plotly = {
    newPlot: (...args) => calls.push(['newPlot', ...args]),
    react: (...args) => calls.push(['react', ...args]),
    Plots: { resize: () => calls.push(['resize']) },
    purge: () => calls.push(['purge']),
};
globalThis.React = { useEffect: () => {} };

const { drawPlot, reactPlot, hasRoomToDraw, isDisplayed } =
    await import('../src/components/ui/plotSurface.js');

const roomy = { clientWidth: 800, clientHeight: 600 };
const margins = { margin: { l: 48, r: 12, t: 12, b: 42 } };

// ── The size must come from the element ──────────────────────────────────────

{
    calls.length = 0;
    const initRef = { current: false };
    drawPlot(roomy, initRef, [], { ...margins }, {});
    assert.equal(calls[0][0], 'newPlot', 'the first draw creates the plot');
    assert.equal(initRef.current, true);
    assert.equal(calls[0][3].autosize, true, 'the layout takes its size from the element');

    drawPlot(roomy, initRef, [], { ...margins }, {});
    assert.equal(calls[1][0], 'react', 'later draws update the existing plot');
    assert.equal(calls[1][3].autosize, true);
}

{
    // A caller that hands over a layout it also keeps must get it back
    // unchanged, or the helper would be doing the very thing it prevents.
    const own = { ...margins };
    drawPlot(roomy, { current: true }, [], own, {});
    assert.equal(own.autosize, undefined, 'the caller layout is not written to');
}

{
    // A pinned size defeats autosizing, so it must not survive into the draw.
    calls.length = 0;
    drawPlot(roomy, { current: true }, [], { ...margins, autosize: true }, {});
    assert.equal(calls[0][3].width, undefined, 'no width is pinned');
    assert.equal(calls[0][3].height, undefined, 'no height is pinned');
}

// ── A box with no room in it is never drawn into ─────────────────────────────

// Below its own margins the plot area is zero or negative. Plotly divides by
// that length to place the axis titles, every position becomes Infinity, and the
// draw aborts partway through, leaving a layout later draws cannot repair: the
// plot stays a sliver even after the window is dragged back open.
assert.equal(hasRoomToDraw({ clientWidth: 800, clientHeight: 600 }, margins), true);
assert.equal(hasRoomToDraw({ clientWidth: 55, clientHeight: 600 }, margins), false,
    'narrower than its own horizontal margins');
assert.equal(hasRoomToDraw({ clientWidth: 800, clientHeight: 50 }, margins), false,
    'shorter than its own vertical margins');
assert.equal(hasRoomToDraw({ clientWidth: 0, clientHeight: 0 }, margins), false);
// A host that reports no size at all is not the same as a collapsed box.
assert.equal(hasRoomToDraw({}, margins), true, 'an unmeasurable host still draws');

// ── A plot that is not on screen is never resized ────────────────────────────

// Only the active tab of a dock group is displayed; the rest are display:none,
// which collapses their boxes and fires their ResizeObserver. Plotly throws
// "Resize must be passed a displayed plot div element" rather than ignoring it,
// so every resize call has to check first.
assert.equal(isDisplayed({ offsetWidth: 800, offsetHeight: 600 }), true);
assert.equal(isDisplayed({ offsetWidth: 0, offsetHeight: 0 }), false,
    'a hidden tab reports no box');
assert.equal(isDisplayed({ offsetWidth: 800, offsetHeight: 0 }), true,
    'one dimension is enough to be on screen');
assert.equal(isDisplayed(null), false, 'a ref emptied by an unmount');
assert.equal(isDisplayed({}), true, 'an unmeasurable host is not the same as a hidden one');

{
    const source = readFileSync(new URL('../src/components/ui/plotSurface.js', import.meta.url), 'utf8');
    assert.match(source, /isDisplayed\(element\)\) Plotly\.Plots\.resize/,
        'the shared ResizeObserver checks before resizing');
}

// Every other resize in the app has to make the same check.
{
    const guarded = [
        'src/components/windows/analysis/plotEngine/charts.js',
        'src/components/windows/analysis/opticalEvaluation/PlotlyChart.js',
        'src/components/windows/optimization/refinement/MFTrendPlot.js',
    ];
    for (const file of guarded) {
        const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
        for (const line of source.split('\n')) {
            if (!line.includes('Plotly.Plots.resize')) continue;
            assert.match(line, /isDisplayed\(/,
                `${file}: a resize that does not check whether the plot is on screen`);
        }
    }
}

{
    calls.length = 0;
    const initRef = { current: true };
    drawPlot({ clientWidth: 20, clientHeight: 600 }, initRef, [], { ...margins }, {});
    assert.equal(calls.length, 0, 'a collapsed box is skipped rather than drawn into');
}

{
    calls.length = 0;
    reactPlot({ clientWidth: 20, clientHeight: 600 }, [], { ...margins }, {});
    assert.equal(calls.length, 0, 'reactPlot guards the same way');
    reactPlot(roomy, [], { ...margins }, {});
    assert.equal(calls[0][0], 'react');
    assert.equal(calls[0][3].autosize, true);
}

// ── Every chart goes through the helper ──────────────────────────────────────

// Optical Evaluation predates it and carries its own equivalent handling: its
// layout declares autosize in model.js, and its trace builder is rebuilt on
// every render, so it already redraws per render. It is the window the rules
// were derived from.
const ALLOWED_WITHOUT_HELPER = new Set([
    'analysis/opticalEvaluation/PlotlyChart.js',
]);

const root = fileURLToPath(new URL('../src/components/windows/', import.meta.url));
function walk(dir) {
    const out = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(full));
        else if (entry.name.endsWith('.js')) out.push(full);
    }
    return out;
}

const offenders = [];
for (const file of walk(root)) {
    const source = readFileSync(file, 'utf8');
    if (!/Plotly\.(newPlot|react)\s*\(/.test(source)) continue;
    const id = relative(root, file).replace(/\\/g, '/');
    if (ALLOWED_WITHOUT_HELPER.has(id)) continue;
    if (!source.includes('plotSurface.js')) offenders.push(id);
}
assert.deepEqual(offenders, [],
    'every chart draws through plotSurface, so none can miss autosize or the guard');

console.log('PASS plot_resize_contract');
