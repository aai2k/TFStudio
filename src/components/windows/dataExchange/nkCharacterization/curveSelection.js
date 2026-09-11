/**
 * Which measured curves a characterization reads, and over what wavelengths.
 *
 * A measurement mode has two pickers of its own: transmittance and reflectance
 * for a spectrophotometer, Ψ and Δ for an ellipsometer. The other mode's
 * settings are left alone while it is not the mode in use, so switching back
 * finds the same curves still chosen.
 */

import { measuredCurveData } from '../../../../utils/io/spectrumTable.js';
import { curveById, defaultCurveSelection } from './model.js';

/** The setting each mode's two pickers write to, in the order they are shown. */
const MODE_KEYS = {
    ellipsometry: ['psiId', 'deltaId'],
    photometry: ['transmittanceId', 'reflectanceId'],
};

const ALL_KEYS = [...MODE_KEYS.photometry, ...MODE_KEYS.ellipsometry];

const modeKeys = measurementMode => (measurementMode === 'ellipsometry'
    ? MODE_KEYS.ellipsometry
    : MODE_KEYS.photometry);

/** The wavelengths every chosen curve covers. */
export function commonRange(curves) {
    if (curves.length === 0) return null;
    const spans = curves.map((curve) => {
        const { x } = measuredCurveData(curve);
        return [x[0], x[x.length - 1]];
    });
    const low = Math.max(...spans.map(span => span[0]));
    const high = Math.min(...spans.map(span => span[1]));
    return high > low ? [low, high] : null;
}

/** The curves the mode's pickers point at, without the ones no longer there. */
export function chosenCurves(design, settings, measurementMode) {
    return modeKeys(measurementMode)
        .map(key => curveById(design, settings[key], measurementMode))
        .filter(Boolean);
}

/** Pick up a design's curves once, and let go of a curve that was removed. */
export function syncCurveSelection({ anyCurves, design, measurementMode, settings, setField }) {
    const available = new Set(anyCurves.map(curve => curve.id));
    const defaults = defaultCurveSelection(design);
    for (const key of ALL_KEYS) {
        if (settings[key] && !available.has(settings[key])) setField(key, '');
    }
    const keys = modeKeys(measurementMode);
    if (!settings[keys[0]] && !settings[keys[1]]) {
        for (const key of keys) if (defaults[key]) setField(key, defaults[key]);
    }
}

/** The range follows the chosen curves until the user sets one. */
export function applyDefaultRange({ range, settings, setField }) {
    if (!range) return;
    if (!settings.lambdaStart) setField('lambdaStart', String(Math.round(range[0])));
    if (!settings.lambdaEnd) setField('lambdaEnd', String(Math.round(range[1])));
}
