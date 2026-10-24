// Measured curves as the API takes them, and the merit block a curve becomes
// as the Fit… dialogs of Measured Spectra and Measured Ellipsometry make it
// (spectrumExchange/model.js, measuredEllipsometry/fitModel.js).

import { canFitInDb, clampedFitRange, defaultMeasuredFitOptions, measuredFitSnapshot } from '../components/windows/dataExchange/spectrumExchange/model.js';
import { ellipsometryFitSnapshot } from '../components/windows/dataExchange/measuredEllipsometry/fitModel.js';
import { makeMeasuredCurve, MEASURED_GRID_MODES } from '../utils/io/spectrumTable.js';
import { requireValue, refusal, isAngle, isBoolean, isPositive, isSide, MAX_POINTS } from './check.js';

const PHOTOMETRIC = ['T', 'R', 'A'];
const POLARIZATIONS = ['avg', 's', 'p'];
const SPECTRUM_FIELDS = ['name', 'quantity', 'angle', 'pol', 'wavelength', 'values'];
const ANGULAR_FIELDS = ['name', 'quantity', 'angle', 'pol', 'side', 'deltaConvention', 'cosDelta', 'wavelength', 'values'];

/** The Fit… dialogs' grid and range options, which every call that samples a curve takes. */
export const GRID_OPTIONS = ['grid', 'step', 'thinEvery', 'from', 'to', 'db'];

/** Whether a curve of `quantity` is Ψ or Δ, which Measured Ellipsometry keeps. */
export const isAngular = quantity => quantity === 'PSI' || quantity === 'DEL';

/** The two signs a Δ is written in, as the windows name them. */
export const DELTA_CONVENTIONS = ['azzam', 'reversed'];

/**
 * A curve given as readSpectrumFile or readEllipsometryFile gives one, as the
 * curve record the windows' import makes, after refusing a field or a value
 * it cannot use.
 */
export function curveRecord(call, curve) {
    if (!curve || typeof curve !== 'object' || Array.isArray(curve)) {
        throw new Error(`${call}: a curve is an object of ${SPECTRUM_FIELDS.join(', ')}, as readSpectrumFile gives one`);
    }
    const angular = isAngular(curve.quantity);
    const fields = angular ? ANGULAR_FIELDS : SPECTRUM_FIELDS;
    const unknown = Object.keys(curve).find(key => !fields.includes(key));
    if (unknown) {
        throw refusal('unknownOption', { call, option: unknown, options: fields },
            `${call}: '${unknown}' is not a field of a curve; a ${angular ? 'Ψ or Δ' : 'T, R or A'} curve has ${fields.join(', ')}`);
    }
    const { name = 'Measured curve', quantity = 'T', angle = 0, pol = 'avg', side = 'front', deltaConvention = 'azzam', wavelength, values } = curve;
    requireValue(call, 'quantity', quantity, v => PHOTOMETRIC.includes(v) || isAngular(v), "'T', 'R' or 'A', or 'PSI' or 'DEL' for Ψ or Δ");
    requireValue(call, 'name', name, v => typeof v === 'string', 'a text');
    const isList = v => Array.isArray(v) && v.length > 0 && v.every(Number.isFinite);
    requireValue(call, 'wavelength', wavelength, v => isList(v) && v.every(x => x > 0), 'a list of wavelengths in nm, each above 0');
    requireValue(call, 'values', values, v => isList(v) && v.length === wavelength.length, `a list of numbers, one per wavelength (${wavelength.length})`);
    requireValue(call, 'angle', angle, isAngle, 'an angle of incidence in degrees, 0 <= angle < 90');
    requireValue(call, 'pol', pol, v => (angular ? v === 'avg' : POLARIZATIONS.includes(v)), angular ? "'avg' for Ψ and Δ" : "'avg', 's' or 'p'");
    requireValue(call, 'side', side, isSide, "'front' or 'back'");
    requireValue(call, 'deltaConvention', deltaConvention, v => DELTA_CONVENTIONS.includes(v) || (v === null && quantity !== 'DEL'),
        quantity === 'DEL' ? "'azzam' or 'reversed'" : "'azzam', 'reversed' or null");
    requireValue(call, 'cosDelta', curve.cosDelta, v => v === undefined || isBoolean(v), 'true or false');
    return makeMeasuredCurve({ name, quantity, aoi: angle, pol, side, deltaConvention: deltaConvention ?? undefined, x: wavelength, y: values, xUnit: 'nm' });
}

