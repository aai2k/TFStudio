import { useDesign } from '../../../../state/DesignContext.js';
import { MFTable } from './mfTable/MFTable.js';
import { DMFWizard } from './DMFWizard.js';
import { SavedMfMenu } from './SavedMfMenu.js';
import { useMeritOperands } from './useMeritOperands.js';
import { useMeritPresets } from './useMeritPresets.js';
import { phaseOperandScopeNotice } from '../phaseOperandScope.js';

const { createElement: h } = React;

export function MeritFunctionEditor({ c, t, setInputDialog }) {
    const { design, updateDesign, checkpoint } = useDesign();
    const te = t.meritFunctionEditor;
    const merit = useMeritOperands({ design, updateDesign, checkpoint, setInputDialog, te });
    const presets = useMeritPresets({
        design, operands: merit.operands, setOperands: merit.setOperands,
        setSelectedId: merit.setSelectedId, checkpoint, setInputDialog, te, t,
    });
    const scopeNotice = phaseOperandScopeNotice(design, merit.operands, te);

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
            design, onGenerate: merit.handleGenerate, operandCount: merit.operands.length,
            mf: merit.mf, omf: merit.omf, busy: merit.evaluationBusy, c, t,
        }),
        h('div', { style: { flex: 1, overflow: 'hidden' } },
            h(MFTable, {
                operands: merit.operands, computed: merit.computed,
                evaluationErrors: merit.errors, bandLevels: merit.bandLevels,
                selectedId: merit.selectedId,
                notice: scopeNotice,
                noOperandsMsg: te.noOperands,
                onSelect: merit.setSelectedId,
                onEdit: merit.handleEdit,
                onEditMany: merit.handleEditMany,
                onAdd: merit.handleAdd,
                onInsertAt: merit.handleInsertAt,
                onDuplicate: merit.handleDuplicate,
                onDelete: merit.handleDelete,
                onClear: merit.handleClear,
                onMoveUp: merit.handleMoveUp,
                onMoveDown: merit.handleMoveDown,
                toolbarStart: h(SavedMfMenu, { c, te, ...presets }),
                c, t
            })
        )
    );
}
