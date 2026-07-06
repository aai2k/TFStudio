/**
 * ZemaxCoatings — import / export Zemax OpticStudio COATING.DAT.
 *
 * Three tabs:
 *   • Coatings — browse parsed COAT/IDEAL/TABLE/ENCRYPTED records; import a
 *     layer-stack (COAT) into the current design's FRONT coating. Zemax COAT
 *     order (outermost→substrate, substrate excluded) is identical to TFStudio
 *     frontLayers order (Help: "Specifying Coatings on Surfaces"), so no
 *     reversal is needed.
 *   • Materials — browse parsed MATE tables; import selected/all into a catalog.
 *   • Export — generate a COATING.DAT (MATE + COAT) from the current design.
 *
 * Conventions live in utils/io/zemaxCoatingFile.js (k-sign flip, relative
 * thickness d = T·λ₀/n₀). This component only does UI + catalog/design wiring.
 */

import { useDesign } from '../../state/DesignContext.js';
import { LockIcon } from '../ui/LockIcon.js';
import { Checkbox } from '../ui/Checkbox.js';
import {
    getMaterialById, getNKById, addCatalog, getCatalogs,
} from '../../utils/materials/catalogManager.js';
import {
    parseZemaxCoating, mateToTfMaterial, tfMaterialToMate,
    coatToTfLayers, tfLayersToCoat, generateZemaxCoating, buildGrid, sanitizeZemaxName,
} from '../../utils/io/zemaxCoatingFile.js';
import { usePersistentNumber } from '../ui/usePersistentState.js';

const { createElement: h, useState, useMemo, useCallback } = React;

// ── Session cache ───────────────────────────────────────────────────────────────
// Docking unmounts a tool window when the user switches tools, which would drop a
// loaded COATING.DAT back to null. Keep the parsed file + browsing selections in a
// module-level singleton so they survive unmount/remount for the session (numeric
// settings persist further, via usePersistentNumber → localStorage). Cleared only
// by loading another file or restarting the app.
const SESSION = {
    doc: null, fileName: '', tab: 'coatings', selCoating: -1,
    selMats: new Set(), thMode: 'absolute', scope: 'used',
    coatName: 'TFSTUDIO_DESIGN', preview: '',
};
function useSession(key) {
    const [v, setV] = useState(SESSION[key]);
    const set = useCallback((nv) => {
        SESSION[key] = (typeof nv === 'function') ? nv(SESSION[key]) : nv;
        setV(SESSION[key]);
    }, [key]);
    return [v, set];
}

// ── UI primitives ──────────────────────────────────────────────────────────────

function TabBtn({ active, onClick, c, children }) {
    return h('button', {
        onClick,
        style: {
            padding: '7px 16px', fontSize: 12, cursor: 'pointer', outline: 'none',
            border: 'none', borderBottom: `2px solid ${active ? c.accent : 'transparent'}`,
            background: 'transparent', color: active ? c.accent : c.text,
            fontWeight: active ? 600 : 400,
        },
    }, children);
}

function Btn({ onClick, c, children, disabled, primary }) {
    return h('button', {
        onClick, disabled,
        style: {
            padding: '5px 12px', fontSize: 11.5, cursor: disabled ? 'not-allowed' : 'pointer',
            border: `1px solid ${primary && !disabled ? c.accent : c.border}`, borderRadius: 4,
            background: primary && !disabled ? c.accent + '22' : 'transparent',
            color: disabled ? c.textDim : (primary ? c.accent : c.text),
            fontWeight: primary ? 600 : 400, opacity: disabled ? 0.55 : 1, whiteSpace: 'nowrap',
        },
    }, children);
}

function Seg({ active, onClick, c, position, children }) {
    const radius = position === 'first' ? '4px 0 0 4px' : position === 'last' ? '0 4px 4px 0' : '0';
    return h('button', {
        onClick,
        style: {
            padding: '4px 10px', fontSize: 11, cursor: 'pointer', outline: 'none',
            border: `1px solid ${active ? c.accent : c.border}`, borderRadius: radius,
            marginLeft: position === 'first' ? 0 : -1,
            background: active ? c.accent + '33' : 'transparent',
            color: active ? c.accent : c.text, fontWeight: active ? 600 : 400,
            position: 'relative', zIndex: active ? 1 : 0, whiteSpace: 'nowrap',
        },
    }, children);
}

