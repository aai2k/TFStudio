/**
 * The pre-pass for a metal film the measurement cannot see through.
 *
 * Once a metal is opaque its spectrum stops depending on how thick it is, so
 * the thickness search has no gradient to work with and can carry the film to
 * any value at all. This runs before the search and stops it when the entered
 * thickness turns out to be an assumption rather than a result.
 */

import { channelDifference, makeSampleEvaluator } from './sampleSpectrum.js';
import { conditionsFor } from './channels.js';
import { isMetalModel } from './indexModels.js';
import { filmFromFit } from './refine.js';

/** Whether a 20% thickness change leaves every channel numerically unchanged. */
function thicknessInsensitive(request, result) {
    const channels = request.channels.map(source => ({
        quantity: source.quantity,
        conditions: conditionsFor({ source }, result.lambdas, request.sample),
    }));
    const evaluate = makeSampleEvaluator(channels);
    const film = filmFromFit(result.fit);
    return [0.8, 1.2].every(factor => {
        const calculated = evaluate(film, result.thicknessNm * factor);
        return channels.every((channel, index) => {
            const tolerance = channel.quantity === 'PSI' || channel.quantity === 'DEL' ? 1e-5 : 1e-8;
            return calculated[index].every((value, point) => Math.abs(channelDifference(
                channel.quantity, value, result.calculated[channel.quantity][point])) <= tolerance);
        });
    });
}

/**
 * The result for a metal whose thickness the measurement cannot reach.
 *
 * Fit the optical constants at the entered thickness first. Once the film is
 * opaque its reflection holds no thickness sensitivity at all, and letting ln d
 * float from there can carry it to astronomical values with the same spectrum.
 * When a fifth either way changes nothing, the entered value is kept and
 * labelled an assumption rather than reported as a fitted result.
 *
 * Returns null when the thickness is worth solving for after all, and the
 * ordinary search should run.
 */
export function opaqueMetalFit(request, fitHeld, report) {
    if (!isMetalModel(request.indexModel)
        || !Number.isFinite(request.thicknessNm) || !(request.thicknessNm > 0)) return null;
    report({ stage: 'held' });
    const held = fitHeld();
    if (held.error || !thicknessInsensitive(request, held)) return null;
    return {
        ...held,
        thicknessStatus: 'unresolved',
        diagnostics: {
            ...held.diagnostics,
            warnings: [
                ...held.diagnostics.warnings,
                { code: 'thicknessUnresolved', detail: { assumedNm: request.thicknessNm } },
            ],
        },
    };
}
