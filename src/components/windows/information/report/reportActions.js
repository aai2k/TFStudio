/**
 * The Report window's actions, grouped by what they touch: the block list,
 * the templates, and the export of the finished document.
 */

import { newBlock, withDefaults, blocksFromTemplate } from '../../../../utils/report/blocks.js';
import { pdfHeaderTemplate, pdfFooterTemplate, reportFileBase } from '../../../../utils/report/template.js';
import { settingsFromWindow } from './blockSources.js';
import { listSavedTemplates, loadTemplate, saveTemplate, deleteTemplate } from './templates.js';
import { tablesAsText } from './exportTables.js';

const { useCallback, useEffect, useState } = React;

function moveItem(list, from, to) {
    const inside = i => i >= 0 && i < list.length;
    if (from === to || !inside(from) || !inside(to)) return list;
    const next = [...list];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
}

export function useBlockActions({ blocks, setBlocks, design }) {
    const toggleBlock = useCallback(id =>
        setBlocks(blocks.map(b => (b.id === id ? { ...b, on: !b.on } : b))), [blocks, setBlocks]);
    const moveBlock = useCallback((id, dir) => {
        const i = blocks.findIndex(b => b.id === id);
        setBlocks(moveItem(blocks, i, i + dir));
    }, [blocks, setBlocks]);
    const reorderBlock = useCallback((from, to) => setBlocks(moveItem(blocks, from, to)), [blocks, setBlocks]);
    const removeBlock = useCallback(id => setBlocks(blocks.filter(b => b.id !== id)), [blocks, setBlocks]);
    // A new block starts from the settings its window shows now.
    const addBlock = useCallback(type =>
        setBlocks([...blocks, newBlock(type, settingsFromWindow(type, design))]), [blocks, design, setBlocks]);
    const setBlockSettings = useCallback((id, changes) => setBlocks(blocks.map(b =>
        (b.id === id ? { ...b, settings: { ...withDefaults(b.type, b.settings), ...changes } } : b))), [blocks, setBlocks]);
    return { toggleBlock, moveBlock, reorderBlock, removeBlock, addBlock, setBlockSettings };
}

export function useTemplateActions({ W, blocks, state, patch, setStatus }) {
    const [savedTemplates, setSavedTemplates] = useState([]);
    useEffect(() => { listSavedTemplates().then(setSavedTemplates); }, []);

    const applyTemplate = useCallback(async id => {
        const template = await loadTemplate(id);
        if (!template) return;
        patch({
            templateId: id, blocks: blocksFromTemplate(template),
            paper: template.paper || state.paper, lang: template.lang ?? state.lang,
            // A preset converted from the earlier wizard brings its cover fields.
            ...(template.doc ? { doc: { ...state.doc, ...template.doc } } : {}),
        });
    }, [patch, state.paper, state.lang, state.doc]);

    const saveAsTemplate = useCallback(async name => {
        if (!String(name || '').trim()) { setStatus({ kind: 'err', msg: W.templateNameRequired }); return; }
        try {
            const id = await saveTemplate(name, blocks, { paper: state.paper, lang: state.lang });
            setSavedTemplates(await listSavedTemplates());
            patch({ templateId: id });
            setStatus({ kind: 'ok', msg: W.templateSaved });
        } catch (e) { setStatus({ kind: 'err', msg: e.message }); }
    }, [W, blocks, patch, setStatus, state.paper, state.lang]);

    const removeTemplate = useCallback(async name => {
        try { await deleteTemplate(name); setSavedTemplates(await listSavedTemplates()); }
        catch (e) { setStatus({ kind: 'err', msg: e.message }); }
    }, [setStatus]);

    return { savedTemplates, applyTemplate, saveAsTemplate, removeTemplate };
}

export function useExportActions({ W, html, doc, items, paper, tr, branding, meta, setStatus }) {
    const finish = useCallback(r => {
        if (r?.success) setStatus({ kind: 'ok', msg: `${W.saved}: ${r.path}` });
        else if (r?.canceled) setStatus(null);
        else setStatus({ kind: 'err', msg: W.exportFailed(r?.error || 'unavailable') });
    }, [W, setStatus]);

    // One wrapper for both file exports: the busy notice, the call, the outcome.
    const run = useCallback(async call => {
        if (!html) return;
        setStatus({ kind: 'busy', msg: W.exporting });
        try { finish(await call()); }
        catch (e) { setStatus({ kind: 'err', msg: W.exportFailed(e.message) }); }
    }, [W, html, finish, setStatus]);

    const exportPdf = useCallback(() => run(() => window.electronAPI?.exportReportPdf?.(html, reportFileBase(doc, items) + '.pdf', {
        pageSize: paper,
        headerTemplate: pdfHeaderTemplate({ tr, doc, designs: items }),
        footerTemplate: pdfFooterTemplate({ tr, brand: branding, meta, designs: items }),
    })), [run, html, doc, items, paper, tr, branding, meta]);

    const exportHtml = useCallback(() => run(() =>
        window.electronAPI?.saveReportHtml?.(html, reportFileBase(doc, items) + '.html')), [run, html, doc, items]);

    const copyTables = useCallback(() => {
        if (!html) return;
        if (navigator.clipboard) navigator.clipboard.writeText(tablesAsText(html));
        setStatus({ kind: 'ok', msg: W.copied });
    }, [W, html, setStatus]);

    return { exportPdf, exportHtml, copyTables };
}
