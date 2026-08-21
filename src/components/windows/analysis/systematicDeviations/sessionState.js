import { createWindowSession } from '../../windowSession.js';

// Deviations are applied to one coating and a sweep can take a while to run, so
// every slot is per design. `dev` starts null and the hook substitutes an empty
// deviation, which keeps each design's slot holding its own nested objects.
export const systematicDeviationsSession = createWindowSession({
    dev: null,
    mode: 'single',
    channel: 'all',
    showBaseline: true,
    lambdaStart: 400,
    lambdaEnd: 800,
    lambdaStep: 5,
    aoi: 0,
    pol: 'avg',
    sweep: { param: 'globalThicknessScale', from: 0.95, to: 1.05, steps: 21, offsetUnit: 'nm' },
    sweepChannel: 'T',
    sweepResult: null,
    showTable: false,
}, {
    scope: 'design',
    id: 'systematicDeviations',
    // The deviations themselves belong to the coating, and the swept result is
    // a computation, so neither is saved as a default.
    savable: [
        'mode', 'channel', 'showBaseline', 'lambdaStart', 'lambdaEnd', 'lambdaStep',
        'aoi', 'pol', 'sweep', 'sweepChannel', 'showTable',
    ],
});
