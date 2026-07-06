/**
 * Shared helpers for the synthesis windows.
 *
 * These pure helpers were byte-identical copies in NeedleVariation.js and
 * GradualEvolution.js. Two that differed only in a parameter are parameterized
 * here so each window keeps its EXACT prior behavior:
 *   - getPoolMaterials(ids, { verbose }) — Needle logged pool diagnostics, GE
 *     was quiet → gated behind `verbose` (Needle passes true).
 *   - load/saveCatSelection(key, …) — distinct localStorage keys per window
 *     (`tfstudio_needle_selectedCats` vs `tfstudio_ge_selectedCats`).
 *
 * Refinement.js is intentionally NOT wired through this module: its
 * densifyForRun() uses a slightly different debug-log string, so folding it in
 * would change its console output. Its resolveMat is identical but left in place
 * to keep the most-validated file untouched in this increment.
 */

import { getMaterial } from '../../utils/materials/materialDatabase.js';
import { getMaterialById, getCatalogs, resolveColor } from '../../utils/materials/catalogManager.js';
import {
    resolveScanSide,
    densifyOperandsForFeatures, ADAPTIVE_SAMPLING_DEFAULTS,
} from '../../utils/physics/optimizer.js';
import { generateARSeeds } from '../../utils/synthesis/seedGenerator.js';
import { getThreadCount } from '../../utils/synthesis/synthesisConfig.js';
import { Checkbox } from '../ui/Checkbox.js';

const { createElement: h } = React;   // React is a window global (never imported)

// ── Shared "blocking warning" badge ─────────────────────────────────────────────
// Used by every optimizer/synthesis window (Refinement, Needle, Gradual
// Evolution, Structural, Needle Manual) so a blocking message — e.g. an empty
// merit function — looks IDENTICAL everywhere. Amber text on a faint amber wash
// reads clearly on all (dark) theme panels, unlike the old brown-on-brown
// reason pill. Spread it and add positioning (marginLeft) at the call site.
export const WARN_BADGE_STYLE = {
    fontSize: 11, padding: '2px 9px', borderRadius: 4,
    background: '#ffb74d22', color: '#ffb74d', border: '1px solid #ffb74d66',
    fontWeight: 600, fontStyle: 'normal', whiteSpace: 'nowrap',
};

// ── Surface-mode-aware active synthesis side ────────────────────────────────────
// For both_independent the UI selector (when added) drives this; default 'front'.
export const sideKeyFor = (d) =>
    resolveScanSide(d?.surfaceMode || 'front_only', 'front') === 'back'
        ? 'backLayers' : 'frontLayers';
export const activeSide = (d) => resolveScanSide(d?.surfaceMode || 'front_only', 'front');

// ── Adaptive merit sampling ─────────────────────────────────────────────────────
// Densify band-sampled operands whose bands hide a sub-grid spectral feature at
// launch so the synthesis merit isn't blind to narrow resonances. Densified
// operands feed BOTH requiredLambdas and the worker scan/refine jobs →
// byte-identical λ-grid contract preserved.
export function densifyForRun(ops, design) {
    return densifyOperandsForFeatures(ops, design, resolveMat, ADAPTIVE_SAMPLING_DEFAULTS, ({ bumped, capped }) =>
        console.log(`[Adaptive] densified ${bumped} operand(s) for narrow features`
            + (capped ? ` (${capped} capped at ${ADAPTIVE_SAMPLING_DEFAULTS.maxPoints} pts)` : '')));
}

// Smallest OMF (optical merit, display only) across synthesis generations;
// null when no generation carries one. Used to show "best OMF" alongside the
// best MF in the synthesis control bars (the best ROW is still chosen by MF).
export function minOmfOf(gens) {
    let m = Infinity;
    for (const g of (gens || [])) if (g && g.omf != null && g.omf < m) m = g.omf;
    return Number.isFinite(m) ? m : null;
}

