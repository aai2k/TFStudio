/**
 * A material with no index at a wavelength a calculation needs is reported,
 * never read as a stand-in: the monitoring worksheet and its Auto λ, the
 * monitoring wizard's plan and run, and a thickness offset in optical units.
 *
 * TiO2 Devore-o (refractiveindex.info formula 4, catalog formula 204) has its
 * pole near 283 nm and no real n below it; at 270 nm it has none.
 */
import assert from 'node:assert/strict';

import { evalN } from '../src/utils/materials/dispersionFormulas.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';
import { MaterialHasNoIndexError } from '../src/utils/materials/materialIndexAt.js';
import {
    autoChipLambdas, buildMonitorWorksheet, defaultMonoTable, mulberry32, pickMonitoringPlan, simulateRunMono,
} from '../src/utils/monitoring/monoSim.js';
import {
    computeDeviatedSpectrum, deviatedDesignForSpec, emptyDeviation, perturbLayers, runDeviationSweep,
} from '../src/utils/physics/systematicDeviations.js';
import { offsetToPhysicalNm } from '../src/utils/physics/systematicDeviations/deviationSpec.js';

const DEVORE_O = [5.913, .2441, 0, .0803, 1, 0, 0, 0, 1];
const devore = { id: 'devore', name: 'TiO2 (Devore-o)', getNK: nm => [evalN(204, DEVORE_O, nm / 1000), 0] };
const resolveMat = id => (id === 'devore' ? devore : getMaterial(id));
const hasIndex = nm => Number.isFinite(devore.getNK(nm)[0]);

assert.ok(!hasIndex(270) && hasIndex(300) && hasIndex(550), 'Devore-o has no index at 270 nm and one at 300 and 550');

// Storage order, air side first: index 3 is grown first, on the substrate.
const design = (referenceWavelength, extra = {}) => ({
    referenceWavelength,
    substrate: { material: 'BK7', thickness: 1 },
    incidentMedium: 'Air', exitMedium: 'Air', surfaceMode: 'front_only',
    frontLayers: [
        { material: 'devore', thickness: 60 }, { material: 'SiO2', thickness: 95 },
        { material: 'devore', thickness: 60 }, { material: 'SiO2', thickness: 95 },
    ],
    backLayers: [],
    ...extra,
});
const noIndex = (materialId, lambdaNm) => error => error instanceof MaterialHasNoIndexError
    && error.materialId === materialId && error.lambdaNm === lambdaNm;

// ── Monitoring worksheet ─────────────────────────────────────────────────────
{
    // The run axis is counted in quarter waves at the reference wavelength.
    assert.throws(() => buildMonitorWorksheet(design(270), resolveMat), noIndex('devore', 270),
        'no index at the reference: reported, not read as n = 1.6');
    // Every chip at 270 nm.
    assert.throws(() => buildMonitorWorksheet(design(550), resolveMat, { lambdaByStep: [270, 270, 270, 270] }),
        noIndex('devore', 270), 'no index at the chip wavelength: reported');
    // The chip glass carries every layer's signal.
    const silica = design(550);
    silica.frontLayers = silica.frontLayers.map(layer => ({ ...layer, material: 'SiO2' }));
    assert.throws(() => buildMonitorWorksheet(silica, resolveMat, { chipMaterial: 'devore', lambdaByStep: [270, 270, 270, 270] }),
        noIndex('devore', 270), 'chip glass with no index at the chip wavelength: reported');
    assert.equal(buildMonitorWorksheet(design(550), resolveMat).rows.length, 4, 'a worksheet where every material has an index');

    // Auto λ over a band reaching below the pole picks only wavelengths every
    // chip can be monitored at; a wavelength with no signal used to score as
    // the best, since no layer had an error there to count against it.
    const picked = autoChipLambdas(design(550), resolveMat, { lamA: 250, lamB: 350, lamSteps: 11, layersPerChip: 2 });
    assert.equal(picked.length, 4);
    assert.ok(picked.every(hasIndex), `Auto λ never picks a wavelength with no index: ${picked}`);
    assert.throws(() => autoChipLambdas(design(270), resolveMat), noIndex('devore', 270),
        'Auto λ with no index at the reference: reported');
}

