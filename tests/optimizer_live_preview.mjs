/**
 * An optimizer run replaces the design far faster than an analysis window can
 * redraw. Windows that follow a run must sample it rather than recompute on
 * every progress message, or the run saturates the main thread and the whole
 * interface stops responding.
 *
 * Group Delay / GDD is the expensive case: its automatic grid is several times
 * denser than Optical Evaluation's and every point costs more, so it also drops
 * to a coarse preview grid for the duration of a run. That is a display
 * resolution change only, which is what the value checks below pin down.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { initWasmForTest } from './_wasmInit.mjs';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';
import { computeGdGddSpectrum } from '../src/components/windows/analysis/gdGddEvaluation/spectrum.js';
import { evaluateDesignPhaseDispersion } from '../src/utils/physics/phaseDispersion.js';

await initWasmForTest();

const source = path => readFileSync(new URL(path, import.meta.url), 'utf8');

const design = (() => {
    const wavelength = 550;
    const high = getMaterial('TiO2').getNK(wavelength)[0];
    const low = getMaterial('SiO2').getNK(wavelength)[0];
    const frontLayers = [];
    for (let pair = 0; pair < 12; pair++) {
        frontLayers.push(
            { material: 'TiO2', thickness: wavelength / (4 * high) },
            { material: 'SiO2', thickness: wavelength / (4 * low) },
        );
    }
    return {
        incidentMedium: 'Air', exitMedium: 'Air',
        substrate: { material: 'BK7', thickness: 1 },
        frontLayers, backLayers: [], surfaceMode: 'front_only',
    };
})();

const options = {
    side: 'front', target: 'R', polarization: 's', thetaDeg: 0,
    lambdaStart: 400, lambdaEnd: 1000,
};
const full = computeGdGddSpectrum(design, options);
const preview = computeGdGddSpectrum(design, { ...options, preview: true });

// ── The preview grid is a resolution change, not a different calculation ──────

// GD, GDD and TOD are pointwise analytic values, so a point present on both
// grids must carry the same number. A preview that changed the physics would
// show the user a curve that is not the design they are optimizing.
let shared = 0;
const fullAt = new Map(full.lambda.map((value, index) => [value, index]));
for (let index = 0; index < preview.lambda.length; index++) {
    const match = fullAt.get(preview.lambda[index]);
    if (match == null) continue;
    shared++;
    for (const key of ['gd', 'gdd', 'tod', 'phaseDeg', 'magnitudeSquared']) {
        assert.equal(preview[key][index], full[key][match],
            `${key} must not depend on the grid at ${preview.lambda[index]} nm`);
    }
}
assert.ok(shared > 50, `expected the grids to share points, got ${shared}`);

// And against the independent pointwise evaluator, not just against each other.
// Above ~800 nm the TiO2 model runs out of range and both grids report no
// value, which is the separate masking behaviour and not what is checked here.
let checked = 0;
for (const wavelengthNm of [400, 500, 600, 700]) {
    const index = preview.lambda.indexOf(wavelengthNm);
    assert.ok(index >= 0, `${wavelengthNm} nm is on the preview grid`);
    const point = evaluateDesignPhaseDispersion(design, {
        wavelengthNm, target: 'R', polarization: 's', thetaDeg: 0,
    });
    assert.equal(point.valid, true, `${wavelengthNm} nm is inside the material models`);
    assert.equal(preview.gd[index], point.gdFs,
        `preview GD at ${wavelengthNm} nm matches the pointwise evaluator`);
    assert.equal(preview.gdd[index], point.gddFs2,
        `preview GDD at ${wavelengthNm} nm matches the pointwise evaluator`);
    checked++;
}
assert.equal(checked, 4);

// ── The preview grid is actually cheaper ─────────────────────────────────────

assert.equal(preview.preview, true);
assert.equal(full.preview, false);
// Local refinement is what makes the full grid expensive; a preview skips it.
assert.equal(preview.adaptivePointCount, 0, 'a preview does not refine locally');
assert.ok(full.lambda.length > preview.lambda.length * 4,
    `preview grid must be far coarser: ${full.lambda.length} vs ${preview.lambda.length}`);
// Still dense enough to read the shape of a curve while it moves.
assert.ok(preview.lambda.length >= 200,
    `preview grid must still show the curve: ${preview.lambda.length} points`);

// A short span keeps a sane step rather than collapsing onto a handful of points.
const narrow = computeGdGddSpectrum(design, {
    ...options, lambdaStart: 549, lambdaEnd: 551, preview: true,
});
assert.ok(narrow.lambda.length >= 3, 'a narrow span still yields a usable preview grid');

// ── Every window that follows a run must sample the design ───────────────────

// This is the wiring the bug came down to: Optical Evaluation throttled its
// live preview and Group Delay did not, so opening Group Delay during a run
// froze the interface.
const followers = [
    ['../src/components/windows/analysis/gdGddEvaluation/useGDGDDState.js', 'Group Delay'],
    ['../src/components/windows/optimization/meritFunctionEditor/useMeritOperands.js', 'Merit Function Editor'],
    ['../src/components/windows/optimization/refinement/useRefinement.js', 'Refinement'],
];
for (const [path, label] of followers) {
    const text = source(path);
    assert.ok(text.includes('useLiveDesign'),
        `${label} must follow the sampled design during a run`);
}

// The Group Delay spectrum must be computed from the sampled design, never the
// live one, and must pass the preview flag through.
const gdState = source('../src/components/windows/analysis/gdGddEvaluation/useGDGDDState.js');
assert.ok(/computeGdGddSpectrum\(liveDesign/.test(gdState),
    'Group Delay computes from the sampled design');
assert.ok(/preview,/.test(gdState), 'Group Delay passes the preview flag through');

// One cadence for every live preview, so the windows redraw together.
const hook = source('../src/state/useLiveDesign.js');
assert.ok(/OPTIMIZATION_PREVIEW_MS = 250/.test(hook));

// Optical Evaluation used to carry its own copy of the sampling mechanism.
// It follows the shared hook now, so there is one place where the rule lives.
const oe = source('../src/components/windows/analysis/opticalEvaluation/useOpticalEvaluation.js');
assert.ok(oe.includes('useLiveDesign'), 'Optical Evaluation follows the sampled design');
assert.ok(!oe.includes('setInterval'), 'Optical Evaluation has no throttle of its own');

// ── Auto-update is one global setting ────────────────────────────────────────

// The switch used to be local to Optical Evaluation, so turning it off there
// did nothing for any other window. It lives on the design context now and the
// windows that show it all read that one value.
const context = source('../src/state/DesignContext.js');
assert.ok(/const \[liveUpdate, setLiveUpdate\] = useState\(true\)/.test(context),
    'auto-update is global state, on by default');
assert.ok(/liveUpdate, setLiveUpdate,/.test(context), 'the setting is on the context value');

const switchSource = source('../src/components/ui/LiveUpdateSwitch.js');
assert.ok(switchSource.includes('useDesign()'),
    'the switch reads the shared setting rather than taking a local one as a prop');
// Its props are presentation only. A `checked` or `onChange` prop would let
// two copies of the switch hold different values, which is the bug being fixed.
const signature = switchSource.match(/export function LiveUpdateSwitch\(\{([^}]*)\}/)[1];
assert.deepEqual(signature.split(',').map(name => name.trim()).filter(Boolean),
    ['c', 'label', 'title']);

for (const [path, label] of [
    ['../src/components/windows/optimization/refinement/ControlBar.js', 'Refinement'],
    // One bar serves Needle Variation, Gradual Evolution and Structural.
    ['../src/components/windows/optimization/synthesisShared/synthesisShell.js', 'the synthesis windows'],
    ['../src/components/windows/optimization/needleManual/NeedleManual.js', 'Needle (manual)'],
]) {
    assert.ok(source(path).includes('LiveUpdateSwitch'), `${label} shows the switch`);
}

// The setting belongs to the windows that start runs. An analysis window obeys
// it but does not offer it, so its toolbar stays about what is being plotted.
for (const [path, label] of [
    ['../src/components/windows/analysis/opticalEvaluation/EvaluationToolbar.js', 'Optical Evaluation'],
    ['../src/components/windows/analysis/gdGddEvaluation/GDControls.js', 'Group Delay'],
]) {
    assert.ok(!source(path).includes('LiveUpdateSwitch'), `${label} does not carry the switch`);
}

// Every window that can start a run offers the switch, so none is left as the
// one place a long run cannot be quietened from.
const runnerDirs = [
    'refinement', 'needleManual', 'needleVariation',
    'gradualEvolution', 'structuralOptimizer',
];
for (const dir of runnerDirs) {
    const base = new URL(`../src/components/windows/optimization/${dir}/`, import.meta.url);
    const files = readdirSync(base).filter(name => name.endsWith('.js'));
    const startsRuns = files.some(name =>
        readFileSync(new URL(name, base), 'utf8').includes('beginOptimization'));
    assert.ok(startsRuns, `${dir} is expected to start optimizer runs`);
    const showsSwitch = files.some(name =>
        readFileSync(new URL(name, base), 'utf8').includes('LiveUpdateSwitch'))
        // The three synthesis windows share one control bar.
        || ['needleVariation', 'gradualEvolution', 'structuralOptimizer'].includes(dir);
    assert.ok(showsSwitch, `${dir} must show the auto-update switch`);
}

// Off, a run is not followed at all: the design is held, so `preview` is false
// and nothing draws a coarse grid for a design that is not moving.
assert.ok(/if \(!liveUpdate\) return undefined;/.test(hook),
    'with auto-update off the sampling interval never starts');
assert.ok(/const following = isOptimizing && liveUpdate;/.test(hook)
    && /preview: following/.test(hook),
    'a held design is not a preview');

// Ordinary edits are unaffected either way: outside a run the design is
// returned untouched, whatever the setting says.
assert.ok(/design: isOptimizing \? sampled : design/.test(hook),
    'edits outside a run always show immediately');

// ── The merit table keeps tracking a run ─────────────────────────────────────

// MF and OMF belong to the run loop, which reports the optimizer's own values.
// The refresh during a run must set only the per-operand values, or the table
// and the run would disagree about the merit function.
const refinement = source('../src/components/windows/optimization/refinement/useRefinement.js');
const liveRefresh = refinement.slice(refinement.indexOf('if (!running || !preview) return;'));
const refreshBody = liveRefresh.slice(0, liveRefresh.indexOf('}, ['));
assert.ok(refreshBody.includes('setComputed'), 'the run refresh updates operand values');
assert.ok(!refreshBody.includes('setMf('), 'the run refresh must not overwrite MF');
assert.ok(!refreshBody.includes('setOmf('), 'the run refresh must not overwrite OMF');

console.log('optimizer_live_preview: passed');
