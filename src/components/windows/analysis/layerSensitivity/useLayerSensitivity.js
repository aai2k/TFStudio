import { useDesign } from '../../../../state/DesignContext.js';
import { getMaterialById, resolveColor } from '../../../../utils/materials/catalogManager.js';
import { getMaterial } from '../../../../utils/materials/materialDatabase.js';
import { computeLayerSensitivity } from '../../../../utils/physics/errorAnalysis.js';
import {
    buildSensitivityViewModel,
    buildSpecDesigns,
    hasSensitivityLayers,
} from './viewModel.js';

const { useMemo, useState } = React;

export function resolveSensitivityMaterial(id) {
    if (!id) return getMaterial('Air');
    return getMaterialById(id) || getMaterial(id) || getMaterial('Air');
}

function buildMaterialColorMap(design) {
    const map = {};
    for (const layer of (design?.frontLayers || [])) {
        const material = resolveSensitivityMaterial(layer.material);
        if (layer.material && !map[layer.material]) map[layer.material] = resolveColor(material);
    }
    for (const layer of (design?.backLayers || [])) {
        const material = resolveSensitivityMaterial(layer.material);
        if (layer.material && !map[layer.material]) map[layer.material] = resolveColor(material);
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

    const result = useMemo(() => {
        if (!sensHasLayers) return null;
        if (!operands.length) return { rows: [], mf0: 0, noOperands: true };
        try {
            return computeLayerSensitivity(design, operands, resolveSensitivityMaterial, {
                mode,
                relPct,
                absDeltaNm,
                includeLocked,
            });
        } catch (error) {
            return { error: error.message || String(error) };
        }
    }, [design, operands, mode, relPct, absDeltaNm, includeLocked]);

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
        resolveMat: resolveSensitivityMaterial,
    };
}
