/**
 * Page 5 — Deposition Simulation (main-thread mono run).
 *
 * A single-λ run is cheap; unlike BBM's spectral run this stays on the main
 * thread (no worker needed for one experiment). Playback and the theory/actual
 * spectrum curves come from the shared wizardKit; only the run itself differs.
 */

import { resolveMat }      from '../wizardShared.js';
import { simulateRunMono, mulberry32 } from '../../../../utils/monitoring/monoSim.js';
import { useDepositionPlayback, useDepositionCurves } from '../wizardKit/depositionPlayback.js';
import { SimulationView }  from '../wizardKit/SimulationView.js';

const { createElement: h, useState, useRef, useCallback } = React;

export function PageSimulation({ p, set, layers, c, B, ctx, run, setRun, buildCfg }) {
    const N = layers.length;
    const [busy, setBusy] = useState(false);
    const seedRef = useRef(0);

    const playback = useDepositionPlayback(run, N, p.timeMult);
    const { layerIdx, frac, setProgress, setPlaying } = playback;
    const { traces } = useDepositionCurves({ run, layers, layerIdx, frac, ctx, p });

    const start = useCallback(() => {
        setBusy(true); setPlaying(false);
        const cfg = buildCfg(true);
        const seed = (cfg._seed ^ Math.imul(++seedRef.current, 0x9E3779B1)) >>> 0;
        // Single-λ run is cheap; defer so the busy state paints, then run on the
        // main thread (no worker needed for one experiment).
        setTimeout(() => {
            try {
                const res = simulateRunMono(ctx.simDesign, resolveMat, { ...cfg, rng: mulberry32(seed) });
                setRun(res); setProgress(0); setPlaying(true);
            } finally { setBusy(false); }
        }, 20);
    }, [ctx, buildCfg, setRun]);

    const leftTop = busy
        ? h('div', { key: 'busy', style: { fontSize: 12, color: c.textDim } }, B.computing)
        : h('button', { key: 'start', onClick: start, style: { padding: '7px', fontSize: 13, fontWeight: 600, cursor: 'pointer', borderRadius: 4, border: `1px solid ${c.accent}`, background: c.accent + '22', color: c.accent } }, run ? B.restart : B.start);

    return h(SimulationView, { p, set, c, B, run, N, layerIdx, frac, traces, leftTop, playback });
}
