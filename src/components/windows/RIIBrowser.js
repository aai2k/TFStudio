/**
 * RIIBrowser.js — Modal browser for refractiveindex.info database.
 * Opened from MaterialEditor via the "Browse RII…" button.
 *
 * Browse mode (no query): collapsible shelf → book → page tree.
 * Search mode (query typed): flat filtered results list.
 */

import {
    loadCatalog, fetchMaterial, searchCatalog, riiToMaterialEntry, sampleMaterial,
    getDatabaseStatus, updateDatabase, clearCatalogCache,
} from '../../utils/materials/riiDatabase.js';
import {
    getCatalogs, createUserCatalog, saveUserMaterial,
} from '../../utils/materials/catalogManager.js';

const { createElement: h, useState, useEffect, useRef, useCallback } = React;

// ── helpers ───────────────────────────────────────────────────────────────────

function wlRange(mat) {
    if (mat.wavelengthRange) {
        return `${Math.round(mat.wavelengthRange[0])}–${Math.round(mat.wavelengthRange[1])} nm`;
    }
    if (mat.tableNK?.length) {
        const lo = mat.tableNK[0][0], hi = mat.tableNK[mat.tableNK.length - 1][0];
        return `${Math.round(lo)}–${Math.round(hi)} nm`;
    }
    return '—';
}

function typeLabel(type) {
    return { tabulated_nk: 'Tabulated n,k', tabulated_n: 'Tabulated n',
             formula: 'Dispersion formula', mixed: 'Formula + tabulated k' }[type] || type;
}

// ── component ─────────────────────────────────────────────────────────────────

