/**
 * The three electric-field components against Essential Macleod.
 *
 * The characteristic matrix carries only the tangential field, so before this
 * fixture existed the p curve was the tangential component divided by
 * cos²θ₀ — the tangential field measured against the tangential part of the
 * incident beam rather than the whole of it. At 45° that reads twice the real
 * fraction, and it draws a null wherever the tangential field has a node even
 * though the resultant field there is not small.
 *
 * Macleod's export gives the component normal to the layers, the component
 * parallel to them, and their resultant, in volts per metre for an incident
 * irradiance of 1 W/m². All three are checked here. Indices and thicknesses
 * travel in the fixture, so this is math against math.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { computeEFieldProfile } = await import('../src/utils/physics/thinFilmMath.js');
const { incidentAmplitudeVpm } =
    await import('../src/components/windows/analysis/eFieldEvaluation/yScale.js');

const fixture = JSON.parse(fs.readFileSync(path.join(HERE, 'reference/macleod_efield.json'), 'utf8'));

// TFStudio samples on its own per-layer grid, so its dense profile is
// interpolated onto Macleod's depths. At 400 points per layer the spacing is
// well under a nanometre against a standing wave whose period is hundreds, so
// the interpolation is far finer than the agreement being measured.
const POINTS_PER_LAYER = 400;
function interpAt(xs, ys, x) {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
    let lo = 0, hi = xs.length - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (xs[mid] <= x) lo = mid; else hi = mid;
    }
    const f = (x - xs[lo]) / (xs[hi] - xs[lo]);
    return ys[lo] + f * (ys[hi] - ys[lo]);
}

// Differences are measured against each profile's own peak. The largest
// absolute difference in a field profile lands at a node, where the field is
// near zero and a relative difference says nothing about the agreement.
const TOLERANCE = 5e-4;

let worst = 0, worstAt = '';
let checked = 0;
for (const c of fixture.cases) {
    const prof = computeEFieldProfile(c.lambda, c.angle, c.pol, c.n0, c.ns, c.layers, POINTS_PER_LAYER);
    const incident = incidentAmplitudeVpm(c.n0[0]);
    // The engine returns each curve as a fraction of the incident |E|²; the
    // fixture holds amplitudes in V/m.
    const toVpm = fraction => Math.sqrt(Math.max(0, fraction)) * incident;
    const peak = Math.max(...c.points.map(point => point.total));
    const compare = (key, expected, at) => {
        const got = toVpm(interpAt(prof.z, prof[key], at.z));
        const diff = Math.abs(got - expected) / peak;
        if (diff > worst) {
            worst = diff;
            worstAt = `${c.lambda} nm, ${c.angle}°, ${c.pol}, z = ${at.z.toFixed(1)} nm, ${key}`;
        }
        assert.ok(diff < TOLERANCE,
            `${c.lambda} nm ${c.angle}° ${c.pol} z=${at.z.toFixed(1)} ${key}: `
            + `got ${got.toFixed(6)}, want ${expected.toFixed(6)} V/m `
            + `(${diff.toExponential(2)} of the ${peak.toFixed(3)} V/m peak)`);
        checked++;
    };
    for (const point of c.points) {
        compare('e2', point.total, point);
        compare('e2Tangential', point.parallel, point);
        compare('e2Normal', point.normal, point);
    }
}
console.log(`  ${checked} component values against Essential Macleod, worst ${worst.toExponential(2)} of peak (${worstAt})`);

// ── Conventions that hold independently of the fixture ──────────────────────

const stack = fixture.cases.find(c => c.lambda === 600 && c.angle === 45 && c.pol === 's');
const profileAt = (angle, pol) =>
    computeEFieldProfile(stack.lambda, angle, pol, stack.n0, stack.ns, stack.layers, 60);

// s-polarization is entirely tangential at every angle, so its resultant is
// its tangential component and it has no normal one. This is the control that
// the correction left the s curve alone.
for (const angle of [0, 15, 45, 60, 80]) {
    const s = profileAt(angle, 's');
    assert.deepEqual(s.e2, s.e2Tangential, `s at ${angle}° is not purely tangential`);
    assert.ok(s.e2Normal.every(value => value === 0), `s at ${angle}° has a normal component`);
}

// At normal incidence there is no normal component and the two polarizations
// are the same problem, so the p curve is unchanged by the correction there.
const normalS = profileAt(0, 's');
const normalP = profileAt(0, 'p');
assert.ok(normalP.e2Normal.every(value => value === 0), 'p at normal incidence has a normal component');
assert.deepEqual(normalP.e2, normalP.e2Tangential, 'p at normal incidence is not purely tangential');
for (let i = 0; i < normalS.e2.length; i++) {
    assert.ok(Math.abs(normalP.e2[i] - normalS.e2[i]) < 1e-12,
        's and p differ at normal incidence');
}

// Which side of an interface the boundary sample belongs to.
//
// The normal component carries 1/n², so it steps across an interface and a
// sample sitting exactly on one has two legitimate values. The fixture skips
// those depths, so this is what pins the choice: the sample the engine puts on
// a boundary belongs to the layer that ENDS there, being continuous with the
// sample before it and stepping to the one after.
{
    const pts = 60;
    const p = computeEFieldProfile(stack.lambda, 45, 'p', stack.n0, stack.ns, stack.layers, pts);
    // Layer 0 contributes pts+1 samples and every later layer pts, since each
    // drops the front point it shares with the layer above.
    for (const k of [0, 1, 2]) {
        const index = pts + k * pts;
        assert.ok(Math.abs(p.z[index] - p.layerBounds[k + 1]) < 1e-9,
            'the boundary sample is not where this test expects it');
        const at = p.e2Normal[index];
        // The step is compared against the change to the neighbour on the same
        // side rather than an absolute tolerance: near a node of the normal
        // component that neighbouring change is already several percent of a
        // small number, while the step across the interface is a factor.
        const alongLayer = Math.abs(at - p.e2Normal[index - 1]);
        const acrossInterface = Math.abs(p.e2Normal[index + 1] - at);
        assert.ok(acrossInterface > 5 * alongLayer,
            `the sample on ${p.z[index].toFixed(1)} nm sits on the far side of the interface`);
        // Across the interface the component scales as 1/n⁴. The comparison is
        // one sample past the boundary, so the ratio also carries a little of
        // H's own variation over that step.
        const step = (stack.layers[k].n[0] / stack.layers[k + 1].n[0]) ** 4;
        assert.ok(Math.abs((p.e2Normal[index + 1] / at) / step - 1) < 0.15,
            `the step across ${p.z[index].toFixed(1)} nm is not the 1/n⁴ the normal component scales by`);
    }
}

// The tangential component is what the matrix carries, so the old curve is
// recoverable from it: the p reading before the correction was the tangential
// component divided by cos²θ₀. This pins the size of the correction rather
// than just asserting it happened.
for (const angle of [15, 30, 45, 60]) {
    const p = profileAt(angle, 'p');
    const cos2 = Math.cos(angle * Math.PI / 180) ** 2;
    const legacyPeak = Math.max(...p.e2Tangential) / cos2;
    assert.ok(legacyPeak / Math.max(...p.e2) > 1.0,
        `the old p reading at ${angle}° was not above the corrected resultant`);
    // The resultant is never below either component, and never above their
    // quadrature sum: the two bounds of the field ellipse.
    for (let i = 0; i < p.e2.length; i++) {
        const quadrature = p.e2Tangential[i] + p.e2Normal[i];
        assert.ok(p.e2[i] >= Math.max(p.e2Tangential[i], p.e2Normal[i]) - 1e-12,
            `resultant below a component at ${angle}°`);
        assert.ok(p.e2[i] <= quadrature + 1e-12,
            `resultant above the quadrature sum at ${angle}°`);
    }
}

console.log('PASS: efield_components_macleod');
