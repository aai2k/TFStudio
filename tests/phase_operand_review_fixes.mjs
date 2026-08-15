import assert from 'node:assert/strict';

import { getMaterial } from '../src/utils/materials/materialDatabase.js';
import { designMaterialLookup } from '../src/utils/materials/designMaterials.js';
import { phaseOperandScopeNotice } from '../src/components/windows/optimization/phaseOperandScope.js';
import { presampleMaterials } from '../src/components/windows/optimization/refinement/refinementUtils.js';
import {
    buildEvalContext,
    buildPresampledTable,
    calcMF,
    evaluateOperands,
    LSQEngine,
    makeOperand,
    operandEvaluationErrors,
    phaseDispersionThicknessPoint,
} from '../src/utils/physics/optimizer.js';
import { makeResolveMat } from '../src/utils/workers/resolveMat.js';

const design = {
    incidentMedium: 'Air',
    exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1 },
    surfaceMode: 'front_only',
    mfEvalMode: 'side',
    frontLayers: [
        { id: 'front-0', material: 'TiO2', thickness: 92, locked: false },
        { id: 'front-1', material: 'SiO2', thickness: 125, locked: false },
    ],
    backLayers: [],
};
const operands = [
    makeOperand({ type: 'RAV', lambdaStart: 495, lambdaEnd: 505, target: 0.7 }),
    makeOperand({ type: 'GDD', lambdaStart: 550, target: 0 }),
    makeOperand({ type: 'T', lambdaStart: 600, target: 0.3 }),
    makeOperand({ type: 'GDD', lambdaStart: 900, target: 0 }),
];
const resolve = designMaterialLookup(design);
const computed = evaluateOperands(operands, buildEvalContext(design, resolve));
assert.ok(Number.isFinite(computed[0]) && Number.isFinite(computed[1])
    && Number.isFinite(computed[2]), 'valid rows still evaluate');
assert.equal(computed[3], null, 'only the out-of-range phase row is blank');
assert.match(operandEvaluationErrors(computed)[3], /outside the material model range/);
assert.equal(calcMF(operands, computed), Infinity,
    'an invalid enabled target cannot be omitted from merit scoring');
assert.throws(
    () => new LSQEngine(operands, design, resolve),
    /Row 4 GDD: .*outside the material model range/,
    'refinement rejects the invalid row with its row number and reason',
);

const backDesign = {
    ...design,
    surfaceMode: 'back_only',
    frontLayers: [
        { material: 'SiO2', thickness: 80 },
        { material: 'Al2O3', thickness: 90 },
        { material: 'SiO2', thickness: 100 },
        { material: 'Al2O3', thickness: 110 },
    ],
    backLayers: [
        { material: 'SiO2', thickness: 70 },
        { material: 'Al2O3', thickness: 85 },
        { material: 'SiO2', thickness: 95 },
    ],
};
const backContext = buildEvalContext(backDesign, designMaterialLookup(backDesign));
const backPoint = phaseDispersionThicknessPoint(
    makeOperand({ type: 'GDD', lambdaStart: 550, pol: 's' }),
    backContext,
    550,
);
assert.equal(backContext.fullThicks.length, 3,
    'back-only constraints use the active back-coating vector');
assert.equal(backPoint.derivative.length, 3,
    'back phase derivatives use the active back-coating layer count');

const opticalTable = presampleMaterials(design, [operands[0]]);
assert.equal('omegaResponses' in opticalTable.TiO2, false,
    'ordinary optical operands skip omega-response presampling');
const phaseTable = presampleMaterials(design, [operands[1]]);
assert.equal(phaseTable.TiO2.omegaResponses.length, 1,
    'phase operands include exact omega responses');

const directTable = buildPresampledTable(
    [550],
    [{ id: 'TiO2', mat: getMaterial('TiO2') }],
    { includeOmegaResponses: true },
);
const warnings = [];
globalThis.postMessage = message => warnings.push(message);
const workerMaterial = makeResolveMat(directTable, 'review-test')('TiO2');
assert.ok(workerMaterial.getOmegaResponse(550), 'an exact worker jet is available');
assert.equal(workerMaterial.getOmegaResponse(550.01), null,
    'a missing exact worker jet is not replaced by its neighbour');
assert.match(warnings[0].message, /exact omega response unavailable/);

const phaseOp = makeOperand({ type: 'GDD', lambdaStart: 550 });
assert.equal(phaseOperandScopeNotice(
    { ...design, mfEvalMode: 'side' }, [phaseOp], null,
), null, 'single-side merit mode needs no mixed-scope notice');
assert.match(phaseOperandScopeNotice(
    { ...design, mfEvalMode: 'total' }, [phaseOp], null,
), /front coating only/);
assert.match(phaseOperandScopeNotice(
    { ...design, surfaceMode: 'back_only', mfEvalMode: 'total' }, [phaseOp], null,
), /back coating only/);
assert.match(phaseOperandScopeNotice(
    { ...design, surfaceMode: 'both_independent', mfEvalMode: 'side' }, [phaseOp], null,
), /front coating only/, 'automatically full-system modes disclose the same mixed scope');

console.log('PASS: phase_operand_review_fixes');
