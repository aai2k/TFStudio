import { materialLabel } from '../../../../utils/materials/catalogManager.js';
import { COATING_TYPES, bandsText } from '../../../../utils/coatingLibrary/entryModel.js';
import { StackStrip } from './StackStrip.js';
import { TYPE_COLORS, alpha, angleText } from './ui.js';

const { createElement: h } = React;

function EntryRow({ entry, selected, onSelect, c, ts }) {
    const summary = [
        ts.layersShort(entry.layers.length),
        materialLabel(entry.substrate),
        bandsText(entry),
        angleText(entry, ts),
    ].join(' · ');
    const color = TYPE_COLORS[entry.type] || TYPE_COLORS.other;
    return h('div', {
        role: 'option', 'aria-selected': selected, title: entry.use,
        onClick: () => onSelect(entry.id),
        style: {
            padding: '5px 10px 6px 22px', cursor: 'pointer',
            borderBottom: `1px solid ${c.border}`,
            background: selected ? alpha(color, 0.18) : 'transparent',
            borderLeft: `3px solid ${selected ? color : 'transparent'}`,
        },
    },
        h('div', { style: { fontSize: 12, fontWeight: selected ? 600 : 400, color: c.text } }, entry.name),
        h('div', { style: { fontSize: 11, color: c.textDim, margin: '2px 0 4px' } }, summary),
        h(StackStrip, { entry, c }));
}

// A family folder: its color, its name and how many entries it holds; click
// to fold or unfold it.
function GroupHeader({ type, count, collapsed, onToggle, c, ts }) {
    const color = TYPE_COLORS[type] || TYPE_COLORS.other;
    return h('button', {
        onClick: onToggle, 'aria-expanded': !collapsed,
        style: {
            display: 'flex', alignItems: 'center', gap: 6, width: '100%', textAlign: 'left',
            padding: '5px 10px', border: 'none', borderBottom: `1px solid ${c.border}`,
            borderLeft: `3px solid ${color}`, background: c.panel, color: c.text,
            fontFamily: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer', outline: 'none',
            position: 'sticky', top: 0, zIndex: 1,
        },
    },
        h('span', { style: { fontSize: 10, color: c.textDim, width: 10 } }, collapsed ? '▸' : '▾'),
        h('span', { style: { width: 9, height: 9, borderRadius: '50%', background: color, flexShrink: 0 } }),
        h('span', { style: { flex: 1 } }, ts.types[type]),
        h('span', { style: { fontSize: 11, fontWeight: 400, color: c.textDim } }, count));
}

/** The entries, sorted into one folder per family. Folders start folded; `openTypes` names the ones unfolded. */
export function EntryList({ entries, selectedId, onSelect, emptyText, openTypes, onToggleType, c, ts }) {
    const groups = COATING_TYPES
        .map(type => ({ type, items: entries.filter(entry => entry.type === type) }))
        .filter(group => group.items.length > 0);
    return h('div', {
        role: 'listbox',
        style: { flex: '0 0 300px', minWidth: 220, overflow: 'auto', borderRight: `1px solid ${c.border}` },
    },
        groups.length === 0
            ? h('div', { style: { padding: 14, fontSize: 12, color: c.textDim, fontStyle: 'italic' } }, emptyText)
            : groups.map(({ type, items }) => {
                const collapsed = !openTypes.includes(type);
                return h('div', { key: type },
                    h(GroupHeader, { type, count: items.length, collapsed, onToggle: () => onToggleType(type), c, ts }),
                    !collapsed && items.map(entry => h(EntryRow, {
                        key: entry.id, entry, selected: entry.id === selectedId, onSelect, c, ts,
                    })));
            }));
}
