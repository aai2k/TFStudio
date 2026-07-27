import { useDesign } from '../../../../state/DesignContext.js';
import { resolveColor } from '../../../../utils/materials/catalogManager.js';
import { designMaterialLookup } from '../../../../utils/materials/designMaterials.js';
import { computeLayerSensitivity } from '../../../../utils/physics/errorAnalysis.js';
import {
    buildSensitivityViewModel,
    buildSpecDesigns,
    hasSensitivityLayers,
} from './viewModel.js';

const { useMemo, useState } = React;

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
    const [mode, setMode] = useState('relative');
    const [relPct, setRelPct] = useState(1.0);
    const [absDeltaNm, setAbsDeltaNm] = useState(1.0);
    const [includeLocked, setIncludeLocked] = useState(false);
    const [view, setView] = useState('chart');
    const [scale, setScale] = useState('normalized');
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
        includeLocked, setIncludeLocked, view, setView, scale, setScale,
        resolveMat,
    };
}
