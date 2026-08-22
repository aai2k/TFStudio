/** Renderer-neutral GD/GDD/TOD merit-target selection and geometry. */

const TARGET_TYPES = {
    gd: { R: new Set(['GD', 'GDFLAT']), T: new Set(['GDT', 'GDTFLAT']) },
    gdd: { R: new Set(['GDD', 'GDDFLAT']), T: new Set(['GDDT', 'GDDTFLAT']) },
    tod: { R: new Set(['TOD', 'TODFLAT']), T: new Set(['TODT', 'TODTFLAT']) },
};

const TARGET_COLORS = { R: '#ef5350', T: '#4fc3f7' };
const TRANSMISSION_TYPES = new Set(Object.values(TARGET_TYPES).flatMap(types => [...types.T]));

export function gdGddTargetColor(response) { return TARGET_COLORS[response] || '#aaaaaa'; }
function operandTargetColor(operand) { return gdGddTargetColor(TRANSMISSION_TYPES.has(operand.type) ? 'T' : 'R'); }
function targetDash(pol) { return pol === 's' ? 'dotted' : pol === 'p' ? 'dashed' : 'solid'; }

function hasFiniteTargetCoordinates(operand) {
    if (!Number.isFinite(Number(operand.target)) || !Number.isFinite(Number(operand.lambdaStart))) return false;
    return !operand.type.endsWith('FLAT') || Number.isFinite(Number(operand.lambdaEnd));
}

export function selectGdGddTargets(operands, options) {
    const types = TARGET_TYPES[options.quantity]?.[options.target];
    const meritSide = options.surfaceMode === 'back_only' ? 'back' : 'front';
    if (!types || options.side !== meritSide) return [];
    return (operands || []).filter(operand => operand?.enabled
        && types.has(operand.type)
        && (operand.pol || 'avg') === options.polarization
        && Math.abs(Number(operand.aoi ?? 0) - Number(options.thetaDeg)) < 1e-9
        && hasFiniteTargetCoordinates(operand));
}

/**
 * Geometry consumed by the same `targetSeries` and `TargetEditorOverlay`
 * adapters as optical targets. Editing callbacks can be added to GD/GDD
 * without introducing a chart-library-specific interaction layer.
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
    const span = Math.max(1, (xRange?.max ?? 1000) - (xRange?.min ?? 0));
    const pointHalfWidth = Math.max(2, span / 60);
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
