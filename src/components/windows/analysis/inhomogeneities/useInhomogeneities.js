import { useDesign } from '../../../../state/DesignContext.js';
import {
    cloneInhomogeneity, emptyInhomogeneity,
} from '../../../../utils/physics/inhomogeneity.js';
import {
    activeDesignSides, buildSpecificationInputs, computeInhomogeneitySpectra, designInterfaces,
} from './model.js';
import { inhomogeneityDesignSession, inhomogeneityViewSession } from './sessionState.js';
import { useWindowSession } from '../../windowSession.js';

const { useCallback, useMemo, useState } = React;
const keyFor = side => (side === 'back' ? 'backInterlayers' : 'interlayers');

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
    const [designSession, setDesignField] = useWindowSession(inhomogeneityDesignSession, design);
    // Memoised so the fallback is one stable object: a fresh one per render
    // would invalidate every memo below it on every render.
    const inh = useMemo(() => designSession.inh || emptyInhomogeneity(), [designSession.inh]);
    const setInh = useCallback(next => {
        setDesignField('inh', current => {
            const base = current || emptyInhomogeneity();
            return cloneInhomogeneity(typeof next === 'function' ? next(base) : next);
        });
    }, [setDesignField]);

    const [view, setViewField] = useWindowSession(inhomogeneityViewSession, design);
    const { channel, lambdaStart, lambdaEnd, lambdaStep, aoi, pol, showEditor, showTable } = view;
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
        design, evalMode, inh,
        channel, setChannel: value => setViewField('channel', value),
        lambdaStart, setLambdaStart: value => setViewField('lambdaStart', value),
        lambdaEnd, setLambdaEnd: value => setViewField('lambdaEnd', value),
        lambdaStep, setLambdaStep: value => setViewField('lambdaStep', value),
        aoi, setAoi: value => setViewField('aoi', value),
        pol, setPol: value => setViewField('pol', value),
        showEditor, setShowEditor: value => setViewField('showEditor', value),
        showTable, setShowTable: value => setViewField('showTable', value),
        error, activeSides, hasBack, interfaces, baseline, perturbed, specInputs,
        findInterlayer, upsertInterlayer, removeInterlayer, clearAll,
    };
}