// Split an array into `k` ~equal contiguous chunks (drops empties).
export function chunkArray(arr, k) {
    const out = [];
    const n = Math.max(1, Math.ceil(arr.length / k));
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out.length ? out : [[]];
}

// Worker-pool size = the user's global Threads setting (detected-core default
// that leaves the main thread + headroom free; see getThreadCount). Was a fixed
// clamp(hw-1, 2, 8); now user-controllable and unshy on many-core CPUs.
export function poolSize() {
    return getThreadCount();
}

// ── Material helpers ────────────────────────────────────────────────────────────

export function resolveMat(id) {
    if (!id) return getMaterial('Air');
    return getMaterialById(id) || getMaterial(id) || getMaterial('Air');
}

export function matDisplayName(id) {
    if (!id) return '';
    const parts = id.split(':');
    return parts[parts.length - 1];
}

// Human-readable material name for DISPLAY (history badges, top designs).
// A material's *id* is a sanitized, immutable key (e.g. "TiO2_2"); its *name*
// is the editable label shown in the Material Editor. Renaming a material in
// the editor intentionally does NOT change its id — that key is referenced by
// every saved design and catalog entry, so mutating it would silently break
// them. We therefore resolve the live `.name` wherever a material is shown to
// the user; it then tracks renames automatically. Falls back to the id segment
// for materials no longer in any catalog.
export function matFriendlyName(id) {
    if (!id) return '';
    const mat = getMaterialById(id);
    if (mat && mat.name) return mat.name;
    return matDisplayName(id);
}

export const MAT_COLORS = {
    TiO2: '#e53935', SiO2: '#1e88e5', Ta2O5: '#8e24aa', Nb2O5: '#43a047',
    HfO2: '#fb8c00', Al2O3: '#00acc1', ZnS:   '#fdd835', ZnSe:  '#f06292',
    Si:   '#546e7a', Ge:    '#78909c', MgF2:  '#80cbc4', ITO:   '#aed581',
    Au:   '#ffd54f', Ag:    '#b0bec5', Cr:    '#8d6e63', BK7:   '#ab47bc',
};

