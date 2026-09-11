/** Renderer-neutral GD/GDD/TOD merit-target selection, geometry and editing. */

import { makeOperand } from '../../../../utils/physics/optimizer.js';
import {
    UNIT_LEVEL, applyHandleEdit, levelOperandOverrides, pointHandleHalfWidth, snapDrawnLine,
} from '../../../../utils/physics/spectrumTargets.js';
import { niceTickInterval } from '../../../ui/chartOptions.js';

const TARGET_TYPES = {
    gd: { R: new Set(['GD', 'GDFLAT']), T: new Set(['GDT', 'GDTFLAT']) },
    gdd: { R: new Set(['GDD', 'GDDFLAT']), T: new Set(['GDDT', 'GDDTFLAT']) },
    tod: { R: new Set(['TOD', 'TODFLAT']), T: new Set(['TODT', 'TODTFLAT']) },
};
const ALL_TARGET_TYPES = new Set(
    Object.values(TARGET_TYPES).flatMap(types => [...types.R, ...types.T]));

const TARGET_COLORS = { R: '#ef5350', T: '#4fc3f7' };
const TRANSMISSION_TYPES = new Set(Object.values(TARGET_TYPES).flatMap(types => [...types.T]));

export function gdGddTargetColor(response) { return TARGET_COLORS[response] || '#aaaaaa'; }
function operandTargetColor(operand) { return gdGddTargetColor(TRANSMISSION_TYPES.has(operand.type) ? 'T' : 'R'); }
function targetDash(pol) { return pol === 's' ? 'dotted' : pol === 'p' ? 'dashed' : 'solid'; }

function hasFiniteTargetCoordinates(operand) {
    if (!Number.isFinite(Number(operand.target)) || !Number.isFinite(Number(operand.lambdaStart))) return false;
    return !operand.type.endsWith('FLAT') || Number.isFinite(Number(operand.lambdaEnd));
}

/** The side the merit function scores, which is the side its targets belong to. */
export function meritTargetSide(surfaceMode) {
    return surfaceMode === 'back_only' ? 'back' : 'front';
}

// An operand is on the plot when it is scored at the polarization and angle
// the curve is computed for; the average polarization is the unset default.
function isOnPlot(operand, types, options) {
    if (!operand?.enabled || !types.has(operand.type)) return false;
    const samePolarization = (operand.pol || 'avg') === options.polarization;
    const sameAngle = Math.abs(Number(operand.aoi ?? 0) - Number(options.thetaDeg)) < 1e-9;
    return samePolarization && sameAngle && hasFiniteTargetCoordinates(operand);
}

export function selectGdGddTargets(operands, options) {
    const types = TARGET_TYPES[options.quantity]?.[options.target];
    if (!types || options.side !== meritTargetSide(options.surfaceMode)) return [];
    return (operands || []).filter(operand => isOnPlot(operand, types, options));
}

/**
 * Why targets cannot be drawn on the current plot, or null when they can.
 *
 * Phase has no overlay: the plot shows an unwrapped phase against a chosen
 * reference wavelength, while a phase operand holds a wrapped value at one
 * wavelength, and the two differ by whole turns. The other side is out because
 * the merit function scores one side only, so a target drawn on the other
 * would never be shown or evaluated.
 */
export function gdGddEditBlocker(options) {
    if (!TARGET_TYPES[options.quantity]) return 'phase';
    if (options.side !== meritTargetSide(options.surfaceMode)) return 'side';
    return null;
}

/** The operand type a drawing on this plot becomes. */
export function gdGddTargetType(options, band) {
    return `${options.quantity.toUpperCase()}${options.target === 'T' ? 'T' : ''}${band ? 'FLAT' : ''}`;
}

// The level grid divides the visible range into about as many steps as the
// R/T/A editor's default grid divides its axis, 5 % over 0 to 100. GD, GDD and
// TOD are unbounded and change unit with the quantity, so no fixed step could
// serve them.
const LEVEL_SNAP_STEPS = 20;

/** The level grid a drawn or dragged target snaps to, or 0 without a known range. */
export function levelSnapStep(range) {
    if (!Array.isArray(range) || !range.every(Number.isFinite)) return 0;
    const span = Math.abs(range[1] - range[0]);
    return span > 0 ? niceTickInterval(span, { targetTicks: LEVEL_SNAP_STEPS }) : 0;
}

