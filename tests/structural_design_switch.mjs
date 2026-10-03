/**
 * A design switch in the Structural Optimizer shows the new design's own run
 * (structuralOptimizer/useStructuralOptimizer.js, loadDesignSwitch): a design
 * with a cached run shows its generations and merit, and never the iteration
 * count of the design switched away from; a design never run shows nothing.
 *
 * Run: node tests/structural_design_switch.mjs
 */
import assert from 'node:assert/strict';
import { shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();

const { loadDesignSwitch } = await import(
    '../src/components/windows/optimization/structuralOptimizer/useStructuralOptimizer.js');
const { setCached } = await import('../src/components/windows/optimization/structuralOptimizer/sessionState.js');

const ref = current => ({ current });
const designOf = id => ({
    id, surfaceMode: 'front_only', backLayers: [],
    frontLayers: [{ id: `${id}1`, material: 'TiO2', thickness: 90 }, { id: `${id}2`, material: 'SiO2', thickness: 110 }],
});

// The window as the switch leaves it: what each setter was last given.
function windowOn(design, lastDesignId) {
    const shown = { iter: 412 };
    const setter = key => value => { shown[key] = value; };
    const ctx = {
        design, lastDesignId: ref(lastDesignId), stopOpt: () => { shown.stopped = true; },
        gensRef: ref([]), genCountRef: ref(0), savedDesignRef: ref(null), baseDesignRef: ref(null),
        baseRevRef: ref(0), trendRef: ref([]), runsRef: ref([]), runOpenRef: ref(false),
        getDesignRevision: () => 0,
    };
    for (const key of ['Generations', 'TopDesigns', 'Trend', 'MfBest', 'Mf', 'Omf', 'OmfBest',
        'LayerCount', 'CanReset', 'Iter', 'StatusMsg']) {
        ctx[`set${key}`] = setter(key[0].toLowerCase() + key.slice(1));
    }
    loadDesignSwitch(ctx);
    return shown;
}

const generation = { genNum: 3, mf: 0.02, omf: 0.02, layerCount: 2, layers: [] };
setCached('B', { generations: [generation], runs: [], savedDesign: null, baseDesign: null, baseRev: 0, trend: [] });

const onB = windowOn(designOf('B'), 'A');
assert.ok(onB.stopped, 'the switch stops a run on the design left');
assert.equal(onB.mf, 0.02, 'B shows its own cached run');
assert.equal(onB.iter, 0, 'and not the iteration count of the run on A');

const onC = windowOn(designOf('C'), 'B');
assert.equal(onC.mf, null, 'a design never run shows no run');
assert.equal(onC.iter, 0);

console.log('PASS: structural_design_switch');
