/**
 * Material Editor — state and action wiring.
 *
 * Owns all editor state (catalogs, filters, the current edit draft, pending
 * import/copy modals) and the read-only preview chart. The substantive catalog
 * and material CRUD logic lives in materialEditorActions.js /
 * materialEditorMaterialActions.js as plain functions; this hook just holds
 * state and forwards calls to them through a shared `ctx` bundle.
 */

import { getCatalogs, getMaterialById, searchMaterials } from '../../../../utils/materials/catalogManager.js';
import {
    DESIGN_CATALOG_ID, buildDesignCatalog, searchDesignCatalog,
    designSelectionTarget, designMaterialConflict,
} from '../../../../utils/materials/designCatalog.js';
import { useDesign } from '../../../../state/DesignContext.js';
import {
    importAgfCatalog, importOptiLayerFiles, commitOptiLayerImport,
    removeCatalogWithConfirm, createCatalogWithPrompt, renameCatalogWithPrompt,
    duplicateCatalogWithPrompt,
} from './materialEditorActions.js';
import {
    newMaterial, selectMaterial, saveMaterial, deleteMaterialWithConfirm,
    copyUserMaterialDraft, copyToCatalog, openCopyPicker as openCopyPickerAction,
} from './materialEditorMaterialActions.js';
import { sampleReadOnlyChart } from './materialEditorReadOnly.js';
import { draftFingerprint } from './materialDraft.js';

const { useState, useEffect, useRef, useCallback, useMemo } = React;

// Shared guard for the two file-based importers: only one import runs at a
// time, and `importing` always clears even if the importer throws.
async function runImportGuarded(fn, ctx, importing, setImporting) {
    if (importing) return;
    setImporting(true);
    try { await fn(ctx); } finally { setImporting(false); }
}

// Redraw the read-only chart when the selection changes. No-op while a user
// material is being edited (UserMaterialForm owns its own preview chart).
function updateReadOnlySampledTable({ editDraft, chartRef, selectedMat, c, me, setSampledTable }) {
    if (editDraft) return;
    if (!chartRef.current || !window.Plotly || !selectedMat?.getNK) { setSampledTable([]); return; }
    setSampledTable(sampleReadOnlyChart(chartRef.current, selectedMat, c, me));
}