// HSL → "#rrggbb" for the hashed fallback (used only when a material is no
// longer in any catalog).
function hslToHex(hDeg, s, l) {
    s /= 100; l /= 100;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => {
        const k = (n + hDeg / 30) % 12;
        const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
        return Math.round(255 * v).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
}

// THE material's display color — the SAME one shown in the Material Editor and
// Design Editor: the user-chosen `color`, else an index-derived `ndColor(nd)`.
// Synthesis history/pool now share this so a material looks identical everywhere.
// Falls back to the old built-in palette / id-hash only for a material that is
// no longer in any catalog (can't resolve a real color).
export function matColor(id) {
    const mat = getMaterialById(id);
    if (mat) return resolveColor(mat);
    const name = matDisplayName(id);
    if (MAT_COLORS[name]) return MAT_COLORS[name];
    let h = 0;
    for (let i = 0; i < (id || '').length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return hslToHex((h * 137) % 360, 65, 55);
}

// Translucent wash of a material's color for the history badge background.
// Must accept ANY CSS color the editor can produce — hex (#rgb / #rrggbb), the
// hsl() that ndColor returns, or a named color — so it parses to rgba/hsla with
// the given alpha instead of the old (fragile, hex-only) `${color}44` trick.
export function matColorAlpha(id, alpha = 0.27) {
    const color = matColor(id);
    let m = /^#([0-9a-f]{3})$/i.exec(color);
    if (m) {
        const [r, g, b] = [...m[1]].map(ch => parseInt(ch + ch, 16));
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    m = /^#([0-9a-f]{6})$/i.exec(color);
    if (m) {
        const h = m[1];
        const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    m = /^hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)$/i.exec(color);
    if (m) return `hsla(${m[1]}, ${m[2]}%, ${m[3]}%, ${alpha})`;
    return color;   // unknown format → solid color (still visible)
}

// ── Smart-seed generation (canonical QW/HW AR starting designs) ──────────────────
// Macleod ("Automatic Design"): synthesis works best from "a very good starting
// design", and needle/GE struggle to discover compact classics like the 3-layer
// quarter–half–quarter AR (its half-wave layer is absentee at λ0 → ~zero needle
// sensitivity). This builds the canonical QW/HW AR templates from the pool; the
// caller refines them OFF-THREAD on its worker pool and starts from the best.
//
// Candidate STARTING-design stacks for the in-run "smart seed" step.
// Returns the canonical QW/HW AR seeds AND the current design (placed
// FIRST so it is always in the running) as plain {name, frontLayers, backLayers}
// entries — NO refinement here. The caller refines every candidate OFF-THREAD on
// its existing worker pool and starts synthesis from the best, so the seed step
// never blocks the UI and can only match or improve the current starting point.
export function buildARSeedCandidates({ design, pool, maxLayers = Infinity }) {
    const lambda0 = design?.referenceWavelength || 550;
    const seeds = generateARSeeds({ pool, lambda0, baseDesign: design, maxLayers });
    const out = [{
        name: 'current',
        frontLayers: (design?.frontLayers || []).map(l => ({ ...l })),
        backLayers:  (design?.backLayers  || []).map(l => ({ ...l })),
    }];
    for (const s of seeds) {
        out.push({ name: s.name, frontLayers: s.frontLayers, backLayers: s.design.backLayers || [] });
    }
    return out;
}

// ── Catalog-selection persistence (localStorage; key per window) ─────────────────
export function loadSavedCatSelection(key) {
    try {
        const raw = localStorage.getItem(key);
        if (raw) return new Set(JSON.parse(raw));
    } catch (_) {}
    return null;
}

export function saveCatSelection(key, set) {
    try { localStorage.setItem(key, JSON.stringify([...set])); } catch (_) {}
}

// ── Catalog-selection state hook ────────────────────────────────────────────────
// The selectedCats useState (initialized from localStorage, filtered to existing
// catalogs), its mirror ref, and the toggle/all/clear handlers were identical in
// Needle+GE apart from the localStorage key. Returns `selectedCatsRef` so the run
// loop can read the latest selection synchronously (as both windows did).
export function useCatSelection(storageKey) {
    const { useState, useRef, useEffect, useCallback } = React;
    const [selectedCats, setSelectedCats] = useState(() => {
        const saved  = loadSavedCatSelection(storageKey);
        const allIds = new Set(getCatalogs().map(c => c.id));
        if (!saved) return allIds;
        const filtered = new Set([...allIds].filter(id => saved.has(id)));
        return filtered.size > 0 ? filtered : allIds;
    });
    const selectedCatsRef = useRef(selectedCats);
    useEffect(() => { selectedCatsRef.current = selectedCats; }, [selectedCats]);

    // Per-material deselection within selected catalogs (pool drill-down).
    // Stored as the set of EXCLUDED full material ids so the default (nothing
    // excluded) means "all materials of every selected catalog" — backward
    // compatible with the old catalog-only behavior. Separate localStorage key.
    const exclKey = storageKey + '_excl';
    const [excludedMats, setExcludedMats] = useState(() => loadSavedCatSelection(exclKey) || new Set());
    const excludedMatsRef = useRef(excludedMats);
    useEffect(() => { excludedMatsRef.current = excludedMats; }, [excludedMats]);

    // Toggling a catalog is an "all or nothing" action for its materials, so it
    // also clears that catalog's per-material exclusions (checked → every material
    // in play; unchecked → clean slate).
    const handleToggleCat = useCallback((catId, catMatIds = []) => {
        const nextCats = new Set(selectedCatsRef.current);
        if (nextCats.has(catId)) nextCats.delete(catId); else nextCats.add(catId);
        const nextExcl = new Set(excludedMatsRef.current);
        for (const id of catMatIds) nextExcl.delete(id);
        selectedCatsRef.current = nextCats; excludedMatsRef.current = nextExcl;
        saveCatSelection(storageKey, nextCats); saveCatSelection(exclKey, nextExcl);
        setSelectedCats(nextCats); setExcludedMats(nextExcl);
    }, []);
    // All/Clear act on whole catalogs AND wipe per-material exclusions, so each
    // is an unambiguous reset ("All" really means every material is in play).
    const handleSelectAllCats = useCallback(() => {
        const next = new Set(getCatalogs().map(cat => cat.id));
        selectedCatsRef.current = next; saveCatSelection(storageKey, next); setSelectedCats(next);
        const none = new Set();
        excludedMatsRef.current = none; saveCatSelection(exclKey, none); setExcludedMats(none);
    }, []);
    const handleClearCats = useCallback(() => {
        const next = new Set();
        selectedCatsRef.current = next; saveCatSelection(storageKey, next); setSelectedCats(next);
        const none = new Set();
        excludedMatsRef.current = none; saveCatSelection(exclKey, none); setExcludedMats(none);
    }, []);

    // Toggle one material's membership. A material lives inside a catalog, but the
    // user can pick individual materials from a catalog whose box is unchecked:
    // turning one on selects the catalog and excludes every OTHER material, so only
    // the chosen one is in play. Turning the last remaining material off collapses
    // the catalog back to unchecked.
    const handleToggleMat = useCallback((catId, fullId, catMatIds = []) => {
        const nextCats = new Set(selectedCatsRef.current);
        const nextExcl = new Set(excludedMatsRef.current);
        if (!nextCats.has(catId)) {
            nextCats.add(catId);
            for (const id of catMatIds) { if (id === fullId) nextExcl.delete(id); else nextExcl.add(id); }
        } else {
            if (nextExcl.has(fullId)) nextExcl.delete(fullId); else nextExcl.add(fullId);
            if (catMatIds.length && catMatIds.every(id => nextExcl.has(id))) {
                for (const id of catMatIds) nextExcl.delete(id);
                nextCats.delete(catId);
            }
        }
        selectedCatsRef.current = nextCats; excludedMatsRef.current = nextExcl;
        saveCatSelection(storageKey, nextCats); saveCatSelection(exclKey, nextExcl);
        setSelectedCats(nextCats); setExcludedMats(nextExcl);
    }, []);

    return { selectedCats, setSelectedCats, selectedCatsRef,
             handleToggleCat, handleSelectAllCats, handleClearCats,
             excludedMats, excludedMatsRef, handleToggleMat };
}

// Above this many candidate materials the pool panel warns that scans may be slow.
export const POOL_WARN_COUNT = 200;
// Hard ceiling for single-threaded scans (Needle Manual): past this the profile
// scan runs long enough on the UI thread to freeze/crash the renderer, so it is
// refused rather than attempted.
export const POOL_MAX_SYNC = 400;

// Count of eligible candidate materials in the selected catalogs (Air/Vacuum and
// user-excluded ids removed). Deliberately skips the getNK(n<1.05) filter that
// getPoolMaterials applies — an upper-bound estimate is all the size guards need,
// and it stays cheap enough to run on every selection change.
export function countPoolMaterials(selectedCatalogIds, excluded = null) {
    let n = 0;
    for (const cat of getCatalogs()) {
        if (!selectedCatalogIds.has(cat.id)) continue;
        for (const key of Object.keys(cat.materials || {})) {
            if (key === 'Air' || key === 'Vacuum') continue;
            const fullId = cat.id === 'builtin' ? key : `${cat.id}:${key}`;
            if (excluded && excluded.has(fullId)) continue;
            n++;
        }
    }
    return n;
}

// ── Candidate material pool from the selected catalogs ───────────────────────────
// Skips Air/Vacuum and anything with n < 1.05 at 550 nm (can't act as a film).
// `verbose` mirrors NeedleVariation's original pool diagnostics; GE passes false.
export function getPoolMaterials(selectedCatalogIds, { verbose = false, excluded = null } = {}) {
    const result = [];
    const allCats = getCatalogs();
    if (verbose) {
        console.log(`[NeedlePool] selected IDs: [${[...selectedCatalogIds].join(', ')}]`,
            '  available:', allCats.map(c => `${c.id}(${Object.keys(c.materials || {}).length})`).join(', '));
    }
    for (const cat of allCats) {
        if (!selectedCatalogIds.has(cat.id)) continue;
        for (const [matKey] of Object.entries(cat.materials || {})) {
            if (matKey === 'Air' || matKey === 'Vacuum') continue;
            const fullId = cat.id === 'builtin' ? matKey : `${cat.id}:${matKey}`;
            if (excluded && excluded.has(fullId)) continue;   // user deselected this material in the pool panel
            const mat    = getMaterialById(fullId);
            if (!mat) continue;
            try {
                const nk = mat.getNK(550);
                const n  = Array.isArray(nk) ? nk[0] : (nk?.n ?? 1);
                if (typeof n === 'number' && n < 1.05) {
                    if (verbose) console.warn(`[NeedlePool] Skipping ${fullId}: n=${n} < 1.05 at 550 nm`);
                    continue;
                }
            } catch (err) {
                if (verbose) console.warn(`[NeedlePool] Skipping ${fullId}: getNK threw`, err);
                continue;
            }
            result.push({ id: fullId, mat, name: matDisplayName(fullId) });
        }
    }
    return result;
}

// ── Shared material-pool panel ──────────────────────────────────────────────────
// The catalog-checkbox + All/Clear header block was byte-identical in
// NeedleVariation.LeftSidebar and GradualEvolution.LeftSidebar except for the
// locale namespace of the three labels — passed in via `labels`. `miniBtn` was
// used ONLY by this block in both windows, so it moves in here.
export function MaterialPoolPanel({ catalogs, selectedCats, onToggleCat,
                                    onSelectAllCats, onClearCats,
                                    excludedMats, onToggleMat, running, c, labels, warnLabel }) {
    const { useState } = React;
    const [expanded, setExpanded] = useState(() => new Set());
    const excluded   = excludedMats || new Set();
    const canPickMat = typeof onToggleMat === 'function';   // gracefully no-op if a window hasn't wired it

    const miniBtn = (label, onClick) => h('button', {
        onClick, disabled: running,
        style: {
            padding: '1px 8px', fontSize: 10, borderRadius: 2,
            background: 'transparent', color: running ? c.textDim : c.text,
            border: `1px solid ${c.border}`, cursor: running ? 'default' : 'pointer',
            fontFamily: 'inherit', opacity: running ? 0.5 : 1,
        }
    }, label);

    const toggleExpand = (id) => setExpanded(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });

    // Materials of a catalog eligible to appear in the pool (Air/Vacuum hidden,
    // matching getPoolMaterials). `name` is the editable display label.
    const matEntries = (cat) => Object.entries(cat.materials || {})
        .filter(([k]) => k !== 'Air' && k !== 'Vacuum')
        .map(([k, m]) => ({
            fullId: cat.id === 'builtin' ? k : `${cat.id}:${k}`,
            name: (m && m.name) || k,
        }));

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
                miniBtn(labels.poolAll,   () => !running && onSelectAllCats && onSelectAllCats()),
                miniBtn(labels.poolClear, () => !running && onClearCats && onClearCats()),
            )
        ),
        (warnLabel && selectedCount > POOL_WARN_COUNT) && h('div', {
            style: { ...WARN_BADGE_STYLE, display: 'block', whiteSpace: 'normal', marginBottom: 5, lineHeight: 1.3 },
        }, warnLabel(selectedCount)),
        catalogs.map(cat => {
            const mats      = matEntries(cat);
            const total     = mats.length;
            const exclCount = mats.reduce((n, m) => n + (excluded.has(m.fullId) ? 1 : 0), 0);
            const checked   = selectedCats.has(cat.id);
            const isOpen    = canPickMat && expanded.has(cat.id);
            // some-but-not-all materials active → indeterminate catalog checkbox
            const indeterminate = checked && exclCount > 0 && exclCount < total;
            const count = (checked && exclCount > 0) ? `(${total - exclCount}/${total})` : `(${total})`;

            return h('div', { key: cat.id },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 4, padding: '2px 0' } },
                    (canPickMat && total > 0)
                        ? h('button', {
                            onClick: () => toggleExpand(cat.id),
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
                        ? mats.map(m => {
                            const matOn = checked && !excluded.has(m.fullId);
                            return h('label', {
                                key: m.fullId,
                                style: {
                                    display: 'flex', alignItems: 'center', gap: 6, padding: '1px 0', minWidth: 0,
                                    cursor: running ? 'default' : 'pointer', fontSize: 11, userSelect: 'none',
                                }
                            },
                                h(Checkbox, {
                                    c, checked: matOn, disabled: running,
                                    onChange: () => !running && onToggleMat(cat.id, m.fullId, mats.map(x => x.fullId)),
                                }),
                                // Same color swatch the Material Editor shows for this material.
                                h('span', { style: {
                                    width: 9, height: 9, borderRadius: '50%', flexShrink: 0,
                                    background: matColor(m.fullId), opacity: matOn ? 1 : 0.4,
                                } }),
                                h('span', {
                                    style: { color: matOn ? c.text : c.textDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                                    title: m.name,
                                }, m.name)
                            );
                        })
                        : h('div', { style: { fontSize: 10, color: c.textDim, fontStyle: 'italic', padding: '1px 0' } }, '—')
                )
            );
        })
    );
}

