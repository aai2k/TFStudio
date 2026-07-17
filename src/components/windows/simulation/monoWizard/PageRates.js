/**
 * Monochromatic Monitoring Wizard — Page 1: Deposition Rates.
 *
 * Mono variant: inlines its own OU rate path (independent of monitoringSim
 * internals); the controls + layout live in the shared RatesPage.
 */

import { mulberry32 } from '../../../../utils/monitoring/monoSim.js';
import { RatesPage }  from '../wizardKit/RatesPage.js';

const { createElement: h } = React;

function samplePath(rate, rateNonce) {
    const rng = mulberry32((rateNonce | 0) + 1);
    const a = rate.corr > 0 ? Math.exp(-1 / rate.corr) : 0;
    const t = [], rr = [];
    const g = () => { let u1 = rng(); while (u1 <= 1e-12) u1 = rng(); return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * rng()); };
    let cur = rate.rmsA > 0 ? rate.meanA + g() * rate.rmsA : rate.meanA;
    for (let i = 0; i < 500; i++) {
        t.push(i); rr.push(cur);
        cur = rate.rmsA <= 0 ? rate.meanA
            : a > 0 ? rate.meanA + a * (cur - rate.meanA) + Math.sqrt(Math.max(0, 1 - a * a)) * rate.rmsA * g()
                    : rate.meanA + g() * rate.rmsA;
    }
    return { t, r: rr };
}

export function PageRates(props) {
    return h(RatesPage, { ...props, samplePath });
}
