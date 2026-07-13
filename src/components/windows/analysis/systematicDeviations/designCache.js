import { cloneDeviation } from '../../../../utils/physics/systematicDeviations.js';
import { systematicDeviationDefaults } from './model.js';

const cache = new Map();

export function designSnapshot(design) {
    return (design && cache.get(design.id)) || systematicDeviationDefaults();
}

export function cacheDesignState(design, state) {
    if (!design) return;
    cache.set(design.id, {
        dev: cloneDeviation(state.dev),
        mode: state.mode,
        channel: state.channel,
        showBaseline: state.showBaseline,
        lambdaStart: state.lambdaStart,
        lambdaEnd: state.lambdaEnd,
        lambdaStep: state.lambdaStep,
        aoi: state.aoi,
        pol: state.pol,
        sweep: state.sweep,
        sweepChannel: state.sweepChannel,
        sweepResult: state.sweepResult,
    });
}
