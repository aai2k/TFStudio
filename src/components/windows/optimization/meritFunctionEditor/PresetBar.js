const { createElement: h, useState } = React;

export function PresetBar({ c, te, diskPresets, diskBusy, diskMsg, onSavePreset, onLoadDiskPreset, onDeleteDiskPreset }) {
    const [diskSel, setDiskSel] = useState('');
    const [applyMode, setApplyMode] = useState('replace');

    const sel = {
        background: c.bg, color: c.text, border: `1px solid ${c.border}`,
        borderRadius: 3, fontSize: 11, padding: '2px 5px', fontFamily: 'inherit', outline: 'none',
    };
    const btn = {
        padding: '2px 9px', fontSize: 11, fontFamily: 'inherit',
        border: `1px solid ${c.border}`, borderRadius: 3,
        background: c.bg, color: c.text, cursor: 'pointer',
    };

    return h('div', {
        style: {
            padding: '5px 10px', background: c.panel, borderBottom: `1px solid ${c.border}`,
            display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, flexWrap: 'wrap',
        }
    },
        h('span', { style: { fontSize: 11, color: c.textDim } }, (te.savedLabel || 'Saved MF') + ':'),
        h('select', {
            value: diskSel, onChange: e => setDiskSel(e.target.value),
            style: { ...sel, minWidth: 180 },
            title: te.diskTip || 'User-saved merit functions from Documents\\TFStudio\\MeritFunctions\\',
        },
            h('option', { value: '', style: { background: c.panel, color: c.textDim } },
                diskPresets.length === 0 ? (te.diskEmpty || '(no saved merit functions)') : (te.diskPicker || '(pick a saved MF…)')),
            diskPresets.map(p => h('option', {
                key: p.file, value: p.name, title: `${p.count} operands — ${p.file}`,
                style: { background: c.panel },
            }, p.name))
        ),
        h('select', {
            value: applyMode, onChange: e => setApplyMode(e.target.value),
            style: { ...sel, width: 96 },
            title: te.modeTip || 'Replace = overwrite current table; Append = add to it',
        },
            h('option', { value: 'replace', style: { background: c.panel } }, te.modeReplace || 'replace'),
            h('option', { value: 'append', style: { background: c.panel } }, te.modeAppend || 'append'),
        ),
        h('button', {
            onClick: () => { if (diskSel) onLoadDiskPreset(diskSel, applyMode); },
            disabled: !diskSel || diskBusy,
            style: { ...btn, opacity: diskSel ? 1 : 0.4, cursor: diskSel ? 'pointer' : 'default' },
        }, te.load || 'Load'),
        h('button', {
            onClick: () => { if (diskSel) onDeleteDiskPreset(diskSel); },
            disabled: !diskSel || diskBusy,
            title: te.deleteTip || 'Delete the selected saved merit function',
            style: { ...btn, opacity: diskSel ? 1 : 0.4, color: diskSel ? '#ef5350' : c.textDim, cursor: diskSel ? 'pointer' : 'default' },
        }, '✕'),
        h('button', {
            onClick: onSavePreset, disabled: diskBusy,
            style: btn,
            title: te.saveTip || 'Save the current MF table as a reusable preset',
        }, te.savePreset || 'Save As…'),
        diskMsg && h('span', {
            style: { fontSize: 10, color: c.textDim, marginLeft: 'auto', fontStyle: 'italic' }
        }, diskMsg),
    );
}
