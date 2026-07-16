/**
 * Material Editor — left panel (toolbar + catalog selector + search + material list).
 *
 * Each render* function takes the editor's flat state object `s` (from
 * useMaterialEditor) and reads only the fields it needs.
 */

import { resolveColor } from '../../../../utils/materials/catalogManager.js';
import { dotStyle, smallBtn } from './materialEditorUI.js';

const { createElement: h } = React;

function renderCatalogToolbar(s) {
    const { c, me, handleImport, importing, handleImportOptiLayer, setShowRii,
            showNewCatalog, setShowNewCatalog, newCatalogName, setNewCatalogName, handleCreateCatalog } = s;
    return h('div', { style: { padding: '6px 8px', borderBottom: `1px solid ${c.border}`, display: 'flex', flexDirection: 'column', gap: 3 } },
        // Import row — file-based importers (AGF, OptiLayer)
        h('div', { style: { display: 'flex', gap: 4 } },
            h('button', {
                onClick: handleImport, disabled: importing,
                style: { ...smallBtn(c), flex: 1, padding: '4px 0', opacity: importing ? 0.5 : 1, cursor: importing ? 'default' : 'pointer' }
            }, importing ? '…' : me.importAgf),
            h('button', {
                onClick: handleImportOptiLayer, disabled: importing,
                style: { ...smallBtn(c), flex: 1, padding: '4px 0', opacity: importing ? 0.5 : 1, cursor: importing ? 'default' : 'pointer' }
            }, importing ? '…' : me.importOptiLayer),
        ),
        // Browse online database
        h('div', { style: { display: 'flex', gap: 4 } },
            h('button', { onClick: () => setShowRii(true), style: { ...smallBtn(c), flex: 1, padding: '4px 0' } }, me.browseRii)
        ),
        // Catalog management row
        h('div', { style: { display: 'flex', gap: 4 } },
            h('button', {
                onClick: () => { setShowNewCatalog(v => !v); setNewCatalogName(''); },
                style: { ...smallBtn(c), flex: 1, padding: '4px 0',
                    backgroundColor: showNewCatalog ? c.accent + '22' : c.panel,
                    color: showNewCatalog ? c.accent : c.textDim,
                    borderColor: showNewCatalog ? c.accent + '88' : c.border }
            }, me.newCatalog)
        ),
        showNewCatalog && h('div', { style: { display: 'flex', gap: 4 } },
            h('input', {
                value: newCatalogName, onChange: e => setNewCatalogName(e.target.value),
                placeholder: me.catalogNamePlaceholder,
                onKeyDown: e => { if (e.key === 'Enter') handleCreateCatalog(); if (e.key === 'Escape') { setShowNewCatalog(false); setNewCatalogName(''); } },
                autoFocus: true,
                style: { flex: 1, height: 22, backgroundColor: c.bg, color: c.text, border: `1px solid ${c.border}`, borderRadius: 3, fontSize: 11, padding: '0 5px', outline: 'none', boxSizing: 'border-box' }
            }),
            h('button', { onClick: handleCreateCatalog, style: smallBtn(c, { backgroundColor: c.accent, color: '#fff', borderColor: c.accent }) }, me.create)
        )
    );
}

