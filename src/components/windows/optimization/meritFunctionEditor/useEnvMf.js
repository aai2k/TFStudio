import { LSQEngine } from '../../../../utils/physics/optimizer.js';
import { designMaterialLookup } from '../../../../utils/materials/designMaterials.js';
import { useLiveDesign } from '../../../../state/useLiveDesign.js';

const { useEffect, useState } = React;

/**
 * Per-environment merit values for the multi-environment editor.
 *
 * Multi-env mode: returns the `perEnvMf` array — one MF per environment, each
 * scored with the environment's OWN operand set (falling back to the shared
 * operands when an environment defines none), evaluated on the live design so
 * the display follows an optimizer run. Single-env mode (or no operands /
 * evaluation failure): returns null — the editor only shows per-env MFs in
 * multi-env mode, so single-env UI stays byte-identical.
 */
export function useEnvMf(design, operands) {
    const [perEnvMf, setPerEnvMf] = useState(null);
    const multiEnv = (design?.meritEnvironments || []).length > 0;
    const { design: liveDesign } = useLiveDesign();

    useEffect(() => {
        if (!multiEnv || !liveDesign || !operands || operands.length === 0) {
            setPerEnvMf(null);
            return;
        }
        try {
            const engine = new LSQEngine(operands, liveDesign, designMaterialLookup(liveDesign), {
                environments: liveDesign.meritEnvironments
            });
            setPerEnvMf(engine.mfAtWithPerEnv(engine.thicknesses).perEnvMf);
        } catch (_) {
            setPerEnvMf(null);
        }
    }, [liveDesign, operands, multiEnv]);

    return perEnvMf;
}