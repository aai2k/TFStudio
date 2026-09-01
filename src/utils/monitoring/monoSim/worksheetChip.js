/**
 * One witness chip's worth of the monitoring worksheet.
 *
 * A chip is its own short coating: it starts from bare glass and carries only
 * the layers assigned to it, so every figure here is computed on that sub-stack
 * and never on the whole design.
 *
 * Turning points are carried forward along the chip. A layer thinner than the
 * distance between two turning points has none of its own, and is then read
 * against the last one the chip produced, which lies in an earlier layer. This
 * is the rule FilmStar MONITOR states as using the last two turning points,
 * which may fall in previous layers.
 *
 * A chip is identified by its number, not by its position in the run, so layers
 * assigned to it out of sequence land on the same physical piece and continue
 * the stack already on it. Each layer arrives with the place it occupies on the
 * run axis (`xStart`, `xPerNm`) already worked out, because that is a property
 * of the run rather than of the chip.
 *
 * For one layer, with S(d) the signal while it grows and d_cut where it stops:
 *
 *   reference     last turning point at or before the cut, else the level the
 *                 chip started at
 *   next          first turning point after the cut, on the same layer
 *                 continued past its stop
 *   swing in      |S(layer start) - S(reference)|
 *   swing out     |S(cut) - S(reference)|
 *   amplitude     |S(next) - S(reference)|, the full swing available to the
 *                 layer rather than the part of it the layer traverses
 *   cutoff ratio  swing out / amplitude, where the stop sits between the two
 *                 turning points that bracket it
 */

import { autoMonoStrategy } from './monitorTable.js';
import {
    findExtrema, nearestExtremum, sampleLayerCurve, signalAt, slopeAtCut, terminationError,
} from './worksheetSignal.js';

// Layers already on the chip, written outermost first as the signal model wants.
function stackBelow(deposited) {
    const belowMats = [];
    const belowThicks = [];
    for (let k = deposited.length - 1; k >= 0; k--) {
        belowMats.push(deposited[k].mat);
        belowThicks.push(deposited[k].d);
    }
    return { belowMats, belowThicks };
}

// Quarter wave in this layer at the monitor wavelength, which sizes the search
// for the turning point after the cut.
function quarterWave(curMat, lam) {
    return lam / (4 * Math.max(1e-6, curMat.getNK(lam)[0] || 1.6));
}

function referencePoint(inLayer, chipExtrema, chipStartLevel) {
    if (inLayer.length) return inLayer[inLayer.length - 1];
    if (chipExtrema.length) return chipExtrema[chipExtrema.length - 1];
    return { s: chipStartLevel, isMax: null, curvature: NaN, fromChipStart: true };
}

function swingFigures({ sStart, sCut, reference, next }) {
    const swingOut = Math.abs(sCut - reference.s);
    const amplitude = next ? Math.abs(next.s - reference.s) : null;
    return {
        swingIn: Math.abs(sStart - reference.s),
        swingOut,
        amplitude,
        cutoffRatio: amplitude > 0 ? swingOut / amplitude : null,
    };
}

function terminationFigures({ ctx, dCut, extrema, sCut, cfg }) {
    const strategy = dCut > 0 ? autoMonoStrategy({ thickness: dCut }, ctx.curMat, ctx.lam) : 'time';
    const slope = slopeAtCut(ctx, dCut);
    const errNm = terminationError({
        strategy,
        // Relative error of the reading plus the photometric floor: the floor
        // is what makes a saturated-stopband wavelength score as unusable
        // instead of as noiseless.
        signalError: (cfg.signalErrorPct / 100) * Math.abs(sCut)
            + (cfg.absSignalErrorPct || 0) / 100,
        slope,
        cutExtremum: nearestExtremum(extrema, dCut),
    });
    const errPct = errNm != null && dCut > 0 ? (errNm / dCut) * 100 : null;
    return { strategy, slope, errNm, errPct };
}

