import { useDesign } from '../../state/DesignContext.js';
import { useUnresolvedMaterials } from '../../utils/materials/useUnresolvedMaterials.js';
import { ReplaceMaterialsDialog } from '../dialogs/ReplaceMaterialsDialog.js';
import { MaterialCalculationBlocked } from './MissingMaterialsNotice.js';

const { createElement: h, Fragment, useState } = React;

/** Prevent a calculation modal from mounting while the active design is unresolved. */
export function MaterialResolutionModalGuard({ children, c, t, onClose }) {
    const { design, updateDesign } = useDesign();
    const missingMaterialIds = useUnresolvedMaterials(design);
    const [replaceOpen, setReplaceOpen] = useState(false);
    if (missingMaterialIds.length === 0) return children;

    return h(Fragment, null,
        h('div', {
            style: {
                position: 'fixed', inset: 0, zIndex: 1000,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                backgroundColor: 'rgba(0,0,0,0.7)',
            },
        },
            h('div', {
                style: {
                    position: 'relative', width: 620, maxWidth: '92vw', height: 360,
                    maxHeight: '85vh', overflow: 'hidden', backgroundColor: c.bg,
                    border: `1px solid ${c.border}`, borderRadius: 8,
                    boxShadow: '0 10px 40px rgba(0,0,0,0.4)',
                },
            },
                h('button', {
                    onClick: onClose, title: t.materialResolution.close,
                    style: {
                        position: 'absolute', right: 8, top: 6, zIndex: 1,
                        border: 'none', background: 'transparent', color: c.textDim,
                        cursor: 'pointer', fontSize: 18,
                    },
                }, '×'),
                h(MaterialCalculationBlocked, {
                    ids: missingMaterialIds, c, t,
                    onRepair: () => setReplaceOpen(true),
                })),
        ),
        replaceOpen && h(ReplaceMaterialsDialog, {
            design, updateDesign, c, t, onClose: () => setReplaceOpen(false),
        }),
    );
}
