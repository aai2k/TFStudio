import { useDesign } from '../../../../state/DesignContext.js';
import {
    cloneInhomogeneity, emptyInhomogeneity,
} from '../../../../utils/physics/inhomogeneity.js';
import {
    activeDesignSides, buildSpecificationInputs, computeInhomogeneitySpectra, designInterfaces,
} from './model.js';

const { useCallback, useEffect, useMemo, useState } = React;
const inhomogeneityCache = new Map();
const keyFor = side => (side === 'back' ? 'backInterlayers' : 'interlayers');

function cachedInhomogeneity(design) {
    const cached = design && inhomogeneityCache.get(design.id);
    return cached ? cloneInhomogeneity(cached) : emptyInhomogeneity();
}

function restoreCachedInhomogeneity(design, setInh) {
    if (design) setInh(cachedInhomogeneity(design));
}

function cacheInhomogeneity(design, inh) {
    if (design) inhomogeneityCache.set(design.id, cloneInhomogeneity(inh));
}

function computeSpectraState(design, params, inh, evalMode, setError) {
    if (!design?.frontLayers) return { baseline: null, perturbed: null };
    try {
        setError(null);
        return computeInhomogeneitySpectra(design, params, inh, evalMode);
    } catch (caught) {
        setError(caught.message || String(caught));
        return { baseline: null, perturbed: null };
    }
}

function computeSpecificationState(design, inh) {
    if (!design?.frontLayers) return null;
    try {
        return buildSpecificationInputs(design, inh);
    } catch (_) {
        return null;
    }
}

function upsertInhomogeneity(previous, side, afterIndex, patch) {
    const key = keyFor(side);
    const list = (previous[key] || []).slice();
    const index = list.findIndex(interlayer => interlayer.afterIndex === afterIndex);
    if (index >= 0) {
        list[index] = { ...list[index], ...patch };
    } else {
        list.push({ afterIndex, thickness: 5, profile: 'linear', slices: 10, enabled: true, ...patch });
    }
    return { ...previous, [key]: list };
}

function removeInhomogeneity(previous, side, afterIndex) {
    const key = keyFor(side);
    return {
        ...previous,
        [key]: (previous[key] || []).filter(interlayer => interlayer.afterIndex !== afterIndex),
    };
}

export function useInhomogeneities() {
    const { design, evalMode } = useDesign();
    const [inh, setInh] = useState(() => cachedInhomogeneity(design));
    useEffect(() => {
        restoreCachedInhomogeneity(design, setInh);
    }, [design?.id]);
    useEffect(() => {
        cacheInhomogeneity(design, inh);
    }, [inh, design?.id]);

    const [channel, setChannel] = useState('all');
    const [lambdaStart, setLambdaStart] = useState(400);
    const [lambdaEnd, setLambdaEnd] = useState(800);
    const [lambdaStep, setLambdaStep] = useState(5);
    const [aoi, setAoi] = useState(0);
    const [pol, setPol] = useState('avg');
    const [error, setError] = useState(null);
    const activeSides = activeDesignSides(design, evalMode);
    const hasBack = (design?.backLayers?.length || 0) > 0;
    const interfaces = useMemo(() => designInterfaces(design), [design]);
    const params = useMemo(() => ({
        lambdaStart, lambdaEnd, lambdaStep, theta: aoi, polarization: pol,
    }), [lambdaStart, lambdaEnd, lambdaStep, aoi, pol]);

    const { baseline, perturbed } = useMemo(
        () => computeSpectraState(design, params, inh, evalMode, setError),
        [design, params, inh, evalMode],
    );
    const specInputs = useMemo(() => computeSpecificationState(design, inh), [design, inh]);

    const findInterlayer = useCallback((side, afterIndex) =>
        (inh[keyFor(side)] || []).find(interlayer => interlayer.afterIndex === afterIndex), [inh]);
    const upsertInterlayer = useCallback((side, afterIndex, patch) => {
        setInh(previous => upsertInhomogeneity(previous, side, afterIndex, patch));
    }, []);
    const removeInterlayer = useCallback((side, afterIndex) => {
        setInh(previous => removeInhomogeneity(previous, side, afterIndex));
    }, []);
    const clearAll = useCallback(() => setInh(emptyInhomogeneity()), []);

    return {
        design, evalMode, inh, channel, setChannel,
        lambdaStart, setLambdaStart, lambdaEnd, setLambdaEnd,
        lambdaStep, setLambdaStep, aoi, setAoi, pol, setPol,
        error, activeSides, hasBack, interfaces, baseline, perturbed, specInputs,
        findInterlayer, upsertInterlayer, removeInterlayer, clearAll,
    };
}
