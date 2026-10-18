/**
 * `useLiveDesign` starts a run from the design on screen.
 *
 * The hook holds the frame it samples during a run. The first render after a
 * run starts used to return the frame it held before: the design from when the
 * window opened, or the last frame of the previous run. Every window following
 * the run computed that old design once, and one computing in a worker started
 * a job for it.
 *
 * Run: node tests/live_design_first_frame.mjs
 */
import assert from 'node:assert/strict';
import { makeEffectRuntime } from './_effectRuntime.mjs';

const runtime = makeEffectRuntime();
globalThis.React = runtime;
const { DesignContext } = await import('../src/state/DesignContext.js');
const { useLiveDesign } = await import('../src/state/useLiveDesign.js');

// Every design the hook returns, one per render, until it settles.
function render(context) {
    DesignContext.value = context;
    const shown = [];
    runtime.run(() => {
        const { design } = useLiveDesign();
        shown.push(design);
        return design;
    });
    return shown;
}
const names = list => list.map(d => d.name).join(', ');

for (const liveUpdate of [true, false]) {
    const label = `live update ${liveUpdate ? 'on' : 'off'}`;
    const opened = { name: 'as opened' };
    const edited = { name: 'edited' };
    const runFrame = { name: 'a frame of the first run' };
    const editedAgain = { name: 'edited after the run' };
    try {
        render({ design: opened, isOptimizing: false, liveUpdate });
        assert.deepEqual(render({ design: edited, isOptimizing: false, liveUpdate }), [edited]);

        const start = render({ design: edited, isOptimizing: true, liveUpdate });
        assert.ok(start.every(d => d === edited), `${label}: the run starts from the edit, not ${names(start)}`);
        render({ design: runFrame, isOptimizing: true, liveUpdate });
        render({ design: runFrame, isOptimizing: false, liveUpdate });

        render({ design: editedAgain, isOptimizing: false, liveUpdate });
        const second = render({ design: editedAgain, isOptimizing: true, liveUpdate });
        assert.ok(second.every(d => d === editedAgain),
            `${label}: a second run starts from the edit after the first, not ${names(second)}`);
    } finally {
        render({ design: editedAgain, isOptimizing: false, liveUpdate });
        runtime.unmount();
    }
}

// With live update off the run's first frame is held while the run moves on.
{
    const before = { name: 'before the run' };
    render({ design: before, isOptimizing: false, liveUpdate: false });
    render({ design: before, isOptimizing: true, liveUpdate: false });
    const held = render({ design: { name: 'moved by the run' }, isOptimizing: true, liveUpdate: false });
    assert.ok(held.every(d => d === before), `with live update off the first frame is held, not ${names(held)}`);
    render({ design: before, isOptimizing: false, liveUpdate: false });
    runtime.unmount();
}

console.log('PASS: live_design_first_frame');
