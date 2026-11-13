import { useDesign } from '../../../../state/DesignContext.js';
import {
    cloneInhomogeneity, emptyInhomogeneity,
} from '../../../../utils/physics/inhomogeneity.js';
import { useEnvironmentChoice } from '../chrome/environmentChoice.js';
import { designInterfaces } from '../designInterfaces.js';
import { useEvaluationUnderCone } from '../useEvaluationUnderCone.js';
import {
    activeDesignSides, buildSpecificationInputs, inhomogeneitySpectraState, NEW_INTERLAYER,
} from './model.js';
import { inhomogeneityDesignSession, inhomogeneityViewSession } from './sessionState.js';
import { useWindowSession } from '../../windowSession.js';

const { useCallback, useMemo } = React;
const keyFor = side => (side === 'back' ? 'backInterlayers' : 'interlayers');

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
        list.push({ afterIndex, ...NEW_INTERLAYER, ...patch });
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

// `ih` is t.inhomogeneities, for the names of the interfaces.
export function useInhomogeneities(ih) {
    const { design } = useDesign();
    // The environment the spectra are computed in, Current or one the
    // droplist names, on what it is scored on and under its own cone. The
    // interlayers are one list for every environment, each at an interface of
    // the layer list, grading between the materials that meet there in the
    // environment shown.
    const environment = useEnvironmentChoice(design);
    const { design: shown, mode: evalMode } = environment.views[0];
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
    const { showCurves, lambdaStart, lambdaEnd, lambdaStep, aoi, showEditor, showTable } = view;
    const activeSides = activeDesignSides(shown, evalMode);
    const hasBack = (design?.backLayers?.length || 0) > 0;
    const interfaces = useMemo(() => designInterfaces(shown, ih), [shown, ih]);
    // Always averaged: the spectrum carries Ts/Tp, Rs/Rp and As/Ap alongside,
    // so the curve switches pick a polarization without recomputing anything.
    const params = useMemo(() => ({
        lambdaStart, lambdaEnd, lambdaStep, theta: aoi, polarization: 'avg',
    }), [lambdaStart, lambdaEnd, lambdaStep, aoi]);

    // Under a cone of incidence the spectra are computed in the analysis worker,
    // as Optical Evaluation computes its own.
    const request = useMemo(() => ({ design: shown, params, inh, evalMode }), [shown, params, inh, evalMode]);
    const evaluated = useEvaluationUnderCone(shown, 'inhomogeneitySpectra', request, inhomogeneitySpectraState);
    const baseline = evaluated.data?.baseline ?? null;
    const perturbed = evaluated.data?.perturbed ?? null;
    const error = evaluated.data?.error ?? evaluated.error;
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
        design, evalMode, inh, environment, shownDesign: shown,
        showCurves,
        toggleCurve: key => setViewField('showCurves',
            current => ({ ...current, [key]: !current[key] })),
        lambdaStart, setLambdaStart: value => setViewField('lambdaStart', value),
        lambdaEnd, setLambdaEnd: value => setViewField('lambdaEnd', value),
        lambdaStep, setLambdaStep: value => setViewField('lambdaStep', value),
        aoi, setAoi: value => setViewField('aoi', value),
        showEditor, setShowEditor: value => setViewField('showEditor', value),
        showTable, setShowTable: value => setViewField('showTable', value),
        error, activeSides, hasBack, interfaces, baseline, perturbed, specInputs,
        findInterlayer, upsertInterlayer, removeInterlayer, clearAll,
    };
}
