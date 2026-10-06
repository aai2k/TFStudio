import { useDesign } from '../../../../state/DesignContext.js';
import { resolveColor } from '../../../../utils/materials/catalogManager.js';
import { designMaterialLookup } from '../../../../utils/materials/designMaterials.js';
import { MaterialHasNoIndexError } from '../../../../utils/materials/materialIndexAt.js';
import { useCatalogRevision } from '../../../../utils/materials/useCatalogRevision.js';
import {
    assignChips, autoChipLambdas, buildMonitorWorksheet,
} from '../../../../utils/monitoring/monoSim.js';
import { matName } from '../wizardShared.js';
import { usableChipGlass } from './chipGlass.js';
import { monitorWorksheetSession } from './sessionState.js';
import { useWindowSession } from '../../windowSession.js';

const { useCallback, useMemo } = React;

const EMPTY = { rows: [], chips: [], xEnd: 0 };

// A plan entered by hand is only meaningful while it still has one entry per
// deposited layer; after the stack is edited it is dropped and the chip size
// takes over again. The Process Exporter reads the same plan with this rule.
export function planForSteps(plan, stepCount) {
    return Array.isArray(plan) && plan.length === stepCount ? plan : null;
}

// Swatch colour and display name per material id the design deposits.
function materialMaps(design, resolveMat) {
    const colors = {};
    const names = {};
    for (const layer of design?.frontLayers || []) {
        if (layer.material && !colors[layer.material]) {
            colors[layer.material] = resolveColor(resolveMat(layer.material));
            names[layer.material] = matName(resolveMat, layer.material);
        }
    }
    return { colors, names };
}

function computeWorksheet(design, resolveMat, options) {
    if (!design?.frontLayers?.length) return EMPTY;
    try {
        return buildMonitorWorksheet(design, resolveMat, options);
    } catch (error) {
        return { ...EMPTY, error };
    }
}

export function useMonitorWorksheet() {
    const { design } = useDesign();
    const [session, setField, patch] = useWindowSession(monitorWorksheetSession, design);
    const stepCount = design?.frontLayers?.length || 0;
    // The chip glass is not a design material, so an edit to its catalog
    // reaches this window only through the catalog revision.
    const catalogRevision = useCatalogRevision();
    const resolveMat = useMemo(() => designMaterialLookup(design), [design, catalogRevision]);
    const chipGlass = useMemo(
        () => usableChipGlass(design, session.chipMaterial),
        [design, session.chipMaterial, catalogRevision]);

    const chipByStep = useMemo(
        () => planForSteps(session.chipByStep, stepCount) || assignChips(stepCount, session.layersPerChip),
        [session.chipByStep, session.layersPerChip, stepCount]);
    const lambdaByStep = useMemo(
        () => planForSteps(session.lambdaByStep, stepCount),
        [session.lambdaByStep, stepCount]);

    const options = useMemo(() => ({
        char: session.char,
        theta: session.theta,
        pol: session.polarization,
        chipMaterial: chipGlass.chipMaterial,
        witnessRatio: session.witnessRatio,
        signalErrorPct: session.signalErrorPct,
        absSignalErrorPct: session.absSignalErrorPct,
        maxTerminationErrPct: session.maxTerminationErrPct,
        chipByStep,
        lambdaByStep,
    }), [session.char, session.theta, session.polarization, chipGlass.chipMaterial,
         session.witnessRatio, session.signalErrorPct, session.absSignalErrorPct,
         session.maxTerminationErrPct, chipByStep, lambdaByStep]);

    const result = useMemo(
        () => computeWorksheet(design, resolveMat, options),
        [design, resolveMat, options]);
    const materials = useMemo(() => materialMaps(design, resolveMat), [design, resolveMat]);

    // Changing the chip size re-plans the whole run, which is the point of the
    // control; a wavelength entered by hand is kept.
    const setLayersPerChip = useCallback(value => {
        patch({ layersPerChip: value, chipByStep: null });
    }, [patch]);

    const setChipForStep = useCallback((step, chip) => {
        const next = chipByStep.slice();
        next[step - 1] = Math.max(1, Math.round(chip) || 1);
        setField('chipByStep', next);
    }, [chipByStep, setField]);

    // Every layer on a chip is monitored at one wavelength, so typing one into
    // any row moves the whole chip rather than being dropped on rebuild.
    const setLambdaForStep = useCallback((step, lambda) => {
        const next = (lambdaByStep || result.rows.map(row => row.lambda)).slice();
        const chip = chipByStep[step - 1];
        chipByStep.forEach((own, index) => { if (own === chip) next[index] = lambda; });
        setField('lambdaByStep', next);
    }, [chipByStep, lambdaByStep, result.rows, setField]);

    // With no index at the reference wavelength the run axis cannot be laid
    // out, so there is nothing to pick from; the worksheet already says why.
    const autoLambda = useCallback(() => {
        try {
            setField('lambdaByStep', autoChipLambdas(design, resolveMat, options));
        } catch (error) {
            if (!(error instanceof MaterialHasNoIndexError)) throw error;
        }
    }, [design, resolveMat, options, setField]);

    const bulkLambda = session.bulkLambda ?? (design?.referenceWavelength || 550);
    const setBulkLambda = useCallback(value => setField('bulkLambda', value), [setField]);
    const applyLambdaToAll = useCallback(() => {
        if (bulkLambda > 0) setField('lambdaByStep', new Array(stepCount).fill(bulkLambda));
    }, [bulkLambda, stepCount, setField]);

    const resetPlan = useCallback(() => {
        patch({ chipByStep: null, lambdaByStep: null });
    }, [patch]);

    return {
        design, stepCount, resolveMat,
        matColorMap: materials.colors, matNames: materials.names,
        rows: result.rows, xEnd: result.xEnd,
        error: result.error || null,
        chipGlassMissing: chipGlass.missing,
        poorCount: result.rows.filter(row => row.poor).length,
        session, setField,
        setLayersPerChip, setChipForStep, setLambdaForStep, autoLambda, resetPlan,
        bulkLambda, setBulkLambda, applyLambdaToAll,
        planned: !!(session.chipByStep || session.lambdaByStep),
    };
}