export function useMaterialEditor({ c, t, setInputDialog }) {
    const [catalogs,         setCatalogs]        = useState([]);
    const [catFilter,        setCatFilter]        = useState('all');
    const [query,            setQuery]            = useState('');
    const [selectedId,       setSelectedId]       = useState(null);
    const [importing,        setImporting]        = useState(false);
    const [showRii,          setShowRii]          = useState(false);
    const [notification,     setNotification]     = useState(null);
    const [menuOpen,         setMenuOpen]         = useState(false);
    const [editDraft,        updateDraft]         = useState(null);
    const [pristineDraft,    setPristineDraft]    = useState(null);
    const [copyPickerFor,    setCopyPickerFor]    = useState(null);
    const [olImport,         setOlImport]         = useState(null);

    const me = t.materialEditor;
    const { design } = useDesign();

    const loadCatalogs = useCallback(() => { setCatalogs(getCatalogs()); }, []);
    useEffect(() => {
        loadCatalogs();
        window.addEventListener('catalogs-loaded', loadCatalogs);
        return () => window.removeEventListener('catalogs-loaded', loadCatalogs);
    }, [loadCatalogs]);

    // Installing a draft (select / new / copy / post-save refresh) also records
    // it as the revert baseline. Edits from the form go through `updateDraft`,
    // which leaves the baseline alone — the difference between the two is what
    // "unsaved changes" means.
    const setEditDraft = useCallback((draft) => {
        updateDraft(draft);
        setPristineDraft(draft);
    }, []);

    const isDirty = draftFingerprint(editDraft) !== draftFingerprint(pristineDraft);
    const handleRevertMaterial = () => updateDraft(pristineDraft);

    // The design's embedded materials, browsable but not part of the registry.
    // `catalogs` stays the registry list every catalog action works against;
    // `browseCatalogs` is the merged list used only where materials are listed.
    const designCatalog = useMemo(
        () => buildDesignCatalog(design, me.designCatalog), [design, me.designCatalog]);
    // Listed first: what the open design is made of is the most likely reason to
    // be in this window.
    const browseCatalogs = designCatalog ? [designCatalog, ...catalogs] : catalogs;

    // Switching to a design with no embedded materials retires the catalog; a
    // filter still pointing at it would leave the selector showing nothing.
    useEffect(() => {
        if (catFilter === DESIGN_CATALOG_ID && !designCatalog) setCatFilter('all');
    }, [catFilter, designCatalog]);

    const designResults = (catFilter === 'all' || catFilter === DESIGN_CATALOG_ID)
        ? searchDesignCatalog(designCatalog, query) : [];
    const results = [
        ...designResults,
        ...searchMaterials(query, catFilter === 'all' ? null : catFilter),
    ];

    const designTarget = designSelectionTarget(designCatalog, selectedId);
    const selectedMat = (editDraft || !selectedId) ? null
        : designTarget ? designCatalog.materials[designTarget]
        : getMaterialById(selectedId);
    const designConflict = designTarget ? designMaterialConflict(design, designTarget) : null;

    const currentCatalog = catFilter !== 'all' ? browseCatalogs.find(cat => cat.id === catFilter) : null;
    const isUserCatalog = currentCatalog?.source === 'user';

    function notify(type, msg) {
        setNotification({ type, msg });
    }

    // Auto-clear notification
    useEffect(() => {
        if (!notification) return;
        const tid = setTimeout(() => setNotification(null), 3000);
        return () => clearTimeout(tid);
    }, [notification]);

    // Context bundle passed to the plain action functions — every setter/value
    // an action might need, in one place, so handlers below stay one-liners.
    const ctx = {
        c, t, me, notify, loadCatalogs, setInputDialog,
        catalogs, catFilter, setCatFilter,
        selectedId, setSelectedId, editDraft, setEditDraft,
        copyPickerFor, setCopyPickerFor, olImport, setOlImport,
    };

    const handleImport = () => runImportGuarded(importAgfCatalog, ctx, importing, setImporting);
    const handleImportOptiLayer = () => runImportGuarded(importOptiLayerFiles, ctx, importing, setImporting);
    const doImportOptiLayer = (targetCatId) => commitOptiLayerImport(targetCatId, ctx);
    const handleRemoveCatalog = (catId) => removeCatalogWithConfirm(catId, ctx);
    const handleCreateCatalog = () => createCatalogWithPrompt(ctx);
    const handleRenameCatalog = (catId) => renameCatalogWithPrompt(catId, ctx);
    const handleDuplicateCatalog = (srcId) => duplicateCatalogWithPrompt(srcId, ctx);

    const handleNewMaterial = () => newMaterial(ctx);
    const handleSelectMaterial = (compId, catalogId, mat) => selectMaterial(compId, catalogId, mat, ctx);
    const handleSaveMaterial = () => saveMaterial(ctx);
    const handleDeleteMaterial = () => deleteMaterialWithConfirm(ctx);
    const handleCopyUserMaterial = () => copyUserMaterialDraft(ctx);
    const openCopyPicker = (srcMat) => openCopyPickerAction(srcMat, ctx);
    const doCopyToCatalog = (srcMat, targetCatId) => copyToCatalog(srcMat, targetCatId, ctx);

    // ── Read-only n/k chart (for builtin/AGF materials) ───────────────────────
    const chartRef = useRef(null);
    // Sampled n,k table built from getNK over the plotted range — shown for materials
    // that carry no stored tabData (built-in functions, AGF/OptiLayer formulas) so the
    // user always gets numbers next to the curve, not just a picture.
    const [sampledTable, setSampledTable] = useState([]);
    useEffect(() => {
        updateReadOnlySampledTable({ editDraft, chartRef, selectedMat, c, me, setSampledTable });
    }, [selectedMat, c, editDraft]);

    const handleRiiAdded = useCallback((catId) => {
        loadCatalogs();
        setCatFilter(catId);
    }, [loadCatalogs]);

    return {
        c, me, catalogs, catFilter, setCatFilter, query, setQuery,
        selectedId, importing, showRii, setShowRii, notification,
        menuOpen, setMenuOpen,
        editDraft, setEditDraft, updateDraft, isDirty, handleRevertMaterial,
        results, selectedMat, currentCatalog, isUserCatalog,
        browseCatalogs, designConflict,
        handleImport, handleImportOptiLayer, doImportOptiLayer,
        handleRemoveCatalog, handleCreateCatalog, handleRenameCatalog, handleDuplicateCatalog,
        handleNewMaterial, handleSelectMaterial, handleSaveMaterial, handleDeleteMaterial,
        handleCopyUserMaterial, openCopyPicker, doCopyToCatalog,
        copyPickerFor, setCopyPickerFor, olImport, setOlImport,
        chartRef, sampledTable, handleRiiAdded,
    };
}
