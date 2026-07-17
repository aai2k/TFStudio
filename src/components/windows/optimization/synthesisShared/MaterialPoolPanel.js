import { Checkbox } from '../../../ui/Checkbox.js';
import { WARN_BADGE_STYLE, matColor } from './materialColors.js';
import { POOL_WARN_COUNT } from './catalogPool.js';

const { createElement: h } = React;   // React is a window global (never imported)

// Materials of a catalog eligible to appear in the pool (Air/Vacuum hidden,
// matching getPoolMaterials). `name` is the editable display label.
const matEntries = (cat) => Object.entries(cat.materials || {})
    .filter(([k]) => k !== 'Air' && k !== 'Vacuum')
    .map(([k, m]) => ({
        fullId: cat.id === 'builtin' ? k : `${cat.id}:${k}`,
        name: (m && m.name) || k,
    }));

function MiniBtn({ label, onClick, running, c }) {
    return h('button', {
        onClick, disabled: running,
        style: {
            padding: '1px 8px', fontSize: 10, borderRadius: 2,
            background: 'transparent', color: running ? c.textDim : c.text,
            border: `1px solid ${c.border}`, cursor: running ? 'default' : 'pointer',
            fontFamily: 'inherit', opacity: running ? 0.5 : 1,
        }
    }, label);
}

// One material checkbox row inside an expanded catalog, with the same color
// swatch the Material Editor shows for it.
function PoolMaterialRow({ m, matOn, running, c, onToggle }) {
    return h('label', {
        style: {
            display: 'flex', alignItems: 'center', gap: 6, padding: '1px 0', minWidth: 0,
            cursor: running ? 'default' : 'pointer', fontSize: 11, userSelect: 'none',
        }
    },
        h(Checkbox, { c, checked: matOn, disabled: running, onChange: () => !running && onToggle() }),
        h('span', { style: {
            width: 9, height: 9, borderRadius: '50%', flexShrink: 0,
            background: matColor(m.fullId), opacity: matOn ? 1 : 0.4,
        } }),
        h('span', {
            style: { color: matOn ? c.text : c.textDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
            title: m.name,
        }, m.name)
    );
}

// One catalog row: expand toggle (when per-material picking is wired), the
// catalog checkbox (indeterminate when only some materials are active) and, when
// open, the per-material sub-list.
function CatalogRow({ cat, selectedCats, excluded, isOpen, canPickMat, running, c, onToggleCat, onToggleMat, onToggleExpand }) {
    const mats      = matEntries(cat);
    const total     = mats.length;
    const exclCount = mats.reduce((n, m) => n + (excluded.has(m.fullId) ? 1 : 0), 0);
    const checked   = selectedCats.has(cat.id);
    const indeterminate = checked && exclCount > 0 && exclCount < total;
    const count = (checked && exclCount > 0) ? `(${total - exclCount}/${total})` : `(${total})`;

    return h('div', null,
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 4, padding: '2px 0' } },
            (canPickMat && total > 0)
                ? h('button', {
                    onClick: () => onToggleExpand(cat.id),
                    style: {
                        background: 'transparent', border: 'none', cursor: 'pointer',
                        color: c.textDim, fontSize: 10, width: 12, padding: 0, lineHeight: 1,
                        fontFamily: 'inherit',
                    }
                  }, isOpen ? '▾' : '▸')
                : h('span', { style: { width: 12, display: 'inline-block', flexShrink: 0 } }),
            h('label', {
                style: {
                    display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0,
                    cursor: running ? 'default' : 'pointer', fontSize: 12, userSelect: 'none',
                }
            },
                h(Checkbox, {
                    c, checked, disabled: running, indeterminate,
                    onChange: () => !running && onToggleCat(cat.id, mats.map(m => m.fullId)),
                }),
                h('span', {
                    style: { color: checked ? c.text : c.textDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                    title: cat.name,
                },
                    cat.name, ' ',
                    h('span', { style: { color: c.textDim, fontSize: 10 } }, count)
                )
            )
        ),
        isOpen && h('div', { style: { paddingLeft: 18 } },
            total
                ? mats.map(m => h(PoolMaterialRow, {
                    key: m.fullId, m, running, c,
                    matOn: checked && !excluded.has(m.fullId),
                    onToggle: () => onToggleMat(cat.id, m.fullId, mats.map(x => x.fullId)),
                  }))
                : h('div', { style: { fontSize: 10, color: c.textDim, fontStyle: 'italic', padding: '1px 0' } }, '—')
        )
    );
}

// ── Shared material-pool panel ──────────────────────────────────────────────────
// Catalog-checkbox list + All/Clear header, shared by the synthesis windows.
// The three header labels come from the caller via `labels` so each window can
// use its own locale namespace.
export function MaterialPoolPanel({ catalogs, selectedCats, onToggleCat,
                                    onSelectAllCats, onClearCats,
                                    excludedMats, onToggleMat, running, c, labels, warnLabel }) {
    const { useState } = React;
    const [expanded, setExpanded] = useState(() => new Set());
    const excluded   = excludedMats || new Set();
    const canPickMat = typeof onToggleMat === 'function';   // gracefully no-op if a window hasn't wired it

    const toggleExpand = (id) => setExpanded(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });

    const selectedCount = catalogs.reduce((sum, cat) =>
        selectedCats.has(cat.id)
            ? sum + matEntries(cat).reduce((n, m) => n + (excluded.has(m.fullId) ? 0 : 1), 0)
            : sum, 0);

    return h('div', {
        style: {
            padding: '6px 8px', borderBottom: `1px solid ${c.border}`,
            flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column'
        }
    },
        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 } },
            h('div', {
                style: { fontSize: 10, fontWeight: 700, color: c.textDim, textTransform: 'uppercase', letterSpacing: '0.05em' }
            }, labels.materialPool),
            h('div', { style: { display: 'flex', gap: 4 } },
                h(MiniBtn, { label: labels.poolAll,   onClick: () => !running && onSelectAllCats && onSelectAllCats(), running, c }),
                h(MiniBtn, { label: labels.poolClear, onClick: () => !running && onClearCats && onClearCats(), running, c }),
            )
        ),
        (warnLabel && selectedCount > POOL_WARN_COUNT) && h('div', {
            style: { ...WARN_BADGE_STYLE, display: 'block', whiteSpace: 'normal', marginBottom: 5, lineHeight: 1.3 },
        }, warnLabel(selectedCount)),
        catalogs.map(cat => h(CatalogRow, {
            key: cat.id, cat, selectedCats, excluded, canPickMat, running, c,
            isOpen: canPickMat && expanded.has(cat.id),
            onToggleCat, onToggleMat, onToggleExpand: toggleExpand,
        }))
    );
}