// The layer's curve on the run axis, including the continuation past the cut.
function chartCurve(curve, xStart, xPerNm) {
    return { x: Array.from(curve.d, d => xStart + d * xPerNm), y: Array.from(curve.s) };
}

function buildRow({ layer, chip, onChip, ctx, geom, cfg, chipStartLevel, chipExtrema, xStart }) {
    const dCut = layer.thickness;
    const curve = sampleLayerCurve(ctx, dCut, geom.dQW, cfg.coarse);
    const extrema = findExtrema(curve);
    // A quarter-wave layer is stopped on its own turning point, and the refined
    // extremum lands either side of the cut by up to a sample. Within one
    // sample of the cut the turning point is the cut's own.
    const atCut = dCut + curve.h;
    const inLayer = extrema.filter(e => e.d <= atCut);
    const next = extrema.find(e => e.d > atCut) || null;
    const sStart = curve.s[0];
    const sCut = dCut > 0 ? signalAt(ctx, dCut) : sStart;
    // The first layer on a chip is itself where the chip's signal starts.
    const reference = referencePoint(inLayer, chipExtrema, chipStartLevel ?? sStart);
    const swings = swingFigures({ sStart, sCut, reference, next });
    const term = terminationFigures({ ctx, dCut, extrema, sCut, cfg });
    const poor = swings.amplitude == null
        || (term.errPct != null && term.errPct > cfg.maxTerminationErrPct);

    return {
        row: {
            step: layer.step,
            layerIndex: layer.layerIndex,
            chip,
            onChip,
            material: layer.material,
            lambda: ctx.lam,
            thickness: dCut,
            partThickness: layer.partThickness,
            strategy: term.strategy,
            initialLevel: onChip === 1 ? sStart : null,
            signalStart: sStart,
            signal: sCut,
            turningPoints: inLayer.length,
            referenceSignal: reference.s,
            referenceFromChipStart: !!reference.fromChipStart,
            referenceInEarlierLayer: !inLayer.length && chipExtrema.length > 0,
            nextTurningSignal: next ? next.s : null,
            ...swings,
            slope: term.slope,
            terminationErrNm: term.errNm,
            terminationErrPct: term.errPct,
            poor,
            crystalNm: poor ? layer.partThickness : null,
            xStart,
            xCut: xStart + dCut * geom.xPerNm,
            xEnd: xStart + curve.dMax * geom.xPerNm,
            curve: cfg.withCurve ? chartCurve(curve, xStart, geom.xPerNm) : null,
        },
        inLayer,
    };
}

/**
 * Worksheet rows for the layers on one chip, in deposition order.
 *
 * `layers` are `{ step, layerIndex, material, partThickness, thickness, xStart,
 * xPerNm }`, with `thickness` already scaled to the witness and the run-axis
 * placement already assigned.
 */
export function buildChipRows({ chip, layers, lam, sys, resolveMat, opts }) {
    const deposited = [];
    const chipExtrema = [];
    const rows = [];
    let chipStartLevel = null;

    for (let i = 0; i < layers.length; i++) {
        const layer = layers[i];
        const curMat = resolveMat(layer.material);
        const ctx = { lam, curMat, ...stackBelow(deposited), sys };
        const geom = { dQW: quarterWave(curMat, lam), xPerNm: layer.xPerNm };
        const built = buildRow({
            layer, chip, onChip: i + 1, ctx, geom, cfg: opts,
            chipStartLevel, chipExtrema, xStart: layer.xStart,
        });
        if (i === 0) chipStartLevel = built.row.signalStart;
        rows.push(built.row);
        for (const e of built.inLayer) {
            chipExtrema.push({ ...e, d: layer.xStart + e.d * geom.xPerNm });
        }
        deposited.push({ mat: curMat, d: layer.thickness });
    }

    return { rows, initialLevel: chipStartLevel };
}
