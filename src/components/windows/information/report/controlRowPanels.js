/**
 * The controls on the Report window's control row: template, designs, the
 * document fields and the branding profile. Each panel opens over the page.
 */

import { FieldLabel, SelectField, CheckField } from '../../analysis/chrome/controls.js';
import { PopoverButton, SettingsMenu, SettingRow, SettingDivider } from '../../analysis/chrome/popover.js';
import { TextField, ColorField, PanelButton } from './controls.js';
import { templateOptions, isSavedTemplate } from './templates.js';
import { updateBranding, saveBranding } from './branding.js';

const { createElement: h, useState } = React;

const hint = (c, text) => h('div', { style: { fontSize: 10, color: c.textDim, lineHeight: 1.5, marginTop: 6 } }, text);

export function TemplateControl({ c, W, templateId, savedTemplates, onApply, onSave, onDelete }) {
    const [name, setName] = useState('');
    const options = templateOptions(W, savedTemplates);
    const value = options.some(o => o.id === templateId) ? templateId : options[0].id;
    return [
        h(FieldLabel, { key: 'label', c }, W.template),
        h(SelectField, { key: 'select', c, value, options, width: 150, onChange: onApply }),
        h(PopoverButton, { key: 'save', c, label: W.saveTemplate, width: 260 },
            h(SettingRow, { c, label: W.templateName },
                h(TextField, { c, value: name, width: 140, onChange: setName }),
                h(PanelButton, { c, label: W.save, disabled: !name.trim(), onClick: () => { onSave(name.trim()); setName(''); } })),
            savedTemplates.length > 0 && h(SettingDivider, { c }),
            savedTemplates.map(saved => h('div', {
                key: saved, style: { display: 'flex', alignItems: 'center', gap: 8, minHeight: 26 },
            },
                h('span', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, saved),
                h(PanelButton, { c, label: W.deleteTemplate, tone: c.error, onClick: () => onDelete(saved) }))),
            isSavedTemplate(templateId) ? null : hint(c, W.builtinTemplates),
        ),
    ];
}

// The open designs under the project folders they sit in, as the explorer
// shows them. A design in no folder lands in a trailing group.
export function groupDesignsByFolder(designs, folders, otherName) {
    const byId = new Map(designs.map(d => [d.id, d]));
    const placed = new Set();
    const groups = [];
    for (const folder of folders || []) {
        const inFolder = (folder.items || []).map(item => byId.get(item.id)).filter(Boolean);
        inFolder.forEach(d => placed.add(d.id));
        if (inFolder.length) groups.push({ name: folder.name || folder.id, designs: inFolder });
    }
    const rest = designs.filter(d => !placed.has(d.id));
    if (rest.length) groups.push({ name: groups.length ? otherName : '', designs: rest });
    return groups;
}

// Past this many designs the picker gets a search field.
const FILTER_ABOVE = 8;

function groupTitle(c, name) {
    return h('div', {
        style: {
            fontSize: 10, fontWeight: 700, color: c.textDim, textTransform: 'uppercase',
            letterSpacing: '0.06em', padding: '6px 0 2px', userSelect: 'none',
        },
    }, name);
}

export function DesignsControl({ c, W, designs, folders, activeDesignId, scope, selectedIds, onUseCurrent, onSelect }) {
    const [filter, setFilter] = useState('');
    const count = scope === 'selected' ? selectedIds.filter(id => designs.some(d => d.id === id)).length : 0;
    const label = count > 0 ? W.designCount(count) : W.currentDesign;
    const needle = filter.trim().toLowerCase();
    const groups = groupDesignsByFolder(designs, folders, W.otherDesigns)
        .map(group => ({ ...group, designs: group.designs.filter(d => !needle || (d.name || d.id).toLowerCase().includes(needle)) }))
        .filter(group => group.designs.length);
    return [
        h(FieldLabel, { key: 'label', c }, W.designs),
        h(PopoverButton, { key: 'pick', c, label, width: 300 },
            h(CheckField, { c, label: W.currentDesign, checked: count === 0, onChange: onUseCurrent }),
            designs.length > FILTER_ABOVE && h('div', { style: { padding: '6px 0 2px' } },
                h(TextField, { c, value: filter, width: 270, placeholder: W.findDesign, onChange: setFilter })),
            h(SettingDivider, { c }),
            designs.length === 0 && h('div', { style: { color: c.textDim } }, W.noDesigns),
            groups.map(group => h('div', { key: group.name },
                group.name && groupTitle(c, group.name),
                group.designs.map(d => h('div', { key: d.id, style: { padding: '2px 0' } },
                    h(CheckField, {
                        c, label: d.name || d.id, checked: count > 0 && selectedIds.includes(d.id),
                        onChange: e => onSelect(d.id, e.target.checked),
                        title: d.id === activeDesignId ? W.currentDesign : undefined,
                    }))))),
            hint(c, W.pickDesigns),
        ),
    ];
}

const DOC_FIELDS = ['title', 'customer', 'docNo', 'revision', 'date', 'designer'];

export function DocumentPanel({ c, W, doc, onChange }) {
    return h(PopoverButton, { c, label: W.document, width: 300 },
        DOC_FIELDS.map(key => h(SettingRow, { key, c, label: W[key] },
            h(TextField, { c, value: doc[key] || '', width: 200, onChange: v => onChange(key, v) }))));
}

export function BrandingPanel({ c, t, W, branding }) {
    const [status, setStatus] = useState(null);
    const set = key => v => updateBranding({ [key]: v });
    const loadLogo = async () => {
        const r = await window.electronAPI?.loadReportLogo?.();
        if (r?.success && r.dataUrl) updateBranding({ logoDataUrl: r.dataUrl });
    };
    const save = async () => {
        try { await saveBranding(); setStatus({ ok: true, msg: W.brandingSaved }); }
        catch (e) { setStatus({ ok: false, msg: e.message }); }
    };
    return h(SettingsMenu, { c, t, label: W.branding, width: 320 },
        h(SettingRow, { c, label: W.company }, h(TextField, { c, value: branding.company, width: 210, onChange: set('company') })),
        h(SettingRow, { c, label: W.line2 }, h(TextField, { c, value: branding.line2, width: 210, onChange: set('line2') })),
        h(SettingRow, { c, label: W.accent }, h(ColorField, { c, value: branding.accent, onChange: set('accent') })),
        h(SettingRow, { c, label: W.footer }, h(TextField, { c, value: branding.footer, width: 210, onChange: set('footer') })),
        h(SettingRow, { c, label: W.designer }, h(TextField, { c, value: branding.designer, width: 210, onChange: set('designer') })),
        h(SettingRow, { c, label: W.logo },
            branding.logoDataUrl && h('img', { src: branding.logoDataUrl, alt: '', style: { maxHeight: 24, maxWidth: 80, background: '#fff', borderRadius: 3 } }),
            h(PanelButton, { c, label: W.loadLogo, onClick: loadLogo }),
            branding.logoDataUrl && h(PanelButton, { c, label: W.clearLogo, onClick: () => updateBranding({ logoDataUrl: null }) })),
        h('div', { style: { display: 'flex', gap: 6, marginTop: 8, paddingTop: 8, borderTop: `1px solid ${c.border}`, alignItems: 'center' } },
            h(PanelButton, { c, label: W.saveBranding, onClick: save }),
            status && h('span', { style: { color: status.ok ? c.success : c.error, flex: 1 } }, status.msg)),
        hint(c, W.brandingHint),
    );
}
