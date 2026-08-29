/**
 * The measured Ψ/Δ a design carries, and the documents this window writes.
 *
 * Ellipsometric curves are kept in their own list on the design rather than
 * beside the photometric ones. They are a different measurement made on a
 * different instrument: they have no percent-or-fraction scale, no s/p
 * polarization to choose, they mean nothing without an angle of incidence, and
 * they are only meaningful as a Ψ paired with its Δ.
 */

import { curvesToCsv, measuredCurveData, X_UNITS } from '../../../../utils/io/spectrumTable.js';
import { nmToX } from '../../../../utils/io/spectrumTable/conversions.js';
import { computeSpectral } from '../../analysis/ellipsometryEvaluation/spectrum.js';
import { toDeltaConvention } from '../../../../utils/physics/thinFilmMath.js';

function finite(values) {
    return (values || []).filter(Number.isFinite);
}

/**
 * Which of a file's columns are Ψ and which are Δ.
 *
 * A column that names itself is taken at its word. Otherwise the values decide,
 * and one thing about them is definitional rather than a guess: Ψ is the
 * arctangent of a magnitude ratio, so it cannot leave 0 to 90 degrees, while Δ
 * runs over a full turn. A column that goes above 90, or below zero, is
 * therefore Δ and cannot be Ψ.
 *
 * Where that settles nothing, the file order stands. Ψ before Δ is what the
 * exports we have seen write, Accurion excepted, and the operator can swap the
 * two in one click. Guessing here is safe in a way it would not be in a general
 * spectrum importer: every file opened in this window is an ellipsometric one.
 */
export function typeColumns(columns) {
    const named = (columns || []).map(column =>
        (column.quantity === 'PSI' || column.quantity === 'DEL' ? column.quantity : null));
    if (named.some(Boolean)) return named;
    if ((columns || []).length !== 2) return named;

    const outsidePsi = columns.map((column) => {
        const values = finite(column.values);
        return values.length > 0 && values.some(value => value > 90 || value < 0);
    });
    if (outsidePsi[0] !== outsidePsi[1]) {
        return outsidePsi[0] ? ['DEL', 'PSI'] : ['PSI', 'DEL'];
    }
    return ['PSI', 'DEL'];
}

/**
 * A Δ column that never leaves -1 to 1 is cos Δ, not degrees.
 *
 * At least one real instrument writes tan Ψ and cos Δ under column headings
 * that say PSI and DELTA. Read as degrees the numbers are legal and the error
 * is invisible, so the window says so rather than letting a fit run on them.
 */
export function looksLikeCosDelta(curve) {
    if (!curve || curve.quantity !== 'DEL') return false;
    const values = finite(curve.y);
    return values.length > 0 && values.every(value => value >= -1 && value <= 1)
        && values.some(value => value < 0);
}

/** The design's measured ellipsometry, always an array. */
export function ellipsometryCurves(design) {
    return design?.measuredEllipsometry || [];
}

/**
 * Ψ and Δ measured under the same conditions, grouped.
 *
 * A fit needs both halves of one measurement, so the window shows what it has
 * and what it is missing rather than a flat list in which an unpaired curve
 * looks the same as a usable one.
 */
export function curvePairs(curves) {
    const groups = new Map();
    for (const curve of curves || []) {
        const key = `${curve.aoi ?? 0}|${curve.side || 'front'}`;
        if (!groups.has(key)) {
            groups.set(key, { aoi: curve.aoi ?? 0, side: curve.side || 'front', psi: null, delta: null });
        }
        const group = groups.get(key);
        if (curve.quantity === 'PSI' && !group.psi) group.psi = curve;
        if (curve.quantity === 'DEL' && !group.delta) group.delta = curve;
    }
    return [...groups.values()].sort((left, right) => left.aoi - right.aoi);
}

/** What the preview chart draws for one curve or one pair. */
export function chartData(curves) {
    const psi = (curves || []).find(curve => curve.quantity === 'PSI');
    const delta = (curves || []).find(curve => curve.quantity === 'DEL');
    const source = psi || delta;
    if (!source) return null;
    return {
        x: measuredCurveData(source).x,
        psi: psi ? measuredCurveData(psi).y : [],
        delta: delta ? measuredCurveData(delta).y : [],
        xLabel: 'Wavelength (nm)',
    };
}

function safeBase(design) {
    return (design?.name || 'ellipsometry').replace(/[^\w.-]+/g, '_');
}

/** Measured Ψ/Δ as a CSV document. */
export function measuredDocument(design, { curves, xUnit = X_UNITS.NM }) {
    return {
        text: curvesToCsv(curves, { xUnit, asPercent: false }),
        fileName: `${safeBase(design)}_measured_psi_delta.csv`,
    };
}

/**
 * The design's own Ψ/Δ as a CSV document.
 *
 * Δ is written in the convention asked for, so a file exported for an
 * instrument's software reads the same way that instrument's own files do.
 */
export function calculatedDocument(design, options) {
    const { lambdaStart, lambdaEnd, lambdaStep, thetaDeg, side, deltaConvention, xUnit } = options;
    const spectrum = computeSpectral(design, {
        side, lambdaStart, lambdaEnd, lambdaStep, thetaDeg,
    });
    const delta = toDeltaConvention(spectrum.delta, deltaConvention);
    const unit = xUnit || X_UNITS.NM;
    const header = ['Wavelength (nm)', 'Psi (deg)', 'Delta (deg)'];
    header[0] = unit === X_UNITS.EV ? 'Photon energy (eV)'
        : unit === X_UNITS.UM ? 'Wavelength (µm)'
            : unit === X_UNITS.CM1 ? 'Wavenumber (cm-1)' : 'Wavelength (nm)';
    const rows = spectrum.x.map((lambda, index) => [
        nmToX(lambda, unit),
        spectrum.psi[index],
        delta[index],
    ].join(','));
    return {
        text: [`# ${design?.name || 'design'}`, `# AOI ${thetaDeg} deg, ${side} side`,
            header.join(','), ...rows].join('\n') + '\n',
        fileName: `${safeBase(design)}_calculated_psi_delta.csv`,
    };
}
