/**
 * Display-unit conversion for wavelength-backed chart axes and controls, and
 * the step a spectrum read in each unit is sampled at. A unit's id is also its
 * key in t.units, which holds the symbol it is written with.
 */

const C_NM_THZ = 299792.458;
const HC_EV_NM = 1239.841984;

export const SPECTRAL_UNITS = {
    nm:  { id: 'nm',  decimals: 0, toNm: value => value,            fromNm: nm => nm },
    um:  { id: 'um',  decimals: 3, toNm: value => value * 1000,     fromNm: nm => nm / 1000 },
    cm1: { id: 'cm1', decimals: 0, toNm: value => 1e7 / value,      fromNm: nm => 1e7 / nm },
    THz: { id: 'THz', decimals: 1, toNm: value => C_NM_THZ / value, fromNm: nm => C_NM_THZ / nm },
    eV:  { id: 'eV',  decimals: 3, toNm: value => HC_EV_NM / value,  fromNm: nm => HC_EV_NM / nm },
};

export const SPECTRAL_UNIT_IDS = ['nm', 'um', 'cm1', 'THz', 'eV'];

const RANGE_CONTROL = {
    nm:  { symbol: 'λ', decimals: 2, step: 10 },
    um:  { symbol: 'λ', decimals: 4, step: 0.01 },
    cm1: { symbol: 'ν̃', decimals: 0, step: 100 },
    THz: { symbol: 'f', decimals: 2, step: 1 },
    eV:  { symbol: 'E', decimals: 4, step: 0.01 },
};

// What a unit's points are evenly spaced in, and how much of the unit one stored
// step is. nm and µm share a grid even in wavelength, whose step is kept in nm
// as `lambdaStep`. cm⁻¹, THz and eV are each proportional to 1/λ, so they share
// a grid even in wavenumber, whose step is kept in cm⁻¹ as `wavenumberStep`.
const STEP_UNITS = {
    nm:  { evenIn: 'wavelength', scale: 1 },
    um:  { evenIn: 'wavelength', scale: 1e-3 },
    cm1: { evenIn: 'wavenumber', scale: 1 },
    THz: { evenIn: 'wavenumber', scale: C_NM_THZ / 1e7 },
    eV:  { evenIn: 'wavenumber', scale: HC_EV_NM / 1e7 },
};

const STEP_KEY = { wavelength: 'lambdaStep', wavenumber: 'wavenumberStep' };

// A step is shown to five significant figures: a step typed in by hand reads as
// typed, and one converted from another unit (0.0019373 eV) fits its field.
const STEP_DIGITS = 5;

/**
 * Decimals for a column of spectral values in one unit: as many as its first
 * value and its step need at the significant figures the step field shows, and
 * at least one. A table at 0.01 or 0.25 nm does not print 400.0 twice, and a
 * step converted from another unit (15.625 cm⁻¹, 0.46843 THz) is not printed
 * to every digit it carries. Nine decimals at most, the grid's own rounding in
 * nm.
 */
export function spectralDecimals(values) {
    if (!values.length) return 1;
    const step = values.length > 1 ? Math.abs(values[1] - values[0]) : 0;
    const shown = [values[0], step].map(value => Number(value.toPrecision(STEP_DIGITS)));
    const whole = value => Math.abs(value - Math.round(value)) < 1e-6;
    let decimals = 1;
    while (decimals < 9 && !shown.every(value => whole(value * 10 ** decimals))) decimals++;
    return decimals;
}

function unitFor(id) { return SPECTRAL_UNITS[id] || SPECTRAL_UNITS.nm; }
export function fromNm(nm, unit) { return unitFor(unit).fromNm(nm); }
export function toNm(value, unit) { return unitFor(unit).toNm(value); }

/** What the points of a spectrum read in `unit` are evenly spaced in: 'wavelength' or 'wavenumber'. */
export function gridEvenIn(unit) { return STEP_UNITS[unitFor(unit).id].evenIn; }

// The length of an nm range in the unit a step of the `evenIn` kind is kept in.
function spanIn(evenIn, nmStart, nmEnd) {
    const unit = evenIn === 'wavenumber' ? 'cm1' : 'nm';
    return Math.abs(fromNm(nmEnd, unit) - fromNm(nmStart, unit));
}

/**
 * The step field in `unit`, read from `params`, which holds the stored steps.
 * `value` is the step in the unit as shown, `arrow` what the arrow keys add (a
 * twentieth of what they add to the range, which is 0.5 nm in nm), and
 * `patch(value)` the stored step a value typed in the unit sets.
 */
export function spectralStepControl(unit, params) {
    const id = unitFor(unit).id;
    const { evenIn, scale } = STEP_UNITS[id];
    const key = STEP_KEY[evenIn];
    return {
        unit: id,
        value: Number((params[key] * scale).toPrecision(STEP_DIGITS)),
        arrow: RANGE_CONTROL[id].step / 20,
        patch: value => ({ [key]: Number((value / scale).toPrecision(12)) }),
    };
}

/**
 * The patch that switches `params` to `unit`. Within nm and µm, or within cm⁻¹,
 * THz and eV, the points stay where they are. Between the two the step is
 * converted so the range keeps its number of intervals: 0.5 nm over 400-800 nm
 * becomes 15.625 cm⁻¹, and switching back gives 0.5 nm again.
 */
export function switchSpectralUnit(params, unit) {
    const from = gridEvenIn(params.spectralUnit);
    const to = gridEvenIn(unit);
    const patch = { spectralUnit: unit };
    const span = spanIn(from, params.lambdaStart, params.lambdaEnd);
    const step = params[STEP_KEY[from]];
    if (from !== to && span > 0 && step > 0) {
        const intervals = span / step;
        const target = spanIn(to, params.lambdaStart, params.lambdaEnd);
        patch[STEP_KEY[to]] = Number((target / intervals).toPrecision(12));
    }
    return patch;
}

/** The quantity symbol a unit is read in: λ, ν̃, f or E. */
export function spectralSymbol(unit) { return RANGE_CONTROL[unitFor(unit).id].symbol; }

/**
 * A wavelength range as a pair of fields in `unit`. Any positive value is a
 * wavelength in every unit, so the fields have no other bound.
 */
export function spectralRangeControl(unit, nmStart, nmEnd) {
    const id = SPECTRAL_UNITS[unit] ? unit : 'nm';
    const config = RANGE_CONTROL[id];
    return {
        symbol: config.symbol,
        start: Number(fromNm(nmStart, id).toFixed(config.decimals)),
        end: Number(fromNm(nmEnd, id).toFixed(config.decimals)),
        step: config.step,
    };
}

function formatValue(value, decimals) {
    if (!Number.isFinite(value)) return '';
    const fixed = value.toFixed(decimals);
    return decimals > 0 ? fixed.replace(/\.?0+$/, '') : fixed;
}

/**
 * Native ECharts value-axis fields; data coordinates always remain nanometres.
 * `titles` is t.spectralAxis, keyed by unit id.
 */
export function spectralAxisOption(unit, nmMin, nmMax, titles) {
    const config = unitFor(unit);
    return {
        name: titles[config.id],
        min: Number.isFinite(nmMin) ? nmMin : undefined,
        max: Number.isFinite(nmMax) ? nmMax : undefined,
        axisLabel: {
            formatter: value => formatValue(config.fromNm(value), config.decimals),
        },
    };
}
