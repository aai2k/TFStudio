/**
 * Material Editor — browse, import, and create optical material catalogs.
 *
 * Layout:
 *   Left panel:   catalog filter + search + material list
 *   Right panel:  read-only details for builtin/AGF materials;
 *                 editable form (UserMaterialForm) for user-catalog materials
 *
 * This module hosts only the top-level component and its final layout.
 * State and actions live in useMaterialEditor.js; supporting pieces live in
 * sibling modules: the draft model and converters (materialDraft.js), the
 * read-only material view (materialEditorReadOnly.js), the left panel
 * (materialEditorLeftPanel.js), the destination-catalog modals
 * (materialEditorModals.js), the editable form (userMaterialForm.js), the
 * n/k grid (nkDataGrid.js), and shared presentational atoms (materialEditorUI.js).
 */

import { RIIBrowser } from './RIIBrowser.js';
import { useMaterialEditor } from './useMaterialEditor.js';
import { renderReadOnlyMaterial } from './materialEditorReadOnly.js';
import { renderLeftPanel } from './materialEditorLeftPanel.js';
import { renderCopyPickerModal, renderOptiLayerImportModal } from './materialEditorModals.js';
import { UserMaterialForm } from './userMaterialForm.js';

const { createElement: h } = React;

export function MaterialEditor({ c, t, setInputDialog }) {
    const s = useMaterialEditor({ c, t, setInputDialog });
    const {
        me, editDraft, selectedMat, sampledTable, chartRef, openCopyPicker, catalogs,
        handleSaveMaterial, handleDeleteMaterial, handleCopyUserMaterial,
        showRii, setShowRii, handleRiiAdded,
        copyPickerFor, setCopyPickerFor, doCopyToCatalog,
        olImport, doImportOptiLayer, setOlImport,
    } = s;

    const rightPanel = h('div', {
        style: { flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', backgroundColor: c.bg }
    },
        editDraft
            ? h(UserMaterialForm, {
                draft: editDraft,
                onChange: s.setEditDraft,
                onSave: handleSaveMaterial,
                onDelete: handleDeleteMaterial,
                onCopy: handleCopyUserMaterial,
                catalogs,
                c,
                t
            })
            : !selectedMat
                ? h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: c.textDim, fontSize: 13, fontStyle: 'italic' } }, me.selectMaterial)
                : renderReadOnlyMaterial({ selectedMat, sampledTable, chartRef, openCopyPicker, me, t, c })
    );

    return h('div', {
        style: { display: 'flex', height: '100%', overflow: 'hidden', fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: 13, color: c.text }
    },
        renderLeftPanel(s),
        rightPanel,
        showRii && h(RIIBrowser, { c, t, onClose: () => setShowRii(false), onAdded: handleRiiAdded }),
        // Destination-catalog picker (shown when there are ≥2 user catalogs).
        copyPickerFor && renderCopyPickerModal({ copyPickerFor, catalogs, doCopyToCatalog, setCopyPickerFor, me, c }),
        // OptiLayer import: choose destination catalog (any non-builtin) or create new.
        olImport && renderOptiLayerImportModal({ olImport, catalogs, doImportOptiLayer, setOlImport, me, c })
    );
}
