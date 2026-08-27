import { useDesign } from '../../../../state/DesignContext.js';
import { MFTable } from './mfTable/MFTable.js';
import { EvalModeBadge, OptimizeBadge } from '../../../SurfaceModeBar.js';
import { DMFWizard } from './DMFWizard.js';
import { PresetBar } from './PresetBar.js';
import { useMeritOperands } from './useMeritOperands.js';
import { useMeritPresets } from './useMeritPresets.js';
import { cloneOperandsWithNewIds, writeEnvOperands } from './useEnvOperands.js';
import { phaseOperandScopeNotice } from '../phaseOperandScope.js';
import { EnvironmentEditor, MultiEnvToggle } from './EnvironmentEditor.js';

const { createElement: h, useState, useEffect } = React;

function MeritSummary({ design, mf, omf, busy, c, t, te, isEnvMode }) {
    return h('div', {
        style: {
            padding: '3px 10px', background: c.panel, borderBottom: `1px solid ${c.border}`,
            fontSize: 11, color: c.textDim, flexShrink: 0,
            display: 'flex', alignItems: 'center', gap: 10,
        }
    },
        h(OptimizeBadge, { design, c, t }),
        h(EvalModeBadge, { design, c, t }),
        busy && h('span', { style: { marginLeft: 'auto', fontStyle: 'italic' } }, te.evaluating),
        mf != null && h('span', { style: { marginLeft: 'auto', display: 'inline-flex', gap: 12 } },
            h('span', null, (te.mfLabel || 'MF:') + ' ',
                h('span', { style: { color: c.text, fontWeight: 600 } }, mf.toFixed(6))),
            !isEnvMode && omf != null && h('span', { title: te.omfTip || 'Optical merit — excludes thickness constraints (MNT/MXT/TT)' },
                (te.omfLabel || 'OMF:') + ' ',
                h('span', { style: { color: c.text, fontWeight: 600 } }, omf.toFixed(6)))
        )
    );
}

export function MeritFunctionEditor({ c, t, setInputDialog }) {
    const { design, updateDesign, checkpoint } = useDesign();
    const te = t.meritFunctionEditor;
    const [activeEnvIndex, setActiveEnvIndex] = useState(null);
    const merit = useMeritOperands({ design, updateDesign, checkpoint, setInputDialog, te, envIndex: activeEnvIndex });
    const presets = useMeritPresets({
        design, operands: merit.operands, setOperands: merit.setOperands,
        setSelectedId: merit.setSelectedId, checkpoint, setInputDialog, te, t,
    });
    const scopeNotice = phaseOperandScopeNotice(design, merit.operands, te);

    // If the active environment is removed (or multi-env is toggled off),
    // fall back to the design-level source instead of pointing at a stale index.
    useEffect(() => {
        const envs = design?.meritEnvironments || [];
        if (activeEnvIndex != null && !envs[activeEnvIndex]) {
            setActiveEnvIndex(null);
        }
    }, [design?.meritEnvironments?.length, activeEnvIndex]);

    const customizeEnv = (envIndex) => {
        const envs = design?.meritEnvironments || [];
        const env = envs[envIndex];
        if (!env || env.operands) return;
        updateDesign(writeEnvOperands(design, envIndex, cloneOperandsWithNewIds(design?.meritOperands || [])));
        setActiveEnvIndex(envIndex);
    };

    if (!design) {
        return h('div', { style: { padding: 24, color: c.textDim, fontSize: 13 } }, te.noDesign);
    }

    const activeEnv = activeEnvIndex != null ? (design.meritEnvironments || [])[activeEnvIndex] : null;
    const breadcrumbStyle = {
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '3px 10px', flexShrink: 0, fontSize: 11,
        background: c.panel, borderBottom: `1px solid ${c.border}`,
        color: c.textDim,
    };
    const backButtonStyle = {
        padding: '2px 8px', marginLeft: 'auto',
        border: `1px solid ${c.border}`, borderRadius: 3,
        background: c.bg || '#fff', color: c.text, fontSize: 11,
        cursor: 'pointer',
    };

    const envLabel = activeEnv
        ? `${activeEnv.incidentMedium || ''}${activeEnv.exitMedium && activeEnv.exitMedium !== activeEnv.incidentMedium ? ' → ' + activeEnv.exitMedium : ''}`
        : '';

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
        h(MultiEnvToggle, { design, updateDesign, t, c }),
        h(MeritSummary, {
            design, mf: merit.mf, omf: merit.omf, busy: merit.evaluationBusy, c, t, te,
            isEnvMode: activeEnvIndex != null,
        }),
        activeEnvIndex != null && h('div', { style: breadcrumbStyle },
            h('span', null,
                (te.breadcrumbDesign || 'Design') + ' > ' +
                `E${activeEnvIndex + 1}${envLabel ? ': ' + envLabel : ''}`),
            h('button', {
                style: backButtonStyle,
                onClick: () => setActiveEnvIndex(null),
                title: te.back || 'Back to design-level operands'
            }, te.back || 'Back')
        ),
        h('div', { style: { flex: 1, overflow: 'hidden' } },
            h(MFTable, {
                operands: merit.operands, computed: merit.computed,
                evaluationErrors: merit.errors, bandLevels: merit.bandLevels,
                selectedId: merit.selectedId,
                notice: scopeNotice,
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
        ),
        (design.meritEnvironments || []).length > 0 && h(EnvironmentEditor, {
            design, updateDesign, t, c,
            perEnvMf: merit.perEnvMf,
            activeEnvIndex,
            onEditOperands: setActiveEnvIndex,
            onCustomize: customizeEnv,
        })
    );
}
