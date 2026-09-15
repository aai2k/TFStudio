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
import {
    DEFAULT_CONSTRAINT_LAST_LAYER, makeOperand, makeDmfsOperand, makeConstraintOperand,
} from '../physics/optimizer.js';
import {
    materialIndexFn, buildPrototypeLayers, adjustToIncidentMedium,
    buildFilterTarget, designReference,
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

/** Material id for an engine layer. Every layer carries its material as its tag. */
function materialForLayer(L, matH, matL) {
    return L.tag === 'H' ? matH : matL;
}

/**
 * The finished filter: quarter waves laid at `reference_nm`, then the step-6 coat
 * matched at λ₀ and at the angle the filter is used at.
 *
 * Both the prototype and the coat move when the reference moves, so the
 * reference solve below runs on this whole assembly rather than on the bare
 * prototype: it is the coated filter in air whose passband has to land on λ₀.
 */
function assembleAt({ reference_nm, nH, nL, nInc, nSub, lambda0_nm, candidate, arMode, aoiDeg, pol }) {
    const filterLayers = buildPrototypeLayers({
        nH, nL, lambda0_nm: reference_nm, mirrors: candidate.mirrors, spacers: candidate.spacers,
    });
    return adjustToIncidentMedium({
        filterLayers, nH, nL, nInc, nSub, lambda0_nm, mode: arMode, aoiDeg, pol,
    });
}

/**
 * Build continuous-target merit operands for a band-pass filter.
 *   - DMFS comment header
 *   - TGT  target 1.0 over the passband  [λ₀ ± halfPass]
 *   - TGT  target 0.0 over each stopband [halfStop … halfStop+stopSpan]
 *   - MNT / MXT thickness constraints, over a layer range that also covers the
 *     layers synthesis adds later
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
    // Thickness constraints: one-sided quadratic penalties over every layer.
    const lastLayer = DEFAULT_CONSTRAINT_LAST_LAYER;
    ops.push(makeConstraintOperand({ type: 'MNT', lambdaStart: 1, lambdaEnd: lastLayer, target: minThicknessNm }));
    ops.push(makeConstraintOperand({ type: 'MXT', lambdaStart: 1, lambdaEnd: lastLayer, target: maxThicknessNm }));
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
 * @param {object} p.candidate    { mirrors:[], spacers:[] } from globalIntegerSearch,
 *   both vectors indexed from the substrate
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
        lambda0_nm, candidate, arMode = 'vcoat',
        halfPass, halfStop, aoi = 0, pol = 'avg',
        resolve = getMaterialById,
    } = p;

    const nH = materialIndexFn(matH, resolve);
    const nL = materialIndexFn(matL, resolve);
    const nSub = materialIndexFn(substrateMaterial, resolve);
    const nInc = materialIndexFn(incidentMedium, resolve);

    // A filter used off normal has its passband at a shorter wavelength than the
    // one its quarter waves were laid at, so the reference is stretched until the
    // band lands on λ₀ at the working angle. At normal incidence it stays λ₀.
    const parts = { nH, nL, nInc, nSub, lambda0_nm, candidate, arMode, aoiDeg: aoi, pol };
    const buildAt = (reference_nm) => assembleAt({ ...parts, reference_nm }).layers;
    // The solve runs in the finished filter's own medium at the angle it is used
    // at, so the target carries no angle of its own: it is here for λ₀ and the
    // two half-widths the centring scan is sized from.
    const target = buildFilterTarget({ lambda0_nm, halfPass, halfStop, pol });
    const reference_nm = designReference({ buildAt, target, nSub, nInc, aoiDeg: aoi });
    const adj = assembleAt({ ...parts, reference_nm });

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
        // The layers are quarter waves at the build reference, not at λ₀, so this
        // is the wavelength their QWOT values come out whole at.
        referenceWavelength: reference_nm,
        meritOperands: operands,
        notes:
            `Generated by Filter Design wizard\n` +
            `λ₀ = ${lambda0_nm} nm,  H = ${matH},  L = ${matL},  substrate = ${substrateMaterial}\n` +
            `${candidate.mirrors.length - 1}-cavity, mirrors=[${candidate.mirrors.join(' ')}] ` +
            `spacers=[${candidate.spacers.join(' ')}] (substrate first)\n` +
            (aoi > 0
                ? `Working angle ${aoi}° (${pol}), quarter waves laid at ${reference_nm.toFixed(2)} nm so the band sits at λ₀ there\n`
                : '') +
            `AR: ${arMode}.  ${frontLayers.length} layers, Th ≈ ${totalNm.toFixed(1)} nm`,
        filterRecipe: {
            lambda0_nm, halfPass, halfStop, arMode, aoi, pol, reference_nm,
            matH, matL, substrateMaterial, incidentMedium, exitMedium,
            mirrors: candidate.mirrors, spacers: candidate.spacers,
        },
    };
}
