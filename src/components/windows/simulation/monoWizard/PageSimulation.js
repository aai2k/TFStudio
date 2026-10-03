/**
 * Page 6 — Deposition Simulation (main-thread mono run).
 *
 * A single-λ run is cheap; unlike BBM's spectral run this stays on the main
 * thread (no worker needed for one experiment). Playback and the theory/actual
 * spectrum curves come from the shared wizardKit; only the run itself differs.
 */

import { MaterialHasNoIndexError } from '../../../../utils/materials/materialIndexAt.js';
import { flipLayerIndex } from '../../../../utils/monitoring/depositionSpectrum.js';
import { simulateRunMono, mulberry32 } from '../../../../utils/monitoring/monoSim.js';
import { useDepositionPlayback, useDepositionCurves } from '../wizardKit/depositionPlayback.js';
import { SimulationView }  from '../wizardKit/SimulationView.js';
import { matName } from '../wizardShared.js';

const { createElement: h, useState, useRef, useCallback } = React;

// A layer monitored where a material of its stack has no index cannot be cut
// on the signal; the run refuses and names the layer as page 4 numbers it.
function noIndexMessage(error, { B, ctx, N }) {
    return B.noIndex(matName(ctx.resolveMat, error.materialId), error.lambdaNm,
        flipLayerIndex(N, error.layerIndex));
}

export function PageSimulation({ p, set, layers, c, B, ctx, run, setRun, buildCfg }) {
    const N = layers.length;
    const [busy, setBusy] = useState(false);
    const [refused, setRefused] = useState(null);
    const seedRef = useRef(0);

    const playback = useDepositionPlayback(run, N, p.timeMult);
    const { layerIdx, frac, setProgress, setPlaying } = playback;
    const { series } = useDepositionCurves({ run, layers, layerIdx, frac, ctx, p });

    const start = useCallback(() => {
        setBusy(true); setPlaying(false);
        const cfg = buildCfg(true);
        const seed = (cfg._seed ^ Math.imul(++seedRef.current, 0x9E3779B1)) >>> 0;
        // Single-λ run is cheap; defer so the busy state paints, then run on the
        // main thread (no worker needed for one experiment).
        setTimeout(() => {
            try {
                const res = simulateRunMono(ctx.simDesign, ctx.resolveMat, { ...cfg, rng: mulberry32(seed) });
                setRefused(null);
                setRun(res); setProgress(0); setPlaying(true);
            } catch (error) {
                if (!(error instanceof MaterialHasNoIndexError)) throw error;
                setRun(null);
                setRefused(noIndexMessage(error, { B, ctx, N }));
            } finally { setBusy(false); }
        }, 20);
    }, [ctx, buildCfg, setRun, B, N]);

    const control = busy
        ? h('div', { key: 'busy', style: { fontSize: 12, color: c.textDim } }, B.computing)
        : h('button', { key: 'start', onClick: start, style: { padding: '7px', fontSize: 13, fontWeight: 600, cursor: 'pointer', borderRadius: 4, border: `1px solid ${c.accent}`, background: c.accent + '22', color: c.accent } }, run ? B.restart : B.start);
    const leftTop = refused
        ? h('div', { key: 'control', style: { display: 'flex', flexDirection: 'column', gap: 6 } },
            control, h('div', { style: { fontSize: 11.5, color: c.error } }, refused))
        : control;

    return h(SimulationView, { p, set, c, B, run, N, layerIdx, frac, series, leftTop, playback });
}
