/**
 * Optical monitoring worksheet: can this design be terminated on a monitor?
 *
 * The monitoring simulator answers "what would one run look like". This module
 * answers the question that comes before it: for every layer of the run, how
 * much signal is available to stop on, where the stop sits between the two
 * turning points that bracket it, and how far the thickness moves when the
 * monitor signal is wrong by its own error.
 *
 * A run is monitored on witness chips, not on the growing part. Each chip
 * carries only the layers assigned to it, so a chip is its own short coating
 * starting from bare glass. Layers per chip is the lever the designer pulls:
 * too many, and the later layers on that chip sit on a signal with no swing
 * left. Two to four is the usual range.
 *
 * A chip is identified by its number. Layers carrying the same number are on
 * the same physical piece even when they are not deposited one after another,
 * which is what a multi-position witness holder allows: the chip comes back in
 * with what is already on it. The run axis is worked out first, over the whole
 * deposition sequence, so the chips are free of it.
 *
 * Every layer on a chip is monitored at one wavelength, taken from the first
 * layer assigned to that chip. A layer too thin to show a turning point of its
 * own has to borrow the one before it, and that only exists on the same curve.
 *
 * The per-chip work is in worksheetChip.js and the single-layer signal in
 * worksheetSignal.js.
 *
 * References:
 *   - H. A. Macleod, Thin-Film Optical Filters, 5th ed., Ch. 12.
 *   - A. V. Tikhonravov, M. K. Trubetskov, T. V. Amotchkina, Appl. Opt. 45,
 *     7863 (2006), on choosing a monochromatic monitoring strategy.
 *   - FTG Software, FilmStar MONITOR, "Optical Monitoring with Design
 *     Software?", for the worksheet columns, two to four layers per chip, and
 *     the rule that a calculation uses the last two turning points, which may
 *     fall in previous layers.
 */

import { CHAMBER_MEDIUM_ID } from '../chamberMedium.js';
import { buildChipRows } from './worksheetChip.js';

export const WORKSHEET_DEFAULTS = {
    char: 'T',
    theta: 0,
    pol: 'avg',
    chipMaterial: null,
    witnessRatio: 1,
    layersPerChip: 3,
    signalErrorPct: 0.3,
    absSignalErrorPct: 0.1,
    maxTerminationErrPct: 1,
    coarse: false,
    withCurve: true,
};

/** Storage indices of `frontLayers` in the order they are deposited. */
export function depositionOrder(frontLayers) {
    const order = [];
    for (let i = (frontLayers || []).length - 1; i >= 0; i--) order.push(i);
    return order;
}

/** Chip number (1-based) for every deposition step, `perChip` layers per chip. */
export function assignChips(stepCount, perChip) {
    const size = Math.max(1, Math.floor(perChip) || 1);
    return Array.from({ length: Math.max(0, stepCount) },
        (_, step) => Math.floor(step / size) + 1);
}

/**
 * The run in deposition order, each layer carrying the thickness the part
 * receives, the thickness the witness receives, the chip it is monitored on,
 * and where it sits on the run axis: cumulative optical thickness in quarter
 * waves at the design reference wavelength.
 */
function runLayout(design, resolveMat, cfg, refLam) {
    const front = design.frontLayers || [];
    const chipByStep = resolveChipByStep(cfg, front.length);
    const layers = [];
    let x = 0;
    depositionOrder(front).forEach((layerIndex, step) => {
        const layer = front[layerIndex];
        const partThickness = Math.max(0, layer.thickness || 0);
        const thickness = partThickness * cfg.witnessRatio;
        const nRef = Math.max(1e-6, resolveMat(layer.material).getNK(refLam)[0] || 1.6);
        const xPerNm = 4 * nRef / refLam;
        layers.push({
            step: step + 1,
            layerIndex,
            material: layer.material,
            chip: chipByStep[step] || 1,
            partThickness,
            thickness,
            xStart: x,
            xPerNm,
        });
        x += thickness * xPerNm;
    });
    return { layers, xEnd: x };
}

// Layers grouped onto the physical chip they are monitored on, chips in the
// order they first enter the run.
function chipGroups(layers) {
    const byChip = new Map();
    for (const layer of layers) {
        if (!byChip.has(layer.chip)) byChip.set(layer.chip, []);
        byChip.get(layer.chip).push(layer);
    }
    return [...byChip].map(([chip, own]) => ({ chip, layers: own }));
}

// The witness chip's glass is the design substrate unless `chipMaterial` names
// another material, for a witness that is not the same glass as the part. The
// chip hangs in the chamber, so it is read in air whatever medium the design
// is embedded in.
function opticalSystem(design, resolveMat, { char, theta, pol, chipMaterial }) {
    const subId = chipMaterial || (design.substrate?.material ?? 'BK7');
    return {
        theta, pol, char,
        incMat: resolveMat(CHAMBER_MEDIUM_ID), subMat: resolveMat(subId),
        subThickMM: design.substrate?.thickness ?? 1,
    };
}

function resolveChipByStep(cfg, stepCount) {
    return cfg.chipByStep && cfg.chipByStep.length === stepCount
        ? cfg.chipByStep
        : assignChips(stepCount, cfg.layersPerChip);
}

