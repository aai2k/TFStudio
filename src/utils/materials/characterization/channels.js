/**
 * The measured curves put on one wavelength grid, with the conditions each one
 * was taken under.
 *
 * Every later step reads all the channels at the same wavelengths, while an
 * instrument file can carry two curves on different grids, at different angles
 * and through different faces of the sample. Everything that has to agree
 * before any solving starts is settled here.
 */

import { createPchipInterpolator } from '../pchip.js';
import { extractEnvelope } from './envelope.js';

function ascendingUnique(values) {
    const sorted = [...values].sort((left, right) => left - right);
    return sorted.filter((value, index) => index === 0 || value !== sorted[index - 1]);
}

function overlapRange(channels) {
    const low = Math.max(...channels.map(channel => channel.lambdas[0]));
    const high = Math.min(...channels.map(channel => channel.lambdas[channel.lambdas.length - 1]));
    return [low, high];
}

function sameGrid(left, right) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * One wavelength grid for every channel.
 *
 * The grid is the master channel's own points inside the range every channel
 * covers, so the data that decides the fit is never interpolated. A second
 * channel measured on a different grid is resampled onto it, and the caller is
 * told which ones were.
 */
function alignChannels(rawChannels, rangeNm) {
    const [overlapLow, overlapHigh] = overlapRange(rawChannels);
    const low = Math.max(overlapLow, rangeNm?.[0] ?? -Infinity);
    const high = Math.min(overlapHigh, rangeNm?.[1] ?? Infinity);
    if (!(high > low)) return { error: 'noOverlap' };

    const master = rawChannels.find(channel => channel.quantity === 'T') || rawChannels[0];
    const lambdas = ascendingUnique(master.lambdas.filter(value => value >= low && value <= high));
    if (lambdas.length < 8) return { error: 'tooFewPoints', points: lambdas.length };

    const resampled = [];
    const channels = rawChannels.map((channel) => {
        let values;
        if (sameGrid(channel.lambdas, lambdas)) {
            values = channel.values.slice();
        } else {
            // A channel measured on the same wavelengths is selected from, not
            // interpolated, even when the range has clipped an end off the grid.
            // Two curves out of one instrument file always take this path, so
            // interpolating here would report every such pair as resampled.
            const position = new Map(channel.lambdas.map((lambda, index) => [lambda, index]));
            const picked = lambdas.map(lambda => position.get(lambda));
            if (picked.every(index => index !== undefined)) {
                values = picked.map(index => channel.values[index]);
            } else {
                const interpolate = createPchipInterpolator(
                    channel.lambdas.map((lambda, index) => [lambda, channel.values[index]]));
                values = lambdas.map(interpolate);
                resampled.push(channel.quantity);
            }
        }
        return { quantity: channel.quantity, values, source: channel };
    });
    return { lambdas, channels, resampled, rangeNm: [lambdas[0], lambdas[lambdas.length - 1]] };
}

export function conditionsFor(channel, lambdas, sample) {
    return {
        lambdas,
        incident: sample.incident,
        substrate: sample.substrate,
        exit: sample.exit,
        substrateThicknessMm: sample.substrateThicknessMm,
        geometry: sample.geometry,
        aoi: channel.source.aoi ?? 0,
        pol: channel.source.pol ?? 'avg',
        side: channel.source.side ?? 'front',
        deltaConvention: channel.source.deltaConvention || 'azzam',
    };
}

/**
 * The measured channels on one wavelength grid, with the sample conditions and
 * the fringe envelope they support, or an error naming what stopped it.
 *
 * At normal incidence there is no p/s distinction to measure: r_p and r_s
 * differ only by the sign that the reference frame flips, so any film gives
 * Ψ = 45° and Δ = 180° and the pair carries nothing about the coating. A curve
 * imported without an angle in its header arrives here at 0°, so this is the
 * common way to reach it rather than an exotic one.
 */
export function prepareChannels(request, sample) {
    const normalIncidence = request.channels.some(
        channel => (channel.quantity === 'PSI' || channel.quantity === 'DEL') && !(channel.aoi > 0));
    if (normalIncidence) return { error: 'ellipsometryNormalIncidence' };

    const aligned = alignChannels(request.channels, request.rangeNm);
    if (aligned.error) return aligned;

    const { lambdas, channels, rangeNm } = aligned;
    const solveChannels = channels.map(channel => ({
        quantity: channel.quantity,
        values: channel.values,
        conditions: conditionsFor(channel, lambdas, sample),
    }));
    const transmittance = channels.find(channel => channel.quantity === 'T');
    const envelope = transmittance
        ? extractEnvelope({
            lambdas,
            transmittance: transmittance.values,
            incidentIndexAt: lambda => sample.incident.getNK(lambda)[0],
            substrateIndexAt: lambda => sample.substrate.getNK(lambda)[0],
        })
        : null;
    return {
        lambdas, channels, rangeNm, solveChannels, envelope,
        hasTransmittance: !!transmittance,
        resampled: aligned.resampled,
    };
}

export function measuredChannels(channels) {
    const output = {};
    for (const channel of channels) output[channel.quantity] = channel.values;
    return output;
}

/** How the saved material records where its constants came from. */
export function measuredSource(measured) {
    if (measured.T && measured.R) return 'measured R/T';
    if (measured.PSI && measured.DEL) return 'measured Ψ/Δ';
    return 'measured ' + Object.keys(measured).join('/');
}

/**
 * Whether R + T is an energy balance for this pair of curves.
 *
 * Only when both were taken under the same illumination. A transmittance at
 * normal incidence and a reflectance at forty-five degrees are both valid and
 * routinely sum past one, which is not a calibration fault.
 */
export function energyComparable(solveChannels) {
    const photometric = solveChannels.filter(
        channel => channel.quantity === 'T' || channel.quantity === 'R');
    return photometric.length === 2 && ['aoi', 'pol', 'side'].every(
        key => photometric[0].conditions[key] === photometric[1].conditions[key]);
}
