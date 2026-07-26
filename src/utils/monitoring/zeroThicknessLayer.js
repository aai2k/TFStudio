/**
 * Record a disabled layer without advancing either deposition clock.
 * Monitoring algorithms must not apply rate noise, cut logic, or shutter
 * delay when the requested physical thickness is zero.
 */
export function recordZeroThicknessLayer(i, ctx, mut, cutStrategy) {
    mut.acc.realizedRates[i] = 0;
    mut.acc.asBuilt[i] = 0;
    mut.acc.cutTimes[i] = 0;
    if (mut.acc.estimated) mut.acc.estimated[i] = 0;
    if (mut.acc.cutStrategies && cutStrategy !== undefined) {
        mut.acc.cutStrategies[i] = cutStrategy;
    }
    mut.truthThicks[i] = 0;
    mut.modelThicks[i] = 0;
    if (ctx.onLayer) ctx.onLayer(ctx.N - i, ctx.N);
}
