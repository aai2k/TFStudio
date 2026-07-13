import { emptyDeviation } from '../../../../utils/physics/systematicDeviations.js';

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

export function systematicDeviationDefaults() {
    return {
        dev: emptyDeviation(),
        mode: 'single', channel: 'all', showBaseline: true,
        lambdaStart: 400, lambdaEnd: 800, lambdaStep: 5, aoi: 0, pol: 'avg',
        sweep: { param: 'globalThicknessScale', from: 0.95, to: 1.05, steps: 21, offsetUnit: 'nm' },
        sweepChannel: 'T', sweepResult: null,
    };
}

export function sweepOptions(uniqueMats, sd) {
    return [
        { value: 'globalThicknessScale', label: sd.optThkScale || 'Global d-scale' },
        { value: 'globalThicknessOffset', label: sd.optThkOffset || 'Global d-offset' },
        { value: 'globalDeltaN', label: sd.optDeltaN || 'Global Δn' },
        { value: 'globalDeltaK', label: sd.optDeltaK || 'Global Δk' },
        ...uniqueMats.flatMap(({ id }) => [
            { value: `mat:${id}:dScale`, label: `${id}: d-scale` },
            { value: `mat:${id}:dOffset`, label: `${id}: d-offset` },
            { value: `mat:${id}:dn`, label: `${id}: Δn` },
            { value: `mat:${id}:dk`, label: `${id}: Δk` },
        ]),
    ];
}