// ── Pareto front over synthesis generations ─────────────────────────────────────
// Designs not dominated in (layerCount, mf): a design survives unless another is no
// worse on both axes and strictly better on at least one. Sorted by layer count.
export function computePareto(gens) {
    return gens.filter(a =>
        !gens.some(b =>
            b !== a &&
            b.layerCount <= a.layerCount && b.mf <= a.mf &&
            (b.layerCount < a.layerCount || b.mf < a.mf)
        )
    ).sort((a, b) => a.layerCount - b.layerCount);
}

// ── Shared Top-Designs (Pareto front) panel ─────────────────────────────────────
// Lists the Pareto-optimal generations (best MF at each layer count). `genPrefix`
// labels the generation number ("Gen N" for needle/GE, "#N" for structural). The
// insert-material column renders per row only for generations that carry one.
export function TopDesignsPanel({ topDesigns, bestMF, onRestore, c, labels, genPrefix = 'Gen ' }) {
    if (!topDesigns.length) return null;
    return h('div', { style: {
        borderTop: `1px solid ${c.border}`, background: c.panel,
        flexShrink: 0, maxHeight: 140, display: 'flex', flexDirection: 'column',
    } },
        h('div', { style: {
            padding: '3px 8px', fontSize: 10, fontWeight: 700, color: c.textDim,
            textTransform: 'uppercase', letterSpacing: '0.05em',
            borderBottom: `1px solid ${c.border}`, flexShrink: 0,
        } }, labels.topDesigns),
        h('div', { style: { flex: 1, overflow: 'auto' } },
            h('table', { style: { borderCollapse: 'collapse', width: '100%' } },
                h('tbody', null,
                    topDesigns.map(gen => {
                        const isBest = Math.abs(gen.mf - bestMF) < 1e-12;
                        return h('tr', { key: gen.id },
                            h('td', { style: { padding: '2px 8px', fontSize: 11, color: c.textDim, width: 56 } },
                                `${genPrefix}${gen.genNum}`),
                            h('td', { style: { padding: '2px 8px', fontSize: 11, color: c.text, width: 60 } },
                                `${gen.layerCount} lyr`),
                            h('td', { style: { padding: '2px 8px', fontSize: 11, fontWeight: isBest ? 700 : 400, color: isBest ? c.success : c.text } },
                                gen.mf.toFixed(6)),
                            gen.insertMat && h('td', {
                                style: {
                                    padding: '2px 8px', fontSize: 10, color: c.textDim,
                                    maxWidth: 92, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                },
                                title: matFriendlyName(gen.insertMat),
                            }, matFriendlyName(gen.insertMat)),
                            h('td', { style: { padding: '2px 8px' } },
                                h('button', {
                                    onClick: () => onRestore(gen),
                                    style: {
                                        padding: '1px 7px', fontSize: 10, cursor: 'pointer',
                                        background: c.panel, color: c.text,
                                        border: `1px solid ${c.border}`, borderRadius: 2,
                                    }
                                }, labels.restore))
                        );
                    })
                )
            )
        )
    );
}

