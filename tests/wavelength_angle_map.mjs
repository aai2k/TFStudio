/**
 * Wavelength vs Angle map.
 *
 * The window owns no physics: it pins the Plot Engine's surface to wavelength
 * on X and angle of incidence on Y, and hands the rest to the validated sweep.
 * What is worth testing is therefore the seam.
 *
 *   1. Step size to sample count, including the cap the surface grid enforces.
 *   2. The specification the controls build: λ on X, AOI on Y, the evaluation
 *      mode carried through, and no drawing fields in it — those must not send
 *      the window back through a sweep.
 *   3. The map is the spectrum. Its normal-incidence row equals evaluateSpectrum
 *      at 0°, and an oblique row equals the same call at that angle.
 *   4. The polarization control reaches the kernel: avg is the mean of s and p.
 *   5. The session store opens on the registry's values and saves them back.
 *   6. A run is followed through useLiveDesign, like the other analysis windows.
 *
 * Run: node tests/wavelength_angle_map.mjs
 */

import assert from 'node:assert/strict';
import { initWasmForTest } from './_wasmInit.mjs';
import { axisSteps, buildMapSpec } from '../src/components/windows/analysis/wavelengthAngleMap/mapSpec.js';
import { wavelengthAngleMapSession } from '../src/components/windows/analysis/wavelengthAngleMap/sessionState.js';
import { computeSurface, MAX_AXIS_STEPS } from '../src/utils/physics/plotQuantities.js';
import { evaluateSpectrum } from '../src/utils/physics/thinFilmMath.js';
import { sessionDefaults } from '../src/constants/analysisDefaults.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';
import { readFile } from 'node:fs/promises';

await initWasmForTest();

const resolveMat = id => getMaterial(id) || getMaterial('Air');

// A quarter-wave stack: enough structure that a passband edge actually moves
// with angle, so a row that silently ignored the angle would show up.
const design = {
    id: 'angle-map-test',
    incidentMedium: 'Air',
    exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1.0 },
    surfaceMode: 'front_only',
    mfEvalMode: 'side',
    frontLayers: [
        { material: 'TiO2', thickness: 62 },
        { material: 'SiO2', thickness: 95 },
        { material: 'TiO2', thickness: 62 },
        { material: 'SiO2', thickness: 95 },
        { material: 'TiO2', thickness: 62 },
    ],
    backLayers: [],
    meritOperands: [],
};

const controls = {
    lambdaStart: 400, lambdaEnd: 800, lambdaStep: 4,
    angleStart: 0, angleEnd: 45, angleStep: 15,
    channel: 'T', pol: 'avg',
};

// ── 1. Step size to sample count ─────────────────────────────────────────────
{
    assert.equal(axisSteps(400, 800, 4), 101, 'an inclusive range counts both ends');
    assert.equal(axisSteps(0, 45, 15), 4, '0, 15, 30 and 45 degrees is four rows');
    assert.equal(axisSteps(550, 550, 2), 2,
        'a range with no span still has the two samples a grid axis needs');
    assert.equal(axisSteps(400, 800, 0), 401,
        'a zero step falls back to one sample per unit rather than an unbounded grid');
    assert.equal(axisSteps(400, 800, 0.05), MAX_AXIS_STEPS,
        'a step finer than the grid allows is capped, keeping the endpoints');
}

// ── 2. The specification the controls build ──────────────────────────────────
{
    const spec = buildMapSpec(controls, 'total');
    assert.equal(spec.xVar, 'wavelength', 'wavelength is always the X axis');
    assert.equal(spec.yVar, 'aoi', 'angle of incidence is always the Y axis');
    assert.equal(spec.xSteps, 101);
    assert.equal(spec.ySteps, 4);
    assert.equal(spec.z, 'T');
    assert.equal(spec.surfaceMode, 'total',
        "the design's evaluation mode is what the map is computed for");
    assert.equal(buildMapSpec(controls, undefined).surfaceMode, 'front',
        'a missing evaluation mode reads as the front surface');

    // Redrawing must not recompute, so how the grid is drawn is not part of what
    // the sweep is keyed on.
    assert.ok(!('render' in spec) && !('colorscale' in spec),
        'the render style and colorscale stay out of the compute specification');
}

