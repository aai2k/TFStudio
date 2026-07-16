/**
 * Specification — design-requirements / qualifiers window.
 *
 * Each row is a single PASS/FAIL design requirement against the active
 * design. The window auto-recomputes on design change. A "Generate MF
 * from spec" button converts qualifiers into OPGT/OPLT merit-function
 * operands and writes them into design.meritOperands.
 *
 * See `src/utils/qualifiers.js` for the math; this file is UI only.
 */

import { useDesign } from '../../../../state/DesignContext.js';
import { useSpecificationState } from './useSpecificationState.js';
import { useDiskPresets } from './useDiskPresets.js';
import { VerdictBar } from './VerdictBar.js';
import { Toolbar } from './Toolbar.js';
import { QTable } from './QTable.js';
import { EmptyState } from './EmptyState.js';

const { createElement: h } = React;

export function Specification({ c, theme, t, setInputDialog }) {
    const ts = t.specification || {};

    const { design, updateDesign, checkpoint } = useDesign();
    const {
        qualifiers, results, verdict, selectedId, containerRef, selectAndFocus,
        addQualifier, updateQualifier, removeQualifier,
        writeQualifiers, qualifierKeyDown, generateMF, onApplyBuiltinPreset,
    } = useSpecificationState({ design, updateDesign, checkpoint });

    const {
        diskPresets, diskBusy, diskMsg,
        onSavePreset, onLoadDiskPreset, onDeleteDiskPreset,
    } = useDiskPresets({ qualifiers, writeQualifiers, checkpoint, design, ts, setInputDialog });

    if (!design) {
        return h('div', { style: { padding: 24, color: c.textDim, fontSize: 13 } }, ts.noDesign || 'No design selected.');
    }

    return h('div', {
        ref: containerRef,
        tabIndex: 0,
        onKeyDown: qualifierKeyDown,
        style: {
            display: 'flex', flexDirection: 'column', height: '100%',
            background: c.bg, color: c.text,
            fontFamily: 'system-ui, -apple-system, sans-serif', overflow: 'hidden',
            outline: 'none',
        }
    },
        h(VerdictBar, { verdict, c, ts, qualifiers, generateMF, design, t }),
        h(Toolbar,    {
            addQualifier, c, ts,
            onApplyBuiltinPreset,
            diskPresets, diskBusy, diskMsg,
            onSavePreset, onLoadDiskPreset, onDeleteDiskPreset,
        }),
        h('div', { style: { flex: 1, overflow: 'auto', minHeight: 0 } },
            qualifiers.length === 0
                ? h(EmptyState, { c, ts, addQualifier })
                : h(QTable, { qualifiers, results, c, ts, updateQualifier, removeQualifier,
                              selectedId, onSelect: selectAndFocus })
        )
    );
}