// `targets` are the operands on this plot, the only ones whose ends are in the
// plotted unit and so the only ones a drawing can snap to.
function snapOptions({ targets, snapNm, levelStep, excludeId = null }) {
    return {
        operands: targets, snapNm, snapPct: levelStep, excludeId,
        types: ALL_TARGET_TYPES, level: UNIT_LEVEL,
    };
}

/**
 * The operands with a drawing added. A click, or a drag that snaps to no
 * width, is a target at one wavelength; a drag across a band is a flatness
 * target at the mean height of the line.
 */
export function createGdGddTarget({ operands, targets, line, options, snapOn, snapNm, levelStep }) {
    const drawn = snapOn ? snapDrawnLine(line, snapOptions({ targets, snapNm, levelStep })) : line;
    const overrides = levelOperandOverrides(
        drawn, { pol: options.polarization, aoi: options.thetaDeg }, UNIT_LEVEL);
    const band = overrides.lambdaEnd > overrides.lambdaStart;
    return [...operands, makeOperand({ type: gdGddTargetType(options, band), ...overrides })];
}

/** The operands with one target moved to where its handle was dropped. */
export function editGdGddTarget({ operands, targets, meta, coords, snapOn, snapNm, levelStep }) {
    const edited = snapOn
        ? snapDrawnLine(coords, snapOptions({ targets, snapNm, levelStep, excludeId: meta.opId }))
        : coords;
    return operands.map(operand => operand.id === meta.opId
        ? { ...operand, ...applyHandleEdit(meta, operand, edited, UNIT_LEVEL) }
        : operand);
}

export function deleteGdGddTarget(operands, opId) {
    return operands.filter(operand => operand.id !== opId);
}

/**
 * Geometry consumed by the same `targetSeries` and `TargetEditorOverlay`
 * adapters as optical targets, so the two plots share one interaction layer.
 */
export function buildGdGddTargetGeometry(operands) {
    const geometry = { lines: [], markers: [], bands: [] };
    for (const source of operands || []) {
        const operand = {
            ...source,
            lambdaStart: Number(source.lambdaStart),
            lambdaEnd: Number(source.lambdaEnd),
            target: Number(source.target),
        };
        const color = operandTargetColor(operand);
        const label = `${operand.type} target`;
        if (operand.type.endsWith('FLAT') && operand.lambdaEnd !== operand.lambdaStart) {
            const middle = (operand.lambdaStart + operand.lambdaEnd) / 2;
            geometry.lines.push({
                opId: operand.id, label, color, width: 2.5, dash: targetDash(operand.pol),
                points: [[operand.lambdaStart, operand.target], [operand.lambdaEnd, operand.target]],
            });
            geometry.markers.push(...[operand.lambdaStart, middle, operand.lambdaEnd].map(x => ({
                opId: operand.id, label, x, y: operand.target, color, size: 9,
            })));
            geometry.bands.push({
                opId: operand.id, x0: operand.lambdaStart, x1: operand.lambdaEnd,
                color, opacity: 0.07,
            });
        } else {
            geometry.markers.push({
                opId: operand.id, label, x: operand.lambdaStart, y: operand.target,
                color, size: 10,
            });
        }
    }
    return geometry;
}

export function buildEditableGdGddTargetGeometry(operands, xRange) {
    const pointHalfWidth = pointHandleHalfWidth(xRange);
    return (operands || []).map(source => {
        const wavelength = Number(source.lambdaStart);
        const end = Number(source.lambdaEnd);
        const target = Number(source.target);
        const common = {
            opId: source.id, type: source.type, color: operandTargetColor(source),
            dash: targetDash(source.pol), y0: target, y1: target,
        };
        return source.type.endsWith('FLAT') && Number.isFinite(end) && end !== wavelength
            ? { ...common, kind: 'band', x0: wavelength, x1: end }
            : { ...common, kind: 'point', x0: wavelength - pointHalfWidth, x1: wavelength + pointHalfWidth };
    }).filter(item => Number.isFinite(item.x0) && Number.isFinite(item.x1)
        && Number.isFinite(item.y0));
}
