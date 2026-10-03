/**
 * The deposition steps of a Process Exporter save and the spectrum at each.
 *
 * A step is the state after layers 1..k of the active coating are deposited at
 * full thickness, with the opposite surface fixed (bare or fully coated) for
 * the whole run. The piece is read in the chamber, in air. On witness chips
 * each chip is its own short run on bare chip glass.
 *
 * Layer-numbering convention (chamber deposition order):
 *   Layer 1 = first deposited = layer touching substrate.
 *   Layer N = last deposited  = outermost layer.
 *
 * TFStudio array convention:
 *   frontLayers: [topmost, ..., layer touching substrate]   (last = substrate-side)
 *   backLayers:  [layer touching substrate, ..., outermost] (first = substrate-side)
 */

import { evaluateDepositionSpectra, evaluateSpectrumTotal } from '../physics/thinFilmMath.js';
import { designMaterialLookup } from '../materials/designMaterials.js';
import { CHAMBER_MEDIUM_ID } from '../monitoring/chamberMedium.js';
import { chipsInRunOrder } from '../monitoring/monoSim.js';

// The spectrum of one step evaluated from its own partial stack: layers 1..k
// at full thickness, the rest at zero, over the whole system. A back-side run
// takes this path for every step; a front-side run and a witness chip are
// evaluated in one pass instead (see runSteps).
export function stepSpectrum(cfg) {
    const {
        aoi, polarization, lambdaStart, lambdaEnd, lambdaStep,
        allLayers, stepK, substrateMat, substrateThk,
        incidentMat, exitMat, otherSideLayers, activeSide,
    } = cfg;

    // ── 1. Build partial-deposition state in DEPOSITION ORDER ────────────────
    const activeStateDep = allLayers.map((l, i) => ({
        materialId: l.materialId,
        matObj:     l.matObj,
        thickness:  (i + 1) <= stepK ? l.thickness : 0,
    }));

    // ── 2. Convert to TFStudio storage order for evaluateSpectrumTotal ───────
    // frontLayers storage: top→substrate (substrate-side LAST)
    // backLayers  storage: substrate→exit (substrate-side FIRST)
    // Our deposition-order array has substrate-side at index 0.
    let frontStored, backStored;
    if (activeSide === 'front') {
        // active = front: deposition order → reverse for frontLayers storage
        frontStored = [...activeStateDep].reverse();
        // other side = back: otherSideLayers is in deposition order (sub-side first),
        // which already matches backLayers storage convention.
        backStored  = otherSideLayers.slice();
    } else {
        // active = back: deposition order is sub-side first → matches backLayers
        backStored  = activeStateDep.slice();
        // other side = front: otherSideLayers in deposition order → reverse for storage
        frontStored = [...otherSideLayers].reverse();
    }

    // ── 3. Spectrum (engine builds the lambda grid internally) ──────────────
    return evaluateSpectrumTotal(
        { lambdaStart, lambdaEnd, lambdaStep, theta: aoi, polarization },
        incidentMat, substrateMat, exitMat,
        frontStored.map(l => ({ material: l.matObj, thickness: l.thickness })),
        backStored .map(l => ({ material: l.matObj, thickness: l.thickness })),
        substrateThk,
    );
}

/**
 * The steps of one save in run order, as `{ cfg, run, index, total }`: `cfg`
 * is what the step's .res file is built from, its spectrum included; `run` is
 * the part or the chip the step belongs to, with its size, folder and, on a
 * chip, the design layer of each of its steps.
 *
 * A front-side run is one growing stack on a fixed back, and a witness chip
 * is one on bare glass, so their spectra come from one pass over the run
 * before the first step: the work then grows with the layer count, not with
 * its square. A back-side run grows behind the substrate, where there is no
 * growing kernel, so each of its steps is evaluated as it is reached.
 *
 * opts: activeSide, secondSurface ('bare' | 'coated'), quantity, aoi
 * (degrees), polarization, lambdaStart, lambdaEnd, lambdaStep (nm), outputDir,
 * appVersion, projectLabel, and chips ({ chipByStep, chipMaterial,
 * witnessRatio } for a run read on witness chips, null for the part).
 */
export function* runSteps(design, opts) {
    const setup = runSetup(design, opts);
    if (!setup) return;
    yield* (opts.chips ? chipSteps(setup, opts) : partSteps(setup, opts));
}

