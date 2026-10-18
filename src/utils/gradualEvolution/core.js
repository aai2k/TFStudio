// Shared low-level helpers of a Gradual Evolution run: design snapshots, the
// design the run goes on from, moving to a finer grid as the design grows, and
// the history rows it reports.

import { designMaterialLookup } from '../materials/designMaterials.js';
import {
    regridForDesign, meritOf, presampleSynthesisMaterials,
} from '../../components/windows/optimization/synthesisShared/runGrid.js';

export const deep = x => JSON.parse(JSON.stringify(x));
export const mkLayers = arr => (arr || []).map(l => ({
    id: l.id, material: l.material, thickness: l.thickness || 0, locked: !!l.locked }));

// Build a full design from the given both-side layer state. In both_independent
// each cycle re-snaps both sides from `best` so both evolve through the run.
export const designSnap = (S, front, back) => ({ ...S.media, frontLayers: mkLayers(front), backLayers: mkLayers(back) });

// The design the run now goes on from, with the readout values that go with it.
export function reportDesign(S, frontLayers, backLayers, readout = {}) {
    const design = {};
    if (frontLayers) design.frontLayers = frontLayers;
    if (backLayers)  design.backLayers  = backLayers;
    S.emit({ design, ...readout });
}

// When `work` has outgrown the run's sampling grid (runGrid.js), move the run
// onto a grid for it: new operands, material tables sampled on them, and
// `work`, `best` and the ΔMF baseline re-scored so the next comparisons are
// made on one grid.
export function regridIfGrown(S) {
    const resolveMat = designMaterialLookup(S.curDes);
    const work = designSnap(S, S.work.frontLayers, S.work.backLayers);
    const operands = regridForDesign(S.operands, work, resolveMat);
    if (!operands) return;
    S.operands = operands;
    S.materials = presampleSynthesisMaterials(S.curDes, operands, S.pool);
    S.work.mf = meritOf(operands, work, resolveMat);
    if (S.best.frontLayers || S.best.backLayers) {
        S.best.mf = meritOf(operands, designSnap(S, S.best.frontLayers, S.best.backLayers), resolveMat);
    }
    S.prevBestMF = Math.min(S.work.mf, S.best.mf);
    S.foldRowId = null;             // earlier rows keep the merit of the old grid
    console.log(`[GE] Grid re-sampled for the grown design: workMF=${S.work.mf.toFixed(6)} bestMF=${S.best.mf.toFixed(6)}`);
}

// The fields of a history row that describe `work` as it stands: merit, elapsed
// time and snapshots, and the total physical thickness (nm) of the whole
// design, the "TOT" column (cf. OTF needle history): the thick seed holds the
// bulk budget and needles redistribute it, so TOT should stay roughly flat
// (≈ seed), not balloon. A runaway TOT signals over-forcing.
function workRowFields(S, { mf, omf, activeLayers }) {
    const fSnap = deep(S.work.frontLayers);
    const bSnap = deep(S.work.backLayers);
    const sumD = arr => (arr || []).reduce((s, L) => s + (Number(L.thickness) || 0), 0);
    return {
        mf, omf, tot: sumD(fSnap) + sumD(bSnap),
        tMs: performance.now() - S.runT0,
        layers:    deep(activeLayers),                 // active-side snapshot
        frontSnap: fSnap,
        backSnap:  bSnap,
    };
}

// Report a row, a new one or the last one again, with the readout that goes
// with it.
function publishRow(S, row, { replacesLast, layerCount, omf }) {
    S.lastRow = row;
    S.hooks.onRow?.(row, { replacesLast, layerCount, mfBest: Math.min(S.best.mf, S.prevBestMF), omf });
}

export function recordCycle(S, { type, mf, layerCount, insertMat, side, activeLayers, omf }) {
    S.genNum += 1;
    const dMF = S.prevBestMF === Infinity ? null : mf - S.prevBestMF;
    S.prevBestMF = Math.min(S.prevBestMF, mf);
    const cy = {
        id: Math.random().toString(36).slice(2),
        genNum: S.genNum, type, dMF, layerCount, insertMat, side,
        ...workRowFields(S, { mf, omf, activeLayers }),
    };
    // A refine step may fold only into a Needle or Refine row this run
    // recorded (recordRefine).
    S.foldRowId = (type === 'needle' || type === 'refine') ? cy.id : null;
    publishRow(S, cy, { replacesLast: false, layerCount, omf });
}

// An accepted step that only changed the thicknesses of the existing layers
// (its needle merged into a neighbour of the same material) is not a Needle
// row. It folds into the last row when that is the Needle or Refine row this
// run recorded just before it, on the current wavelength grid: the row then
// shows its design refined further. Otherwise it is a Refine row when it is a
// new best, so the lowest merit reached is always a row the window can
// restore, and no row when it is not. A GE row keeps the design the forced
// step made.
export function recordRefine(S, { mf, layerCount, side, activeLayers, omf, newBest }) {
    const last = S.lastRow;
    if (!last || last.id !== S.foldRowId) {
        if (newBest) recordCycle(S, { type: 'refine', mf, layerCount, insertMat: null, side, activeLayers, omf });
        return;
    }
    S.prevBestMF = Math.min(S.prevBestMF, mf);
    publishRow(S, {
        ...last,
        dMF: last.dMF == null ? null : last.dMF + (mf - last.mf),
        ...workRowFields(S, { mf, omf, activeLayers: last.side === 'back' ? S.work.backLayers : S.work.frontLayers }),
    }, { replacesLast: true, layerCount: last.layerCount, omf });
}
