import { useDesign } from '../../../../state/DesignContext.js';
import { resolveColor } from '../../../../utils/materials/catalogManager.js';
import { designMaterialLookup } from '../../../../utils/materials/designMaterials.js';
import { computeLayerSensitivity } from '../../../../utils/physics/errorAnalysis.js';
import { useMeritValues, MERIT_ONLY } from '../../optimization/useMeritValues.js';
import {
    buildSensitivityViewModel,
    buildSpecDesigns,
    hasSensitivityLayers,
} from './viewModel.js';
import { layerSensitivitySession } from './sessionState.js';
import { useWindowSession } from '../../windowSession.js';

const { useMemo } = React;
const NO_OPERANDS = [];
const NO_ROWS = Object.freeze({ rows: [], mf0: null });

function buildMaterialColorMap(design) {
    const resolveMaterial = designMaterialLookup(design);
    const map = {};
    for (const layer of [...(design?.frontLayers || []), ...(design?.backLayers || [])]) {
        if (layer.material && !map[layer.material]) {
            map[layer.material] = resolveColor(resolveMaterial(layer.material));
        }
    }
    return map;
}

function rankingOf(design, operands, options) {
    try {
        return computeLayerSensitivity(design, operands, designMaterialLookup(design), options);
    } catch (error) {
        return { ...NO_ROWS, error: error.message || String(error) };
    }
}

// The ranking read as useMeritValues reads merit rows: computeLayerSensitivity
// here, and the analysis worker's layerSensitivity at the rows' own Steps.
function sensitivityReading(options) {
    return {
        ...MERIT_ONLY,
        none: NO_ROWS,
        here: (design, operands) => rankingOf(design, operands, options),
        operation: 'layerSensitivity',
        payload: (design, operands) => ({ design, operands, options }),
        received: ranking => ranking,
    };
}

/**
 * The ranking of `design`'s layers by how far `operands`' merit moves under
 * the perturbation `options` describe (computeLayerSensitivity), read as the
 * merit tables read their rows (useMeritValues): at once with every row at its
 * default step, `mfProvisional` marking a ranking that can differ at the rows'
 * own Steps, then on the analysis worker at those Steps unless `hold` is on;
 * under a cone, on the worker alone, `busy` while it works and `failed` when
 * it could not.
 */
export function useSensitivityRanking(design, operands, options, hold) {
    const reading = useMemo(() => sensitivityReading(options), [options]);
    return useMeritValues(design, operands, hold, reading);
}

export function useLayerSensitivity() {
    const { design, isOptimizing } = useDesign();
    const [session, setField] = useWindowSession(layerSensitivitySession, design);
    const { mode, relPct, absDeltaNm, includeLocked, scale, showChart } = session;
    const setMode = value => setField('mode', value);
    const setRelPct = value => setField('relPct', value);
    const setAbsDeltaNm = value => setField('absDeltaNm', value);
    const setIncludeLocked = value => setField('includeLocked', value);
    const setScale = value => setField('scale', value);
    const setShowChart = value => setField('showChart', value);
    const operands = design?.meritOperands || NO_OPERANDS;
    const sensHasLayers = hasSensitivityLayers(design);

    const options = useMemo(
        () => ({ mode, relPct, absDeltaNm, includeLocked }),
        [mode, relPct, absDeltaNm, includeLocked]);
    const ranking = useSensitivityRanking(sensHasLayers ? design : null, operands, options, isOptimizing);
    let result = null;
    if (sensHasLayers) result = operands.length ? ranking : { rows: [], mf0: 0, noOperands: true };

    const matColorMap = useMemo(() => buildMaterialColorMap(design), [design]);
    const specDesigns = useMemo(
        () => buildSpecDesigns(design, mode, relPct, absDeltaNm),
        [design, mode, relPct, absDeltaNm],
    );
    const viewModel = buildSensitivityViewModel(design, result);

    return {
        design, operands, sensHasLayers, result, error: result?.error || null,
        provisional: !!result?.mfProvisional, busy: !!result?.busy, failed: !!result?.failed,
        matColorMap, specDesigns, ...viewModel,
        mode, setMode, relPct, setRelPct, absDeltaNm, setAbsDeltaNm,
        includeLocked, setIncludeLocked, scale, setScale,
        showChart, setShowChart,
    };
}
