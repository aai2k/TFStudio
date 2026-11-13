/**
 * A film and its substrate at another temperature, by the elastic strain model
 * of H. Takahashi, "Temperature stability of thin-film narrow-bandpass filters
 * produced by ion-assisted deposition", Appl. Opt. 34, 667-675 (1995).
 *
 * A film held to its substrate is stretched in its plane as the substrate
 * expands, and thins by its Poisson ratio. The volume its material fills
 * changes otherwise than the volume it occupies, so its packing density moves,
 * and with it the index. Between the temperature T₀ the design is given at
 * and T = T₀ + ΔT, with α the substrate's linear expansion, β the film's, ν
 * the film's Poisson ratio and dN/dT the temperature coefficient of the index
 * of the film's material, all per K, the paper's equations taken at ΔT in
 * place of its 1 °C are:
 *
 *   A = 2(α − β)(1 − 2ν)/(1 − ν)·ΔT
 *   B = 2ν(α − β)/(1 − ν)·ΔT
 *   P = P₀(1 + 3βΔT)/(1 + 3βΔT + A)          packing density, Eq. (14), p. 670
 *   d = d₀(1 − B + βΔT)                      thickness, Eq. (15), p. 670
 *   n = (N₀ + (dN/dT)·ΔT)·P + 1 − P          index, Eq. (18), p. 670, from Eq. (1), p. 669
 *
 * The film is taken as fully dense at T₀, P₀ = 1, the paper's case for
 * ion-assisted films, so N₀ is the film's index there, n₀. The index then
 * changes as n = P·n₀ + P·(dN/dT)·ΔT + 1 − P at every wavelength: a scale and
 * an offset of n₀. The paper models the real index alone; k is kept as it is.
 *
 * The paper applies the equations to a whole filter as one film: its N₀ is
 * the filter's averaged index (Eqs. 3 and 4), its dN/dT a weighted mean over
 * the filter's materials (Eq. 17), and the expansion of the filter and of its
 * materials is taken as one. Here they are applied to each layer with the
 * constants of its own material, and dN/dT is one value, the same at every
 * wavelength. Neither is the paper's.
 *
 * The paper gives no model for the substrate itself. Here its index moves by
 * its own dn/dT, n = n₀ + (dn/dT)·ΔT, and its thickness by its own expansion,
 * d = d₀(1 + αΔT); k is kept as it is.
 *
 * A material at another temperature is a material of its own, named by an id
 * that holds its scale and offset of n and the id of the material it is made
 * from, so it resolves anywhere that material resolves: on the main thread,
 * in a worker from the worker's table, and in a design posted to a worker.
 */

const PREFIX = 'thermal:';
const THERMAL_ID = /^thermal:([^:]+):([^:]+):(.+)$/s;

/**
 * True when a constant of the model is given: a finite number. A constant
 * that is absent, null, NaN, infinite or text is not given.
 */
export const constantGiven = value => Number.isFinite(value);

// A constant, or 0 where it is not given.
const givenOrZero = value => (constantGiven(value) ? value : 0);

// True when the strain a substrate puts on a film is known: the substrate's
// expansion α and the film's expansion β and Poisson ratio ν are all given.
const strainKnown = (film, substrateExpansion) =>
    [substrateExpansion, film.linearExpansionPerK, film.poissonsRatio].every(constantGiven);

/**
 * What a change of temperature ΔT (K) makes of a film, `{ thicknessFactor,
 * nScale, nOffset }`: its thickness is thicknessFactor times as large and its
 * index n₀ becomes nScale·n₀ + nOffset. `film` holds the film material's
 * expansion β (linearExpansionPerK), Poisson ratio ν (poissonsRatio) and dN/dT
 * (dnDtPerK), `substrateExpansion` the substrate's α, each per K.
 *
 * Where α, β or ν is not given the strain is not known, and the film is taken
 * as unstrained, A = B = 0 in Eqs. (14) and (15): P = 1, its thickness
 * d₀(1 + βΔT) and its index n₀ + (dN/dT)·ΔT by Eq. (18). β and dN/dT not
 * given count as 0.
 */
