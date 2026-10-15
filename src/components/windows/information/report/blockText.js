/**
 * Names and one-line summaries of blocks for the rail and the Add block list.
 * Pure: takes the `t.report.window` strings, the `t.units` symbols and a block.
 */

import { withDefaults } from '../../../../utils/report/blocks.js';
import { yScaleOf } from '../../analysis/opticalEvaluation/yScale.js';
import { DISPERSION_QUANTITY_KEYS } from '../../../../utils/report/sections/dispersion.js';
import { polText } from '../../../../utils/report/sections/format.js';

export function blockName(W, type) {
    return W.blockNames?.[type] || type;
}

const range = (s, units) => `${s.lambdaStart}-${s.lambdaEnd} ${units.nm}`;
const angles = list => (list || []).map(a => `${a}°`).join(', ');
const lambdaText = (W, lambda, units) => (lambda == null ? W.useRef : `${lambda} ${units.nm}`);

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
    spectrum: (W, s, units) => [
        W.sourceWindows.spectrum, range(s, units), angles(s.thetas),
        Object.keys(s.curves || {}).filter(k => s.curves[k]).join(' '),
        s.yScale && s.yScale !== 'percent' ? yScaleOf(s.yScale).short : null,
        s.spectralUnit && s.spectralUnit !== 'nm' ? units[s.spectralUnit] : null,
        ...plotAndTable(W, s),
    ],
    color: (W, s) => [W.sourceWindows.color, s.characteristic, s.illuminant, `${s.observer}°`, `${s.theta}°`, polText(W, s.pol)],
    integrals: (W, s) => [W.sourceWindows.integrals, `${s.theta}°`, polText(W, s.polarization)],
    gdGdd: (W, s, units) => [
        W.sourceWindows.gdGdd, range(s, units), `${s.target} ${W.sides?.[s.side] || s.side}`, `${s.theta}°`, polText(W, s.pol),
        DISPERSION_QUANTITY_KEYS.filter(k => s.quantities?.[k]).map(k => (k === 'phase' ? W.phase : W.dispersionNames[k])).join(' '),
        ...plotAndTable(W, s),
    ],
    ellipsometry: (W, s, units) => [
        W.sourceWindows.ellipsometry, range(s, units), angles(s.thetas),
        [s.showPsi ? 'Ψ' : null, s.showDelta ? 'Δ' : null].filter(Boolean).join(' '), ...plotAndTable(W, s),
    ],
    efield: (W, s, units) => [W.sourceWindows.efield, lambdaText(W, s.lambda, units), `${s.theta}°`, polText(W, s.pol)],
    riProfile: (W, s, units) => [W.sourceWindows.riProfile, lambdaText(W, s.lambda, units)],
    monteCarlo: (W, s) => [W.sourceWindows.monteCarlo, W.lastRun, s.envelope ? W.envelope : null, ...plotAndTable(W, s)],
    worksheet: W => [W.sourceWindows.worksheet, W.asInWindow],
};

/** One line describing the block's settings, or '' for a block without any. */
export function blockSummary(W, block, units) {
    const make = SUMMARIES[block.type];
    if (!make) return '';
    return make(W, withDefaults(block.type, block.settings), units).filter(part => part != null && part !== '').join(' · ');
}
