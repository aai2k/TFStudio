import { useDesign } from '../../../../state/DesignContext.js';
import { resolveColor } from '../../../../utils/materials/catalogManager.js';
import { designMaterialLookup } from '../../../../utils/materials/designMaterials.js';
import { computeLayerSensitivity } from '../../../../utils/physics/errorAnalysis.js';
import {
    buildSensitivityViewModel,
    buildSpecDesigns,
    hasSensitivityLayers,
} from './viewModel.js';
import { layerSensitivitySession } from './sessionState.js';
import { useWindowSession } from '../../windowSession.js';

const { useMemo } = React;

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

export function useLayerSensitivity() {
    const { design } = useDesign();
    const [session, setField] = useWindowSession(layerSensitivitySession, design);
    const { mode, relPct, absDeltaNm, includeLocked, scale, showChart } = session;
    const setMode = value => setField('mode', value);
    const setRelPct = value => setField('relPct', value);
    const setAbsDeltaNm = value => setField('absDeltaNm', value);
    const setIncludeLocked = value => setField('includeLocked', value);
    const setScale = value => setField('scale', value);
    const setShowChart = value => setField('showChart', value);
    const operands = design?.meritOperands || [];
    const sensHasLayers = hasSensitivityLayers(design);

    const resolveMat = useMemo(() => designMaterialLookup(design), [design]);

    const result = useMemo(() => {
        if (!sensHasLayers) return null;
        if (!operands.length) return { rows: [], mf0: 0, noOperands: true };
        try {
            return computeLayerSensitivity(design, operands, resolveMat, {
                mode,
                relPct,
                absDeltaNm,
                includeLocked,
            });
        } catch (error) {
            return { error: error.message || String(error) };
        }
    }, [design, resolveMat, operands, mode, relPct, absDeltaNm, includeLocked]);

    const matColorMap = useMemo(() => buildMaterialColorMap(design), [design]);
    const specDesigns = useMemo(
        () => buildSpecDesigns(design, mode, relPct, absDeltaNm),
        [design, mode, relPct, absDeltaNm],
    );
    const viewModel = buildSensitivityViewModel(design, result);

    return {
        design, operands, sensHasLayers, result, error: result?.error || null,
        matColorMap, specDesigns, ...viewModel,
        mode, setMode, relPct, setRelPct, absDeltaNm, setAbsDeltaNm,
        includeLocked, setIncludeLocked, scale, setScale,
        showChart, setShowChart, resolveMat,
    };
}
