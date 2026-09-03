/**
 * Coating Library: coatings as reusable objects, separate from designs.
 *
 * Two shelves. Built-in holds the starting designs shipped with TFStudio
 * (src/utils/coatingLibrary/builtin/). My coatings holds what the user saved
 * from a design, as .tfsc files in the Coatings folder. Either kind can be put
 * onto the front or the back of the active design.
 */
import {
    COATING_TAGS, COATING_TAG_GROUPS, COATING_TYPES, tagGroupOf,
} from '../../../../utils/coatingLibrary/entryModel.js';
import { materialLabel } from '../../../../utils/materials/catalogManager.js';
import { EntryList } from './EntryList.js';
import { EntryDetail } from './EntryDetail.js';
import { SaveCoatingDialog } from './SaveCoatingDialog.js';
import { ImportLinkDialog } from './ImportLinkDialog.js';
import { useCoatingLibrary } from './useCoatingLibrary.js';
import { Chip, FONT, Segmented, TAG_GROUP_COLORS, buttonStyle, inputStyle } from './ui.js';

const { createElement: h, useState } = React;

const barStyle = (c, edge) => ({
    display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', flexShrink: 0,
    padding: '6px 10px', background: c.panel, [edge]: `1px solid ${c.border}`,
});

function FilterBar({ session, setField, entries, visible, substrates, onSave, onImport, c, ts }) {
    const label = text => h('span', { style: { fontSize: 11, color: c.textDim } }, text);
    return h('div', { style: barStyle(c, 'borderBottom') },
        h(Segmented, {
            value: session.source, c,
            onChange: value => { setField('source', value); setField('selectedId', null); },
            options: [['builtin', ts.sourceBuiltin], ['user', ts.sourceUser]],
        }),
        h('input', {
            value: session.query, placeholder: ts.searchPlaceholder,
            onChange: event => setField('query', event.target.value),
            style: inputStyle(c, 190),
        }),
        h('select', {
            value: session.type, onChange: event => setField('type', event.target.value), style: inputStyle(c, 150),
        },
            h('option', { value: '' }, ts.allTypes),
            COATING_TYPES.map(type => h('option', { key: type, value: type }, ts.types[type]))),
        h('select', {
            value: session.substrate, onChange: event => setField('substrate', event.target.value),
            style: inputStyle(c, 130),
        },
            h('option', { value: '' }, ts.anySubstrate),
            substrates.map(id => h('option', { key: id, value: id }, materialLabel(id)))),
        label(ts.lambdaLabel),
        h('input', {
            value: session.lambda, title: ts.lambdaTip, inputMode: 'decimal',
            onChange: event => setField('lambda', event.target.value), style: inputStyle(c, 64),
        }),
        label(ts.maxLayersLabel),
        h('input', {
            value: session.maxLayers, inputMode: 'numeric',
            onChange: event => setField('maxLayers', event.target.value), style: inputStyle(c, 50),
        }),
        label(ts.count(visible.length, entries.length)),
        h('span', { style: { flex: 1 } }),
        h('button', { onClick: onImport, title: ts.importLinkTip, style: buttonStyle(c) }, ts.importLink),
        h('button', { onClick: onSave, title: ts.saveCurrentTip, style: buttonStyle(c) }, ts.saveCurrent));
}

function tagChip(tag, count, active, toggleTag, c) {
    const color = TAG_GROUP_COLORS[tagGroupOf(tag)] || TAG_GROUP_COLORS.context;
    return h(Chip, {
        key: tag, label: count == null ? tag : `${tag} ${count}`, color, active, c,
        title: COATING_TAGS[tag] || tag, onClick: () => toggleTag(tag),
    });
}

