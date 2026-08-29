// Preferences → Quick Access: which tools sit in the title bar, and in what
// order.
//
// The list is kept in the portable preferences file rather than settings.json,
// so a reinstall does not take a customised title bar with it.

import { ICONS, iconColorForTool, makeTabs } from '../../Toolbar.js';
import { Row, buttonStyle, selectStyle } from './ui.js';

const { createElement: h, useMemo, useState } = React;

export const DEFAULT_QUICK_ACCESS = ['new-design', 'open-project', 'save', 'undo', 'redo'];

/** Every ribbon button, as a flat pick list with the tab each one came from. */
export function quickAccessCandidates(t) {
    return makeTabs(t).flatMap(tab =>
        tab.groups.flatMap(group =>
            group.items.map(item => ({
                id: item.id,
                label: item.label,
                title: item.title,
                tabLabel: tab.label,
            }))));
}

/**
 * The saved list, less anything that is no longer a ribbon button.
 *
 * A tool removed from the ribbon between releases would otherwise leave a
 * button in the title bar that draws no icon and opens nothing.
 */
export function resolveQuickAccess(saved, candidates) {
    const known = new Set(candidates.map(entry => entry.id));
    const list = Array.isArray(saved) ? saved : DEFAULT_QUICK_ACCESS;
    return list.filter(id => known.has(id));
}

const iconOf = (id) => h('span', {
    style: { display: 'flex', flexShrink: 0, width: 20, height: 20, color: iconColorForTool(id) || 'inherit' },
}, ICONS[id] || null);

function ChosenRow({ entry, index, count, c, t, onMove, onRemove }) {
    const smallBtn = (label, title, disabled, onClick) => h('button', {
        onClick, title, disabled,
        style: {
            ...buttonStyle(c),
            padding: '2px 7px', fontWeight: '400',
            opacity: disabled ? 0.35 : 1,
            cursor: disabled ? 'default' : 'pointer',
        },
    }, label);

    return h('div', {
        style: {
            display: 'flex', alignItems: 'center', gap: '9px',
            padding: '5px 8px', borderBottom: `1px solid ${c.border}`,
        },
    },
        h('span', { style: { width: '18px', color: c.textDim, fontSize: '11px', flexShrink: 0 } }, index + 1),
        iconOf(entry.id),
        h('span', { style: { flex: 1, minWidth: 0, fontSize: '12.5px', color: c.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
            entry.label),
        h('span', { style: { fontSize: '11px', color: c.textDim, flexShrink: 0 } }, entry.tabLabel),
        smallBtn('↑', t.settings.quickAccessMoveUp, index === 0, () => onMove(index, -1)),
        smallBtn('↓', t.settings.quickAccessMoveDown, index === count - 1, () => onMove(index, 1)),
        smallBtn('×', t.settings.quickAccessRemove, false, () => onRemove(entry.id)),
    );
}

export const QuickAccessPane = ({ quickAccess, setQuickAccess, c, t }) => {
    const candidates = useMemo(() => quickAccessCandidates(t), [t]);
    const chosenIds = resolveQuickAccess(quickAccess, candidates);
    const byId = useMemo(() => new Map(candidates.map(entry => [entry.id, entry])), [candidates]);
    const chosen = chosenIds.map(id => byId.get(id));
    const [toAdd, setToAdd] = useState('');

    const available = candidates.filter(entry => !chosenIds.includes(entry.id));

    const move = (index, step) => {
        const next = [...chosenIds];
        const target = index + step;
        if (target < 0 || target >= next.length) return;
        [next[index], next[target]] = [next[target], next[index]];
        setQuickAccess(next);
    };

    return h('div', null,
        h(Row, {
            c, wide: true,
            label: t.settings.quickAccessTools,
            hint: t.settings.quickAccessHint,
        },
            h('div', {
                style: {
                    border: `1px solid ${c.border}`, borderRadius: '4px',
                    maxHeight: '210px', overflowY: 'auto', backgroundColor: c.bg,
                },
            },
                chosen.length === 0
                    ? h('div', {
                        style: { padding: '14px', fontSize: '12px', color: c.textDim, textAlign: 'center' },
                    }, t.settings.quickAccessEmpty)
                    : chosen.map((entry, index) => h(ChosenRow, {
                        key: entry.id,
                        entry, index, count: chosen.length, c, t,
                        onMove: move,
                        onRemove: (id) => setQuickAccess(chosenIds.filter(x => x !== id)),
                    }))
            ),

            h('div', { style: { display: 'flex', gap: '8px', marginTop: '10px' } },
                h('select', {
                    value: toAdd,
                    onChange: (e) => setToAdd(e.target.value),
                    style: { ...selectStyle(c), flex: 1 },
                },
                    h('option', { value: '' }, t.settings.quickAccessAddPrompt),
                    available.map(entry =>
                        h('option', { key: entry.id, value: entry.id }, `${entry.tabLabel} · ${entry.label}`))
                ),
                h('button', {
                    onClick: () => { if (toAdd) { setQuickAccess([...chosenIds, toAdd]); setToAdd(''); } },
                    disabled: !toAdd,
                    style: { ...buttonStyle(c), opacity: toAdd ? 1 : 0.4, cursor: toAdd ? 'pointer' : 'default' },
                }, t.settings.quickAccessAdd),
                h('button', {
                    onClick: () => setQuickAccess([...DEFAULT_QUICK_ACCESS]),
                    style: buttonStyle(c),
                }, t.settings.quickAccessReset)
            )
        )
    );
};
