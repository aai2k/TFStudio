/**
 * Material Editor: the left panel (catalog selector, search and material list).
 *
 * Four stacked rows: the catalog selector with its "⋯" menu of catalog
 * actions, a search box, a result-count row carrying the Add menu, and the
 * material list. Both menus are drawn by actionMenu.js.
 *
 * Each render* function takes the editor's flat state object `s` (from
 * useMaterialEditor) and reads only the fields it needs.
 */

import { resolveColor } from '../../../../utils/materials/catalogManager.js';
import { DESIGN_CATALOG_ID } from '../../../../utils/materials/designCatalog.js';
import { dotStyle, smallBtn, formatNm } from './materialEditorUI.js';
import { ActionMenu } from './actionMenu.js';
import { tablerIcon } from '../../../ui/tablerIcons.js';

const { createElement: h } = React;

const PANEL_WIDTH = 244;

const fieldStyle = (c) => ({
    height: 24, boxSizing: 'border-box',
    backgroundColor: c.bg, color: c.text,
    border: `1px solid ${c.border}`, borderRadius: 3,
    fontSize: 12, padding: '0 6px', outline: 'none',
    fontFamily: 'inherit',
});

// The ⋯ menu: what acts on the selected catalog, under its name, then the two
// ways of making a catalog. An AGF file always becomes a catalog of its own,
// which is why it sits here and not under Add. An action that cannot apply to
// the selection is disabled rather than hidden, so the menu keeps its shape.
function catalogMenuItems(s) {
    const { me, currentCatalog, isUserCatalog, importing,
            handleCreateCatalog, handleRenameCatalog, handleDuplicateCatalog, handleRemoveCatalog,
            handleImport } = s;
    // The design catalog lives on the design, not in the registry: it can be
    // browsed and its materials copied out, but not renamed, duplicated or
    // deleted as a catalog.
    const isDesignCatalog = currentCatalog?.id === DESIGN_CATALOG_ID;
    const canDelete = !!currentCatalog && currentCatalog.id !== 'builtin' && !isDesignCatalog;
    return [
        { id: 'head',   header: true, label: currentCatalog?.name || me.allCatalogs },
        { id: 'rename', icon: 'pencil',      label: me.menuRenameCatalog,    onClick: () => handleRenameCatalog(currentCatalog.id),
          disabled: !isUserCatalog },
        { id: 'dup',    icon: 'copy-plus',   label: me.menuDuplicateCatalog, onClick: () => handleDuplicateCatalog(currentCatalog.id),
          disabled: !currentCatalog || isDesignCatalog },
        { id: 'del',    icon: 'trash',       label: me.menuDeleteCatalog,    onClick: () => handleRemoveCatalog(currentCatalog.id),
          disabled: !canDelete, danger: true },
        { id: 'sep',    separator: true },
        { id: 'new',    icon: 'folder-plus', label: me.menuNewEmptyCatalog,  onClick: handleCreateCatalog },
        { id: 'agf',    icon: 'folder-down', label: me.menuNewAgfCatalog,    onClick: handleImport, disabled: importing },
    ];
}

// The Add menu: every way of getting a material in. Each asks for or picks
// the catalog it adds to, so all of them work whichever catalog is selected.
function addMenuItems(s) {
    const { me, importing, handleNewMaterial, handleImportFiles, setShowRii } = s;
    return [
        { id: 'blank', icon: 'file-plus',   label: me.addBlankMaterial, onClick: handleNewMaterial },
        { id: 'sep',   separator: true },
        { id: 'rii',   icon: 'database',    label: me.addFromRii,       onClick: () => setShowRii(true) },
        { id: 'files', icon: 'file-import', label: me.addFromFiles,     onClick: handleImportFiles, disabled: importing },
    ];
}

function renderCatalogRow(s) {
    const { c, me, catFilter, handleCatalogChange, browseCatalogs, currentCatalog,
            menuOpen, setMenuOpen, menuTriggerRef, setAddMenuOpen } = s;
    const total = browseCatalogs.reduce((sum, cat) => sum + Object.keys(cat.materials || {}).length, 0);
    return h('div', { style: { position: 'relative', display: 'flex', alignItems: 'center', gap: 6, padding: '8px 8px 4px' } },
        h('span', { style: { fontSize: 11, color: c.textDim, flexShrink: 0 } }, me.catalogLabel),
        h('select', {
            value: catFilter,
            onChange: e => handleCatalogChange(e.target.value),
            title: catFilter === 'all' ? me.allCatalogs : (currentCatalog?.name || ''),
            style: { ...fieldStyle(c), flex: 1, minWidth: 0, cursor: 'pointer' }
        },
            h('option', { value: 'all' }, `${me.allCatalogs} (${total})`),
            browseCatalogs.map(cat =>
                h('option', { key: cat.id, value: cat.id },
                    `${cat.name} (${Object.keys(cat.materials || {}).length})`))
        ),
        h('button', {
            ref: menuTriggerRef,
            // Opening one menu shuts the other: a button pressed from the
            // keyboard sends no mouse press for the open menu to close on.
            onClick: () => { setAddMenuOpen(false); setMenuOpen(v => !v); },
            title: me.catalogMenuTip,
            style: smallBtn(c, {
                flexShrink: 0, padding: '2px 6px', lineHeight: '16px',
                backgroundColor: menuOpen ? c.accent + '22' : c.panel,
                color: menuOpen ? c.accent : c.text,
                borderColor: menuOpen ? c.accent + '88' : c.border,
            })
        }, '⋯'),
        menuOpen && h(ActionMenu, { items: catalogMenuItems(s), onClose: () => setMenuOpen(false), c, triggerRef: menuTriggerRef })
    );
}

