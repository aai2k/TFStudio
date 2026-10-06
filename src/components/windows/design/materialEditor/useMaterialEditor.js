/**
 * Material Editor — state and action wiring.
 *
 * Owns all editor state (catalogs, filters, the current edit draft, pending
 * import/copy modals) and the read-only preview chart. The substantive catalog
 * and material CRUD logic lives in materialEditorActions.js /
 * materialEditorMaterialActions.js as plain functions; this hook just holds
 * state and forwards calls to them through a shared `ctx` bundle.
 */

import { getCatalog, getCatalogs, getMaterialById, searchMaterials } from '../../../../utils/materials/catalogManager.js';
import {
    DESIGN_CATALOG_ID, buildDesignCatalog, searchDesignCatalog,
    designSelectionTarget,
} from '../../../../utils/materials/designCatalog.js';
import { resolveDesignMaterial } from '../../../../utils/materials/designMaterials.js';
import { useCatalogRevision } from '../../../../utils/materials/useCatalogRevision.js';
import { useDesign } from '../../../../state/DesignContext.js';
import {
    importAgfCatalog, importMaterialFiles, commitFileImport,
    removeCatalogWithConfirm, createCatalogWithPrompt, renameCatalogWithPrompt,
    duplicateCatalogWithPrompt,
} from './materialEditorActions.js';
import {
    newMaterial, startBlankMaterial, selectMaterial, saveMaterial, deleteMaterialWithConfirm, confirmLeavingDraft,
    copyUserMaterialDraft, copyToCatalog, openCopyPicker as openCopyPickerAction,
} from './materialEditorMaterialActions.js';
import { sampleReadOnlyChart } from './materialEditorReadOnly.js';
import { clearMaterialChart } from './materialChart.js';
import { draftFingerprint } from './materialDraft.js';
import { materialEditorSession } from './sessionState.js';
import { evalParamsSession } from '../../../../state/evalParamsSession.js';
import { useWatchedSession, useWindowSession } from '../../windowSession.js';

const { useState, useEffect, useRef, useCallback, useMemo } = React;

// Shared guard for the two file-based importers: only one import runs at a
// time, and `importing` always clears even if the importer throws.
async function runImportGuarded(fn, ctx, importing, setImporting) {
    if (importing) return;
    setImporting(true);
    try { await fn(ctx); } finally { setImporting(false); }
}

// The name of the catalog a compound material id points into.
function catalogNameOf(id) {
    const cut = id.indexOf(':');
    return cut > 0 ? (getCatalog(id.slice(0, cut))?.name ?? id.slice(0, cut)) : id;
}

// Redraw the read-only chart when the selection changes. No-op while a user
// material is being edited (UserMaterialForm owns its own preview chart).
function updateReadOnlySampledTable({ editDraft, chartRef, selectedMat, c, me, setSampledTable }) {
    if (editDraft) return;
    if (!chartRef.current || !selectedMat?.getNK) { setSampledTable([]); return; }
    setSampledTable(sampleReadOnlyChart(chartRef.current, selectedMat, c, me));
}

