/**
 * MaterialPicker — custom material selector dropdown with catalog browser and search.
 *
 * Replaces the native <select> MaterialSelect. Supports both legacy builtin IDs
 * (e.g. 'BK7') and compound catalog IDs (e.g. 'schott:N-BK7').
 */

import { getCatalogs, getMaterialById, searchMaterials, normalizeId, materialLabel, ndColor, resolveColor } from '../../utils/materials/catalogManager.js';

const { createElement: h, useState, useEffect, useRef, useCallback } = React;

// ── helpers ───────────────────────────────────────────────────────────────────

function dotStyle(color) {
    return {
        width: 9, height: 9, borderRadius: '50%',
        backgroundColor: color || '#888', flexShrink: 0,
        display: 'inline-block', marginRight: 4
    };
}

// ── MaterialPicker ────────────────────────────────────────────────────────────

/**
 * @param {string}   value       current material ID (legacy or compound)
 * @param {function} onChange    called with new compound material ID
 * @param {object}   c           color palette
 * @param {object}   t           locale
 * @param {boolean}  [compact]   true = narrow trigger (layer rows), false = full-width (media rows)
 */
export function MaterialPicker({ value, onChange, c, t, compact }) {
    const [open,      setOpen]     = useState(false);
    const [query,     setQuery]    = useState('');
    const [catFilter, setCatFilter]= useState('all');
    const [catalogs,  setCatalogs] = useState([]);

    const triggerRef = useRef(null);
    const dropRef    = useRef(null);
    const searchRef  = useRef(null);

    const mp = t.materialPicker;

    // Reload catalog list whenever dropdown opens
    useEffect(() => {
        if (open) {
            setCatalogs(getCatalogs());
            setTimeout(() => searchRef.current?.focus(), 0);
        } else {
            setQuery('');
        }
    }, [open]);

    // Close on click outside
    useEffect(() => {
        if (!open) return;
        const handler = (e) => {
            if (!dropRef.current?.contains(e.target) && !triggerRef.current?.contains(e.target)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    // Close on Escape
    useEffect(() => {
        if (!open) return;
        const handler = (e) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [open]);

    const resolvedId = value || 'builtin:Air';
    const mat = getMaterialById(resolvedId) || getMaterialById('builtin:Air');
    const dotColor = mat ? resolveColor(mat) : '#888';
    const label = mat ? (mat.name || materialLabel(resolvedId)) : materialLabel(resolvedId);

    // Dropdown position from trigger — flips upward when near the bottom of the viewport
    const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 0, maxH: 320 });
    const handleOpen = () => {
        if (triggerRef.current) {
            const r = triggerRef.current.getBoundingClientRect();
            const dropWidth = Math.max(r.width, 240);
            const spaceBelow = window.innerHeight - r.bottom - 4;
            const spaceAbove = r.top - 4;
            const flipUp = spaceBelow < 220 && spaceAbove > spaceBelow;
            const maxH = flipUp
                ? Math.min(320, Math.max(120, spaceAbove))
                : Math.min(320, Math.max(120, spaceBelow));
            const top = flipUp ? r.top - 2 - maxH : r.bottom + 2;
            const left = Math.min(r.left, window.innerWidth - dropWidth - 4);
            setDropPos({ top, left, width: dropWidth, maxH });
        }
        setOpen(true);
    };

    const results = searchMaterials(query, catFilter === 'all' ? null : catFilter);

    const select = (compoundId) => {
        onChange(compoundId);
        setOpen(false);
    };

    // ── Trigger button ────────────────────────────────────────────────────────
    const trigger = h('div', {
        ref: triggerRef,
        onClick: handleOpen,
        style: {
            display: 'flex', alignItems: 'center',
            flex: compact ? undefined : 1,
            minWidth: compact ? 80 : 0,
            height: 22, padding: '0 4px',
            backgroundColor: c.panel, color: c.text,
            border: `1px solid ${open ? c.accent : c.border}`, borderRadius: 3,
            fontSize: 12, fontFamily: 'system-ui, -apple-system, sans-serif',
            cursor: 'pointer', userSelect: 'none', gap: 4, overflow: 'hidden'
        }
    },
        h('span', { style: dotStyle(dotColor) }),
        h('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, label),
        h('span', { style: { color: c.textDim, fontSize: 10, flexShrink: 0 } }, '▾')
    );

    if (!open) return trigger;

    // ── Dropdown overlay ──────────────────────────────────────────────────────
    const dropdown = h('div', {
        ref: dropRef,
        style: {
            position: 'fixed', zIndex: 9999,
            top: dropPos.top, left: dropPos.left, width: dropPos.width,
            maxHeight: dropPos.maxH, display: 'flex', flexDirection: 'column',
            backgroundColor: c.bg, border: `1px solid ${c.accent}`,
            borderRadius: 4, boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            overflow: 'hidden'
        }
    },
        // Search input
        h('div', { style: { padding: '4px 6px', borderBottom: `1px solid ${c.border}` } },
            h('input', {
                ref: searchRef,
                value: query,
                onChange: (e) => setQuery(e.target.value),
                placeholder: mp.searchPlaceholder,
                style: {
                    width: '100%', height: 22, boxSizing: 'border-box',
                    backgroundColor: c.panel, color: c.text,
                    border: `1px solid ${c.border}`, borderRadius: 3,
                    fontSize: 12, padding: '0 6px', outline: 'none'
                }
            })
        ),
        // Catalog filter tabs
        catalogs.length > 1 && h('div', {
            style: {
                display: 'flex', gap: 2, padding: '3px 6px',
                borderBottom: `1px solid ${c.border}`, flexWrap: 'wrap'
            }
        },
            h('button', {
                onClick: () => setCatFilter('all'),
                style: catTabStyle(catFilter === 'all', c)
            }, mp.allCatalogs),
            catalogs.map(cat =>
                h('button', {
                    key: cat.id,
                    onClick: () => setCatFilter(cat.id),
                    style: catTabStyle(catFilter === cat.id, c)
                }, cat.name)
            )
        ),
        // Material list
        h('div', { style: { flex: 1, overflowY: 'auto' } },
            results.length === 0
                ? h('div', { style: { padding: '12px 8px', color: c.textDim, fontSize: 12, textAlign: 'center' } },
                    'No materials found')
                : results.map(({ catalogId, catalogName, material }) => {
                    const compId = `${catalogId}:${material.id}`;
                    const isActive = resolvedId === compId ||
                        (resolvedId === `builtin:${material.id}` && catalogId === 'builtin') ||
                        (value === material.id && catalogId === 'builtin');
                    const mc = resolveColor(material);
                    return h('div', {
                        key: compId,
                        onClick: () => select(compId),
                        style: {
                            display: 'flex', alignItems: 'center', gap: 6,
                            padding: '3px 8px', cursor: 'pointer',
                            backgroundColor: isActive ? c.accent + '33' : 'transparent',
                            color: isActive ? c.accent : c.text, fontSize: 12,
                        },
                        onMouseEnter: (e) => { e.currentTarget.style.backgroundColor = c.hover; },
                        onMouseLeave: (e) => { e.currentTarget.style.backgroundColor = isActive ? c.accent + '33' : 'transparent'; }
                    },
                        h('span', { style: dotStyle(mc) }),
                        h('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                            material.name || material.id),
                        catalogId !== 'builtin' && h('span', {
                            style: { fontSize: 10, color: c.textDim, flexShrink: 0 }
                        }, catalogName)
                    );
                })
        )
    );

    return h(React.Fragment, null, trigger, dropdown);
}

function catTabStyle(active, c) {
    return {
        padding: '1px 7px', fontSize: 11,
        border: `1px solid ${active ? c.accent : c.border}`,
        borderRadius: 3,
        backgroundColor: active ? c.accent + '33' : 'transparent',
        color: active ? c.accent : c.textDim,
        cursor: 'pointer', outline: 'none',
        fontFamily: 'system-ui, -apple-system, sans-serif'
    };
}
