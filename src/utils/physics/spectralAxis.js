/**
 * spectralAxis.js — spectral-axis display-unit helper (scoped to
 * the Optical Evaluation window).
 *
 * The physics engine ALWAYS works in vacuum wavelength λ [nm]. This module
 * touches ONLY the display layer: plots keep their x DATA in nm (curves, target
 * shapes, hovertemplates, ranges) and we merely relabel the axis — Plotly tick
 * positions stay in nm (`tickvals`) while their labels (`ticktext`) are the
 * round-number values in the chosen unit. Nothing in any coordinate logic
 * changes, so the nm sampling contract is untouched.
 *
 * Conversions (vacuum):
 *   λ[µm]   = λ[nm] / 1000
 *   ν̃[cm⁻¹] = 1e7 / λ[nm]                         (wavenumber)
 *   f[THz]  = c / λ = 299792.458 / λ[nm]           (c = 299 792 458 m/s)
 *   E[eV]   = h·c / λ = 1239.841984 / λ[nm]        (h·c = 1239.841984 eV·nm)
 * cm⁻¹, THz and eV are reciprocal in λ, so their axes run opposite to λ.
 */

const C_NM_THZ = 299792.458;     // c in nm·THz  (299792458 m/s → nm·THz)
const HC_EV_NM = 1239.841984;    // h·c in eV·nm (CODATA 2018: 1239.84198 eV·nm)

// Unit table. `toNm(v)` maps a unit value → nm; `fromNm(nm)` the inverse.
export const SPECTRAL_UNITS = {
    nm:  { id: 'nm',  short: 'nm',   title: 'Wavelength (nm)',     decimals: 0, toNm: v => v,            fromNm: nm => nm },
    um:  { id: 'um',  short: 'µm',   title: 'Wavelength (µm)',     decimals: 3, toNm: v => v * 1000,     fromNm: nm => nm / 1000 },
    cm1: { id: 'cm1', short: 'cm⁻¹', title: 'Wavenumber (cm⁻¹)',   decimals: 0, toNm: v => 1e7 / v,      fromNm: nm => 1e7 / nm },
    THz: { id: 'THz', short: 'THz',  title: 'Frequency (THz)',     decimals: 1, toNm: v => C_NM_THZ / v, fromNm: nm => C_NM_THZ / nm },
    eV:  { id: 'eV',  short: 'eV',   title: 'Photon energy (eV)',  decimals: 3, toNm: v => HC_EV_NM / v,  fromNm: nm => HC_EV_NM / nm },
};

export const SPECTRAL_UNIT_IDS = ['nm', 'um', 'cm1', 'THz', 'eV'];

/** nm → display-unit value. */
export function fromNm(nm, unit) {
    const u = SPECTRAL_UNITS[unit] || SPECTRAL_UNITS.nm;
    return u.fromNm(nm);
}
/** display-unit value → nm. */
export function toNm(value, unit) {
    const u = SPECTRAL_UNITS[unit] || SPECTRAL_UNITS.nm;
    return u.toNm(value);
}

// ── "Nice" tick generation ────────────────────────────────────────────────────
// Standard 1/2/5×10ⁿ nice-number stepping over [lo, hi].
function niceStep(rough) {
    if (!(rough > 0) || !isFinite(rough)) return 1;
    const exp = Math.floor(Math.log10(rough));
    const mag = Math.pow(10, exp);
    const f = rough / mag;
    let nf;
    if (f < 1.5) nf = 1;
    else if (f < 3) nf = 2;
    else if (f < 7) nf = 5;
    else nf = 10;
    return nf * mag;
}

function niceTickValues(lo, hi, target = 7) {
    if (!isFinite(lo) || !isFinite(hi)) return [];
    if (lo > hi) { const tmp = lo; lo = hi; hi = tmp; }
    if (lo === hi) return [lo];
    const step = niceStep((hi - lo) / Math.max(1, target));
    if (!(step > 0)) return [lo, hi];
    const first = Math.ceil(lo / step) * step;
    const out = [];
    for (let v = first, i = 0; v <= hi + step * 1e-6 && i < 1000; v += step, i++) {
        out.push(Math.round(v / step) * step);   // re-snap to kill float drift
    }
    return out;
}

function formatTick(value, decimals) {
    if (!isFinite(value)) return '';
    const s = value.toFixed(decimals);
    return s.indexOf('.') >= 0 ? s.replace(/\.?0+$/, '') : s;
}

/**
 * Plotly xaxis partial for a spectral axis covering [nmMin, nmMax] (in nm).
 * Spread into the existing `xaxis` config:
 *
 *     xaxis: { ...spectralAxisProps(unit, nmMin, nmMax), gridcolor, tickfont }
 *
 * For `nm` it returns just the title (Plotly auto-ticks in nm). For other units
 * it returns title + tickmode 'array' + tickvals (nm positions) + ticktext
 * (round values in the unit). The x DATA stays in nm — only labels change.
 */
export function spectralAxisProps(unit, nmMin, nmMax, standoff = 8) {
    const u = SPECTRAL_UNITS[unit] || SPECTRAL_UNITS.nm;
    const title = { text: u.title, standoff };
    if (unit === 'nm' || !isFinite(nmMin) || !isFinite(nmMax) || nmMin <= 0 || nmMax <= 0) {
        return { title };
    }
    const a = u.fromNm(nmMin), b = u.fromNm(nmMax);
    const lo = Math.min(a, b), hi = Math.max(a, b);
    const ticksU = niceTickValues(lo, hi);
    if (!ticksU.length) return { title };
    const tickvals = ticksU.map(v => u.toNm(v));        // positions stay in nm
    const ticktext = ticksU.map(v => formatTick(v, u.decimals));
    return { title, tickmode: 'array', tickvals, ticktext };
}
