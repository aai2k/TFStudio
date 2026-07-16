/**
 * RIIBrowser — left panel: search box, offline status/update bar, and the
 * browse (shelf/book/page tree) or search (flat results) list.
 */

import { shelfRow } from './riiTree.js';

const { createElement: h } = React;

export function renderStatusBar(s) {
    const { c, rii, dbStatus, updateMsg, updating, handleUpdate } = s;
    return h('div', {
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
    );
}

function renderSearchResultRow(r, s) {
    const { c, selected, handleSelectResult } = s;
    const active = selected?.dataPath === r.dataPath;
    return h('div', {
        key: r.dataPath,
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
}

function renderListArea(s) {
    const { catalogLoading, loadErr, browsing, catalogTree, results, showNoResults, rii, c } = s;
    if (catalogLoading || loadErr) return null;
    return h('div', { style: { flex: 1, overflowY: 'auto' } },
        showNoResults && h('div', { style: { padding: '10px 12px', color: c.textDim, fontSize: 12 } }, rii.noResults),
        // BROWSE MODE — shelf/book/page tree
        browsing && catalogTree && catalogTree.map(shelf => shelfRow(shelf, s)),
        // SEARCH MODE — flat results
        !browsing && results.map(r => renderSearchResultRow(r, s))
    );
}

export function renderRiiLeftPanel(s) {
    const { c, rii, query, setQuery, catalogLoading, loadErr } = s;
    return h('div', {
        style: {
            width: 290, borderRight: `1px solid ${c.border}`,
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
        },
    },
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
        catalogLoading && h('div', { style: { padding: '10px 12px', color: c.textDim, fontSize: 12 } }, rii.loading),
        loadErr && h('div', { style: { padding: '10px 12px', color: '#ec7063', fontSize: 12 } }, rii.loadError + ': ' + loadErr),
        renderListArea(s)
    );
}