export function useMaterialEditor({ c, t, setInputDialog }) {
    const [catalogs,         setCatalogs]        = useState([]);
    const [session, setField] = useWindowSession(materialEditorSession, null);
    const { catFilter, query, selectedId, editDraft, pristineDraft, detailTab, tableHeight } = session;
    const setCatFilter     = value => setField('catFilter', value);
    const setQuery         = value => setField('query', value);
    const setSelectedId    = value => setField('selectedId', value);
    const updateDraft      = value => setField('editDraft', value);
    const setPristineDraft = value => setField('pristineDraft', value);
    const setDetailTab     = value => setField('detailTab', value);
    const setTableHeight   = value => setField('tableHeight', value);
    const [importing,       setImporting]        = useState(false);
    const [showRii,          setShowRii]          = useState(false);
    const [notification,     setNotification]     = useState(null);
    const [menuOpen,         setMenuOpen]         = useState(false);
    const menuTriggerRef = useRef(null);
    const [addMenuOpen,      setAddMenuOpen]      = useState(false);
    const addMenuTriggerRef = useRef(null);
    const [copyPickerFor,    setCopyPickerFor]    = useState(null);
    const [newMaterialPicker, setNewMaterialPicker] = useState(false);
    const [fileImport,       setFileImport]       = useState(null);

    const me = t.materialEditor;
    const { design, designs } = useDesign();
    // The wavelengths the design is evaluated over, from whichever copy of
    // Optical Evaluation was changed last. A fit has to be right where the
    // coating is used, so this is the band the fit panel offers, and it follows
    // that window while this one is open.
    const evalParams = useWatchedSession(evalParamsSession, null);

    const workingNm = [evalParams.lambdaStart, evalParams.lambdaEnd];

    // The list follows every catalog change, the ones other windows make
    // included (Zemax Coatings, n,k Characterization): a catalog missing from it
    // would open its materials read-only.
    const catalogRevision = useCatalogRevision();
    const loadCatalogs = useCallback(() => { setCatalogs(getCatalogs()); }, []);
    useEffect(() => { loadCatalogs(); }, [loadCatalogs, catalogRevision]);

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

    const leavingDraft = (action) => confirmLeavingDraft({ isDirty, editDraft, setInputDialog, me }, action);

    // The materials the design uses, browsable but not part of the registry.
    // `catalogs` stays the registry list every catalog action works against;
    // `browseCatalogs` is the merged list used only where materials are listed.
    // Rebuilt on a catalog change too: an entry a catalog holds is that
    // catalog's material, which a save here replaces.
    const designCatalog = useMemo(
        () => buildDesignCatalog(design, me.designCatalog), [design, me.designCatalog, catalogRevision]);
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
    // Carried by the design and computed from its own copy, which can be copied
    // out but not edited: held by no catalog here, or by a catalog, named in
    // `conflict`, with another material under the same id.
    const designResolution = designTarget != null ? resolveDesignMaterial(design, designTarget) : null;
    const designOnly = designResolution?.status === 'embedded'
        ? { conflict: designResolution.conflict ? catalogNameOf(designTarget) : null }
        : null;

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
        c, t, me, notify, loadCatalogs, setInputDialog, designs,
        catalogs, catFilter, setCatFilter,
        selectedId, setSelectedId, editDraft, setEditDraft,
        copyPickerFor, setCopyPickerFor, setFileImport, setNewMaterialPicker,
    };

    const handleImport = () => runImportGuarded(importAgfCatalog, ctx, importing, setImporting);
    const handleImportFiles = () => runImportGuarded(importMaterialFiles, ctx, importing, setImporting);
    const doImportFiles = (targetCatId, entries, newCatalogName) => commitFileImport(targetCatId, entries, ctx, newCatalogName);
    const handleRemoveCatalog = (catId) => removeCatalogWithConfirm(catId, ctx);
    const handleCreateCatalog = () => leavingDraft(() => createCatalogWithPrompt(ctx));
    const handleRenameCatalog = (catId) => renameCatalogWithPrompt(catId, ctx);
    const handleDuplicateCatalog = (srcId) => leavingDraft(() => duplicateCatalogWithPrompt(srcId, ctx));

    const handleNewMaterial = () => leavingDraft(() => newMaterial(ctx));
    const handleNewMaterialIn = (catalogId) => leavingDraft(() => startBlankMaterial(catalogId, ctx));
    const handleSelectMaterial = (compId, catalogId, mat) => leavingDraft(() => selectMaterial(compId, catalogId, mat, ctx));
    const handleCatalogChange = (catalogId) => leavingDraft(() => { setCatFilter(catalogId); setEditDraft(null); });
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
    // The chart is on one page of the detail pane, so leaving that page takes
    // its node away: the renderer is disposed with it and drawn again on the
    // way back, which is also why the open page is a dependency here.
    useEffect(() => {
        updateReadOnlySampledTable({ editDraft, chartRef, selectedMat, c, me, setSampledTable });
        const element = chartRef.current;
        return () => clearMaterialChart(element);
    }, [selectedMat, c, editDraft, detailTab]);

    const handleRiiAdded = useCallback((catId) => {
        loadCatalogs();
        setCatFilter(catId);
    }, [loadCatalogs]);

    return {
        c, me, catalogs, catFilter, setCatFilter, handleCatalogChange, query, setQuery,
        selectedId, importing, showRii, setShowRii, notification,
        menuOpen, setMenuOpen, menuTriggerRef, addMenuOpen, setAddMenuOpen, addMenuTriggerRef,
        editDraft, setEditDraft, updateDraft, isDirty, handleRevertMaterial,
        detailTab, setDetailTab, tableHeight, setTableHeight,
        results, selectedMat, currentCatalog, isUserCatalog,
        browseCatalogs, designOnly, workingNm,
        handleImport, handleImportFiles, doImportFiles,
        handleRemoveCatalog, handleCreateCatalog, handleRenameCatalog, handleDuplicateCatalog,
        handleNewMaterial, handleNewMaterialIn, handleSelectMaterial, handleSaveMaterial, handleDeleteMaterial,
        handleCopyUserMaterial, openCopyPicker, doCopyToCatalog,
        copyPickerFor, setCopyPickerFor, newMaterialPicker, setNewMaterialPicker, fileImport, setFileImport,
        chartRef, sampledTable, handleRiiAdded,
    };
}