// ── Monitoring wizard: plan and run ──────────────────────────────────────────
{
    // Default plan at a reference with no index: a layer that cannot be
    // monitored there, or is monitored through one that cannot, is cut by time.
    const table = defaultMonoTable(design(270), resolveMat, { autoPickLambda: false });
    assert.deepEqual(table.slice(0, 3).map(row => row.strategy), ['time', 'time', 'time'],
        'Devore-o layers and the layer on top of one: by time');

    // Auto λ in a band where Devore-o has no index anywhere: by time, no throw.
    const dead = pickMonitoringPlan({ design: design(270), resolveMat, lamA: 250, lamB: 280 });
    assert.deepEqual(dead.slice(0, 3).map(row => row.strategy), ['time', 'time', 'time']);
    // Auto λ in a band reaching below the pole: an optical cut only where it has a signal.
    const plan = pickMonitoringPlan({ design: design(550), resolveMat, lamA: 250, lamB: 350 });
    assert.ok(plan.every(row => row.strategy === 'time' || hasIndex(row.lambda)),
        `no optical cut at a wavelength with no index: ${JSON.stringify(plan)}`);

    const run = monTable => simulateRunMono(design(550), resolveMat, {
        rates: new Map([['devore', { mean: 0.4, sigma: 0.02, corrTime: 5 }], ['SiO2', { mean: 0.5, sigma: 0.02, corrTime: 5 }]]),
        perMaterial: true, monTable,
        mon: { char: 'T', theta: 0, polarization: 'avg', scanIntervalSec: 0.25, confirmScans: 2 },
        sig: { randomPct: 0.3, driftPctPer1000s: 0 },
        recordTrajectory: true, rng: mulberry32(20261003),
    });
    const at = (lambda, strategy) => ({ lambda, strategy, order: 1, sigmaRelPct: 0 });
    assert.equal(run([550, 550, 550, 550].map(l => at(l, 'turning'))).asBuiltFront.length, 4, 'a run with a signal on every layer');
    // A turning cut on Devore-o at 270 nm used to come out at exactly its target.
    assert.throws(() => run([at(550, 'turning'), at(550, 'turning'), at(270, 'turning'), at(550, 'turning')]),
        error => noIndex('devore', 270)(error) && error.layerIndex === 2, 'the run refuses the Devore-o layer');
    // A silica layer monitored at 270 nm through the Devore-o layer beneath it.
    assert.throws(() => run([at(550, 'turning'), at(270, 'level'), at(270, 'time'), at(550, 'turning')]),
        error => noIndex('devore', 270)(error) && error.layerIndex === 1, 'and the layer monitored through it');
    // Cut by time, a layer needs no signal.
    assert.equal(run([at(550, 'turning'), at(550, 'turning'), at(270, 'time'), at(550, 'turning')]).asBuiltFront.length, 4);
}

// ── Thickness offset in optical units ────────────────────────────────────────
{
    assert.ok(Number.isNaN(offsetToPhysicalNm(.1, 'qw', NaN, 270)), 'no index: no physical offset');
    assert.ok(Number.isNaN(offsetToPhysicalNm(.1, 'ot', 0, 270)));
    assert.equal(offsetToPhysicalNm(5, 'nm', NaN, 270), 5, 'an offset in nm needs no index');
    assert.equal(offsetToPhysicalNm(0, 'qw', NaN, 270), 0, 'no offset is no offset');

    const params = { lambdaStart: 400, lambdaEnd: 800, lambdaStep: 50, theta: 0, polarization: 'avg' };
    const offset = (value, unit) => ({ ...emptyDeviation(), globalThicknessOffset: value, globalThicknessOffsetUnit: unit });
    // 0.1 QW on every layer at 270 nm used to add 0 nm to the Devore-o layers.
    assert.throws(() => computeDeviatedSpectrum(design(270), params, offset(.1, 'qw'), 'front', resolveMat),
        noIndex('devore', 270), 'spectrum: reported');
    assert.throws(() => deviatedDesignForSpec(design(270), offset(.1, 'qw'), resolveMat), noIndex('devore', 270),
        'specification verdict: reported');
    assert.throws(() => runDeviationSweep({
        design: design(270), params, evalMode: 'front', resolveMat,
        baseDev: offset(0, 'qw'), sweep: { param: 'globalThicknessOffset', from: -.1, to: .1, steps: 3 },
    }), noIndex('devore', 270), 'sweep: reported');

    assert.ok(computeDeviatedSpectrum(design(270), params, offset(5, 'nm'), 'front', resolveMat).T.length > 0,
        'an offset in nm at the same reference');
    // An optical offset on the silica layers alone needs only silica's index.
    const silicaOnly = { ...emptyDeviation(), perMaterial: { SiO2: { dn: 0, dk: 0, dScale: 1, dOffset: .1, dOffsetUnit: 'qw' } } };
    const layers = perturbLayers(design(270).frontLayers, silicaOnly, resolveMat, 270);
    const nSilica = getMaterial('SiO2').getNK(270)[0];
    assert.deepEqual(layers.map(layer => layer.thickness), [60, 95 + .1 * 270 / (4 * nSilica), 60, 95 + .1 * 270 / (4 * nSilica)],
        'only the layers carrying the offset need an index');
}

console.log('PASS: no_index_monitoring_offsets');
