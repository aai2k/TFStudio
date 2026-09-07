import { ContextMenu } from '../../../ui/ContextMenu.js';
import { useWindowSession } from '../../windowSession.js';
import { meritPresetSession } from './sessionState.js';
import { TblBtn } from './mfTable/CellControls.js';

const { createElement: h, useState, useRef } = React;

function presetItem(preset, { te, c, mode, onLoad, onDelete }) {
    return {
        id: preset.file,
        label: preset.name,
        onClick: () => onLoad(preset.name, mode),
        shortcut: h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 10 } },
            h('span', null, te.presetRows(preset.count)),
            h('span', {
                title: te.deleteTip,
                onClick: event => { event.stopPropagation(); onDelete(preset.name); },
                style: { color: c.error, cursor: 'pointer', padding: '0 2px' },
            }, '✕')),
    };
}

/**
 * Load and save buttons for the .tfsm merit functions on disk, in the table's
 * own bar since they load and save the table. Load opens a menu of the saved
 * files; the last entry switches between replacing the table and appending.
 */
export function SavedMfMenu({ c, te, diskPresets, diskBusy, diskMsg, onSavePreset, onLoadDiskPreset, onDeleteDiskPreset }) {
    const [session, setField] = useWindowSession(meritPresetSession, null);
    const [menu, setMenu] = useState(null);
    const loadRef = useRef(null);
    const mode = session.applyMode;

    const openMenu = () => {
        const rect = loadRef.current?.getBoundingClientRect();
        setMenu(rect ? { x: rect.left, y: rect.top - 4 } : { x: 0, y: 0 });
    };
    const items = diskPresets.length === 0
        ? [{ id: 'empty', label: te.diskEmpty, disabled: true }]
        : diskPresets.map(preset => presetItem(preset, { te, c, mode, onLoad: onLoadDiskPreset, onDelete: onDeleteDiskPreset }));
    items.push({ separator: true }, {
        id: 'append',
        label: te.appendToTable,
        icon: mode === 'append' ? '✓' : null,
        onClick: () => setField('applyMode', mode === 'append' ? 'replace' : 'append'),
    });

    return h(React.Fragment, null,
        h('span', { ref: loadRef, style: { display: 'inline-flex' } },
            h(TblBtn, { label: te.loadMf + ' ▾', onClick: openMenu, disabled: diskBusy, title: te.diskTip, c })),
        h(TblBtn, { label: te.saveMf, onClick: onSavePreset, disabled: diskBusy, title: te.saveTip, c }),
        diskMsg && h('span', {
            title: diskMsg,
            style: {
                fontSize: 10, color: c.textDim, fontStyle: 'italic', marginLeft: 4,
                minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            },
        }, diskMsg),
        menu && h(ContextMenu, { x: menu.x, y: menu.y, items, c, dense: true, onClose: () => setMenu(null), ariaLabel: te.loadMf }),
    );
}
