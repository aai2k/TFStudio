import assert from 'node:assert/strict';

import { getMaterial } from '../src/utils/materials/materialDatabase.js';
import { designMaterialLookup } from '../src/utils/materials/designMaterials.js';
import {
    evaluateDesignPhaseDispersion,
    evaluateStackPhaseDispersion,
} from '../src/utils/physics/phaseDispersion.js';
import { evaluateOperands } from '../src/utils/physics/optimizer/evalCore.js';
import { LSQEngine } from '../src/utils/physics/optimizer/lsqEngine.js';

const layers = [
    { material: getMaterial('Al2O3'), thicknessNm: 104.2 },
    { material: getMaterial('SiO2'), thicknessNm: 91.7 },
    { material: getMaterial('Al2O3'), thicknessNm: 77.3 },
    { material: getMaterial('SiO2'), thicknessNm: 138.4 },
];
const stack = {
    wavelengthNm: 537.2,
    thetaDeg: 27,
    incidentMaterial: getMaterial('Air'),
    substrateMaterial: getMaterial('BK7'),
};

for (const target of ['R', 'T']) {
    for (const polarization of ['s', 'p']) {
        const analytic = evaluateStackPhaseDispersion({
            ...stack,
            target,
            polarization,
            layers,
            withThicknessJacobian: true,
        });
        assert.ok(analytic.valid && analytic.thicknessJacobian,
            `${target}/${polarization} returns a thickness Jacobian`);
        for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
            const step = 1e-3;
            const plus = layers.map(layer => ({ ...layer }));
            const minus = layers.map(layer => ({ ...layer }));
            plus[layerIndex].thicknessNm += step;
            minus[layerIndex].thicknessNm -= step;
            const upper = evaluateStackPhaseDispersion({
                ...stack, target, polarization, layers: plus,
            });
            const lower = evaluateStackPhaseDispersion({
                ...stack, target, polarization, layers: minus,
            });
            for (const quantity of ['phaseDeg', 'gdFs', 'gddFs2', 'todFs3']) {
                const finiteDifference = (upper[quantity] - lower[quantity]) / (2 * step);
                const actual = analytic.thicknessJacobian[quantity][layerIndex];
                const scale = Math.max(1, Math.abs(finiteDifference));
                assert.ok(Math.abs(actual - finiteDifference) < 2e-7 * scale,
                    `${target}/${polarization} ${quantity} layer ${layerIndex} matches thickness FD`);
            }
        }
    }
}

const design = {
    incidentMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1 },
    exitMedium: 'Air',
    surfaceMode: 'front_only',
    mfEvalMode: 'side',
    frontLayers: layers.map((layer, index) => ({
        id: `layer-${index}`,
        material: index % 2 === 0 ? 'Al2O3' : 'SiO2',
        thickness: layer.thicknessNm,
        locked: false,
    })),
    backLayers: [],
};
const operands = [
    {
        id: 'reflectance', enabled: true, type: 'RAV', lambdaStart: 525,
        lambdaEnd: 545, aoi: 27, pol: 'avg', target: 0.8, weight: 1,
    },
    {
        id: 'gdd-flat', enabled: true, type: 'GDDTFLAT', lambdaStart: 525,
        lambdaEnd: 545, aoi: 27, pol: 'avg', target: -4, weight: 2,
    },
    {
        id: 'tod-point', enabled: true, type: 'TOD', lambdaStart: 537.2,
        lambdaEnd: 537.2, aoi: 27, pol: 'p', target: 10, weight: 0.7,
    },
    {
        id: 'differential-phase', enabled: true, type: 'DPT', lambdaStart: 537.2,
        lambdaEnd: 537.2, aoi: 27, pol: 'avg', target: 5, weight: 0.4,
    },
];
const engine = new LSQEngine(operands, design, designMaterialLookup(design));
const free = engine.thicknesses.map((_, index) => index);
const computed = evaluateOperands(operands, engine._ctxFor(engine.thicknesses));
const analyticRows = engine._analyticJacobian(engine.thicknesses, free, computed);
assert.ok(analyticRows, 'phase operands keep the analytic DLS Jacobian');
assert.equal(analyticRows.length, operands.length, 'one analytic row per operand');