function renderCatalogSelector(s) {
    const { c, me, catFilter, setCatFilter, setEditDraft, catalogs, currentCatalog,
            isUserCatalog, handleNewMaterial, handleDuplicateCatalog, handleRemoveCatalog } = s;
    return h('div', { style: { padding: '4px 8px 6px', borderBottom: `1px solid ${c.border}` } },
        h('div', { style: { fontSize: 10, color: c.textDim, marginBottom: 3, textTransform: 'uppercase', letterSpacing: 1 } }, me.catalogsLabel || 'Catalogs'),
        // Selector gets the full panel width so long catalog names are readable;
        // `title` surfaces the complete name on hover for any extra-long case.
        h('select', {
            value: catFilter,
            onChange: e => { setCatFilter(e.target.value); setEditDraft(null); },
            title: catFilter === 'all' ? me.allCatalogs : (currentCatalog?.name || ''),
            style: { width: '100%', boxSizing: 'border-box', height: 24, backgroundColor: c.bg, color: c.text, border: `1px solid ${c.border}`, borderRadius: 3, fontSize: 12, padding: '0 4px', outline: 'none', cursor: 'pointer', fontFamily: 'inherit' }
        },
            h('option', { value: 'all' },
                `${me.allCatalogs} (${catalogs.reduce((sum, cat) => sum + Object.keys(cat.materials || {}).length, 0)})`),
            catalogs.map(cat => {
                const count = Object.keys(cat.materials || {}).length;
                const badge = cat.source === 'user' ? ` ${me.userCatalogBadge}` : '';
                return h('option', { key: cat.id, value: cat.id }, `${cat.name}${badge} (${count})`);
            })
        ),
        // Action row: New material (user catalogs) + duplicate / remove.
        (currentCatalog || isUserCatalog) && h('div', { style: { display: 'flex', gap: 4, marginTop: 5, alignItems: 'center' } },
            isUserCatalog && h('button', {
                onClick: handleNewMaterial,
                style: { ...smallBtn(c), flex: 1, padding: '4px 0',
                    backgroundColor: c.accent + '22', color: c.accent, borderColor: c.accent + '66' }
            }, me.newMaterial),
            !isUserCatalog && h('div', { style: { flex: 1 } }),  // spacer → right-align buttons
            currentCatalog && h('button', {
                onClick: () => handleDuplicateCatalog(currentCatalog.id),
                title: me.duplicateCatalog,
                style: smallBtn(c, { padding: '3px 8px', flexShrink: 0 })
            }, '⎘'),
            currentCatalog && currentCatalog.id !== 'builtin' && h('button', {
                onClick: () => handleRemoveCatalog(currentCatalog.id),
                title: me.removeCatalog,
                style: smallBtn(c, { padding: '3px 8px', flexShrink: 0, color: '#ec7063', borderColor: '#ec7063' + '66' })
            }, '×')
        )
    );
}

function renderMaterialList(s) {
    const { c, me, results, editDraft, selectedId, handleSelectMaterial } = s;
    if (results.length === 0) {
        return h('div', { style: { padding: 12, color: c.textDim, fontSize: 12, textAlign: 'center' } }, me.noMaterials);
    }
    return results.map(({ catalogId, material }) => {
        const compId = `${catalogId}:${material.id}`;
        const isActive = editDraft
            ? (editDraft.catalogId === catalogId && (editDraft.id === material.id || editDraft.originalId === material.id))
            : selectedId === compId;
        const mc = resolveColor(material);
        return h('div', {
            key: compId,
            onClick: () => handleSelectMaterial(compId, catalogId, material),
            style: {
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '3px 8px', cursor: 'pointer',
                backgroundColor: isActive ? c.accent + '33' : 'transparent',
                borderLeft: `2px solid ${isActive ? c.accent : 'transparent'}`,
                color: isActive ? c.accent : c.text, fontSize: 12
            }
        },
            h('span', { style: dotStyle(mc) }),
            h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, material.name || material.id)
        );
    });
}

export function renderLeftPanel(s) {
    const { c, me, notification, query, setQuery } = s;
    return h('div', {
        style: { width: 220, flexShrink: 0, display: 'flex', flexDirection: 'column', borderRight: `1px solid ${c.border}`, backgroundColor: c.panel }
    },
        renderCatalogToolbar(s),
        notification && h('div', {
            style: { padding: '4px 8px', fontSize: 11, color: notification.type === 'ok' ? '#58d68d' : '#ec7063', borderBottom: `1px solid ${c.border}` }
        }, notification.msg),
        renderCatalogSelector(s),
        // Search
        h('div', { style: { padding: '4px 8px', borderBottom: `1px solid ${c.border}` } },
            h('input', {
                value: query, onChange: e => setQuery(e.target.value),
                placeholder: me.searchPlaceholder,
                style: { width: '100%', height: 22, boxSizing: 'border-box', backgroundColor: c.bg, color: c.text, border: `1px solid ${c.border}`, borderRadius: 3, fontSize: 12, padding: '0 6px', outline: 'none' }
            })
        ),
        // Material list
        h('div', { style: { flex: 1, overflowY: 'auto' } }, renderMaterialList(s))
    );
}