// Termination error of every layer on a chip at each candidate wavelength: a
// row per wavelength, a column per layer, null for a layer cut on time.
function chipErrorTable({ group, sys, resolveMat, cfg, lams }) {
    return lams.map(lam => buildChipRows({
        chip: group.chip, layers: group.layers, lam, sys, resolveMat, opts: cfg,
    }).rows.map(row => row.terminationErrPct));
}

// How badly a wavelength serves the chip: the worst of the layers the choice
// can do anything for. A layer cut on time has no optical error to report. A
// layer with no signal at any candidate, one of the chip's own index, is going
// to the crystal whichever wavelength is picked, so it takes no part either. A
// layer dead at this wavelength and alive at another does take part, and this
// wavelength loses.
function wavelengthScore(errs, inPlay) {
    return errs.reduce((worst, err, i) => (inPlay[i] ? Math.max(worst, err) : worst), 0);
}

/**
 * Build the worksheet for a design.
 *
 * @param {object} design      the coating; only `frontLayers` are deposited
 * @param {(id:string)=>object} resolveMat  material lookup
 * @param {object} [opts]
 *   char, theta, pol         what the monitor measures and through what geometry
 *   chipMaterial             the witness chip's glass; the design substrate
 *                            when not set
 *   witnessRatio             witness thickness / part thickness
 *   layersPerChip            chip size used when `chipByStep` is not given
 *   chipByStep               chip number per deposition step, overriding the above
 *   lambdaByStep             monitor wavelength per deposition step; a chip is
 *                            monitored at the wavelength of its first layer
 *   signalErrorPct           the monitor's signal error, as a percentage of the
 *                            reading, on the same convention as the Monitoring
 *                            Simulator's random signal error
 *   absSignalErrorPct        the monitor's photometric noise floor, in percent
 *                            of full scale; it does not shrink with the
 *                            reading, which is what rules out a wavelength
 *                            where the signal has saturated
 *   maxTerminationErrPct     a layer is flagged when the termination error
 *                            exceeds this percentage of its own thickness
 * @returns {{ rows, chips, xEnd }} rows in deposition order.
 */
export function buildMonitorWorksheet(design, resolveMat, opts = {}) {
    const cfg = { ...WORKSHEET_DEFAULTS, ...opts };
    const front = design?.frontLayers || [];
    if (!front.length) return { rows: [], chips: [], xEnd: 0 };

    const refLam = design.referenceWavelength || 550;
    const sys = opticalSystem(design, resolveMat, cfg);
    const layout = runLayout(design, resolveMat, cfg, refLam);

    const rows = [];
    const chips = [];
    for (const group of chipGroups(layout.layers)) {
        const lam = cfg.lambdaByStep?.[group.layers[0].step - 1] || refLam;
        const built = buildChipRows({
            chip: group.chip, layers: group.layers, lam, sys, resolveMat, opts: cfg,
        });
        rows.push(...built.rows);
        chips.push({
            chip: group.chip,
            lambda: lam,
            initialLevel: built.initialLevel,
            steps: group.layers.map(layer => layer.step),
        });
    }
    rows.sort((a, b) => a.step - b.step);
    return { rows, chips, xEnd: layout.xEnd };
}

// The wavelength whose worst served layer on this chip terminates most
// precisely. The design's own reference wavelength is the incumbent, so a chip
// whose layers all score the same keeps it rather than drifting to the edge of
// the band.
function bestLambdaForChip({ group, sys, resolveMat, band, cfg }) {
    const lams = [band.refLam];
    for (let g = 0; g < band.steps; g++) {
        lams.push(band.lamA + (g * (band.lamB - band.lamA)) / (band.steps - 1));
    }
    const table = chipErrorTable({ group, sys, resolveMat, cfg, lams });
    const inPlay = group.layers.map((_, i) => table.some(errs => Number.isFinite(errs[i])));
    let bestLam = lams[0];
    let bestScore = wavelengthScore(table[0], inPlay);
    for (let k = 1; k < lams.length; k++) {
        const score = wavelengthScore(table[k], inPlay);
        if (score < bestScore) { bestScore = score; bestLam = lams[k]; }
    }
    return Math.round(bestLam);
}

/**
 * One monitoring wavelength per chip.
 *
 * All layers on a chip are monitored at the same wavelength, because a layer
 * too thin to show a turning point of its own has to borrow the one before it,
 * and that only exists on the same curve.
 *
 * @returns {number[]} monitor wavelength per deposition step.
 */
export function autoChipLambdas(design, resolveMat, opts = {}) {
    const cfg = { ...WORKSHEET_DEFAULTS, ...opts, coarse: true, withCurve: false };
    const front = design?.frontLayers || [];
    if (!front.length) return [];

    const refLam = design.referenceWavelength || 550;
    const band = {
        refLam,
        lamA: Number.isFinite(cfg.lamA) ? cfg.lamA : refLam * 0.7,
        lamB: Number.isFinite(cfg.lamB) ? cfg.lamB : refLam * 1.3,
        steps: Math.max(2, Math.floor(cfg.lamSteps || 25)),
    };
    const sys = opticalSystem(design, resolveMat, cfg);
    const layout = runLayout(design, resolveMat, cfg, refLam);

    const out = new Array(front.length).fill(refLam);
    for (const group of chipGroups(layout.layers)) {
        const lam = bestLambdaForChip({ group, sys, resolveMat, band, cfg });
        for (const layer of group.layers) out[layer.step - 1] = lam;
    }
    return out;
}
