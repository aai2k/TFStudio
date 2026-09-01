import { useDesign } from '../../../../state/DesignContext.js';
import { OPTIMIZATION_PREVIEW_MS, useLiveDesign } from '../../../../state/useLiveDesign.js';
import { computeSurface } from '../../../../utils/physics/plotQuantities.js';
import { designMaterialLookup } from '../../../../utils/materials/designMaterials.js';
import { runSurfaceSweep } from '../plotEngine/surfaceRunner.js';
import { useWindowSession } from '../../windowSession.js';
import { wavelengthAngleMapSession } from './sessionState.js';
import { buildMapSpec } from './mapSpec.js';

const { useEffect, useMemo, useRef, useState } = React;

// A design edit arrives as a stream of writes while a field is typed into or a
// slider dragged. Waiting for the design to settle keeps the sweep off every
// intermediate stack.
//
// Shorter than the interval a run is sampled at, so a run still gets a sweep
// per sampled frame: a wait longer than the sampling period would be reset by
// the next frame before it ever fired, and the map would sit frozen at the
// grid it held when the run started.
const SETTLE_MS = Math.round(OPTIMIZATION_PREVIEW_MS * 0.6);

// Above this many layer evaluations the sweep goes to the worker pool.
//
// A sweep costs one thin-film evaluation per grid point per layer. Timed
// against the shipped kernel, 61,000 of them take 24 ms, 243,000 take 50 ms and
// 490,000 take 65 ms, so a sweep inside the budget below finishes well within
// the settle above and never delays the next frame of a run. Starting a pool
// costs a worker per core, each compiling the kernel and receiving the sampled
// material table, which is more than a sweep this size takes to run outright;
// since the window sweeps on its own, a run at the default grid would otherwise
// build and kill that pool several times a second.
const MAIN_THREAD_BUDGET = 300000;

function sweepWork(spec, design) {
    const layers = (design.frontLayers?.length || 0) + (design.backLayers?.length || 0);
    return spec.xSteps * spec.ySteps * Math.max(1, layers);
}

/**
 * The sweep on the calling thread, reporting a failure the way the pool does.
 *
 * `computeSurface` throws on a design it cannot resolve. This is also the
 * fallback the pool runs after a worker failure, and there a throw would leave
 * the sweep as an unhandled rejection: the last map would stay on screen with
 * nothing to say why it had not moved.
 */
function sweepHere(spec, design) {
    try {
        return computeSurface(spec, design, designMaterialLookup(design));
    } catch (err) {
        return { ok: false, error: String(err && err.message || err), x: [], y: [], z: [] };
    }
}

/**
 * Keep the map in step with the design, without a Compute button.
 *
 * The grid is a wavelength row per angle, and each row is one batched spectrum
 * call, so a default map is quick. It still runs on the Plot Engine's worker
 * pool rather than in the renderer, because the step sizes are the user's and
 * a fine grid over a hundred-layer stack is not quick.
 */
function useMapSweep(spec, design) {
    const [result, setResult] = useState(null);
    const [computing, setComputing] = useState(false);
    const [progress, setProgress] = useState(null);
    const poolRef = useRef(null);
    const requestRef = useRef(0);

    useEffect(() => {
        // Supersede whatever is in flight: a pool left running would go on
        // filling a grid nobody is waiting for.
        const requestId = ++requestRef.current;
        const running = poolRef.current;
        poolRef.current = null;
        try { running?.terminate(); } catch (_) {}
        setProgress(null);
        if (!design) {
            setResult(null);
            setComputing(false);
            return undefined;
        }
        const timer = setTimeout(() => {
            // Small enough to run here finishes before a pool would have
            // started, and the timer above is what supersedes it.
            if (sweepWork(spec, design) <= MAIN_THREAD_BUDGET) {
                setResult(sweepHere(spec, design));
                return;
            }
            setComputing(true);
            runSurfaceSweep({
                surfaceSpec: spec,
                design,
                poolRef,
                setProgress,
                setSurfaceResult: setResult,
                setComputing,
                computeMainThread: () => sweepHere(spec, design),
                isCurrent: () => requestRef.current === requestId,
            });
        }, SETTLE_MS);
        return () => clearTimeout(timer);
    }, [spec, design]);

    // The window can be docked away mid-sweep, and the pool has to go with it.
    useEffect(() => () => {
        requestRef.current += 1;
        try { poolRef.current?.terminate(); } catch (_) {}
        poolRef.current = null;
    }, []);

    return { result, computing, progress };
}

export function useWavelengthAngleMap() {
    // The design as the other analysis windows see it: sampled while a run is
    // driving it, and held where it was if the live-update setting is off. The
    // evaluation mode is a property of the design being edited, not of the frame
    // being drawn, so it comes from the context directly.
    const { evalMode } = useDesign();
    const { design } = useLiveDesign();
    const [values, setField, patch] = useWindowSession(wavelengthAngleMapSession, design);
    const {
        lambdaStart, lambdaEnd, lambdaStep, angleStart, angleEnd, angleStep,
        channel, pol, render, colorscale,
    } = values;

    // Memoised on the values themselves rather than on the session object, so a
    // remount or a design switch that reads the same settings back does not
    // start the sweep over.
    const computeSpec = useMemo(
        () => buildMapSpec(values, evalMode),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [lambdaStart, lambdaEnd, lambdaStep, angleStart, angleEnd, angleStep,
            channel, pol, evalMode],
    );
    const spec = useMemo(
        () => ({ ...computeSpec, render, colorscale }),
        [computeSpec, render, colorscale],
    );
    const sweep = useMapSweep(computeSpec, design);

    return { design, evalMode, spec, ...values, ...sweep, set: setField, patch };
}
