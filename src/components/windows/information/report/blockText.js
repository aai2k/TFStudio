/**
 * Names and one-line summaries of blocks for the rail and the Add block list.
 * Pure: takes the `t.report.window` strings and a block.
 */

import { withDefaults } from '../../../../utils/report/blocks.js';
import { SPECTRAL_UNITS } from '../../../../utils/physics/spectralAxis.js';
import { yScaleOf } from '../../analysis/opticalEvaluation/yScale.js';

export function blockName(W, type) {
    return W.blockNames?.[type] || type;
}

const range = s => `${s.lambdaStart}-${s.lambdaEnd} nm`;
const angles = list => (list || []).map(a => `${a}°`).join(', ');
const lambdaText = (W, lambda) => (lambda == null ? W.useRef : `${lambda} nm`);

function plotAndTable(W, s) {
    const parts = [];
    if (s.plot === 'none') parts.push(W.summaryNoPlot);
    parts.push(s.tableStep > 0 ? W.summaryTable(s.tableStep) : W.summaryNoTable);
    return parts;
}

const SUMMARIES = {
    facts: (W, s) => (s.stackDiagram ? [W.stackDiagram] : []),
    layers: (W, s) => [
        s.columns === 'auto' ? W.auto : W.summaryColumns(s.columns),
        s.extended ? W.summaryExtended : null,
        s.groupPeriods ? W.summaryGrouped : null,
    ],
    materials: (W, s) => (s.table ? [W.asTable] : []),
    notes: (W, s) => [s.text && s.text.trim() ? W.summaryText : W.summaryDesignNotes],
    spectrum: (W, s) => [
        W.sourceWindows.spectrum, range(s), angles(s.thetas),
        Object.keys(s.curves || {}).filter(k => s.curves[k]).join(' '),
        s.yScale && s.yScale !== 'percent' ? yScaleOf(s.yScale).short : null,
        s.spectralUnit && s.spectralUnit !== 'nm' ? SPECTRAL_UNITS[s.spectralUnit]?.short : null,
        ...plotAndTable(W, s),
    ],
    color: (W, s) => [W.sourceWindows.color, s.characteristic, s.illuminant, `${s.observer}°`, `${s.theta}°`, s.pol],
    integrals: (W, s) => [W.sourceWindows.integrals, `${s.theta}°`, s.polarization],
    gdGdd: (W, s) => [
        W.sourceWindows.gdGdd, range(s), `${s.target} ${W.sides?.[s.side] || s.side}`, `${s.theta}°`, s.pol,
        ['phase', 'gd', 'gdd', 'tod'].filter(k => s.quantities?.[k]).map(k => (k === 'phase' ? W.phase : k.toUpperCase())).join(' '),
        ...plotAndTable(W, s),
    ],
    ellipsometry: (W, s) => [
        W.sourceWindows.ellipsometry, range(s), angles(s.thetas),
        [s.showPsi ? 'Ψ' : null, s.showDelta ? 'Δ' : null].filter(Boolean).join(' '), ...plotAndTable(W, s),
    ],
    efield: (W, s) => [W.sourceWindows.efield, lambdaText(W, s.lambda), `${s.theta}°`, s.pol],
    riProfile: (W, s) => [W.sourceWindows.riProfile, lambdaText(W, s.lambda)],
    monteCarlo: (W, s) => [W.sourceWindows.monteCarlo, W.lastRun, s.envelope ? W.envelope : null, ...plotAndTable(W, s)],
    worksheet: W => [W.sourceWindows.worksheet, W.asInWindow],
};

/** One line describing the block's settings, or '' for a block without any. */
export function blockSummary(W, block) {
    const make = SUMMARIES[block.type];
    if (!make) return '';
    return make(W, withDefaults(block.type, block.settings)).filter(part => part != null && part !== '').join(' · ');
}
