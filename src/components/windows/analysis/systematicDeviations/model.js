import { emptyDeviation } from '../../../../utils/physics/systematicDeviations.js';
import { matFriendlyName } from '../../optimization/synthesisShared/materialNames.js';

const PARAM_KINDS = {
    globalThicknessScale: 'scale',
    globalThicknessOffset: 'offset',
    globalDeltaN: 'dn',
    globalDeltaK: 'dk',
    dScale: 'scale',
    dOffset: 'offset',
    dn: 'dn',
    dk: 'dk',
};

const SWEEP_RANGES = {
    scale: { from: 0.95, to: 1.05 },
    dn: { from: -0.05, to: 0.05 },
    dk: { from: -0.01, to: 0.01 },
};

const OFFSET_RANGES = {
    qw: { from: -0.1, to: 0.1 },
    fw: { from: -0.05, to: 0.05 },
    ot: { from: -10, to: 10 },
    nm: { from: -10, to: 10 },
};

export function sweepParamKind(param) {
    const field = String(param).split(':').pop();
    return PARAM_KINDS[param] || PARAM_KINDS[field] || 'scale';
}

export function defaultSweepRange(param, offsetUnit = 'nm') {
    const kind = sweepParamKind(param);
    const range = kind === 'offset'
        ? (OFFSET_RANGES[offsetUnit] || OFFSET_RANGES.nm)
        : (SWEEP_RANGES[kind] || SWEEP_RANGES.scale);
    return { ...range };
}

/**
 * The sweep the design can run.
 *
 * The parameter is kept per design and a material parameter names its
 * material by id. Once that material is replaced, no layer uses it, the
 * parameter selector has no such option and shows its first one, and a run
 * would perturb nothing. Such a parameter falls back to that first option,
 * with its default range, so the selector and the run agree. A sweep that is
 * still valid is returned as it is.
 */
export function sweepForDesign(sweep, uniqueMats) {
    const material = /^mat:(.+):[^:]+$/.exec(sweep.param);
    if (!material || uniqueMats.some(({ id }) => id === material[1])) return sweep;
    const param = 'globalThicknessScale';
    return { ...sweep, param, ...defaultSweepRange(param) };
}

/** The store patch that puts a stale sweep right and drops its result; empty when `stored` is valid. */
export function staleSweepPatch(stored, uniqueMats) {
    const sweep = sweepForDesign(stored.sweep, uniqueMats);
    return sweep === stored.sweep ? {} : { sweep, sweepResult: null };
}

export function systematicDeviationDefaults() {
    return {
        dev: emptyDeviation(),
        mode: 'single', channel: 'all', showBaseline: true,
        lambdaStart: 400, lambdaEnd: 800, lambdaStep: 5, aoi: 0, pol: 'avg',
        sweep: { param: 'globalThicknessScale', from: 0.95, to: 1.05, steps: 21, offsetUnit: 'nm' },
        sweepChannel: 'T', sweepResult: null,
    };
}

// A material parameter names its material as the design shows it, not by id.
export function sweepOptions(uniqueMats, sd, design) {
    return [
        { value: 'globalThicknessScale', label: sd.optThkScale || 'Global d-scale' },
        { value: 'globalThicknessOffset', label: sd.optThkOffset || 'Global d-offset' },
        { value: 'globalDeltaN', label: sd.optDeltaN || 'Global Δn' },
        { value: 'globalDeltaK', label: sd.optDeltaK || 'Global Δk' },
        ...uniqueMats.flatMap(({ id }) => {
            const name = matFriendlyName(id, design);
            return [
                { value: `mat:${id}:dScale`, label: sd.optMatScale(name) },
                { value: `mat:${id}:dOffset`, label: sd.optMatOffset(name) },
                { value: `mat:${id}:dn`, label: `${name}: Δn` },
                { value: `mat:${id}:dk`, label: `${name}: Δk` },
            ];
        }),
    ];
}

/**
 * What the heat map calls the parameter a sweep result was run on: the label
 * the selector gives it, so the two read the same in every language. The
 * result records its own parameter, which the selector may have moved off
 * since the run, and its material may have left the design since; that
 * material is still named. A result saved before results recorded their
 * parameter carries only the name it was given then.
 */
export function sweepParamName(sweepResult, uniqueMats, sd, design) {
    const { param, paramName } = sweepResult;
    if (!param) return paramName || sd.colParam;
    const material = /^mat:(.+):[^:]+$/.exec(param)?.[1];
    const mats = material && !uniqueMats.some(({ id }) => id === material)
        ? [...uniqueMats, { id: material }]
        : uniqueMats;
    const option = sweepOptions(mats, sd, design).find(item => item.value === param);
    const unit = sweepParamKind(param) === 'offset' ? ` (${sweepResult.offsetUnit || 'nm'})` : '';
    return (option?.label || sd.colParam) + unit;
}
