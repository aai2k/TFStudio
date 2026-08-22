/** Display-unit conversion for wavelength-backed chart axes and controls. */

const C_NM_THZ = 299792.458;
const HC_EV_NM = 1239.841984;

export const SPECTRAL_UNITS = {
    nm:  { id: 'nm',  short: 'nm',   title: 'Wavelength (nm)',     decimals: 0, toNm: value => value,            fromNm: nm => nm },
    um:  { id: 'um',  short: 'µm',   title: 'Wavelength (µm)',     decimals: 3, toNm: value => value * 1000,     fromNm: nm => nm / 1000 },
    cm1: { id: 'cm1', short: 'cm⁻¹', title: 'Wavenumber (cm⁻¹)',   decimals: 0, toNm: value => 1e7 / value,      fromNm: nm => 1e7 / nm },
    THz: { id: 'THz', short: 'THz',  title: 'Frequency (THz)',     decimals: 1, toNm: value => C_NM_THZ / value, fromNm: nm => C_NM_THZ / nm },
    eV:  { id: 'eV',  short: 'eV',   title: 'Photon energy (eV)',  decimals: 3, toNm: value => HC_EV_NM / value,  fromNm: nm => HC_EV_NM / nm },
};

export const SPECTRAL_UNIT_IDS = ['nm', 'um', 'cm1', 'THz', 'eV'];

const RANGE_CONTROL = {
    nm:  { symbol: 'λ', decimals: 2, step: 10 },
    um:  { symbol: 'λ', decimals: 4, step: 0.01 },
    cm1: { symbol: 'ν̃', decimals: 0, step: 100 },
    THz: { symbol: 'f', decimals: 2, step: 1 },
    eV:  { symbol: 'E', decimals: 4, step: 0.01 },
};

function unitFor(id) { return SPECTRAL_UNITS[id] || SPECTRAL_UNITS.nm; }
export function fromNm(nm, unit) { return unitFor(unit).fromNm(nm); }
export function toNm(value, unit) { return unitFor(unit).toNm(value); }

export function spectralRangeControl(unit, nmStart, nmEnd) {
    const id = SPECTRAL_UNITS[unit] ? unit : 'nm';
    const config = RANGE_CONTROL[id];
    const boundaryA = fromNm(100, id), boundaryB = fromNm(20000, id);
    return {
        symbol: config.symbol,
        start: Number(fromNm(nmStart, id).toFixed(config.decimals)),
        end: Number(fromNm(nmEnd, id).toFixed(config.decimals)),
        min: Math.min(boundaryA, boundaryB),
        max: Math.max(boundaryA, boundaryB),
        step: config.step,
    };
}

function formatValue(value, decimals) {
    if (!Number.isFinite(value)) return '';
    const fixed = value.toFixed(decimals);
    return decimals > 0 ? fixed.replace(/\.?0+$/, '') : fixed;
}

/** Native ECharts value-axis fields; data coordinates always remain nanometres. */
export function spectralAxisOption(unit, nmMin, nmMax) {
    const config = unitFor(unit);
    return {
        name: config.title,
        min: Number.isFinite(nmMin) ? nmMin : undefined,
        max: Number.isFinite(nmMax) ? nmMax : undefined,
        axisLabel: {
            formatter: value => formatValue(config.fromNm(value), config.decimals),
        },
    };
}