// ── Plotly chart lifecycle primitive ────────────────────────────────────────────
// Owns the Plotly lifecycle for the synthesis trend charts: newPlot-then-react, a
// ResizeObserver that re-fits the chart to its box on panel/docking resizes, and a
// purge on unmount. Callers supply `build()` (returns { traces, layout }, invoked
// inside the effect so it sees fresh closures) and a `deps` gate.
//
// The plot div stays mounted at all times and the "no data" message is an overlay,
// rather than swapping the div out when data clears. Swapping it out orphaned the
// initialized-flag, so the next run react()'d onto a div that was never newPlot'd
// and rendered blank until the tab was toggled. When `hasData` goes false the graph
// is purged and the flag reset so a fresh run always newPlot's cleanly.
export function PlotlyChart({ build, hasData, empty, deps = [], config, c }) {
    const { useRef, useEffect } = React;
    const divRef  = useRef(null);
    const initRef = useRef(false);
    const cfg = config || { responsive: true, displayModeBar: false };

    useEffect(() => {
        if (!divRef.current || typeof Plotly === 'undefined') return;
        if (!hasData) {
            if (initRef.current) {
                try { Plotly.purge(divRef.current); } catch (_) {}
                initRef.current = false;
            }
            return;
        }
        const { traces, layout } = build();
        if (!initRef.current) {
            Plotly.newPlot(divRef.current, traces, layout, cfg);
            initRef.current = true;
        } else {
            Plotly.react(divRef.current, traces, layout, cfg);
        }
    }, [hasData, ...deps]);   // eslint-disable-line react-hooks/exhaustive-deps

    // Re-fit on PANEL resize (responsive:true only listens to WINDOW resizes).
    useEffect(() => {
        const el = divRef.current;
        if (!el || typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver(() => {
            if (divRef.current && typeof Plotly !== 'undefined') {
                try { Plotly.Plots.resize(divRef.current); } catch (_) {}
            }
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    // Purge the graph on unmount so it doesn't leak per docking-tab switch.
    useEffect(() => () => {
        if (divRef.current && typeof Plotly !== 'undefined') {
            try { Plotly.purge(divRef.current); } catch (_) {}
        }
        initRef.current = false;
    }, []);

    return h('div', { style: { position: 'relative', width: '100%', height: '100%' } },
        h('div', { ref: divRef, style: { width: '100%', height: '100%' } }),
        !hasData && empty && h('div', {
            style: {
                position: 'absolute', inset: 0, display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                color: (c && c.textDim) || '#888', fontSize: 11, fontStyle: 'italic',
                pointerEvents: 'none',
            }
        }, empty)
    );
}

// ── Shared synthesis history table ──────────────────────────────────────────────
// Needle's GenerationsTable and GE's CyclesTable were ~identical: same th/td/
// sideBadge helpers and the same genNum/side/layers/mf/tot/time/dMF/material/
// restore columns. GE additionally shows a Needle/GE "type" badge column — passed
// in via the optional `typeColumn = { header, render(row) }` (inserted after the
// side column). Rows are reversed for display (newest first), matching both
// windows. `labels` carries the per-window locale strings.
export function SynthesisHistoryTable({ rows, bestMF, onRestore, showSide, c, labels, typeColumn = null }) {
    const th = (label, w) => h('th', {
        style: {
            padding: '2px 5px', fontSize: 10, fontWeight: 700, color: c.textDim,
            textTransform: 'uppercase', letterSpacing: '0.04em',
            position: 'sticky', top: 0, background: c.panel,
            borderBottom: `1px solid ${c.border}`,
            width: w, textAlign: 'left', whiteSpace: 'nowrap',
        }
    }, label);

    const td = (content, style = {}) =>
        h('td', { style: { padding: '2px 5px', fontSize: 11, whiteSpace: 'nowrap', ...style } }, content);

    const sideBadge = (side) => {
        if (!side) return '—';
        const isBack = side === 'back';
        return h('span', {
            style: {
                padding: '1px 6px', borderRadius: 3, fontSize: 10,
                background: isBack ? '#42a5f51a' : '#ffa72622',
                color: isBack ? '#42a5f5' : '#ffa726',
                fontWeight: 600,
            }
        }, isBack ? 'B' : 'F');
    };

    // Both the empty state and the table sit inside the flex:1 scroll container
    // (matches Needle's original; GE's bare empty-div is normalized to the same —
    // visually identical italic message).
    if (!rows.length) {
        return h('div', { style: { flex: 1, overflow: 'auto' } },
            h('div', { style: { padding: '12px 10px', color: c.textDim, fontSize: 11, fontStyle: 'italic' } },
                labels.noGens));
    }

    return h('div', { style: { flex: 1, overflow: 'auto' } },
        h('table', { style: { borderCollapse: 'collapse', width: '100%' } },
            h('thead', null,
                h('tr', null,
                    th(labels.genCol,    36),
                    showSide && th('Side', 36),
                    typeColumn && th(typeColumn.header, 52),
                    th(labels.layersCol, 48),
                    th(labels.mfCol,     80),
                    th(labels.totCol,    64),
                    th(labels.timeCol,   56),
                    th(labels.dMFCol,    72),
                    th(labels.matCol,   100),
                    th('',               60),
                )
            ),
            h('tbody', null,
                [...rows].reverse().map(row => {
                    const isBest = Math.abs(row.mf - bestMF) < 1e-12;
                    return h('tr', {
                        key: row.id,
                        style: { background: isBest ? `${c.accent || '#ffa726'}1a` : 'transparent' }
                    },
                        td(row.genNum, { color: c.textDim }),
                        showSide && td(sideBadge(row.side)),
                        typeColumn && td(typeColumn.render(row)),
                        td(row.layerCount, { color: c.text }),
                        td(row.mf.toFixed(6), {
                            color: isBest ? c.success : c.text,
                            fontWeight: isBest ? 700 : 400,
                        }),
                        td(row.tot != null ? row.tot.toFixed(0) : '—', { color: c.textDim }),
                        td(row.tMs != null ? `${(row.tMs / 1000).toFixed(1)}s` : '—', { color: c.textDim }),
                        td(row.dMF == null ? '—'
                            : row.dMF < 0
                                ? h('span', { style: { color: c.success } }, row.dMF.toFixed(5))
                                : h('span', { style: { color: '#ef5350' } }, `+${row.dMF.toFixed(5)}`)),
                        td(row.insertMat
                            ? h('span', {
                                title: matFriendlyName(row.insertMat),
                                style: {
                                    display: 'inline-block', maxWidth: 92, verticalAlign: 'middle',
                                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                    padding: '1px 5px', borderRadius: 3, fontSize: 10,
                                    background: matColorAlpha(row.insertMat), color: c.text
                                }
                              }, matFriendlyName(row.insertMat))
                            : '—'
                        ),
                        h('td', { style: { padding: '2px 5px' } },
                            h('button', {
                                onClick: () => onRestore(row),
                                style: {
                                    padding: '1px 7px', fontSize: 10, cursor: 'pointer',
                                    background: c.panel, color: c.text,
                                    border: `1px solid ${c.border}`, borderRadius: 2,
                                    fontFamily: 'inherit',
                                }
                            }, labels.restore)
                        )
                    );
                })
            )
        )
    );
}