function renderSearchRow(s) {
    const { c, me, query, setQuery } = s;
    return h('div', { style: { padding: '4px 8px' } },
        h('input', {
            value: query, onChange: e => setQuery(e.target.value),
            placeholder: me.searchPlaceholder,
            style: { ...fieldStyle(c), width: '100%' }
        })
    );
}

function renderCountRow(s) {
    const { c, me, results, addMenuOpen, setAddMenuOpen, addMenuTriggerRef, setMenuOpen } = s;
    return h('div', {
        style: { position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                 gap: 6, padding: '4px 8px 6px', borderBottom: `1px solid ${c.border}` }
    },
        h('span', { style: { fontSize: 11, color: c.textDim } }, me.materialCount(results.length)),
        h('button', {
            ref: addMenuTriggerRef,
            onClick: () => { setMenuOpen(false); setAddMenuOpen(v => !v); },
            title: me.addMaterialsTip,
            style: smallBtn(c, {
                display: 'inline-flex', alignItems: 'center', gap: 5,
                backgroundColor: c.accent + (addMenuOpen ? '33' : '22'), color: c.accent, borderColor: c.accent + '66',
            })
        },
            tablerIcon('plus', 12),
            me.addMaterials,
            h('span', { className: addMenuOpen ? 'tf-caret tf-caret-open' : 'tf-caret', style: { backgroundColor: c.accent } })
        ),
        addMenuOpen && h(ActionMenu, { items: addMenuItems(s), onClose: () => setAddMenuOpen(false), c, triggerRef: addMenuTriggerRef })
    );
}

// Second line of a list row: the material's own data range, plus — only while
// browsing all catalogs — the catalog it lives in, since the selector no longer
// names one in that mode.
function materialSubtitle(material, catalogName, catFilter) {
    const parts = [];
    if (material.lambdaMin && material.lambdaMax) {
        parts.push(`${formatNm(material.lambdaMin * 1000)}–${formatNm(material.lambdaMax * 1000)} nm`);
    }
    if (catFilter === 'all' && catalogName) parts.push(catalogName);
    return parts.join(' · ');
}

function renderMaterialList(s) {
    const { c, me, results, editDraft, selectedId, handleSelectMaterial, catFilter } = s;
    if (results.length === 0) {
        return h('div', { style: { padding: 12, color: c.textDim, fontSize: 12, textAlign: 'center' } }, me.noMaterials);
    }
    return results.map(({ catalogId, catalogName, material, selectionId }) => {
        // Design-catalog entries carry their own key: they are addressed by the
        // id the design references them under, not by the material's own id.
        const compId = selectionId || `${catalogId}:${material.id}`;
        const isActive = editDraft
            ? (editDraft.catalogId === catalogId && (editDraft.id === material.id || editDraft.originalId === material.id))
            : selectedId === compId;
        const subtitle = materialSubtitle(material, catalogName, catFilter);
        return h('div', {
            key: compId,
            onClick: () => handleSelectMaterial(compId, catalogId, material),
            style: {
                display: 'flex', alignItems: 'flex-start', gap: 7,
                padding: '5px 8px', cursor: 'pointer',
                backgroundColor: isActive ? c.accent + '33' : 'transparent',
                borderLeft: `2px solid ${isActive ? c.accent : 'transparent'}`,
            }
        },
            h('span', { style: { ...dotStyle(resolveColor(material)), marginTop: 3 } }),
            h('div', { style: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 } },
                h('span', {
                    style: { fontSize: 12, color: isActive ? c.accent : c.text,
                             overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
                }, material.name || material.id),
                subtitle && h('span', {
                    style: { fontSize: 10, color: c.textDim,
                             overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
                }, subtitle)
            )
        );
    });
}

export function renderLeftPanel(s) {
    const { c, notification } = s;
    return h('div', {
        style: { width: PANEL_WIDTH, flexShrink: 0, display: 'flex', flexDirection: 'column',
                 borderRight: `1px solid ${c.border}`, backgroundColor: c.panel }
    },
        renderCatalogRow(s),
        renderSearchRow(s),
        renderCountRow(s),
        notification && h('div', {
            style: { padding: '4px 8px', fontSize: 11, borderBottom: `1px solid ${c.border}`,
                     color: notification.type === 'ok' ? '#2fa84f' : '#e6194b' }
        }, notification.msg),
        h('div', { style: { flex: 1, overflowY: 'auto' } }, renderMaterialList(s))
    );
}
