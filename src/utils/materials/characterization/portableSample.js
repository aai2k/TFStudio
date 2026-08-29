/**
 * A characterization sample that survives a postMessage.
 *
 * A sample carries three materials, and a material is an object with a method
 * on it, which cannot cross a worker boundary. The main thread samples each of
 * them on the wavelengths the run will ask for and sends plain arrays; the
 * worker rebuilds lookup stubs over exactly those values.
 *
 * The lookup is an exact match on the wavelength float, not an interpolation.
 * Every wavelength a run evaluates at comes from the measured channels, which
 * is what is sampled here, so the worker sees the same numbers the main thread
 * would have computed and the result is identical either way.
 */

/** Every wavelength any channel carries, ascending and deduplicated. */
export function channelLambdas(channels) {
    const seen = new Set();
    for (const channel of channels || []) {
        for (const lambda of channel.lambdas || []) {
            if (Number.isFinite(lambda)) seen.add(lambda);
        }
    }
    return [...seen].sort((left, right) => left - right);
}

function sampleMaterial(material, lambdas) {
    const n = new Array(lambdas.length);
    const k = new Array(lambdas.length);
    for (let index = 0; index < lambdas.length; index++) {
        const [nr, ni] = material.getNK(lambdas[index]);
        n[index] = nr;
        k[index] = ni;
    }
    return { n, k };
}

/** The sample as plain data, sampled on the wavelengths the channels cover. */
export function portableSample(sample, channels) {
    const lambdas = channelLambdas(channels);
    return {
        lambdas,
        incident: sampleMaterial(sample.incident, lambdas),
        substrate: sampleMaterial(sample.substrate, lambdas),
        exit: sampleMaterial(sample.exit, lambdas),
        substrateThicknessMm: sample.substrateThicknessMm,
        geometry: sample.geometry,
        substrateId: sample.substrateId,
    };
}

function lookup(lambdas, table) {
    const byLambda = new Map();
    for (let index = 0; index < lambdas.length; index++) {
        byLambda.set(lambdas[index], [table.n[index], table.k[index]]);
    }
    // A wavelength outside the sampled set means the run evaluated somewhere the
    // measurement never reached, which the alignment step rules out. Falling
    // back to the nearest keeps such a run finite instead of poisoning it with
    // NaN, and there is nothing better to return.
    let nearest = null;
    return (lambda) => {
        const hit = byLambda.get(lambda);
        if (hit) return hit;
        if (!nearest) {
            nearest = (value) => {
                let low = 0;
                let high = lambdas.length - 1;
                while (high - low > 1) {
                    const mid = (low + high) >> 1;
                    if (lambdas[mid] < value) low = mid; else high = mid;
                }
                const pick = Math.abs(lambdas[low] - value) <= Math.abs(lambdas[high] - value) ? low : high;
                return [table.n[pick], table.k[pick]];
            };
        }
        return nearest(lambda);
    };
}

/** Rebuild a usable sample from what portableSample sent. */
export function sampleFromPortable(portable) {
    const { lambdas } = portable;
    return {
        incident: { getNK: lookup(lambdas, portable.incident) },
        substrate: { getNK: lookup(lambdas, portable.substrate) },
        exit: { getNK: lookup(lambdas, portable.exit) },
        substrateThicknessMm: portable.substrateThicknessMm,
        geometry: portable.geometry,
        substrateId: portable.substrateId,
    };
}
