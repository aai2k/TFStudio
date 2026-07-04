/**
 * Filter Design → TFStudio Design assembly.
 *
 * Bridges the pure engine (`filterDesign.js`) to an app Design object:
 *   - resolves catalog material ids into engine index functions,
 *   - builds the embedded prototype for a chosen integer-search candidate,
 *   - applies the step-6 AR / V-coat,
 *   - maps engine layers (incident→substrate order) to `frontLayers`,
 *   - emits **continuous range-target operands** (TGT: passband T→1, stopbands
 *     T→0) — the same continuous-target machinery the rest of TFStudio uses —
 *     so the generated design is immediately consistent with the MF Editor and
 *     ready for Refinement.
 *
 * Kept separate from `filterDesign.js` so the engine itself stays free of the
 * optimizer/operand imports (and Node-testable in isolation).
 */

import { getMaterialById } from '../materials/catalogManager.js';
import { makeOperand, makeDmfsOperand, makeConstraintOperand } from '../physics/optimizer.js';
import {
    materialIndexFn, buildPrototypeLayers, adjustToIncidentMedium,
    buildFilterTarget,
} from './filterDesign.js';

function _uid() { return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; }

/**
 * Pre-sample materials onto a dense λ grid so they can cross the Web Worker
 * boundary (functions don't serialize). The worker rebuilds an interpolating
 * index function from the grid. λ range covers the whole filter spectral window.
 *
 * @returns {{ lambdas:number[], H:[n,k][], L:[n,k][], Sub:[n,k][] }}
 */
export function presampleForSearch({ matH, matL, substrateMaterial, lamLo, lamHi, step = 0.05, resolve = getMaterialById }) {
    const nkFn = (id) => materialIndexFn(id, resolve);
    const fH = nkFn(matH), fL = nkFn(matL), fS = nkFn(substrateMaterial);
    const lambdas = [], H = [], L = [], Sub = [];
    for (let lam = lamLo; lam <= lamHi + 1e-9; lam += step) {
        const x = Math.round(lam * 1000) / 1000;
        lambdas.push(x);
        H.push(fH(x)); L.push(fL(x)); Sub.push(fS(x));
    }
    return { lambdas, H, L, Sub };
}

/** Material id for an engine layer given the H/L/spacer assignment. */
function materialForLayer(L, matH, matL) {
    if (L.tag === 'H') return matH;
    if (L.tag === 'L') return matL;
    if (L.tag === 'spacer') return L.spacerKind === 'H' ? matH : matL;
    if (L.tag === 'ar') return L.arMat === 'H' ? matH : matL;
    return matL;
}

/**
 * Build continuous-target merit operands for a band-pass filter.
 *   - DMFS comment header
 *   - TGT  target 1.0 over the passband  [λ₀ ± halfPass]
 *   - TGT  target 0.0 over each stopband [halfStop … halfStop+stopSpan]
 *   - MNT / MXT thickness constraints (9999 sentinel → cover later-added layers)
 */
export function buildFilterOperands({
    lambda0_nm, halfPass, halfStop, aoi = 0, pol = 'avg',
    stopSpan = null, minThicknessNm = 7, maxThicknessNm = 9999, label = 'Filter',
}) {
    const span = stopSpan || Math.max(halfStop * 2.5, halfStop + 5 * halfPass);
    const ops = [];
    ops.push(makeDmfsOperand(
        `${label}  λ₀=${lambda0_nm.toFixed(1)} nm  passband ±${halfPass} nm (T≥89.13%)  ` +
        `reject ±${halfStop} nm (T≤0.1%)  AOI=${aoi}°  pol=${pol}`));
    // Passband: continuous T target = 1
    ops.push(makeOperand({
        type: 'TGT', target: 1.0, targetEnd: 1.0,
        lambdaStart: lambda0_nm - halfPass, lambdaEnd: lambda0_nm + halfPass,
        aoi, pol, weight: 1.0,
    }));
    // Low stopband: continuous T target = 0
    ops.push(makeOperand({
        type: 'TGT', target: 0.0, targetEnd: 0.0,
        lambdaStart: lambda0_nm - halfStop - span, lambdaEnd: lambda0_nm - halfStop,
        aoi, pol, weight: 1.0,
    }));
    // High stopband: continuous T target = 0
    ops.push(makeOperand({
        type: 'TGT', target: 0.0, targetEnd: 0.0,
        lambdaStart: lambda0_nm + halfStop, lambdaEnd: lambda0_nm + halfStop + span,
        aoi, pol, weight: 1.0,
    }));
    // Thickness constraints (one-sided quadratic penalties; sentinel covers all layers)
    ops.push(makeConstraintOperand({ type: 'MNT', lambdaStart: 1, lambdaEnd: 9999, target: minThicknessNm }));
    ops.push(makeConstraintOperand({ type: 'MXT', lambdaStart: 1, lambdaEnd: 9999, target: maxThicknessNm }));
    return ops;
}