// Tags: one row holding the toggle and the chosen tags, so the active filter
// is always in view; the whole vocabulary of the entries the other filters
// leave unfolds below it, one line per kind of tag, each chip with how many
// entries choosing it would keep.
function TagBar({ session, setField, tags, toggleTag, c, ts }) {
    const chosen = session.tags;
    if (tags.length === 0 && chosen.length === 0) return null;
    const open = session.tagsOpen;
    const countOf = tag => tags.find(item => item.tag === tag)?.count || 0;
    const groups = Object.keys(COATING_TAG_GROUPS)
        .map(group => ({ group, items: tags.filter(item => !chosen.includes(item.tag) && tagGroupOf(item.tag) === group) }))
        .filter(({ items }) => items.length > 0);
    return h('div', { style: { flexShrink: 0, borderBottom: `1px solid ${c.border}`, background: c.bg } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', padding: '4px 10px' } },
            h('button', {
                onClick: () => setField('tagsOpen', !open), 'aria-expanded': open,
                style: { ...buttonStyle(c), padding: '1px 8px' },
            }, `${open ? '▾' : '▸'} ${open ? ts.hideTags : ts.showTags}`),
            chosen.map(tag => tagChip(tag, countOf(tag), true, toggleTag, c)),
            chosen.length > 0 && h('button', {
                onClick: () => setField('tags', []), style: { ...buttonStyle(c), padding: '1px 8px' },
            }, ts.clearTags)),
        open && h('div', { style: { padding: '0 10px 6px', maxHeight: 160, overflow: 'auto' } },
            groups.map(({ group, items }) => h('div', {
                key: group, style: { display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', padding: '2px 0' },
            },
                h('span', { style: { fontSize: 11, color: TAG_GROUP_COLORS[group], minWidth: 110 } }, ts.tagGroups[group]),
                items.map(({ tag, count }) => tagChip(tag, count, false, toggleTag, c))))));
}

function ApplyBar({ session, setField, selected, onApply, onDelete, message, c, ts }) {
    const canApply = !!selected;
    return h('div', { style: barStyle(c, 'borderTop') },
        h('span', { style: { fontSize: 11, color: c.textDim } }, ts.applyHeading),
        h(Segmented, {
            value: session.applySide, c, disabled: !canApply,
            onChange: value => setField('applySide', value),
            options: [['front', ts.sideFront], ['back', ts.sideBack]],
        }),
        h('select', {
            value: session.applyMode, disabled: !canApply,
            onChange: event => setField('applyMode', event.target.value), style: inputStyle(c, 170),
        },
            h('option', { value: 'replace' }, ts.modeReplace),
            h('option', { value: 'append' }, ts.modeAppend)),
        h('button', {
            onClick: onApply, disabled: !canApply,
            style: buttonStyle(c, { primary: true, disabled: !canApply }),
        }, ts.apply),
        session.source === 'user' && h('button', {
            onClick: onDelete, disabled: !canApply,
            style: buttonStyle(c, { danger: true, disabled: !canApply }),
        }, ts.delete),
        message && h('span', {
            role: 'status', style: { fontSize: 11, color: c.textDim, fontStyle: 'italic', marginLeft: 'auto' },
        }, message));
}

export function CoatingLibrary({ c, t }) {
    const ts = t.coatingLibrary;
    const {
        design, session, setField, entries, visible, tags, substrates, toggleTag, toggleType,
        selected, message, setMessage, apply, remove,
    } = useCoatingLibrary(ts);
    const [saving, setSaving] = useState(false);
    const [importing, setImporting] = useState(false);

    const emptyText = entries.length === 0
        ? (session.source === 'user' ? ts.emptyUser : ts.emptyBuiltin)
        : ts.emptyFiltered;

    return h('div', {
        style: {
            display: 'flex', flexDirection: 'column', height: '100%', minWidth: 520,
            background: c.bg, color: c.text, fontFamily: FONT, overflow: 'hidden',
        },
    },
        h(FilterBar, {
            session, setField, entries, visible, substrates,
            onSave: () => setSaving(true), onImport: () => setImporting(true), c, ts,
        }),
        h(TagBar, { session, setField, tags, toggleTag, c, ts }),
        h('div', { style: { display: 'flex', flex: 1, minHeight: 0 } },
            h(EntryList, {
                entries: visible, selectedId: session.selectedId,
                onSelect: id => { setField('selectedId', id); setMessage(''); },
                collapsedTypes: session.collapsedTypes, onToggleType: toggleType,
                emptyText, c, ts,
            }),
            h('div', { style: { flex: 1, minWidth: 0, overflow: 'auto' } },
                selected
                    ? h(EntryDetail, { entry: selected, c, ts })
                    : h('div', { style: { padding: 24, fontSize: 12, color: c.textDim, fontStyle: 'italic' } }, ts.selectHint))),
        h(ApplyBar, { session, setField, selected, onApply: apply, onDelete: remove, message, c, ts }),
        saving && h(SaveCoatingDialog, {
            design, c, t,
            onClose: () => setSaving(false),
            onSaved: name => { setField('source', 'user'); setMessage(ts.saveDialog.saved(name)); },
        }),
        importing && h(ImportLinkDialog, {
            c, t,
            onClose: () => setImporting(false),
            onSaved: name => { setField('source', 'user'); setMessage(ts.importDialog.imported(name)); },
        }));
}
