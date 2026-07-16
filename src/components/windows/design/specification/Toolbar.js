import { QUALIFIER_KINDS } from '../../../../utils/synthesis/qualifiers.js';
import { QUALIFIER_PRESETS } from '../../../../utils/synthesis/qualifierPresets.js';
import { btnStyle, selStyle } from './fields.js';

const { createElement: h, useState } = React;

export function Toolbar({
    addQualifier, c, ts,
    onApplyBuiltinPreset,
    diskPresets, diskBusy, diskMsg,
    onSavePreset, onLoadDiskPreset, onDeleteDiskPreset,
}) {
    const [kind, setKind]                 = useState('T_AVG');
    const [builtinSel, setBuiltinSel]     = useState('');
    const [diskSel,    setDiskSel]        = useState('');
    const [applyMode,  setApplyMode]      = useState('replace'); // 'replace' | 'append'

    return h('div', {
        style: {
            padding: '6px 10px', background: c.panel,
            borderBottom: `1px solid ${c.border}`,
            display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
            flexWrap: 'wrap',
        }
    },
        // Add single
        h('span', { style: { fontSize: 11, color: c.textDim } }, ts.addKindLabel || 'Add:'),
        h('select', {
            value: kind, onChange: e => setKind(e.target.value),
            style: { ...selStyle(c), minWidth: 180 },
        }, QUALIFIER_KINDS.map(k =>
            h('option', { key: k, value: k, style: { background: c.panel } },
              (ts.kinds && ts.kinds[k]) || k))
        ),
        h('button', { onClick: () => addQualifier(kind), style: btnStyle(c) },
          ts.add || '+ Add'),

        // Divider
        h('span', { style: { width: 1, height: 18, background: c.border, marginLeft: 6, marginRight: 6 } }),

        // Built-in presets
        h('span', { style: { fontSize: 11, color: c.textDim } }, ts.presetLabel || 'Preset:'),
        h('select', {
            value: builtinSel, onChange: e => setBuiltinSel(e.target.value),
            style: { ...selStyle(c), minWidth: 200 },
            title: ts.presetTip || 'Canned spec sheets for common coating types',
        },
            h('option', { value: '', style: { background: c.panel, color: c.textDim } },
              ts.presetPicker || '(pick a built-in spec…)'),
            QUALIFIER_PRESETS.map(p => h('option', {
                key: p.id, value: p.id,
                title: p.description,
                style: { background: c.panel },
            }, p.label))
        ),
        h('select', {
            value: applyMode, onChange: e => setApplyMode(e.target.value),
            style: { ...selStyle(c), width: 96 },
            title: ts.modeTip || 'Replace = overwrite current list; Append = add to it',
        },
            h('option', { value: 'replace', style: { background: c.panel } }, ts.modeReplace || 'replace'),
            h('option', { value: 'append',  style: { background: c.panel } }, ts.modeAppend  || 'append'),
        ),
        h('button', {
            onClick: () => { if (builtinSel) { onApplyBuiltinPreset(builtinSel, applyMode); setBuiltinSel(''); } },
            disabled: !builtinSel,
            style: { ...btnStyle(c), opacity: builtinSel ? 1 : 0.4, cursor: builtinSel ? 'pointer' : 'default' },
        }, ts.apply || 'Apply'),

        // Divider
        h('span', { style: { width: 1, height: 18, background: c.border, marginLeft: 6, marginRight: 6 } }),

        // Saved-to-disk presets
        h('span', { style: { fontSize: 11, color: c.textDim } }, ts.savedLabel || 'Saved:'),
        h('select', {
            value: diskSel, onChange: e => setDiskSel(e.target.value),
            style: { ...selStyle(c), minWidth: 180 },
            title: ts.diskTip || 'User-saved spec presets from Documents\\TFStudio\\Qualifiers\\',
        },
            h('option', { value: '', style: { background: c.panel, color: c.textDim } },
              diskPresets.length === 0
                ? (ts.diskEmpty || '(no saved presets)')
                : (ts.diskPicker || '(pick a saved spec…)')),
            diskPresets.map(p => h('option', {
                key: p.file, value: p.name,
                title: `${p.count} qualifiers — ${p.file}`,
                style: { background: c.panel },
            }, p.name))
        ),
        h('button', {
            onClick: () => { if (diskSel) { onLoadDiskPreset(diskSel, applyMode); } },
            disabled: !diskSel || diskBusy,
            style: { ...btnStyle(c), opacity: diskSel ? 1 : 0.4 },
        }, ts.load || 'Load'),
        h('button', {
            onClick: () => { if (diskSel) onDeleteDiskPreset(diskSel); },
            disabled: !diskSel || diskBusy,
            title: ts.deleteTip || 'Delete the selected saved preset',
            style: { ...btnStyle(c), opacity: diskSel ? 1 : 0.4, color: diskSel ? c.error : c.textDim },
        }, '✕'),
        h('button', {
            onClick: onSavePreset, disabled: diskBusy,
            style: btnStyle(c),
            title: ts.saveTip || 'Save current spec list as a reusable preset',
        }, ts.savePreset || 'Save…'),

        // Disk feedback message (last action)
        diskMsg && h('span', {
            style: { fontSize: 10, color: c.textDim, marginLeft: 'auto', fontStyle: 'italic' }
        }, diskMsg),
    );
}