export function RIIBrowser({ c, t, onClose, onAdded }) {
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

    // Load catalog once
    useEffect(() => {
        let alive = true;
        setCatalogLoading(true);
        setLoadErr(null);
        loadCatalog()
            .then(tree => { if (alive) { setCatalogTree(tree); setCatalogLoading(false); } })
            .catch(err  => { if (alive) { setLoadErr(err.message); setCatalogLoading(false); } });
        return () => { alive = false; };
    }, []);

    // Offline-mirror status + live update progress
    useEffect(() => {
        let alive = true;
        getDatabaseStatus().then(s => { if (alive) setDbStatus(s); });
        const off = window.electronAPI?.onRiiUpdateProgress?.((info) => {
            if (!alive) return;
            if (info.phase === 'downloading') setUpdateMsg(rii.updateDownloading);
            else if (info.phase === 'extracting') setUpdateMsg(rii.updateExtracting);
        });
        return () => { alive = false; if (typeof off === 'function') off(); };
    }, [rii]);

    const handleUpdate = useCallback(async () => {
        setUpdating(true);
        setUpdateMsg(rii.updateDownloading);
        try {
            const res = await updateDatabase();
            if (res.success) {
                setUpdateMsg('');
                const s = await getDatabaseStatus();
                setDbStatus(s);
                // Reload the (now refreshed) catalog tree.
                clearCatalogCache();
                setCatalogLoading(true);
                const tree = await loadCatalog();
                setCatalogTree(tree);
                setCatalogLoading(false);
            } else {
                setUpdateMsg(rii.updateError(res.error || ''));
            }
        } catch (err) {
            setUpdateMsg(rii.updateError(err.message));
        } finally {
            setUpdating(false);
        }
    }, [rii]);

    // Search on query change
    useEffect(() => {
        if (!catalogTree || !query.trim()) { setResults([]); return; }
        setResults(searchCatalog(catalogTree, query));
    }, [catalogTree, query]);

    // Fetch material when selection changes
    useEffect(() => {
        if (!selected) { setMat(null); return; }
        let alive = true;
        setMatLoading(true);
        setMatErr(null);
        setMat(null);
        setPhase('idle');
        fetchMaterial(selected.dataPath)
            .then(m => { if (alive) { setMat(m); setMatLoading(false); } })
            .catch(err => { if (alive) { setMatErr(err.message); setMatLoading(false); } });
        return () => { alive = false; };
    }, [selected]);

    // Draw chart
    useEffect(() => {
        if (!chartRef.current || !window.Plotly) return;
        if (!mat) { window.Plotly.purge(chartRef.current); return; }
        // Wide range so IR materials aren't truncated; the material's own
        // wavelengthRange still bounds the actual samples (built-ins span to ~20 µm).
        const samples = sampleMaterial(mat, 200, 20000, 10);
        if (!samples.length) return;
        const lams = samples.map(r => r[0]);
        const ns   = samples.map(r => r[1]);
        const ks   = samples.map(r => r[2]);
        const hasK = ks.some(k => k > 1e-8);
        const traces = [
            { x: lams, y: ns, name: 'n(λ)', type: 'scatter', mode: 'lines',
              line: { color: '#5dade2', width: 2 } },
        ];
        if (hasK) traces.push({
            x: lams, y: ks, name: 'k(λ)', type: 'scatter', mode: 'lines',
            line: { color: '#e74c3c', width: 1.5, dash: 'dash' }, yaxis: 'y2',
        });
        const layout = {
            paper_bgcolor: c.bg, plot_bgcolor: c.bg,
            margin: { t: 6, b: 32, l: 48, r: hasK ? 48 : 12 },
            xaxis: { title: { text: 'Wavelength (nm)', font: { size: 10 } },
                     color: c.textDim, gridcolor: c.border, tickfont: { size: 9 } },
            yaxis: { color: '#5dade2', gridcolor: c.border, tickfont: { size: 9 } },
            legend: { font: { size: 10, color: c.text }, bgcolor: 'transparent', x: 0.01, y: 0.99 },
            font: { family: 'system-ui, -apple-system, sans-serif' },
        };
        if (hasK) layout.yaxis2 = { color: '#e74c3c', overlaying: 'y', side: 'right', tickfont: { size: 9 } };
        window.Plotly.react(chartRef.current, traces, layout, { responsive: true, displayModeBar: false });
    }, [mat, c]);

    // ── tree toggle helpers ───────────────────────────────────────────────────

    const toggleShelf = useCallback((shelfId) => {
        setExpandedShelves(prev => {
            const next = new Set(prev);
            next.has(shelfId) ? next.delete(shelfId) : next.add(shelfId);
            return next;
        });
    }, []);

    const toggleBook = useCallback((key) => {
        setExpandedBooks(prev => {
            const next = new Set(prev);
            next.has(key) ? next.delete(key) : next.add(key);
            return next;
        });
    }, []);

    // ── select / add handlers ─────────────────────────────────────────────────

    const handleSelectResult = useCallback((r) => {
        setSelected(r);
        setPhase('idle');
        setAddMsg('');
    }, []);

    const handleAddClick = useCallback(() => {
        if (!mat || !selected) return;
        const userCats = getCatalogs().filter(cat => cat.source === 'user');
        if (userCats.length === 0) {
            doAdd('__new__');
        } else {
            setTargetCatId(userCats[0].id);
            setPhase('picking');
        }
    }, [mat, selected]);

    const doAdd = useCallback((catId) => {
        try {
            const entry = riiToMaterialEntry(mat, selected.pageName, selected.bookName);
            let resolvedId = catId;
            if (catId === '__new__') {
                resolvedId = createUserCatalog('RefractiveIndex.info').id;
            }
            saveUserMaterial(resolvedId, entry);
            setPhase('ok');
            setAddMsg(rii.addSuccess(entry.name));
            window.dispatchEvent(new CustomEvent('catalogs-loaded'));
            if (onAdded) onAdded(resolvedId, entry.name);
        } catch (err) {
            setPhase('error');
            setAddMsg(rii.addError(err.message));
        }
    }, [mat, selected, rii, onAdded]);

    // ── render helpers ────────────────────────────────────────────────────────

    const rowBase = {
        cursor: 'pointer', userSelect: 'none',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    };

    function shelfRow(shelf) {
        const open = expandedShelves.has(shelf.shelf);
        const active = open;
        return h('div', { key: shelf.shelf },
            h('div', {
                onClick: () => toggleShelf(shelf.shelf),
                style: {
                    ...rowBase, padding: '5px 10px',
                    display: 'flex', alignItems: 'center', gap: 6,
                    backgroundColor: active ? c.accent + '18' : 'transparent',
                    borderBottom: `1px solid ${c.border}44`,
                    fontSize: 12, fontWeight: 700,
                    color: active ? c.accent : c.text,
                },
            },
                h('span', { style: { fontSize: 10, width: 10, flexShrink: 0, color: c.textDim } }, open ? '▾' : '▸'),
                h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, shelf.name),
                h('span', { style: { marginLeft: 'auto', fontSize: 10, color: c.textDim, flexShrink: 0 } },
                    shelf.books.length)
            ),
            open && shelf.books.map(book => bookRow(shelf, book))
        );
    }

    function bookRow(shelf, book) {
        const key = shelf.shelf + '/' + book.book;
        const open = expandedBooks.has(key);
        const active = open;
        return h('div', { key },
            h('div', {
                onClick: () => toggleBook(key),
                style: {
                    ...rowBase, padding: '4px 10px 4px 22px',
                    display: 'flex', alignItems: 'center', gap: 6,
                    backgroundColor: active ? c.accent + '12' : 'transparent',
                    borderBottom: `1px solid ${c.border}33`,
                    fontSize: 12, fontWeight: 600,
                    color: active ? c.accent : c.text,
                },
            },
                h('span', { style: { fontSize: 10, width: 10, flexShrink: 0, color: c.textDim } }, open ? '▾' : '▸'),
                h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, book.name),
                h('span', { style: { marginLeft: 'auto', fontSize: 10, color: c.textDim, flexShrink: 0 } },
                    book.pages.length)
            ),
            open && book.pages.map(page => pageRow(shelf, book, page))
        );
    }

    function pageRow(shelf, book, page) {
        const isActive = selected?.dataPath === page.dataPath;
        const result = {
            shelf: shelf.shelf, shelfName: shelf.name,
            book: book.book,   bookName: book.name,
            page: page.page,   pageName: page.name,
            dataPath: page.dataPath,
        };
        return h('div', {
            key: page.dataPath,
            onClick: () => handleSelectResult(result),
            style: {
                ...rowBase, padding: '3px 10px 3px 36px',
                display: 'flex', alignItems: 'center',
                borderBottom: `1px solid ${c.border}22`,
                backgroundColor: isActive ? c.accent + '22' : 'transparent',
                borderLeft: `2px solid ${isActive ? c.accent : 'transparent'}`,
                fontSize: 11,
                color: isActive ? c.accent : c.text,
            },
        },
            h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, page.name)
        );
    }

    const userCatalogs = getCatalogs().filter(cat => cat.source === 'user');
    const browsing = !query.trim();

    // ── full render ───────────────────────────────────────────────────────────

    return h('div', {
        style: {
            position: 'fixed', inset: 0, zIndex: 9000,
            backgroundColor: 'rgba(0,0,0,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
        },
        onMouseDown: (e) => { if (e.target === e.currentTarget) onClose(); },
    },
        h('div', {
            style: {
                width: 820, height: 580,
                backgroundColor: c.bg, border: `1px solid ${c.border}`,
                borderRadius: 6, display: 'flex', flexDirection: 'column', overflow: 'hidden',
                boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
                fontFamily: 'system-ui, -apple-system, sans-serif',
            },
        },

            // Header
            h('div', {
                style: {
                    padding: '9px 14px', borderBottom: `1px solid ${c.border}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    flexShrink: 0,
                },
            },
                h('span', { style: { fontSize: 14, fontWeight: 600, color: c.text } }, rii.title),
                h('button', {
                    onClick: onClose,
                    style: { background: 'none', border: 'none', color: c.textDim, cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: 0 },
                }, '×')
            ),

            // Offline-database status bar
            h('div', {
                style: {
                    padding: '5px 14px', borderBottom: `1px solid ${c.border}`,
                    display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
                    fontSize: 11, color: c.textDim, backgroundColor: c.panel + '55',
                },
            },
                h('span', {},
                    dbStatus?.hasLocal
                        ? (dbStatus.lastUpdated
                            ? rii.dbUpdated(dbStatus.lastUpdated, dbStatus.materialCount)
                            : rii.dbOffline)
                        : rii.dbOnlineOnly),
                updateMsg && h('span', { style: { color: updating ? c.accent : '#ec7063' } }, updateMsg),
                h('button', {
                    onClick: handleUpdate,
                    disabled: updating,
                    style: {
                        marginLeft: 'auto', padding: '3px 12px', fontSize: 11,
                        backgroundColor: updating ? c.panel : c.accent,
                        color: updating ? c.textDim : '#fff',
                        border: updating ? `1px solid ${c.border}` : 'none',
                        borderRadius: 3, cursor: updating ? 'default' : 'pointer',
                    },
                }, updating ? rii.updating : rii.updateButton)
            ),

            // Body
            h('div', { style: { flex: 1, display: 'flex', overflow: 'hidden' } },

                // Left panel
                h('div', {
                    style: {
                        width: 290, borderRight: `1px solid ${c.border}`,
                        display: 'flex', flexDirection: 'column', overflow: 'hidden',
                    },
                },
                    // Search box
                    h('div', { style: { padding: '8px 8px 6px', flexShrink: 0 } },
                        h('input', {
                            value: query, onChange: e => setQuery(e.target.value),
                            placeholder: rii.searchPlaceholder,
                            autoFocus: true,
                            style: {
                                width: '100%', boxSizing: 'border-box', height: 26,
                                backgroundColor: c.panel, color: c.text,
                                border: `1px solid ${c.border}`, borderRadius: 3,
                                fontSize: 12, padding: '0 8px', outline: 'none',
                            },
                        })
                    ),

                    // Loading / error states
                    catalogLoading && h('div', {
                        style: { padding: '10px 12px', color: c.textDim, fontSize: 12 },
                    }, rii.loading),

                    loadErr && h('div', {
                        style: { padding: '10px 12px', color: '#ec7063', fontSize: 12 },
                    }, rii.loadError + ': ' + loadErr),

                    // Search: no results
                    !catalogLoading && !loadErr && !browsing && results.length === 0 && h('div', {
                        style: { padding: '10px 12px', color: c.textDim, fontSize: 12 },
                    }, rii.noResults),

                    // Scrollable list area
                    !catalogLoading && !loadErr && h('div', { style: { flex: 1, overflowY: 'auto' } },

                        // BROWSE MODE — shelf/book/page tree
                        browsing && catalogTree && catalogTree.map(shelf => shelfRow(shelf)),

                        // SEARCH MODE — flat results
                        !browsing && results.map((r, i) => {
                            const active = selected?.dataPath === r.dataPath;
                            return h('div', {
                                key: r.dataPath + ':' + i,
                                onClick: () => handleSelectResult(r),
                                style: {
                                    padding: '5px 10px', cursor: 'pointer',
                                    borderBottom: `1px solid ${c.border}44`,
                                    backgroundColor: active ? c.accent + '22' : 'transparent',
                                    borderLeft: `2px solid ${active ? c.accent : 'transparent'}`,
                                },
                            },
                                h('div', {
                                    style: { fontSize: 12, fontWeight: 600,
                                             color: active ? c.accent : c.text,
                                             overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                                }, r.bookName),
                                h('div', {
                                    style: { fontSize: 11, color: c.textDim,
                                             overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                                }, r.pageName + ' · ' + r.shelfName)
                            );
                        })
                    )
                ),

                // Right panel
                h('div', { style: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' } },

                    !selected && h('div', {
                        style: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                 color: c.textDim, fontSize: 13, fontStyle: 'italic' },
                    }, rii.selectMaterial),

                    selected && matLoading && h('div', {
                        style: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                 color: c.textDim, fontSize: 13 },
                    }, rii.loadingMaterial),

                    selected && matErr && h('div', {
                        style: { flex: 1, padding: 16, color: '#ec7063', fontSize: 12 },
                    }, matErr),

                    selected && mat && !matLoading && h('div', {
                        style: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
                    },
                        // Info grid
                        h('div', {
                            style: {
                                padding: '10px 14px 6px', flexShrink: 0,
                                display: 'grid', gridTemplateColumns: 'auto 1fr',
                                gap: '3px 14px', fontSize: 12,
                            },
                        },
                            h('span', { style: { color: c.textDim } }, rii.book),
                            h('span', { style: { color: c.text, fontWeight: 600 } }, selected.bookName),
                            h('span', { style: { color: c.textDim } }, rii.page),
                            h('span', { style: { color: c.text } }, selected.pageName),
                            h('span', { style: { color: c.textDim } }, rii.type),
                            h('span', { style: { color: c.text } }, typeLabel(mat.type)),
                            h('span', { style: { color: c.textDim } }, rii.wavelengthRange),
                            h('span', { style: { color: c.text } }, wlRange(mat)),
                        ),

                        // References
                        mat.references && h('div', {
                            style: {
                                padding: '0 14px 6px', flexShrink: 0,
                                fontSize: 11, color: c.textDim, lineHeight: 1.5,
                                maxHeight: 52, overflow: 'hidden',
                            },
                        }, mat.references.length > 280 ? mat.references.slice(0, 280) + '…' : mat.references),

                        // Chart
                        h('div', { ref: chartRef, style: { flex: 1, minHeight: 160 } }),

                        // Action bar
                        h('div', {
                            style: {
                                padding: '8px 14px', borderTop: `1px solid ${c.border}`,
                                flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8,
                            },
                        },
                            phase === 'ok'    && h('span', { style: { fontSize: 12, color: '#58d68d' } }, addMsg),
                            phase === 'error' && h('span', { style: { fontSize: 12, color: '#ec7063' } }, addMsg),

                            phase === 'picking' && [
                                h('span', { key: 'lbl', style: { fontSize: 12, color: c.textDim } }, rii.catalogLabel),
                                h('select', {
                                    key: 'sel',
                                    value: targetCatId, onChange: e => setTargetCatId(e.target.value),
                                    style: {
                                        flex: 1, height: 24, backgroundColor: c.panel, color: c.text,
                                        border: `1px solid ${c.border}`, borderRadius: 3, fontSize: 12,
                                    },
                                },
                                    userCatalogs.map(cat =>
                                        h('option', { key: cat.id, value: cat.id }, cat.name)
                                    ),
                                    h('option', { key: '__new__', value: '__new__' }, rii.newCatalogOption)
                                ),
                                h('button', {
                                    key: 'add',
                                    onClick: () => doAdd(targetCatId),
                                    style: {
                                        padding: '3px 12px', fontSize: 12,
                                        backgroundColor: c.accent, color: '#fff',
                                        border: 'none', borderRadius: 3, cursor: 'pointer',
                                    },
                                }, rii.addButton),
                                h('button', {
                                    key: 'cancel',
                                    onClick: () => setPhase('idle'),
                                    style: {
                                        padding: '3px 10px', fontSize: 12, backgroundColor: c.panel,
                                        color: c.text, border: `1px solid ${c.border}`,
                                        borderRadius: 3, cursor: 'pointer',
                                    },
                                }, rii.cancel),
                            ],

                            (phase === 'idle' || phase === 'ok') && h('button', {
                                onClick: handleAddClick,
                                style: {
                                    marginLeft: 'auto', padding: '4px 16px', fontSize: 12,
                                    backgroundColor: c.accent, color: '#fff',
                                    border: 'none', borderRadius: 3, cursor: 'pointer',
                                },
                            }, rii.addToCatalog),
                        )
                    )
                )
            )
        )
    );
}
