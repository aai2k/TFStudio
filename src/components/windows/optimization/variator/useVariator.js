import { useDesign } from '../../../../state/DesignContext.js';
import {
    getVariatorCache, buildBaseMaps, computeAnyVaried,
    collectUniqueMaterials, buildThicknessPatch, computeVariatorSpectrum,
} from './model.js';

const { useState, useEffect, useRef, useMemo, useCallback } = React;

// Slider state — all relative to the baseline captured on first mount.
// Layer thickness deltas are stored by layer ID so reordering does not
// shift values around. Material n/k offsets are keyed by material id.
// One-shot checkpoint guard fires the FIRST time any slider moves so a
// single Ctrl+Z reverts the whole Variator session; reset on Revert and on
// design switch.
function useSliderState(design, checkpoint) {
    const [dThkFront, setDThkFront] = useState({});  // { [layerId]: Δnm }
    const [dThkBack,  setDThkBack]  = useState({});
    const [dSubMm,    setDSubMm]    = useState(0);
    const [dN,        setDN]        = useState({});  // { [matId]: Δn }
    const [dK,        setDK]        = useState({});  // { [matId]: Δk }
    const checkpointedRef = useRef(false);

    useEffect(() => {
        setDThkFront({}); setDThkBack({}); setDSubMm(0);
        setDN({}); setDK({});
        checkpointedRef.current = false;
    }, [design?.id]);

    const ensureCheckpoint = useCallback(() => {
        if (checkpointedRef.current) return;
        checkpointedRef.current = true;
        try { checkpoint(); } catch (_) {}
    }, [checkpoint]);

    const setLayerFront = (lid, val) => { ensureCheckpoint(); setDThkFront(prev => ({ ...prev, [lid]: val })); };
    const setLayerBack  = (lid, val) => { ensureCheckpoint(); setDThkBack(prev => ({ ...prev, [lid]: val })); };
    const setSub   = (val) => { ensureCheckpoint(); setDSubMm(val); };
    const setMatDN = (id, val) => { ensureCheckpoint(); setDN(prev => ({ ...prev, [id]: val })); };
    const setMatDK = (id, val) => { ensureCheckpoint(); setDK(prev => ({ ...prev, [id]: val })); };

    const revert = useCallback(() => {
        setDThkFront({}); setDThkBack({}); setDSubMm(0);
        setDN({}); setDK({});
        // The thickness-patch effect (useThicknessSync) fires with zeros,
        // restoring baseline thicknesses on this and every other open window.
    }, []);

    return {
        dThkFront, dThkBack, dSubMm, dN, dK,
        setLayerFront, setLayerBack, setSub, setMatDN, setMatDK, revert,
    };
}

// Captures the baseline thickness snapshot once per design id and pushes
// slider deltas back onto the design as transient thickness updates.
function useThicknessSync({ design, updateDesign, dThkFront, dThkBack, dSubMm }) {
    // Capture baseline thicknesses once per design id. We snapshot the
    // *current* thicknesses the first time we see this design — that
    // becomes the Revert reference for the rest of this Variator session
    // (including across docking switches via the module-scoped cache).
    useEffect(() => {
        if (!design) return;
        const cache = getVariatorCache(design.id);
        if (!cache.baseFront) {
            cache.baseFront = (design.frontLayers || []).map(l => ({ id: l.id, thickness: l.thickness }));
            cache.baseBack  = (design.backLayers  || []).map(l => ({ id: l.id, thickness: l.thickness }));
            cache.baseSubstrateMm = design.substrate?.thickness ?? 1.0;
        }
    }, [design?.id]);

    // Apply slider state -> design (thicknesses only). Material n/k offsets
    // stay local; see model.js.
    const applyThicknessesToDesign = useCallback((nextDF, nextDB, nextDSubMm) => {
        if (!design) return;
        const cache = getVariatorCache(design.id);
        const patch = buildThicknessPatch(design, cache, nextDF, nextDB, nextDSubMm);
        if (patch) updateDesign(patch, { transient: true });
    }, [design, updateDesign]);

    // Push transient updates whenever a thickness slider changes.
    useEffect(() => {
        if (!design) return;
        applyThicknessesToDesign(dThkFront, dThkBack, dSubMm);
    }, [dThkFront, dThkBack, dSubMm, applyThicknessesToDesign, design?.id]);
}

// Computes the Variator preview spectrum (perturbed + baseline arms) and
// recomputes whenever the design, view params, eval mode, or n/k offsets change.
function useSpectrumCompute({ design, params, evalMode, dN, dK }) {
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);

    const compute = useCallback(() => {
        if (!design) return;
        try {
            const cache = getVariatorCache(design.id);
            const result = computeVariatorSpectrum({ design, params, evalMode, dN, dK, cache });
            setData(result);
            setError(null);
        } catch (e) {
            console.error('[Variator] compute error:', e);
            setError(e.message || 'Computation error');
        }
    }, [design, params, evalMode, dN, dK]);

    useEffect(() => { compute(); }, [compute]);

    return { data, error };
}

export function useVariator() {
    const { design, updateDesign, checkpoint, evalMode } = useDesign();

    // View params
    const [params, setParams] = useState({
        lambdaStart: 400, lambdaEnd: 800, lambdaStep: 2, theta: 0, polarization: 'avg'
    });
    const [showBaseline, setShowBaseline] = useState(true);
    const [showTargets,  setShowTargets]  = useState(true);

    const slider = useSliderState(design, checkpoint);
    useThicknessSync({
        design, updateDesign,
        dThkFront: slider.dThkFront, dThkBack: slider.dThkBack, dSubMm: slider.dSubMm,
    });
    const uniqueMats = useMemo(() => (design ? collectUniqueMaterials(design) : []), [design]);
    const spectrum = useSpectrumCompute({ design, params, evalMode, dN: slider.dN, dK: slider.dK });

    if (!design) {
        return { design: null };
    }

    const cache = getVariatorCache(design.id);
    const { baseFrontById, baseBackById, baseSubMm } = buildBaseMaps(cache, design);
    const anyVaried = computeAnyVaried(slider.dThkFront, slider.dThkBack, slider.dSubMm, slider.dN, slider.dK);

    return {
        design, evalMode, params, setParams,
        showBaseline, setShowBaseline, showTargets, setShowTargets,
        data: spectrum.data, error: spectrum.error, anyVaried, uniqueMats,
        baseFrontById, baseBackById, baseSubMm,
        dThkFront: slider.dThkFront, dThkBack: slider.dThkBack, dSubMm: slider.dSubMm,
        dN: slider.dN, dK: slider.dK,
        setLayerFront: slider.setLayerFront, setLayerBack: slider.setLayerBack, setSub: slider.setSub,
        setMatDN: slider.setMatDN, setMatDK: slider.setMatDK, revert: slider.revert,
    };
}