function runSetup(design, opts) {
    const {
        activeSide, quantity, aoi, polarization,
        lambdaStart, lambdaEnd, lambdaStep,
        appVersion = '',
        projectLabel = '',
        chips = null,
    } = opts;

    const resolveMaterial = designMaterialLookup(design);
    const controlLambda = design.referenceWavelength || 550;
    // The part or the chip sits in the chamber: air on both sides of it,
    // whatever media the design is embedded in. The header's match medium of
    // 1.0 tells the monitoring software the same.
    const air          = resolveMaterial(CHAMBER_MEDIUM_ID);
    const substrateMat = resolveMaterial((chips && chips.chipMaterial) || design.substrate?.material);
    const substrateThk = design.substrate?.thickness || 1.0;

    // Deposition order, substrate side first, over every layer of the side so
    // a chip plan indexed by step still applies once the empty layers are
    // dropped. frontLayers storage is substrate-side last, backLayers storage
    // substrate-side first.
    const frontStored = design.frontLayers || [];
    const backStored  = design.backLayers || [];
    const activeAll   = activeSide === 'front' ? [...frontStored].reverse() : backStored.slice();
    const otherDep    = (activeSide === 'front' ? backStored.slice() : [...frontStored].reverse())
        .filter(l => l && l.thickness > 0);

    const ratio = chips ? (chips.witnessRatio || 1) : 1;
    const allLayers = activeAll
        .map((l, step) => ({ l, chip: chips ? (chips.chipByStep?.[step] ?? 1) : null }))
        .filter(({ l }) => l && l.thickness > 0)
        .map(({ l, chip }) => ({
            materialId: l.material,
            thickness:  l.thickness * ratio,
            matObj:     resolveMaterial(l.material),
            chip,
        }));

    const N = allLayers.length;
    if (N === 0) return null;

    const common = {
        designName: design.name, controlLambda, aoi, polarization, quantity,
        lambdaStart, lambdaEnd, lambdaStep, substrateMat, substrateThk,
        incidentMat: air, exitMat: air, appVersion, projectLabel, runSize: N,
    };
    const params = { lambdaStart, lambdaEnd, lambdaStep, theta: aoi, polarization };
    return { allLayers, otherDep, resolveMaterial, common, params, air, substrateMat, substrateThk };
}

const asDeposition = l => ({ material: l.matObj, thickness: l.thickness });

// Each chip is its own short run from bare glass, grown like a front coating
// whichever side of the part the run deposits, back face bare. Its files go in
// a folder of their own, numbered from 01 on the chip, and each one names the
// design layer it belongs to.
function* chipSteps(setup, opts) {
    const { allLayers, common, params, air, substrateMat, substrateThk } = setup;
    const outputDir = opts.outputDir || '';
    const N = allLayers.length;
    let index = 0;
    for (const { chip, steps } of chipsInRunOrder(allLayers.map(l => l.chip))) {
        const subdir = `chip-${chip}`;
        const chipLayers = steps.map(i => allLayers[i]);
        const run = { chip, subdir, size: chipLayers.length, designLayers: steps.map(i => i + 1) };
        const spectra = evaluateDepositionSpectra(
            params, air, substrateMat, air, chipLayers.map(asDeposition), [], substrateThk);
        for (let k = 1; k <= chipLayers.length; k++) {
            const cfg = {
                ...common, allLayers: chipLayers, stepK: k, spectrum: spectra[k - 1],
                otherSideLayers: [], activeSide: 'front',
                outputDir: outputDir ? `${outputDir.replace(/[\\/]+$/, '')}\\${subdir}` : subdir,
                comment: `Witness chip ${chip}, layer ${k} of ${chipLayers.length} on the chip: `
                    + `design layer ${steps[k - 1] + 1} of ${N}`,
            };
            index += 1;
            yield { cfg, run, index, total: N };
        }
    }
}

function* partSteps(setup, opts) {
    const { allLayers, otherDep, resolveMaterial, common, params, air, substrateMat, substrateThk } = setup;
    const { activeSide, secondSurface, outputDir = '' } = opts;
    const N = allLayers.length;
    const otherSideLayers = (secondSurface === 'coated')
        ? otherDep.map(l => ({
            materialId: l.material,
            thickness:  l.thickness,
            matObj:     resolveMaterial(l.material),
        }))
        : [];

    // The other side of a front-side run is the back coating, whose deposition
    // order is its storage order.
    const spectra = activeSide === 'front'
        ? evaluateDepositionSpectra(params, air, substrateMat, air,
            allLayers.map(asDeposition), otherSideLayers.map(asDeposition), substrateThk)
        : null;

    const run = { chip: null, subdir: null, size: N };
    for (let k = 1; k <= N; k++) {
        const cfg = { ...common, allLayers, stepK: k, otherSideLayers, activeSide, outputDir };
        cfg.spectrum = spectra ? spectra[k - 1] : stepSpectrum(cfg);
        yield { cfg, run, index: k, total: N };
    }
}
