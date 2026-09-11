/**
 * How many terms a dispersion model is given, and the fit at each of them.
 *
 * The extracted n and k go to the same fitter that fits a model to a tabulated
 * material, once per term count, and every candidate is then refined against
 * the measured spectrum before any of them is judged.
 */

import {
    fitMetalLadder,
    fitTabulatedMaterial,
    indexModelTermRange,
    TERM_GAIN,
} from '../dispersionFits.js';
import { isMetalModel } from './indexModels.js';
import { refine } from './refine.js';
import { resolvableExtinction } from './resolution.js';

/**
 * The extracted constants as rows a dispersion model can be fitted to.
 *
 * An extinction coefficient smaller than the measurement could resolve is set
 * to zero rather than carried. Left in, it makes a transparent film come back
 * with an absorption model fitted to photometric noise, which then costs three
 * parameters that describe nothing and leaves the fit unable to say how well
 * any of the others are determined.
 */
export function pointwiseRows(lambdas, extraction, thicknessNm) {
    const rows = [];
    for (let point = 0; point < lambdas.length; point++) {
        if (!extraction.resolved[point]) continue;
        const floor = resolvableExtinction(lambdas[point], thicknessNm);
        const extinction = extraction.k[point] > floor ? extraction.k[point] : 0;
        rows.push([lambdas[point], extraction.n[point], extinction]);
    }
    return rows;
}

function refineSeed(context, seedFit) {
    return { seedFit, refined: refine({ ...context, seedFit }) };
}

/**
 * Seed a model at one term count and refine it against the measurement.
 * Returns null when the seed fitter cannot produce a model from these rows.
 */
function fitAtTerms(context, rows, terms) {
    let seedFit;
    try {
        seedFit = fitTabulatedMaterial(rows, {
            rangeNm: context.rangeNm, nModel: context.indexModel, nTerms: terms,
        });
    } catch (_) {
        return null;
    }
    return refineSeed(context, seedFit);
}

/**
 * A metal seed at every oscillator count, Drude first, or none when the seed
 * fitter cannot produce a model from these rows.
 */
function metalSeeds(context, rows, warmStart) {
    try {
        return fitMetalLadder(rows, { rangeNm: context.rangeNm, nModel: context.indexModel, warmStart });
    } catch (_) {
        return [];
    }
}

/**
 * The model with the terms the measurement supports.
 *
 * A term is kept while it cuts the residual against the measured spectrum by
 * TERM_GAIN, the same rule the table fitter uses, but applied to the residual
 * that matters here. Judged on the extracted n and k instead, a term that
 * visibly improves the calculated spectrum can be dropped for not improving a
 * set of intermediate values.
 *
 * `parsimonious: false` drops that preference and returns the lowest residual
 * the model reaches at any term count. Trial thicknesses are compared that way,
 * because the term count a thickness happens to settle on is not a property of
 * the thickness: one entry keeping a cheaper model and another spending a
 * richer one turns a comparison between thicknesses into a comparison between
 * model sizes. Parsimony is applied once, at the thickness that wins.
 *
 * A metal's terms are its Lorentz oscillators, and every count the table
 * fitter can build is refined and judged here in the same way, whether the
 * thickness is held or solved. Left to the table fitter, the count would be
 * decided on the extracted constants under a test that tightens as the
 * spectrum is sampled more finely: silver measured from 300 nm, where its
 * interband edge sits, came back as plain Drude on a 2 nm grid and with two
 * oscillators on a 5 nm one. The sweep starts at none, so a film with no
 * absorption band in range can settle on the plain Drude fit here, on the
 * measured spectrum, and does not have to spend an oscillator that a free
 * thickness would then drift to pay for.
 *
 * The chain of metal seeds is the expensive part of the sweep, so it travels:
 * `seeds` reuses one already built from these rows, `warmStart` builds one
 * from a chain fitted to nearly the same rows, and the chain used comes back
 * as `seeds` on the result, with `cold` saying whether it was built from these
 * rows alone.
 */
export function fitBestModel(context, rows, { parsimonious = true, seeds = null, warmStart = null } = {}) {
    const margin = parsimonious ? 1 - TERM_GAIN : 1;
    const keep = (candidate, best) => candidate
        && (!best || candidate.refined.rms < best.refined.rms * margin);
    let best = null;
    let ladder = null;
    if (isMetalModel(context.indexModel)) {
        ladder = seeds || metalSeeds(context, rows, warmStart);
        for (const seedFit of ladder) {
            const candidate = refineSeed(context, seedFit);
            if (keep(candidate, best)) best = candidate;
        }
    } else {
        const [first, last] = indexModelTermRange(context.indexModel);
        for (let terms = first; terms <= last; terms++) {
            const candidate = fitAtTerms(context, rows, terms);
            if (keep(candidate, best)) best = candidate;
            // Do not stop at the first rejected count. The coefficient spaces
            // are nested, but each candidate is then refined through a
            // nonlinear TMM; one local solve can stall while a later term
            // count escapes it. A six-term Cauchy fit to the 500 nm TiO2 export
            // is the concrete case: four terms stalls, while six cuts the
            // spectrum residual materially.
        }
    }
    return best && { ...best, seeds: ladder, cold: !warmStart };
}
