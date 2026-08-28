/**
 * The optical model a characterized film is measured through.
 *
 * A witness sample is one film on one face of a substrate that is thick enough
 * to be incoherent, and a spectrophotometer sees its back face as well. Fitting
 * against a coating on a semi-infinite substrate instead moves the transmittance
 * by several percent and puts that error straight into k, so the substrate and
 * its second surface are part of the model here, not an afterthought.
 *
 * Reference: Macleod, Thin-Film Optical Filters, 5th ed., §2, the incoherent
 * combination of two coated surfaces, which `evaluateSpectrumTotalAt`
 * implements.
 */

import { evaluateSpectrumAt, evaluateSpectrumTotalAt } from '../../physics/thinFilmMath.js';

/**
 * How much of the sample the measurement saw.
 *
 *   slab     film, substrate and the substrate's own back face. What a
 *            spectrophotometer measures a witness in.
 *   coating  film on a semi-infinite substrate, no back face. For a wedged,
 *            roughened or index-matched back, and for data already corrected
 *            for it.
 */
export const SAMPLE_GEOMETRIES = ['slab', 'coating'];

/** A film whose n and k are read from arrays aligned to one evaluation grid. */
export function griddedFilm(lambdas, nValues, kValues) {
    const indexOf = new Map();
    lambdas.forEach((lambda, index) => indexOf.set(lambda, index));
    const getNK = (lambda) => {
        const index = indexOf.get(lambda);
        return index === undefined ? [nValues[0], kValues[0]] : [nValues[index], kValues[index]];
    };
    return { getNK };
}

/** A film with one n and one k at every wavelength. */
export function constantFilm(n, k) {
    const nk = [n, k];
    return { getNK: () => nk };
}

function selectedChannels(spectrum) {
    return { R: spectrum.R, T: spectrum.T, A: spectrum.A };
}

/**
 * Reflectance, transmittance and absorptance of the sample.
 *
 * `side` is the face the instrument illuminated. Transmittance is the same
 * either way, reflectance is not, so a curve measured through the uncoated face
 * is modelled with the film on the far side rather than being refused.
 *
 * @param {object} conditions  lambdas, incident, substrate, exit,
 *                             substrateThicknessMm, aoi, pol, side, geometry
 * @param {object} film        material with getNK(λ)
 * @param {number} thicknessNm film thickness
 */
export function filmSpectrum(conditions, film, thicknessNm) {
    const { lambdas, incident, substrate, exit, aoi = 0, pol = 'avg' } = conditions;
    const params = { theta: aoi, polarization: pol };
    const layers = [{ material: film, thickness: thicknessNm }];

    if (conditions.geometry === 'coating') {
        // A semi-infinite substrate has no far side to illuminate.
        return selectedChannels(evaluateSpectrumAt(lambdas, params, incident, substrate, layers));
    }
    const illuminatedFromFilm = conditions.side !== 'back';
    return selectedChannels(evaluateSpectrumTotalAt(
        lambdas, params,
        illuminatedFromFilm ? incident : exit,
        substrate,
        illuminatedFromFilm ? exit : incident,
        illuminatedFromFilm ? layers : [],
        illuminatedFromFilm ? [] : layers,
        conditions.substrateThicknessMm ?? 1.0,
    ));
}

/** The sample with no film on it, which is what the fit is measured against. */
export function bareSubstrateSpectrum(conditions) {
    return filmSpectrum(conditions, constantFilm(1, 0), 0);
}

const conditionsKey = conditions =>
    `${conditions.geometry}|${conditions.aoi}|${conditions.pol}|${conditions.side}`;

/**
 * One call that evaluates every measured channel of a sample.
 *
 * A reflectance and a transmittance taken under the same conditions come out of
 * the same spectrum, so evaluating them separately does the whole transfer-matrix
 * calculation twice. Channels are grouped by their conditions here, which halves
 * the work in the usual case and still allows a channel measured at a different
 * angle to have its own.
 *
 * @param {{quantity:'T'|'R', conditions:object}[]} channels
 * @returns {(film:object, thicknessNm:number) => number[][]} aligned to channels
 */
export function makeSampleEvaluator(channels) {
    const groups = [];
    const byKey = new Map();
    channels.forEach((channel, index) => {
        const key = conditionsKey(channel.conditions);
        let group = byKey.get(key);
        if (!group) {
            group = { conditions: channel.conditions, members: [] };
            byKey.set(key, group);
            groups.push(group);
        }
        group.members.push({ index, quantity: channel.quantity });
    });
    return (film, thicknessNm) => {
        const output = new Array(channels.length);
        for (const group of groups) {
            const spectrum = filmSpectrum(group.conditions, film, thicknessNm);
            for (const member of group.members) output[member.index] = spectrum[member.quantity];
        }
        return output;
    };
}