/**
 * The Fit… dialog's grid and range settings from the options, after refusing
 * a value it cannot take. `names` are the caller's names for from and to.
 */
export function fitConfig(call, curve, { grid = 'measured', step, thinEvery, from, to, db = false }, [first, last] = ['from', 'to']) {
    requireValue(call, 'grid', grid, v => MEASURED_GRID_MODES.includes(v), "'measured', 'thinned' or 'uniform'");
    requireValue(call, 'step', step, v => v === undefined || (grid === 'uniform' && isPositive(v)), "a wavelength step in nm above 0, with grid 'uniform'");
    requireValue(call, 'thinEvery', thinEvery, v => v === undefined || (grid === 'thinned' && Number.isInteger(v) && v >= 1), "a whole number of 1 or more, with grid 'thinned'");
    requireValue(call, first, from, v => v === undefined || isPositive(v), 'a wavelength in nm above 0');
    requireValue(call, last, to, v => v === undefined || isPositive(v), 'a wavelength in nm above 0');
    const [low, high] = [from ?? curve.x[0], to ?? curve.x[curve.x.length - 1]];
    if ((from !== undefined || to !== undefined) && !(low < high)) {
        throw refusal('wavelengthRange', { call, from: low, to: high },
            `${call}: ${first} and ${last} are wavelengths in nm, 0 < ${first} < ${last}; without them, the curve's first and last, ${curve.x[0]} and ${curve.x[curve.x.length - 1]} nm`);
    }
    requireValue(call, 'db', db, v => isBoolean(v) && (!v || canFitInDb(curve)), `true or false; true for a T curve only, and this one is ${curve.quantity}`);
    return {
        mode: grid, scale: db ? 'dB' : 'linear',
        ...(from !== undefined ? { rangeMin: from } : {}), ...(to !== undefined ? { rangeMax: to } : {}),
        ...(step !== undefined ? { stepNm: step } : {}), ...(thinEvery !== undefined ? { thinEvery } : {}),
    };
}

// Refuses a uniform grid of more points than a spectrum may hold.
function checkPoints(call, settings, curve) {
    if (settings.mode !== 'uniform') return;
    const first = settings.rangeMin ?? curve.x[0];
    const last = settings.rangeMax ?? curve.x[curve.x.length - 1];
    const points = Math.floor(Math.abs(last - first) / settings.stepNm) + 1;
    if (points > MAX_POINTS) throw new Error(`${call}: ${points} points is more than ${MAX_POINTS}; take a larger step`);
}

const SNAPSHOT_ERRORS = {
    range: 'no measured point lies inside the range asked for and the span every material of the design has data for',
    dbEmpty: 'no point of the curve is above 0, and only those have a value in dB',
    aoi: 'a Ψ or Δ curve at normal incidence says nothing about the film; its angle is the one the ellipsometer used, above 0',
    backSide: 'a Ψ or Δ curve measured on the back side is not scored: Ψ and Δ are scored on the front side only',
    side: 'Ψ and Δ are scored on the front side, and this design is scored on its back alone',
};

/**
 * The merit block the Fit… dialog makes of `curve` on `design` with the
 * dialog's settings `config`, the range kept to the span every material of the
 * design has data for, as the dialog keeps it. Returns the dialog's settings
 * as it holds them, the snapshot, and `clipped`, true when fewer points were
 * kept than the range asked for holds. A range that misses that span is
 * refused, where the dialog moves it onto the span and its fields show the
 * move.
 */
export function fitSnapshot(call, design, curve, config) {
    const asked = { ...defaultMeasuredFitOptions(curve), ...config };
    const settings = clampedFitRange(design, asked);
    checkPoints(call, settings, curve);
    const missed = settings.rangeMax < asked.rangeMin || settings.rangeMin > asked.rangeMax;
    const made = (isAngular(curve.quantity) ? ellipsometryFitSnapshot : measuredFitSnapshot)(design, curve, settings);
    const snapshot = missed && made.operand ? { error: 'range' } : made;
    if (!snapshot.operand) throw new Error(`${call}: ${SNAPSHOT_ERRORS[snapshot.error] ?? snapshot.error}`);
    const moved = settings.rangeMin > asked.rangeMin || settings.rangeMax < asked.rangeMax;
    return { settings, snapshot, clipped: Boolean(snapshot.sampled.clipped) || moved };
}