// ── 3. The map is the spectrum ───────────────────────────────────────────────
{
    const spec = buildMapSpec(controls, 'front');
    const map = computeSurface(spec, design, resolveMat);
    assert.ok(map.ok, `surface failed: ${map.error}`);
    assert.equal(map.y.length, 4, 'one row per angle');
    assert.equal(map.x.length, 101, 'one column per wavelength');
    assert.deepEqual(map.y, [0, 15, 30, 45], 'the rows are the angles asked for');

    const ctx = {
        inc: resolveMat('Air'),
        sub: resolveMat('BK7'),
        layers: design.frontLayers.map(l => ({
            material: resolveMat(l.material), thickness: l.thickness,
        })),
    };
    const spectrumAt = theta => evaluateSpectrum(
        { lambdaStart: 400, lambdaEnd: 800, lambdaStep: 4, theta, polarization: 'avg' },
        ctx.inc, ctx.sub, ctx.layers,
    );

    for (const [row, theta] of [[0, 0], [3, 45]]) {
        const reference = spectrumAt(theta);
        let worst = 0;
        for (let i = 0; i < map.x.length; i++) {
            worst = Math.max(worst, Math.abs(map.z[row][i] - reference.T[i]));
        }
        assert.ok(worst < 1e-12,
            `the ${theta}° row is the ${theta}° spectrum (max |Δ| = ${worst.toExponential(2)})`);
    }

    // The angle axis has to reach the kernel, not just the axis labels.
    const moved = map.z[0].some((value, i) => Math.abs(value - map.z[3][i]) > 1e-3);
    assert.ok(moved, 'the 45° row differs from the 0° row');

    for (const row of map.z) {
        for (const value of row) {
            assert.ok(Number.isFinite(value) && value >= 0 && value <= 1,
                `transmittance stays a fraction (got ${value})`);
        }
    }
}

// ── 4. The polarization control reaches the kernel ───────────────────────────
{
    const oblique = { ...controls, angleStart: 45, angleEnd: 45, angleStep: 15 };
    const at = pol => computeSurface(buildMapSpec({ ...oblique, pol }, 'front'), design, resolveMat);
    const avg = at('avg');
    const s = at('s');
    const p = at('p');
    assert.ok(avg.ok && s.ok && p.ok);

    let worst = 0;
    let split = 0;
    for (let i = 0; i < avg.x.length; i++) {
        worst = Math.max(worst, Math.abs(avg.z[0][i] - (s.z[0][i] + p.z[0][i]) / 2));
        split = Math.max(split, Math.abs(s.z[0][i] - p.z[0][i]));
    }
    assert.ok(worst < 1e-12, `avg is the mean of s and p (max |Δ| = ${worst.toExponential(2)})`);
    assert.ok(split > 1e-3, 's and p differ at 45°, so the map is not averaging one curve twice');
}

// ── 5. The session store ─────────────────────────────────────────────────────
{
    wavelengthAngleMapSession.reset();
    const shipped = sessionDefaults('wavelengthAngleMap');
    const opened = wavelengthAngleMapSession.read(design);
    for (const [key, value] of Object.entries(shipped)) {
        assert.equal(opened[key], value, `${key} opens on its registry value`);
    }

    wavelengthAngleMapSession.write(design, { angleEnd: 80, channel: 'R' });
    const other = wavelengthAngleMapSession.read({ id: 'another-design' });
    assert.equal(other.angleEnd, 80,
        'the angle range is a display preference and carries across designs');
    assert.equal(other.channel, 'R');

    const saved = wavelengthAngleMapSession.savableValues(design);
    assert.equal(saved.angleEnd, 80, 'the range is written out as a saved default');
    assert.ok(!('result' in saved), 'a computed grid is not a default');
    wavelengthAngleMapSession.reset();
}

// ── 6. The map follows a run the way the other analysis windows do ──────────
//
// Taking the design straight from the context means every transient write of a
// live optimizer run lands here. Those arrive faster than the settle, so the
// wait is reset before it ever fires and the map sits frozen at the grid it held
// when the run started; with live update off it would chase the run instead of
// holding, which is the opposite of what that setting promises.
//
// Read as text: the wiring is a hook and the interval is a module constant, so
// neither can be checked by calling anything.
{
    const read = name => readFile(new URL(name, import.meta.url), 'utf8');
    const hook = await read('../src/components/windows/analysis/wavelengthAngleMap/useWavelengthAngleMap.js');
    const live = await read('../src/state/useLiveDesign.js');

    assert.match(hook, /const \{ design \} = useLiveDesign\(\)/,
        'the design comes from useLiveDesign, so a run is sampled and the live-update setting is honoured');
    assert.doesNotMatch(hook, /design[^;]*=\s*useDesign\(\)/,
        'and not from the context, which streams every intermediate stack of a run');

    const factor = /SETTLE_MS = Math\.round\(OPTIMIZATION_PREVIEW_MS \* ([\d.]+)\)/.exec(hook);
    assert.ok(factor, 'the settle is derived from the preview interval, not a number that can drift past it');
    assert.ok(Number(factor[1]) < 1,
        'and is shorter than it, so each sampled frame of a run gets its sweep');
    assert.match(live, /OPTIMIZATION_PREVIEW_MS = \d+/,
        'the interval it is derived from is still declared there');
}

console.log('wavelength_angle_map: passed');
