import { createWindowSession } from '../../windowSession.js';

/**
 * Which curves are being characterized, and on what sample.
 *
 * Kept per design, because the curves belong to the design and a substrate
 * override describes the witness the film was deposited on rather than a
 * preference. The wavelength range starts empty and is filled from the curves
 * the first time a design is opened, so it follows the measurement instead of
 * a global default that would clip it.
 */
export const nkCharacterizationSession = createWindowSession({
    transmittanceId: '',
    reflectanceId: '',
    indexModel: 'cauchy',
    // Empty follows the design-wide evaluation mode: FRONT/BACK is one coating
    // on a semi-infinite substrate, TOTAL includes the substrate's back face.
    geometry: '',
    substrateId: '',
    substrateThicknessMm: '',
    thicknessNm: '',
    fixThickness: false,
    lambdaStart: '',
    lambdaEnd: '',
}, { scope: 'design' });

/** What the window is showing, which carries across designs. */
export const nkCharacterizationViewSession = createWindowSession({
    view: 'constants',
    showResults: true,
    showPointwise: true,
}, { scope: 'shared' });

/**
 * The last explicit extraction for each design.
 *
 * A dock move or tab switch unmounts the window. Keeping the result here makes
 * it behave like the other analysis windows: the expensive run and its stale
 * marker survive that remount, but are still discarded when the design closes.
 */
export const nkCharacterizationResultSession = createWindowSession({
    result: null,
    ranWith: '',
}, { scope: 'design' });