function Num({ value, onChange, min, max, step = 1, c, width = 72 }) {
    const [raw, setRaw] = useState(String(value));
    React.useEffect(() => { setRaw(String(value)); }, [value]);
    const commit = () => {
        const v = parseFloat(raw);
        if (!isNaN(v)) { const cl = Math.min(Math.max(v, min ?? -Infinity), max ?? Infinity); onChange(cl); setRaw(String(cl)); }
        else setRaw(String(value));
    };
    return h('input', {
        type: 'number', value: raw, min, max, step,
        onChange: (e) => setRaw(e.target.value), onBlur: commit,
        onKeyDown: (e) => { if (e.key === 'Enter') e.currentTarget.blur(); },
        style: {
            width, height: 24, background: c.bg, color: c.text,
            border: `1px solid ${c.border}`, borderRadius: 3, fontSize: 11, padding: '0 5px',
            outline: 'none', textAlign: 'right',
        },
    });
}

function Label({ children, c }) {
    return h('span', {
        style: { fontSize: 10, color: c.textDim, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px', whiteSpace: 'nowrap' },
    }, children);
}

const th = (c) => ({ textAlign: 'left', padding: '4px 8px', fontSize: 10, color: c.textDim, textTransform: 'uppercase', letterSpacing: '0.4px', borderBottom: `1px solid ${c.border}`, position: 'sticky', top: 0, background: c.panel });
const td = (c) => ({ padding: '3px 8px', fontSize: 11.5, color: c.text, borderBottom: `1px solid ${c.border}22` });

// ── Helpers ─────────────────────────────────────────────────────────────────────

const matName = (id) => getMaterialById(id)?.name || id;

// Catalog id/name derived from the loaded file name (stable → re-import overwrites).
function catalogIdFor(fileName) {
    const base = (fileName || 'coating').replace(/\.[^.]*$/, '');
    return { id: 'zemax_' + sanitizeZemaxName(base).toLowerCase(), name: 'Zemax ' + base };
}

// Register the file's MATE materials into a user catalog; return {catId, nameMap}
// where nameMap maps an UPPER-cased Zemax material name → full TFStudio id.
function registerMaterials(materials, fileName, onlyNames) {
    const { id: catId, name: catName } = catalogIdFor(fileName);
    const cat = { id: catId, name: catName, source: 'user', materials: {} };
    const nameMap = {};
    const usedIds = {};
    for (const m of materials) {
        if (onlyNames && !onlyNames.has(m.name.toUpperCase())) continue;
        const tf = mateToTfMaterial(m, { comment: `Imported from ${fileName}` });
        let mid = tf.id || 'material', n = 2;
        while (usedIds[mid]) mid = (tf.id || 'material') + '_' + n++;
        usedIds[mid] = true;
        tf.id = mid;
        cat.materials[mid] = tf;
        nameMap[m.name.toUpperCase()] = `${catId}:${mid}`;
    }
    addCatalog(cat);
    return { catId, catName, nameMap, count: Object.keys(cat.materials).length };
}

// ── Main component ───────────────────────────────────────────────────────────────

export function ZemaxCoatings({ c, t }) {
    const z = t.zemaxCoatings;
    const { design, updateDesign, checkpoint } = useDesign();

    // Loaded file + browsing selections survive window switches (module cache).
    const [tab, setTab] = useSession('tab');
    const [doc, setDoc] = useSession('doc');            // parsed { materials, coatings, ... }
    const [fileName, setFileName] = useSession('fileName');
    const [selCoating, setSelCoating] = useSession('selCoating');
    const [selMats, setSelMats] = useSession('selMats');
    const [thMode, setThMode] = useSession('thMode');   // 'absolute' | 'relative'
    const [scope, setScope] = useSession('scope');       // 'used' | 'all'
    const [coatName, setCoatName] = useSession('coatName');
    const [preview, setPreview] = useSession('preview');

    // Ephemeral UI state (no need to persist).
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState(null);          // { type, msg }

    // Numeric settings persist across restarts (localStorage).
    const [refNm, setRefNm] = usePersistentNumber('tfstudio-zemax-refNm', 550);
    const [gStart, setGStart] = usePersistentNumber('tfstudio-zemax-gStart', 400);
    const [gEnd, setGEnd] = usePersistentNumber('tfstudio-zemax-gEnd', 800);
    const [gStep, setGStep] = usePersistentNumber('tfstudio-zemax-gStep', 25);

    const flash = (type, msg) => setStatus({ type, msg });

    // ── Load a file ────────────────────────────────────────────────────────────
    const onLoad = useCallback(async () => {
        setLoading(true); setStatus(null);
        try {
            const res = await window.electronAPI.zemaxPickCoatingFile();
            if (!res?.success) { if (!res?.canceled) flash('error', z.errLoad(res?.error || '')); setLoading(false); return; }
            const parsed = parseZemaxCoating(res.text);
            if (!parsed.materials.length && !parsed.coatings.length) { flash('error', z.errParse); setLoading(false); return; }
            setDoc(parsed); setFileName(res.fileName || 'COATING.DAT');
            setSelCoating(parsed.coatings.findIndex(x => x.type === 'layers'));
            setSelMats(new Set());
            flash('success', z.loadedFile(res.fileName || ''));
        } catch (err) {
            flash('error', z.errLoad(err.message));
        }
        setLoading(false);
    }, [z]);

    // ── Import a coating into the front design ──────────────────────────────────
    const importCoating = useCallback(() => {
        const coat = doc?.coatings?.[selCoating];
        if (!coat || coat.type !== 'layers') { flash('error', z.importNotStack); return; }

        // Materials referenced by this coating must exist; register the file's MATE
        // tables into a catalog and resolve names → ids.
        const need = new Set(coat.layers.map(l => l.material.toUpperCase()));
        const { catName, nameMap } = registerMaterials(doc.materials, fileName, need);
        // Fall back to builtin Air for an undefined AIR layer.
        const resolveId = (zName) => nameMap[zName.toUpperCase()] || (/^AIR$/i.test(zName) ? 'Air' : null);

        const { layers, warnings } = coatToTfLayers(coat, {
            refWavelengthUm: refNm / 1000,
            materialId: resolveId,
            realIndex: (zName, lamNm) => {
                const id = resolveId(zName);
                return id ? getNKById(id, lamNm)[0] : 0;
            },
        });
        if (!layers.length) { flash('error', warnings[0] || z.importNotStack); return; }

        checkpoint();
        updateDesign({ frontLayers: layers });
        flash('success', z.importedCoating(coat.name, layers.length) + (catName ? '' : '') + (warnings.length ? ` (${z.warningsN(warnings.length)})` : ''));
    }, [doc, selCoating, fileName, refNm, checkpoint, updateDesign, z]);

    // ── Import materials into a catalog ─────────────────────────────────────────
    const importMaterials = useCallback((all) => {
        if (!doc?.materials?.length) return;
        const only = all ? null : selMats;
        if (!all && (!only || only.size === 0)) { flash('error', z.noSelection); return; }
        const { catName, count } = registerMaterials(doc.materials, fileName, all ? null : only);
        flash('success', z.importedMaterials(count, catName));
    }, [doc, selMats, fileName, z]);

    // ── Export: collect material ids in scope ───────────────────────────────────
    const exportMaterialIds = useCallback(() => {
        const ids = new Set();
        if (scope === 'all') {
            const cats = getCatalogs();
            for (const cat of Object.values(cats || {}))
                for (const mid of Object.keys(cat.materials || {})) ids.add(`${cat.id}:${mid}`);
        } else {
            for (const L of (design.frontLayers || [])) if (L.material) ids.add(L.material);
            for (const L of (design.backLayers || [])) if (L.material) ids.add(L.material);
            if (design.substrate?.material) ids.add(design.substrate.material);
            if (design.incidentMedium) ids.add(design.incidentMedium);
            if (design.exitMedium) ids.add(design.exitMedium);
        }
        return [...ids];
    }, [scope, design]);

    const onGenerate = useCallback(() => {
        const frontLayers = design.frontLayers || [];
        if (!frontLayers.length) { flash('error', z.nothingToExport); setPreview(''); return; }

        const grid = buildGrid(gStart, gEnd, gStep);
        const ids = exportMaterialIds();

        // id → unique Zemax name (sanitised, de-duplicated on collision).
        const usedNames = {}, idToName = {};
        const zNameFor = (id) => {
            if (idToName[id]) return idToName[id];
            let nm = sanitizeZemaxName(matName(id)), base = nm, n = 2;
            while (usedNames[nm] && usedNames[nm] !== id) nm = (base.slice(0, 30) + '_' + n++);
            usedNames[nm] = id; idToName[id] = nm; return nm;
        };

        const materials = ids.map(id =>
            tfMaterialToMate(zNameFor(id), (lamNm) => getNKById(id, lamNm), grid));

        const coat = tfLayersToCoat(coatName, frontLayers, {
            zemaxName: zNameFor,
            mode: thMode,
            refWavelengthUm: refNm / 1000,
            realIndex: (id, lamNm) => getNKById(id, lamNm)[0],
        });

        const text = generateZemaxCoating({ materials, coatings: [coat] });
        setPreview(text);
        flash('success', `${materials.length} MATE · ${coat.layers.length} layers`);
    }, [design, gStart, gEnd, gStep, scope, coatName, thMode, refNm, exportMaterialIds, z]);

    const onSave = useCallback(async () => {
        if (!preview) return;                 // Save is disabled until a preview exists
        try {
            const res = await window.electronAPI.zemaxSaveCoatingFile(preview, 'COATING.DAT');
            if (res?.success) flash('success', z.savedFile(res.filePath));
            else if (!res?.canceled) flash('error', z.errSave(res?.error || ''));
        } catch (err) { flash('error', z.errSave(err.message)); }
    }, [preview, z]);

    // ── Render ──────────────────────────────────────────────────────────────────
    return h('div', {
        style: { display: 'flex', flexDirection: 'column', height: '100%', background: c.bg, color: c.text, fontFamily: 'system-ui, -apple-system, sans-serif', overflow: 'hidden' },
    },
        // Header / load bar
        h('div', { style: { padding: '8px 12px', borderBottom: `1px solid ${c.border}`, background: c.panel, flexShrink: 0 } },
            h('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 2 } }, z.title),
            h('div', { style: { fontSize: 10.5, color: c.textDim, lineHeight: 1.4, marginBottom: 8 } }, z.subtitle),
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
                h(Btn, { onClick: onLoad, c, primary: true, disabled: loading }, loading ? z.loading : z.loadBtn),
                fileName ? h('span', { style: { fontSize: 11, color: c.textDim } }, z.loadedFile(fileName)) : null,
                h('div', { style: { flex: 1 } }),
                h(Label, { c }, z.refWavelength),
                h(Num, { value: refNm, onChange: setRefNm, min: 100, max: 30000, step: 10, c, width: 70 }),
            ),
        ),

        // Tabs
        h('div', { style: { display: 'flex', borderBottom: `1px solid ${c.border}`, background: c.panel, flexShrink: 0 } },
            h(TabBtn, { active: tab === 'coatings', onClick: () => setTab('coatings'), c }, z.tabCoatings),
            h(TabBtn, { active: tab === 'materials', onClick: () => setTab('materials'), c }, z.tabMaterials),
            h(TabBtn, { active: tab === 'export', onClick: () => setTab('export'), c }, z.tabExport),
        ),

        // Body
        h('div', { style: { flex: 1, overflow: 'auto', padding: 12 } },
            tab === 'coatings' ? h(CoatingsTab, { c, z, doc, selCoating, setSelCoating, refNm, importCoating })
          : tab === 'materials' ? h(MaterialsTab, { c, z, doc, selMats, setSelMats, importMaterials })
          : h(ExportTab, { c, z, design, thMode, setThMode, gStart, setGStart, gEnd, setGEnd, gStep, setGStep, scope, setScope, coatName, setCoatName, preview, onGenerate, onSave, refNm }),
        ),

        // Status banner
        status ? h('div', {
            style: {
                padding: '6px 12px', fontSize: 11, flexShrink: 0,
                borderTop: `1px solid ${c.border}`,
                background: status.type === 'error' ? (c.error + '22') : (c.success + '22'),
                color: status.type === 'error' ? c.error : (c.text),
            },
        }, status.msg) : null,
    );
}

// ── Coatings tab ─────────────────────────────────────────────────────────────────

const COAT_TYPE_LABEL = (z, type) => ({
    layers: z.typeStack, idealI: z.typeIdeal, ideal: z.typeIdeal, ideal2: z.typeIdeal,
    table: z.typeTable, encrypted: z.typeEncrypted,
}[type] || type);

function CoatingsTab({ c, z, doc, selCoating, setSelCoating, refNm, importCoating }) {
    if (!doc) return h('div', { style: { color: c.textDim, fontSize: 12, padding: 20, textAlign: 'center' } }, z.noFile);
    if (!doc.coatings.length) return h('div', { style: { color: c.textDim, fontSize: 12, padding: 20, textAlign: 'center' } }, z.noCoatings);

    const sel = doc.coatings[selCoating];
    const matsByName = {};
    for (const mat of doc.materials) matsByName[mat.name.toUpperCase()] = mat;

    // Preview physical thickness for the selected layer stack.
    const realIndexOf = (zName) => {
        const mat = matsByName[zName.toUpperCase()];
        if (!mat || !mat.points.length) return null;
        const pts = mat.points;
        const lamUm = refNm / 1000;
        if (lamUm <= pts[0][0]) return pts[0][1];
        if (lamUm >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
        let lo = 0, hi = pts.length - 1;
        while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pts[mid][0] <= lamUm) lo = mid; else hi = mid; }
        const f = (lamUm - pts[lo][0]) / (pts[hi][0] - pts[lo][0]);
        return pts[lo][1] + f * (pts[hi][1] - pts[lo][1]);
    };
    const layerThkNm = (L) => {
        if (L.isAbsolute) return L.thickness * 1000;
        const n0 = realIndexOf(L.material);
        return n0 > 0 ? (L.thickness * (refNm / 1000) / n0) * 1000 : NaN;
    };

    return h('div', { style: { display: 'flex', gap: 12, height: '100%' } },
        // Left — coating list
        h('div', { style: { flex: '0 0 300px', overflow: 'auto', border: `1px solid ${c.border}`, borderRadius: 4 } },
            h('table', { style: { width: '100%', borderCollapse: 'collapse' } },
                h('thead', null, h('tr', null,
                    h('th', { style: th(c) }, z.colName),
                    h('th', { style: th(c) }, z.colType),
                    h('th', { style: { ...th(c), textAlign: 'right' } }, z.colLayers),
                )),
                h('tbody', null, doc.coatings.map((co, i) => {
                    const importable = co.type === 'layers';
                    return h('tr', {
                        key: i,
                        onClick: importable ? () => setSelCoating(i) : undefined,
                        title: importable ? co.name : z.notImportable,
                        style: {
                            cursor: importable ? 'pointer' : 'default',
                            opacity: importable ? 1 : 0.5,
                            background: i === selCoating ? c.accent + '22' : 'transparent',
                        },
                    },
                        h('td', { style: { ...td(c), display: 'flex', alignItems: 'center', gap: 5 } },
                            importable ? null : h('span', { style: { display: 'inline-flex', color: c.textDim }, title: z.notImportable }, h(LockIcon, { locked: true, size: 11 })),
                            h('span', null, co.name || '—'),
                        ),
                        h('td', { style: { ...td(c), color: c.textDim } }, COAT_TYPE_LABEL(z, co.type)),
                        h('td', { style: { ...td(c), textAlign: 'right', color: c.textDim } }, importable ? co.layers.length : ''),
                    );
                })),
            ),
        ),
        // Right — selected coating detail
        h('div', { style: { flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 8 } },
            !sel ? h('div', { style: { color: c.textDim, fontSize: 12, padding: 12 } }, z.selectCoating)
          : sel.type !== 'layers' ? h('div', { style: { color: c.textDim, fontSize: 12, padding: 12 } }, z.importNotStack)
          : [
                h('div', { key: 'h', style: { display: 'flex', alignItems: 'center', gap: 10 } },
                    h('div', { style: { fontWeight: 600, fontSize: 12 } }, sel.name),
                    h('div', { style: { flex: 1 } }),
                    h(Btn, { onClick: importCoating, c, primary: true }, z.importToFront),
                ),
                h('div', { key: 'lh', style: { fontSize: 10, color: c.textDim, textTransform: 'uppercase', letterSpacing: '0.4px' } }, z.layersHeader),
                h('table', { key: 'lt', style: { width: '100%', borderCollapse: 'collapse' } },
                    h('thead', null, h('tr', null,
                        h('th', { style: { ...th(c), width: 30 } }, '#'),
                        h('th', { style: th(c) }, z.colMaterial),
                        h('th', { style: { ...th(c), textAlign: 'right' } }, z.colThickness),
                        h('th', { style: th(c) }, z.colMode),
                    )),
                    h('tbody', null, sel.layers.map((L, i) =>
                        h('tr', { key: i },
                            h('td', { style: { ...td(c), color: c.textDim } }, i + 1),
                            h('td', { style: td(c) }, L.material),
                            h('td', { style: { ...td(c), textAlign: 'right', fontVariantNumeric: 'tabular-nums' } },
                                Number.isFinite(layerThkNm(L)) ? `${layerThkNm(L).toFixed(2)} nm` : '—'),
                            h('td', { style: { ...td(c), color: c.textDim } },
                                L.isAbsolute ? `${L.thickness} ${z.modeAbs}` : `${L.thickness} ${z.modeRel}`),
                        ),
                    )),
                ),
                h('div', { key: 'note', style: { fontSize: 10.5, color: c.textDim, marginTop: 4 } }, z.importNotStack),
            ],
        ),
    );
}

