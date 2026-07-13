import { useDesign } from '../../../../state/DesignContext.js';
import { MFTable } from '../MFTableComponents.js';
import { EvalModeBadge, OptimizeBadge } from '../../../SurfaceModeBar.js';
import { DMFWizard } from './DMFWizard.js';
import { PresetBar } from './PresetBar.js';
import { useMeritOperands } from './useMeritOperands.js';
import { useMeritPresets } from './useMeritPresets.js';

const { createElement: h } = React;

function MeritSummary({ design, mf, omf, c, t, te }) {
    return h('div', {
        style: {
            padding: '3px 10px', background: c.panel, borderBottom: `1px solid ${c.border}`,
            fontSize: 11, color: c.textDim, flexShrink: 0,
            display: 'flex', alignItems: 'center', gap: 10,
        }
    },
        h(OptimizeBadge, { design, c, t }),
        h(EvalModeBadge, { design, c, t }),
        mf != null && h('span', { style: { marginLeft: 'auto', display: 'inline-flex', gap: 12 } },
            h('span', null, (te.mfLabel || 'MF:') + ' ',
                h('span', { style: { color: c.text, fontWeight: 600 } }, mf.toFixed(6))),
            omf != null && h('span', { title: te.omfTip || 'Optical merit — excludes thickness constraints (MNT/MXT/TT)' },
                (te.omfLabel || 'OMF:') + ' ',
                h('span', { style: { color: c.text, fontWeight: 600 } }, omf.toFixed(6)))
        )
    );
}

export function MeritFunctionEditor({ c, t, setInputDialog }) {
    const { design, updateDesign, checkpoint } = useDesign();
    const te = t.meritFunctionEditor;
    const merit = useMeritOperands({ design, updateDesign, checkpoint, setInputDialog, te });
    const presets = useMeritPresets({
        design, operands: merit.operands, setOperands: merit.setOperands,
        setSelectedId: merit.setSelectedId, checkpoint, setInputDialog, te, t,
    });

    if (!design) {
        return h('div', { style: { padding: 24, color: c.textDim, fontSize: 13 } }, te.noDesign);
    }

    return h('div', {
        style: {
            display: 'flex', flexDirection: 'column', height: '100%',
            background: c.bg, color: c.text,
            fontFamily: 'system-ui, -apple-system, sans-serif', overflow: 'hidden'
        }
    },
        h(DMFWizard, {
            design, onGenerate: merit.handleGenerate, operandCount: merit.operands.length, c, t,
        }),
        h(PresetBar, { c, te, ...presets }),
        h(MeritSummary, { design, mf: merit.mf, omf: merit.omf, c, t, te }),
        h('div', { style: { flex: 1, overflow: 'hidden' } },
            h(MFTable, {
                operands: merit.operands, computed: merit.computed, selectedId: merit.selectedId,
                noOperandsMsg: te.noOperands,
                onSelect: merit.setSelectedId,
                onEdit: merit.handleEdit,
                onAdd: merit.handleAdd,
                onInsertAt: merit.handleInsertAt,
                onDuplicate: merit.handleDuplicate,
                onDelete: merit.handleDelete,
                onClear: merit.handleClear,
                onMoveUp: merit.handleMoveUp,
                onMoveDown: merit.handleMoveDown,
                c, t
            })
        )
    );
}
