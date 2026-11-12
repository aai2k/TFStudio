/**
 * Designs for the environment window tests: a four-layer TiO2 / MgF2 AR on
 * BK7 with merit rows, as a design with one environment and as one with three
 * (environment 2 on sapphire, environment 3 switched off with thinner TiO2),
 * where one row is scored on sapphire alone.
 */
import { makeOperand } from '../src/utils/physics/optimizer.js';

const row = (spec, id) => ({ ...makeOperand(spec), id });

export function oneEnvironmentDesign() {
    return {
        id: 'env-window', name: 'AR on three substrates',
        incidentMedium: 'builtin:Air', exitMedium: 'builtin:Air',
        substrate: { material: 'builtin:BK7', thickness: 1 },
        referenceWavelength: 550, surfaceMode: 'front_only', mfEvalMode: 'side',
        frontLayers: [
            { id: 'l1', material: 'builtin:TiO2', thickness: 11.92 },
            { id: 'l2', material: 'builtin:MgF2', thickness: 51.81 },
            { id: 'l3', material: 'builtin:TiO2', thickness: 16.68 },
            { id: 'l4', material: 'builtin:MgF2', thickness: 118.58 },
        ],
        backLayers: [],
        meritOperands: [
            row({ type: 'DMFS', comment: 'AR' }, 'h1'),
            row({ type: 'RAV', lambdaStart: 420, lambdaEnd: 680, aoi: 0, pol: 'avg', target: 0, weight: 1 }, 'r1'),
            row({ type: 'R', lambdaStart: 550, aoi: 30, pol: 'avg', target: 0, weight: 1 }, 'r2'),
            row({ type: 'CONS', target: 0.5 }, 'k1'),
            row({ type: 'MXT', lambdaStart: 1, lambdaEnd: 4, target: 300, weight: 1 }, 'x1'),
        ],
    };
}

export function threeEnvironmentDesign() {
    const design = oneEnvironmentDesign();
    return {
        ...design,
        environments: [
            { id: 'base', name: 'BK7' },
            { id: 'env2', name: 'Sapphire', substrate: { material: 'builtin:Al2O3' } },
            { id: 'env3', thicknessFactors: { 'builtin:TiO2': 0.95 }, enabled: false },
        ],
        meritOperands: design.meritOperands.map(op => (op.id === 'r2' ? { ...op, env: 'env2' } : op)),
    };
}
