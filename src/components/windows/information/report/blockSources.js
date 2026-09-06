/**
 * Settings a new block copies from the window it comes from.
 *
 * Every analysis window keeps its controls in a session store registered under
 * the window's id. Reading that store gives the values as the window shows them
 * now, or the saved defaults if the window has not been opened this session, so
 * a range set once in Optical Evaluation is not typed again in the report.
 */

import { windowSessionStores } from '../../windowSession.js';
import { blockSpec } from '../../../../utils/report/blocks.js';

// The stores are peeked, not read: a read from the report must not move the
// window off the design it last showed or reseed what it holds for it.
function windowValues(windowId, design) {
    return windowSessionStores(windowId).reduce((acc, store) => ({ ...acc, ...store.peek(design) }), {});
}

const listCopy = list => (Array.isArray(list) && list.length ? [...list] : undefined);

// Store keys → block settings, per block type. A key the store does not carry
// stays undefined and falls back to the block default. The Monte-Carlo and
// worksheet blocks have no entry: they print what their window holds, read
// when the report is built, so there is nothing to copy.
const FROM_WINDOW = {
    spectrum: v => ({
        lambdaStart: v.lambdaStart, lambdaEnd: v.lambdaEnd, lambdaStep: v.lambdaStep,
        thetas: listCopy(v.thetas), curves: v.showCurves ? { ...v.showCurves } : undefined,
        spectralUnit: v.spectralUnit, yScale: v.yScale, yAuto: v.yAuto, yMin: v.yMin, yMax: v.yMax,
    }),
    color: v => ({
        characteristic: v.characteristic, pol: v.pol, theta: v.theta,
        observer: v.observer, illuminant: v.illuminant, step: v.step,
    }),
    integrals: v => ({ theta: v.theta, polarization: v.polarization }),
    // The window shows one quantity at a time; the block starts with that one.
    gdGdd: v => ({
        lambdaStart: v.lamStart, lambdaEnd: v.lamEnd, theta: v.theta, target: v.target, pol: v.pol, side: v.side,
        quantities: v.quantity ? { phase: false, gd: false, gdd: false, tod: false, [v.quantity]: true } : undefined,
    }),
    ellipsometry: v => ({
        lambdaStart: v.lambdaStart, lambdaEnd: v.lambdaEnd, lambdaStep: v.lambdaStep,
        thetas: v.thetaDeg != null ? [v.thetaDeg] : undefined,
        showPsi: v.showPsi, showDelta: v.showDelta,
    }),
    efield: v => ({ theta: v.theta, pol: v.pol === 'p' ? 'p' : (v.pol === 's' ? 's' : undefined), lambda: v.lambda }),
    riProfile: v => ({ lambda: v.lambda }),
};

/** Settings for a new block of `type`, copied from its source window. */
export function settingsFromWindow(type, design) {
    const spec = blockSpec(type);
    const map = FROM_WINDOW[type];
    if (!spec?.source || !map) return {};
    const mapped = map(windowValues(spec.source, design));
    return Object.fromEntries(Object.entries(mapped).filter(([, v]) => v !== undefined));
}
