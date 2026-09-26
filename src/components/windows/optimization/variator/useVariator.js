import { useDesign } from '../../../../state/DesignContext.js';
import {
    captureVariatorBaseline, buildBaseMaps, computeAnyVaried, collectUniqueMaterials,
    buildThicknessPatch, computeVariatorSpectrum, designFollowsSession,
} from './model.js';
import { variatorSliderSession, variatorViewSession } from './sessionState.js';
import { useWindowCopy, useWindowSession } from '../../windowSession.js';

const { useState, useEffect, useRef, useMemo, useCallback } = React;

// Sliders that move the design. Only these put the session's undo step down;
// the n/k offsets act on the preview alone.
const THICKNESS_KEYS = ['dThkFront', 'dThkBack', 'dSubMm'];
const THICKNESSES_AT_ZERO = { dThkFront: {}, dThkBack: {}, dSubMm: 0 };

// A design's thicknesses as one comparable value.
function thicknessKey(design) {
    const layers = list => (list || []).map(l => `${l.id}:${l.thickness}`).join(',');
    return `${layers(design.frontLayers)}|${layers(design.backLayers)}|${design.substrate?.thickness}`;
}

// Starts the session again from the design as it is whenever the design stops
// holding what the sliders put there: on first open, after an undo, or after an
// edit in another window. The n/k offsets are kept; they are not in the design.
//
// It compares against the session rendered with the design. On a switch of
// design the store is read instead, since the rendered session still belongs
// to the old one. A design the sliders wrote themselves can arrive after they
// have moved on, and would then look like an edit from outside; `written`
// holds what they wrote since the design last matched them, so that one is let
// through and the next write brings the design up to date.
function useSessionReconcile({ design, session, patchSession, copyId, written }) {
    const seenIdRef = useRef(null);
    useEffect(() => {
        if (!design) return;
        const switched = seenIdRef.current !== design.id;
        seenIdRef.current = design.id;
        const current = switched ? variatorSliderSession.read(design, copyId) : session;
        const follows = designFollowsSession(design, current);
        const ownWrite = !switched && written.has(thicknessKey(design));
        if (follows || !ownWrite) written.clear();
        if (follows || ownWrite) return;
        patchSession({ ...THICKNESSES_AT_ZERO, baseline: captureVariatorBaseline(design), checkpointed: false });
    }, [design]); // eslint-disable-line react-hooks/exhaustive-deps
}

// Pushes the thickness sliders onto the design as transient updates, once per
// move. Keyed on the sliders alone: a write keyed on the design as well would
// run again after every render and write the sliders back over an undo. A
// baseline the store has already replaced is not written; the render with the
// new one writes instead.
function useThicknessSync({ design, updateDesign, session, copyId, written }) {
    const designRef = useRef(design);
    designRef.current = design;
    const updateRef = useRef(updateDesign);
    updateRef.current = updateDesign;
    const { baseline, dThkFront, dThkBack, dSubMm } = session;
    useEffect(() => {
        const current = designRef.current;
        if (!current || variatorSliderSession.read(current, copyId).baseline !== baseline) return;
        const patch = buildThicknessPatch(current, baseline, dThkFront, dThkBack, dSubMm);
        if (!patch) return;
        written.add(thicknessKey({ ...current, ...patch }));
        updateRef.current(patch, { transient: true });
    }, [baseline, dThkFront, dThkBack, dSubMm]); // eslint-disable-line react-hooks/exhaustive-deps
}

// Slider state, relative to the session's baseline. Layer thickness deltas are
// keyed by layer id so reordering does not shift values around; material n/k
// offsets are keyed by material id. The first thickness move of a session
// pushes one undo checkpoint, so a single Ctrl+Z reverts the whole session.
function useSliderSession(design, updateDesign, checkpoint) {
    const copyId = useWindowCopy();
    const [session, , patchSession] = useWindowSession(variatorSliderSession, design);
    const written = useRef(null);
    if (!written.current) written.current = new Set();
    useSessionReconcile({ design, session, patchSession, copyId, written: written.current });
    useThicknessSync({ design, updateDesign, session, copyId, written: written.current });

    // Reads the store rather than the rendered session, so two moves between
    // renders both land and only the first puts the undo step down.
    const move = useCallback((key, update) => {
        const current = variatorSliderSession.read(design, copyId);
        const next = { [key]: update(current[key]) };
        if (THICKNESS_KEYS.includes(key) && !current.checkpointed) {
            try { checkpoint(); } catch (_) {}
            next.checkpointed = true;
        }
        patchSession(next);
    }, [design, copyId, checkpoint, patchSession]);

    const byId = (key, id, val) => move(key, map => ({ ...map, [id]: val }));

    // Zeros every slider. The thickness write then restores the baseline on
    // this and every other open window.
    const revert = useCallback(() => {
        patchSession({ ...THICKNESSES_AT_ZERO, dN: {}, dK: {} });
    }, [patchSession]);

    return {
        ...session,
        setLayerFront: (lid, val) => byId('dThkFront', lid, val),
        setLayerBack: (lid, val) => byId('dThkBack', lid, val),
        setSub: val => move('dSubMm', () => val),
        setMatDN: (id, val) => byId('dN', id, val),
        setMatDK: (id, val) => byId('dK', id, val),
        revert,
    };
}

// Computes the Variator preview spectrum (perturbed + baseline arms) and
// recomputes whenever the design, view params, eval mode, baseline, or n/k
// offsets change.
function useSpectrumCompute({ design, params, evalMode, dN, dK, baseline }) {
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);

    const compute = useCallback(() => {
        if (!design) return;
        try {
            const result = computeVariatorSpectrum({ design, params, evalMode, dN, dK, baseline });
            setData(result);
            setError(null);
        } catch (e) {
            console.error('[Variator] compute error:', e);
            setError(e.message || 'Computation error');
        }
    }, [design, params, evalMode, dN, dK, baseline]);

    useEffect(() => { compute(); }, [compute]);

    return { data, error };
}

export function useVariator() {
    const { design, updateDesign, checkpoint, evalMode } = useDesign();

    // View params
    const [view, setViewField] = useWindowSession(variatorViewSession, design);
    const { params, showBaseline, showTargets } = view;
    const setParams      = value => setViewField('params', value);
    const setShowBaseline = value => setViewField('showBaseline', value);
    const setShowTargets  = value => setViewField('showTargets', value);

    const slider = useSliderSession(design, updateDesign, checkpoint);
    const uniqueMats = useMemo(() => (design ? collectUniqueMaterials(design) : []), [design]);
    const spectrum = useSpectrumCompute({
        design, params, evalMode, dN: slider.dN, dK: slider.dK, baseline: slider.baseline,
    });

    if (!design) {
        return { design: null };
    }

    const { baseFrontById, baseBackById, baseSubMm } = buildBaseMaps(slider.baseline, design);
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
