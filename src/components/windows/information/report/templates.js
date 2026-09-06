/**
 * Report templates: the three that ship plus the ones the user saved.
 *
 * Saved templates live in the report presets folder as `.tfsr` files, through
 * the same channels the earlier presets used; a `ver: 1` file converts on load.
 * Template ids are the built-in key, or `saved:<name>` for a saved one.
 */

import { BUILTIN_TEMPLATES, normalizeTemplate, templateFromBlocks } from '../../../../utils/report/blocks.js';

const SAVED = 'saved:';

export function isSavedTemplate(id) { return typeof id === 'string' && id.startsWith(SAVED); }
export function savedTemplateName(id) { return isSavedTemplate(id) ? id.slice(SAVED.length) : null; }
export function savedTemplateId(name) { return SAVED + name; }

export async function listSavedTemplates() {
    try {
        const r = await window.electronAPI?.listReportPresets?.();
        return r?.success ? (r.presets || []).map(p => p.name).filter(Boolean) : [];
    } catch (_) { return []; }
}

/** The template for `id`, or null when it is unknown or cannot be read. */
export async function loadTemplate(id) {
    if (BUILTIN_TEMPLATES[id]) return BUILTIN_TEMPLATES[id];
    const name = savedTemplateName(id);
    if (!name) return null;
    try {
        const r = await window.electronAPI?.loadReportPreset?.(name);
        return r?.success ? normalizeTemplate(r.preset) : null;
    } catch (_) { return null; }
}

export async function saveTemplate(name, blocks, { paper, lang }) {
    const payload = templateFromBlocks(name, blocks, { paper, lang });
    const r = await window.electronAPI?.saveReportPreset?.(payload);
    if (!r?.success) throw new Error(r?.error || 'save failed');
    return savedTemplateId(payload.name);
}

export async function deleteTemplate(name) {
    const r = await window.electronAPI?.deleteReportPreset?.(name);
    if (!r?.success) throw new Error(r?.error || 'delete failed');
}

/** Options for the template selector: built-ins first, then the saved ones. */
export function templateOptions(W, savedNames) {
    return [
        ...Object.keys(BUILTIN_TEMPLATES).map(id => ({ id, label: W.templates?.[id] || id })),
        ...savedNames.map(name => ({ id: savedTemplateId(name), label: name })),
    ];
}