export function filmAtTemperature(film, substrateExpansion, deltaT) {
    const beta = givenOrZero(film.linearExpansionPerK);
    const dnDt = givenOrZero(film.dnDtPerK);
    if (!strainKnown(film, substrateExpansion)) {
        return { thicknessFactor: 1 + beta * deltaT, nScale: 1, nOffset: dnDt * deltaT };
    }
    const nu = film.poissonsRatio;
    const strain = substrateExpansion - beta;
    const a = 2 * strain * (1 - 2 * nu) / (1 - nu) * deltaT;
    const b = 2 * nu * strain / (1 - nu) * deltaT;
    const expanded = 1 + 3 * beta * deltaT;
    const packing = expanded / (expanded + a);
    return {
        thicknessFactor: 1 - b + beta * deltaT,
        nScale: packing,
        nOffset: packing * dnDt * deltaT + 1 - packing,
    };
}

/**
 * What a change of temperature ΔT (K) makes of a substrate, as
 * filmAtTemperature gives it: its thickness grows by its own expansion α and
 * its index by its own dn/dT, `substrate` holding both (linearExpansionPerK,
 * dnDtPerK), each per K, 0 when not given.
 */
export function substrateAtTemperature(substrate, deltaT) {
    return {
        thicknessFactor: 1 + givenOrZero(substrate.linearExpansionPerK) * deltaT,
        nScale: 1,
        nOffset: givenOrZero(substrate.dnDtPerK) * deltaT,
    };
}

/** True when a change leaves the index as it is. */
export const keepsIndex = change => change.nScale === 1 && change.nOffset === 0;

/** The id of material `baseId` with its index n₀ made nScale·n₀ + nOffset. */
export function thermalMaterialId(baseId, { nScale, nOffset }) {
    return `${PREFIX}${nScale}:${nOffset}:${baseId}`;
}

/** `{ baseId, nScale, nOffset }` of an id thermalMaterialId made, or null for any other id. */
export function parseThermalId(id) {
    const match = typeof id === 'string' && id.startsWith(PREFIX) ? THERMAL_ID.exec(id) : null;
    return match ? { baseId: match[3], nScale: Number(match[1]), nOffset: Number(match[2]) } : null;
}

/** The id a material at another temperature is made from, or the id itself. */
export function baseMaterialId(id) {
    return parseThermalId(id)?.baseId ?? id;
}

const derivations = new WeakMap();
const madeFrom = new WeakMap();

/** [n, k] with n made nScale·n + nOffset. */
const shiftedNK = ([n, k], nScale, nOffset) => [nScale * n + nOffset, k];

// A response of materialOmegaResponse with n made nScale·n + nOffset: the
// value takes the scale and the offset, each derivative of n the scale; k and
// its derivatives stay.
function shiftedResponse(response, nScale, nOffset) {
    if (!response) return response;
    const scaled = ([re, im], offset = 0) => [nScale * re + offset, im];
    return {
        ...response,
        nk: scaled(response.nk, nOffset),
        ...(response.derivatives ? { derivatives: response.derivatives.map(value => scaled(value)) } : {}),
        ...(response.jet ? { jet: response.jet.map((value, order) => scaled(value, order === 0 ? nOffset : 0)) } : {}),
    };
}

/**
 * Material `base` with its index n₀ made nScale·n₀ + nOffset, under the id
 * `id`, k kept: the same material in every other respect, its name, range and
 * constants included. One object per base material and id.
 */
export function materialAtTemperature(base, id) {
    let made = madeFrom.get(base);
    if (!made) madeFrom.set(base, made = new Map());
    if (made.has(id)) return made.get(id);
    const { nScale, nOffset } = parseThermalId(id);
    const getNK = Object.assign(lambda => shiftedNK(base.getNK(lambda), nScale, nOffset), base.getNK);
    const material = { ...base, id, getNK };
    if (base.getOmegaResponse) {
        material.getOmegaResponse = lambda => shiftedResponse(base.getOmegaResponse(lambda), nScale, nOffset);
    }
    derivations.set(material, { base, nScale, nOffset });
    made.set(id, material);
    return material;
}

/**
 * `resolved`, `{ material, status }` as a design resolves the material that
 * id `id` is made from, made into the resolution of `id`: the same with the
 * material at its temperature, or as it is when that material is missing.
 */
export function resolvedAtTemperature(resolved, id) {
    return resolved.status === 'missing' ? resolved : { ...resolved, material: materialAtTemperature(resolved.material, id) };
}

/**
 * `responseOf(material, ...args)`, a response of a material as
 * materialOmegaResponse gives it, made to give a material that
 * materialAtTemperature made the response of the material it was made from
 * with its index changed.
 */
export function followingTemperature(responseOf) {
    const response = (material, ...args) => {
        const derivation = derivations.get(material);
        if (!derivation) return responseOf(material, ...args);
        return shiftedResponse(response(derivation.base, ...args), derivation.nScale, derivation.nOffset);
    };
    return response;
}
