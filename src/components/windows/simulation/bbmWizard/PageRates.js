/**
 * Broadband Monitoring Wizard — Page 1: Deposition Rates.
 *
 * Broadband variant: the preview path comes from monitoringSim's shared OU
 * sampler; the controls + layout live in the shared RatesPage.
 */

import { sampleOURatePath, mulberry32 } from '../../../../utils/monitoring/monitoringSim.js';
import { RatesPage }                    from '../wizardKit/RatesPage.js';

const { createElement: h } = React;

// Live OU rate path preview (re-seeded by the "Randomize" nonce).
function samplePath(rate, rateNonce) {
    const rng = mulberry32((rateNonce | 0) + 1);
    return sampleOURatePath(rate.meanA, rate.rmsA, rate.corr, 1, 500, rng);
}

export function PageRates(props) {
    return h(RatesPage, { ...props, samplePath });
}