for (const layerIndex of free) {
    const step = 1e-3;
    const plus = [...engine.thicknesses];
    const minus = [...engine.thicknesses];
    plus[layerIndex] += step;
    minus[layerIndex] -= step;
    const upper = engine._residuals(plus);
    const lower = engine._residuals(minus);
    for (let rowIndex = 0; rowIndex < analyticRows.length; rowIndex++) {
        const finiteDifference = (upper[rowIndex] - lower[rowIndex]) / (2 * step);
        const actual = analyticRows[rowIndex][layerIndex];
        const scale = Math.max(1, Math.abs(finiteDifference));
        assert.ok(Math.abs(actual - finiteDifference) < 3e-7 * scale,
            `operand row ${rowIndex}, layer ${layerIndex} matches residual FD`);
    }
}

const backDesign = {
    ...design,
    surfaceMode: 'back_only',
    frontLayers: [
        { id: 'fixed-front', material: 'SiO2', thickness: 115, locked: true },
    ],
    backLayers: [
        { id: 'back-0', material: 'MgF2', thickness: 82.4, locked: false },
        { id: 'back-1', material: 'Al2O3', thickness: 106.3, locked: false },
        { id: 'back-2', material: 'SiO2', thickness: 71.8, locked: false },
    ],
};
const backOperands = [
    {
        id: 'back-gdd', enabled: true, type: 'GDD', lambdaStart: 537.2,
        lambdaEnd: 537.2, aoi: 27, pol: 'p', target: -3, weight: 1.2,
    },
    {
        id: 'back-transmission-tod', enabled: true, type: 'TODT', lambdaStart: 531.5,
        lambdaEnd: 531.5, aoi: 27, pol: 's', target: 4, weight: 0.8,
    },
];
const backEngine = new LSQEngine(
    backOperands,
    backDesign,
    designMaterialLookup(backDesign),
);
const backComputed = evaluateOperands(
    backOperands,
    backEngine._ctxFor(backEngine.thicknesses),
);
for (let index = 0; index < backOperands.length; index++) {
    const operand = backOperands[index];
    const expected = evaluateDesignPhaseDispersion(backDesign, {
        wavelengthNm: operand.lambdaStart,
        side: 'back',
        target: operand.type.endsWith('T') ? 'T' : 'R',
        polarization: operand.pol,
        thetaDeg: operand.aoi,
    });
    const quantity = operand.type.startsWith('TOD') ? 'todFs3' : 'gddFs2';
    assert.equal(backComputed[index], expected[quantity],
        `${operand.type} evaluates the back coating from the exit medium`);
}

const backFree = backEngine.thicknesses.map((_, index) => index);
const backAnalyticRows = backEngine._analyticJacobian(
    backEngine.thicknesses,
    backFree,
    backComputed,
);
assert.ok(backAnalyticRows, 'back-side phase operands keep the analytic DLS Jacobian');
for (const layerIndex of backFree) {
    const step = 1e-3;
    const plus = [...backEngine.thicknesses];
    const minus = [...backEngine.thicknesses];
    plus[layerIndex] += step;
    minus[layerIndex] -= step;
    const upper = backEngine._residuals(plus);
    const lower = backEngine._residuals(minus);
    for (let rowIndex = 0; rowIndex < backAnalyticRows.length; rowIndex++) {
        const finiteDifference = (upper[rowIndex] - lower[rowIndex]) / (2 * step);
        const actual = backAnalyticRows[rowIndex][layerIndex];
        const scale = Math.max(1, Math.abs(finiteDifference));
        assert.ok(Math.abs(actual - finiteDifference) < 3e-7 * scale,
            `back operand row ${rowIndex}, layer ${layerIndex} matches residual FD`);
    }
}

console.log('PASS: phase_dispersion_optimizer_jacobian');