/**
 * Assemble a complete TFStudio Design from a chosen integer-search candidate.
 *
 * @param {object} p
 * @param {string} p.name
 * @param {string} p.matH @param {string} p.matL  catalog material ids
 * @param {string} p.substrateMaterial @param {number} [p.substrateThicknessMm=1]
 * @param {string} [p.incidentMedium='Air'] @param {string} [p.exitMedium='Air']
 * @param {number} p.lambda0_nm
 * @param {object} p.candidate    { mirrors:[], spacers:[] } from globalIntegerSearch
 * @param {'H'|'L'} [p.spacerKind='L']
 * @param {'none'|'1layer'|'vcoat'} [p.arMode='vcoat']
 * @param {number} p.halfPass @param {number} p.halfStop
 * @param {number} [p.aoi=0] @param {string} [p.pol='avg']
 * @param {object} [p.resolve=getMaterialById]   material resolver (testable)
 * @returns {object} Design with frontLayers (incident→substrate) + continuous operands
 */
export function buildFilterDesignObject(p) {
    const {
        name = 'Filter Design',
        matH, matL, substrateMaterial,
        substrateThicknessMm = 1.0,
        incidentMedium = 'Air', exitMedium = 'Air',
        lambda0_nm, candidate, spacerKind = 'L', arMode = 'vcoat',
        halfPass, halfStop, aoi = 0, pol = 'avg',
        resolve = getMaterialById,
    } = p;

    const nH = materialIndexFn(matH, resolve);
    const nL = materialIndexFn(matL, resolve);
    const nSub = materialIndexFn(substrateMaterial, resolve);
    const nInc = materialIndexFn(incidentMedium, resolve);

    const filterLayers = buildPrototypeLayers({
        nH, nL, lambda0_nm, mirrors: candidate.mirrors, spacers: candidate.spacers, spacerKind,
    });
    const target = buildFilterTarget({ lambda0_nm, halfPass, halfStop });
    const adj = adjustToIncidentMedium({
        filterLayers, nH, nL, nInc, nSub, lambda0_nm, target, mode: arMode,
    });

    const seed = _uid();
    const frontLayers = adj.layers.map((L, i) => ({
        id: `l-${seed}-${i}`,
        material: materialForLayer(L, matH, matL),
        thickness: L.d,
        locked: false,
    }));

    const operands = buildFilterOperands({
        lambda0_nm, halfPass, halfStop, aoi, pol,
        label: `Filter ${candidate.mirrors.length - 1}-cavity`,
    });

    const totalNm = frontLayers.reduce((s, l) => s + l.thickness, 0);
    return {
        id: `design-${seed}`,
        name,
        incidentMedium,
        substrate: { material: substrateMaterial, thickness: substrateThicknessMm },
        exitMedium,
        surfaceMode: 'front_only',
        frontLayers,
        backLayers: [],
        referenceWavelength: lambda0_nm,
        meritOperands: operands,
        notes:
            `Generated by Filter Design wizard\n` +
            `λ₀ = ${lambda0_nm} nm,  H = ${matH},  L = ${matL},  substrate = ${substrateMaterial}\n` +
            `${candidate.mirrors.length - 1}-cavity, mirrors=[${candidate.mirrors.join(' ')}] ` +
            `spacers=[${candidate.spacers.join(' ')}] (${spacerKind}-spacer)\n` +
            `AR: ${arMode}.  ${frontLayers.length} layers, Th ≈ ${totalNm.toFixed(1)} nm`,
        filterRecipe: {
            lambda0_nm, halfPass, halfStop, spacerKind, arMode, aoi, pol,
            matH, matL, substrateMaterial, incidentMedium, exitMedium,
            mirrors: candidate.mirrors, spacers: candidate.spacers,
        },
    };
}