// ── Materials tab ────────────────────────────────────────────────────────────────

function MaterialsTab({ c, z, doc, selMats, setSelMats, importMaterials }) {
    if (!doc) return h('div', { style: { color: c.textDim, fontSize: 12, padding: 20, textAlign: 'center' } }, z.noFile);
    if (!doc.materials.length) return h('div', { style: { color: c.textDim, fontSize: 12, padding: 20, textAlign: 'center' } }, z.noMaterials);

    const toggle = (name) => {
        const next = new Set(selMats);
        if (next.has(name)) next.delete(name); else next.add(name);
        setSelMats(next);
    };

    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, height: '100%' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            h(Btn, { onClick: () => setSelMats(new Set(doc.materials.map(m => m.name))), c }, z.selectAll),
            h(Btn, { onClick: () => setSelMats(new Set()), c }, z.clearSel),
            h('div', { style: { flex: 1 } }),
            h(Btn, { onClick: () => importMaterials(false), c, primary: true }, z.importSelected),
            h(Btn, { onClick: () => importMaterials(true), c }, z.importAll),
        ),
        h('div', { style: { flex: 1, overflow: 'auto', border: `1px solid ${c.border}`, borderRadius: 4 } },
            h('table', { style: { width: '100%', borderCollapse: 'collapse' } },
                h('thead', null, h('tr', null,
                    h('th', { style: { ...th(c), width: 28 } }, ''),
                    h('th', { style: th(c) }, z.colName),
                    h('th', { style: { ...th(c), textAlign: 'right' } }, z.colPoints),
                    h('th', { style: th(c) }, z.colRange),
                )),
                h('tbody', null, doc.materials.map((m, i) => {
                    const lo = m.points.length ? m.points[0][0] : 0;
                    const hi = m.points.length ? m.points[m.points.length - 1][0] : 0;
                    const checked = selMats.has(m.name);
                    return h('tr', { key: i, onClick: () => toggle(m.name), style: { cursor: 'pointer', background: checked ? c.accent + '18' : 'transparent' } },
                        h('td', { style: { ...td(c), textAlign: 'center' } }, h(Checkbox, { c, checked, readOnly: true })),
                        h('td', { style: td(c) }, m.name),
                        h('td', { style: { ...td(c), textAlign: 'right', color: c.textDim } }, m.points.length),
                        h('td', { style: { ...td(c), color: c.textDim } }, m.points.length ? `${lo}–${hi}` : '—'),
                    );
                })),
            ),
        ),
    );
}

