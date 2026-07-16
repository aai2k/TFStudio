/**
 * RIIBrowser — state and action wiring.
 *
 * Owns catalog/search/selection state and the destination-catalog "add" flow.
 * Effect bodies live in riiEffects.js, user-triggered actions in riiActions.js,
 * and the n/k chart draw in riiChart.js — this hook just holds state and wires
 * them together through a shared `ctx` bundle.
 */

import { searchCatalog } from '../../../../utils/materials/riiDatabase.js';
import { getCatalogs } from '../../../../utils/materials/catalogManager.js';
import { updateRiiDatabase, addRiiMaterial, startAddFlow } from './riiActions.js';
import { loadRiiCatalogTree, trackRiiDbStatus, fetchSelectedMaterial, toggleInSet } from './riiEffects.js';
import { drawRiiChart } from './riiChart.js';

const { useState, useEffect, useRef, useCallback } = React;

export function useRIIBrowser({ c, t, onAdded }) {
    const rii = t.riiDatabase;

    const [catalogTree,    setCatalogTree]    = useState(null);
    const [loadErr,        setLoadErr]        = useState(null);
    const [catalogLoading, setCatalogLoading] = useState(true);
    const [query,          setQuery]          = useState('');
    const [results,        setResults]        = useState([]);
    const [expandedShelves, setExpandedShelves] = useState(new Set());
    const [expandedBooks,   setExpandedBooks]   = useState(new Set());
    const [selected,       setSelected]       = useState(null);
    const [mat,            setMat]            = useState(null);
    const [matLoading,     setMatLoading]     = useState(false);
    const [matErr,         setMatErr]         = useState(null);
    const [phase,          setPhase]          = useState('idle');
    const [addMsg,         setAddMsg]         = useState('');
    const [targetCatId,    setTargetCatId]    = useState('');
    const [dbStatus,       setDbStatus]       = useState(null);
    const [updating,       setUpdating]       = useState(false);
    const [updateMsg,      setUpdateMsg]      = useState('');
    const chartRef = useRef(null);

    useEffect(() => loadRiiCatalogTree({ setCatalogTree, setLoadErr, setCatalogLoading }), []);
    useEffect(() => trackRiiDbStatus({ rii, setDbStatus, setUpdateMsg }), [rii]);

    useEffect(() => {
        if (!catalogTree || !query.trim()) { setResults([]); return; }
        setResults(searchCatalog(catalogTree, query));
    }, [catalogTree, query]);

    useEffect(() => fetchSelectedMaterial(selected, { setMat, setMatLoading, setMatErr, setPhase }), [selected]);

    useEffect(() => { drawRiiChart(chartRef.current, mat, c); }, [mat, c]);

    const toggleShelf = useCallback((shelfId) => {
        setExpandedShelves(prev => toggleInSet(prev, shelfId));
    }, []);
    const toggleBook = useCallback((key) => {
        setExpandedBooks(prev => toggleInSet(prev, key));
    }, []);

    const handleSelectResult = useCallback((r) => {
        setSelected(r);
        setPhase('idle');
        setAddMsg('');
    }, []);

    // Context bundle passed to the plain action/effect functions.
    const ctx = { rii, mat, selected, onAdded, setPhase, setAddMsg, setUpdating, setUpdateMsg, setDbStatus, setCatalogLoading, setCatalogTree, setTargetCatId };

    const handleUpdate = () => updateRiiDatabase(ctx);
    const doAdd = (catId) => addRiiMaterial(catId, ctx);
    const handleAddClick = () => startAddFlow({ ...ctx, doAdd });

    const userCatalogs = getCatalogs().filter(cat => cat.source === 'user');
    const browsing = !query.trim();
    const showNoResults = !catalogLoading && !loadErr && !browsing && results.length === 0;

    return {
        c, rii, catalogTree, loadErr, catalogLoading, query, setQuery, results,
        expandedShelves, expandedBooks, toggleShelf, toggleBook,
        selected, mat, matLoading, matErr, phase, addMsg, targetCatId, setTargetCatId,
        dbStatus, updating, updateMsg, handleUpdate,
        chartRef, handleSelectResult, handleAddClick, doAdd, setPhase,
        userCatalogs, browsing, showNoResults,
    };
}
