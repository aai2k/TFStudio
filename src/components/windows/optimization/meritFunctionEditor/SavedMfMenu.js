import { dropPositionFrom, useDismiss } from '../../../ui/PickerDropdown.js';
import { useWindowSession } from '../../windowSession.js';
import { meritPresetSession } from './sessionState.js';
import { TblBtn } from './mfTable/CellControls.js';

const { createElement: h, useRef, useState } = React;

// Room for a saved merit function's name beside its row count and its delete
// control; a longer name widens the list rather than being cut short.
const MENU_MIN_WIDTH = 260;

// The list cannot be a <select>: an option holds a label and nothing else,
// while a row here carries a row count, a delete control and a tick. It wears
// the picker's surface and motion instead, from the tf-menu rules in styles.css.
function presetRow(preset, { c, te, onLoad, onDelete }) {
    return h('div', {
        key: preset.file, role: 'menuitem', className: 'tf-menu-item',
        onClick: () => onLoad(preset.name),
    },
        h('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' } }, preset.name),
        h('span', { style: { fontSize: 10, color: c.textDim, flexShrink: 0 } }, te.presetRows(preset.count)),
        h('span', {
            title: te.deleteTip, role: 'button',
            onClick: event => { event.stopPropagation(); onDelete(preset.name); },
            style: { color: c.error, cursor: 'pointer', padding: '0 2px', flexShrink: 0 },
        }, '✕'),
    );
}

// The last entry: whether a file replaces the table or is added to it. Picking
// it leaves the list open, so the next click can be the file to apply it to.
function applyModeRow(te, mode, setMode) {
    const on = mode === 'append';
    return h('div', {
        role: 'menuitemcheckbox', 'aria-checked': on ? 'true' : 'false', className: 'tf-menu-item',
        onClick: () => setMode(on ? 'replace' : 'append'),
    },
        h('span', { style: { width: 10, flexShrink: 0 } }, on ? '✓' : ''),
        te.appendToTable);
}

// The open list, placed against the button that opened it.
function savedList(options) {
    const { c, te, position, dropRef, presets, mode, setMode, onLoad, onDelete } = options;
    return h('div', {
        ref: dropRef, role: 'menu', 'aria-label': te.loadMf, className: 'tf-menu',
        style: {
            position: 'fixed', zIndex: 9999,
            ...(position.top != null ? { top: position.top } : { bottom: position.bottom }),
            left: position.left, width: position.width, maxHeight: position.maxH,
            overflowY: 'auto', fontFamily: 'inherit',
        },
    },
        presets.length === 0
            ? h('div', { className: 'tf-menu-item', 'aria-disabled': 'true' }, te.diskEmpty)
            : presets.map(preset => presetRow(preset, { c, te, onLoad, onDelete })),
        h('div', { className: 'tf-menu-sep' }),
        applyModeRow(te, mode, setMode),
    );
}

// The button's own chevron, turning as the list opens the way a select's does.
function caret(open) {
    return h('span', { className: open ? 'tf-caret tf-caret-open' : 'tf-caret' });
}

/**
 * Load and save buttons for the .tfsm merit functions on disk, in the table's
 * own bar since they load and save the table. Load opens a list of the saved
 * files anchored to its button, which flips above the bar at the foot of a
 * window rather than covering the controls it belongs to.
 */
export function SavedMfMenu({ c, te, diskPresets, diskBusy, diskMsg, onSavePreset, onLoadDiskPreset, onDeleteDiskPreset }) {
    const [session, setField] = useWindowSession(meritPresetSession, null);
    const [open, setOpen] = useState(false);
    const [position, setPosition] = useState(null);
    const triggerRef = useRef(null);
    const dropRef = useRef(null);
    const mode = session.applyMode;
    useDismiss(open, setOpen, dropRef, triggerRef);

    // The button toggles. Outside-click dismissal ignores it, so without this a
    // click on the open list would be swallowed by that exclusion and re-open it.
    const toggle = () => {
        if (open) { setOpen(false); return; }
        const rect = triggerRef.current?.getBoundingClientRect();
        if (!rect) return;
        setPosition(dropPositionFrom(rect, MENU_MIN_WIDTH));
        setOpen(true);
    };

    const loadLabel = h('span', {
        style: { display: 'inline-flex', alignItems: 'center', gap: 6 },
    }, te.loadMf, caret(open));

    return h(React.Fragment, null,
        h('span', { ref: triggerRef, style: { display: 'inline-flex' } },
            h(TblBtn, { label: loadLabel, onClick: toggle, disabled: diskBusy, title: te.diskTip, c })),
        h(TblBtn, { label: te.saveMf, onClick: onSavePreset, disabled: diskBusy, title: te.saveTip, c }),
        diskMsg && h('span', {
            title: diskMsg,
            style: {
                fontSize: 10, color: c.textDim, fontStyle: 'italic', marginLeft: 4,
                minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            },
        }, diskMsg),
        open && position && savedList({
            c, te, position, dropRef, presets: diskPresets, mode,
            setMode: value => setField('applyMode', value),
            onLoad: name => { setOpen(false); onLoadDiskPreset(name, mode); },
            onDelete: onDeleteDiskPreset,
        }),
    );
}