// ── Export tab ───────────────────────────────────────────────────────────────────

function ExportTab({ c, z, design, thMode, setThMode, gStart, setGStart, gEnd, setGEnd, gStep, setGStep, scope, setScope, coatName, setCoatName, preview, onGenerate, onSave, refNm }) {
    const nLayers = (design.frontLayers || []).length;
    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10, height: '100%' } },
        h('div', { style: { fontSize: 12, fontWeight: 600 } }, z.exportTitle),
        h('div', { style: { fontSize: 10.5, color: c.textDim } }, `${nLayers} front-coating layer${nLayers === 1 ? '' : 's'}`),

        // Options grid
        h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' } },
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
                h(Label, { c }, z.thicknessMode),
                h('div', { style: { display: 'flex' } },
                    h(Seg, { active: thMode === 'absolute', onClick: () => setThMode('absolute'), c, position: 'first' }, z.thicknessAbs),
                    h(Seg, { active: thMode === 'relative', onClick: () => setThMode('relative'), c, position: 'last' }, z.thicknessRel),
                ),
            ),
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
                h(Label, { c }, z.materialScope),
                h('div', { style: { display: 'flex' } },
                    h(Seg, { active: scope === 'used', onClick: () => setScope('used'), c, position: 'first' }, z.scopeUsed),
                    h(Seg, { active: scope === 'all', onClick: () => setScope('all'), c, position: 'last' }, z.scopeAll),
                ),
            ),
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
                h(Label, { c }, z.coatingName),
                h('input', {
                    value: coatName, onChange: (e) => setCoatName(e.target.value),
                    style: { height: 24, width: 180, background: c.bg, color: c.text, border: `1px solid ${c.border}`, borderRadius: 3, fontSize: 11, padding: '0 6px', outline: 'none' },
                }),
            ),
        ),

        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            h(Label, { c }, z.sampleGrid),
            h(Label, { c }, z.from), h(Num, { value: gStart, onChange: setGStart, min: 100, max: 30000, step: 10, c, width: 64 }),
            h(Label, { c }, z.to), h(Num, { value: gEnd, onChange: setGEnd, min: 100, max: 30000, step: 10, c, width: 64 }),
            h(Label, { c }, z.step), h(Num, { value: gStep, onChange: setGStep, min: 1, max: 1000, step: 5, c, width: 56 }),
        ),

        h('div', { style: { fontSize: 10.5, color: c.textDim } },
            thMode === 'absolute' ? z.thicknessAbsHint : `${z.thicknessRelHint}  (λ₀ = ${refNm} nm)`),

        h('div', { style: { display: 'flex', gap: 8 } },
            h(Btn, { onClick: onGenerate, c, primary: true }, z.generate),
            h(Btn, { onClick: onSave, c, disabled: !preview }, z.saveBtn),
        ),

        // Preview
        h('div', { style: { flex: 1, display: 'flex', flexDirection: 'column', minHeight: 120 } },
            h(Label, { c }, z.preview),
            h('textarea', {
                value: preview, readOnly: true, spellCheck: false,
                style: {
                    flex: 1, marginTop: 4, width: '100%', resize: 'none',
                    background: c.bg, color: c.text, border: `1px solid ${c.border}`, borderRadius: 4,
                    fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 10.5, padding: 8, outline: 'none', whiteSpace: 'pre',
                },
            }),
        ),
    );
}
