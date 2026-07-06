/**
 * Stack Formula dialog.
 *
 * Type a compact symbolic coating description (a design formula)
 * and generate a layer stack. See `src/utils/stackFormula.js` for
 * the grammar and semantics (QWOT-multiplier coefficients, (…)^n groups,
 * single-char adjacency, media sides).
 *
 * Apply modes:
 *   • Replace — overwrite the active design's front stack (+ media if the
 *     formula specifies them); one undo checkpoint.
 *   • Append  — add the generated layers to the end of the active front stack.
 *   • New     — create a brand-new design from the formula.
 */

import { useDesign } from '../../state/DesignContext.js';
import { makeDefaultDesign } from '../../state/DesignContext.js';
import { getMaterial } from '../../utils/materials/materialDatabase.js';
import { getMaterialById, materialLabel } from '../../utils/materials/catalogManager.js';
import { mirrorLayers } from '../../utils/physics/optimizer.js';
import { evaluateSpectrum } from '../../utils/physics/thinFilmMath.js';
import {
    parseStackFormula, buildStackFromFormula, formulaOf, autoSymbolMap,
    resolveAtom, collectUnknownSymbols, DEFAULT_SYMBOL_MAP,
} from '../../utils/synthesis/stackFormula.js';
import { MaterialPicker } from '../ui/MaterialPicker.js';
import { Checkbox } from '../ui/Checkbox.js';

const { createElement: h, useState, useMemo, useEffect, useRef, useCallback } = React;

function resolveMat(id) {
    if (!id) return getMaterial('Air');
    return getMaterialById(id) || getMaterial(id) || getMaterial('Air');
}

// Which symbols in the parsed atoms need a symbol→material assignment row?
// Direct catalog material names (SiO2, BK7, …) don't; H/L/M and any unknown
// token do. Multi-char tokens that segment into singles contribute the singles.
function neededSymbols(atoms, symbolMap) {
    const out = [];
    const seen = new Set();
    const add = (s) => { if (!seen.has(s)) { seen.add(s); out.push(s); } };
    for (const a of atoms) {
        const sym = a.sym;
        if (Object.prototype.hasOwnProperty.call(symbolMap, sym)) { add(sym); continue; }
        // direct material?
        const r = resolveAtom({ coef: 1, sym }, symbolMap);
        if (r.specs && r.specs.length === 1 && !Object.prototype.hasOwnProperty.call(symbolMap, sym)) {
            // could be a direct material OR a single mapped symbol; if not in map it's direct → skip
            continue;
        }
        if (r.specs && r.specs.length > 1) {
            // segmented into singles — list each single char
            for (const chr of sym) add(chr);
            continue;
        }
        // unknown
        add(sym);
    }
    return out;
}

// Compute the initial formula text + symbol-assignment rows for the dialog.
// For an existing front stack: auto-detect symbols (autoSymbolMap) and emit a
// compact formula. For an empty design: H/L/M defaults + a sample formula.
function computeSeed(design) {
    const layers = design.frontLayers || [];
    const lam = design.referenceWavelength || 550;
    if (!layers.length) {
        return {
            text: '(H L)^4 H',
            rows: Object.entries(DEFAULT_SYMBOL_MAP).map(([sym, matId]) => ({ sym, matId, fixed: true })),
        };
    }
    const { symbolMap, id2sym, ranked } = autoSymbolMap(layers, lam);
    let text = '';
    try { text = formulaOf({ layers, refLambda: lam, symbolMap }); } catch { text = ''; }
    const rows = ranked.map(id => ({ sym: id2sym[id], matId: id, fixed: false }));
    return { text, rows };
}

// ── Preview plot ──────────────────────────────────────────────────────────────

function PreviewPlot({ compiled, incidentId, substrateId, refLambda, c, height = 220 }) {
    const divRef = useRef(null);

    const data = useMemo(() => {
        if (!compiled.ok) return { error: compiled.error };
        try {
            const incMat = resolveMat(incidentId);
            const subMat = resolveMat(substrateId);
            const layersResolved = compiled.layers.map(l => ({
                material: resolveMat(l.material), thickness: l.thickness,
            }));
            const lo = Math.max(200, refLambda * 0.6);
            const hi = Math.min(2500, refLambda * 1.7);
            const spec = evaluateSpectrum(
                { lambdaStart: lo, lambdaEnd: hi, lambdaStep: Math.max(1, (hi - lo) / 300),
                  theta: 0, polarization: 'avg' },
                incMat, subMat, layersResolved);
            return { lambda: spec.lambda, T: spec.T, R: spec.R };
        } catch (err) { return { error: err.message }; }
    }, [compiled, incidentId, substrateId, refLambda]);

    useEffect(() => {
        if (!divRef.current || !window.Plotly) return;
        // Invalid formula → purge any prior spectrum and bail (the overlay below
        // shows "no preview"). We must NOT unmount the plot div on error: Plotly
        // owns DOM inside it that React doesn't track, so swapping the div for a
        // text node makes React's reconciler throw on removeChild and the
        // preview never recovers ("disappears forever"). Keeping the div mounted
        // and only purging avoids that.
        if (data.error) {
            try { window.Plotly.purge(divRef.current); } catch { /* not yet plotted */ }
            return;
        }
        const traces = [
            { x: data.lambda, y: data.T.map(v => v * 100), type: 'scatter', mode: 'lines',
              name: 'T', line: { color: '#4fc3f7', width: 1.6 } },
            { x: data.lambda, y: data.R.map(v => v * 100), type: 'scatter', mode: 'lines',
              name: 'R', line: { color: '#ef5350', width: 1.6 } },
        ];
        const layout = {
            margin: { l: 44, r: 12, t: 6, b: 32 },
            xaxis: { title: { text: 'λ (nm)', font: { size: 10, color: c.textDim } },
                     color: c.text, gridcolor: c.border, tickfont: { size: 9 } },
            yaxis: { title: { text: 'T, R (%)', font: { size: 10, color: c.textDim } },
                     color: c.text, gridcolor: c.border, tickfont: { size: 9 }, range: [0, 105] },
            paper_bgcolor: c.panel, plot_bgcolor: c.bg, font: { color: c.text, size: 10 },
            showlegend: true, legend: { x: 0.02, y: 0.98, bgcolor: 'rgba(0,0,0,0)' },
            shapes: [{ type: 'line', xref: 'x', yref: 'paper', x0: refLambda, x1: refLambda,
                       y0: 0, y1: 1, line: { color: c.textDim, width: 1, dash: 'dot' } }],
        };
        window.Plotly.react(divRef.current, traces, layout, { responsive: true, displayModeBar: false });
    }, [data, c, refLambda]);

    // Purge Plotly on unmount so the detached node is cleaned up.
    useEffect(() => () => {
        if (divRef.current && window.Plotly) { try { window.Plotly.purge(divRef.current); } catch { /* noop */ } }
    }, []);

    // The Plotly div is ALWAYS mounted (so React never tears out Plotly's DOM);
    // the "no preview" message is an overlay sibling shown only on error.
    return h('div', { style: { position: 'relative', width: '100%', height } },
        h('div', { ref: divRef, style: { width: '100%', height } }),
        data.error && h('div', {
            style: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
                     justifyContent: 'center', color: c.textDim, fontSize: 12, fontStyle: 'italic',
                     background: c.panel, pointerEvents: 'none' } },
            '— no preview —'),
    );
}

// ── Dialog ─────────────────────────────────────────────────────────────────

export function StackFormulaDialog({ onClose, onCreateNew, folderName, hasActiveDesign, c, t }) {
    const { design, updateDesign, checkpoint } = useDesign();
    const sf = t.stackFormula;

    // Seed once from the active design: auto-detect its materials → H/L/M symbols
    // and a compact formula (or H/L/M defaults + sample for an empty design).
    const seedRef = useRef(null);
    if (!seedRef.current) seedRef.current = computeSeed(design);

    // Symbol → material assignments as an ordered, editable list. The user can
    // reassign, rename, add, or remove; any unknown symbol used in the formula
    // is auto-surfaced.
    const [symRows, setSymRows] = useState(() => seedRef.current.rows);
    // Empty-material rows are intentionally EXCLUDED from the map so a used but
    // unassigned symbol resolves to "unknown" (→ a clear error) instead of Air.
    const symbolMap = useMemo(() => {
        const m = {};
        for (const r of symRows) if (r.sym && r.matId) m[r.sym] = r.matId;
        return m;
    }, [symRows]);

    const setRowMat = useCallback((idx, matId) =>
        setSymRows(prev => prev.map((r, i) => i === idx ? { ...r, matId } : r)), []);
    const setRowSym = useCallback((idx, sym) =>
        setSymRows(prev => prev.map((r, i) => i === idx ? { ...r, sym } : r)), []);
    const addRow = useCallback(() =>
        setSymRows(prev => [...prev, { sym: '', matId: '', fixed: false }]), []);
    const removeRow = useCallback((idx) =>
        setSymRows(prev => prev.filter((_, i) => i !== idx)), []);

    const [refLambda, setRefLambda] = useState(() => design.referenceWavelength || 550);
    const [startFromSubstrate, setStartFromSubstrate] = useState(false);
    // Media as dropdowns (initialised from the design) — the formula carries
    // layers only. The front coating is bounded by the incident medium +
    // substrate; the back coating by the substrate + exit medium.
    const [incidentMat, setIncidentMat] = useState(() => design.incidentMedium || 'builtin:Air');
    const [substrateMat, setSubstrateMat] = useState(() => design.substrate?.material || 'builtin:BK7');
    const [exitMat, setExitMat] = useState(() => design.exitMedium || 'builtin:Air');

    // Which coating side(s) to write the formula into.
    const isSym = design.surfaceMode === 'symmetric';
    const [applySide, setApplySide] = useState('front'); // 'front' | 'back' | 'both'
    const effSide = isSym ? 'front' : applySide;          // symmetric edits front + auto-mirrors
    const showIncident = effSide !== 'back';
    const showExit     = effSide !== 'front' && !isSym;
    const [newName, setNewName] = useState(() => sf.defaultName);

    // Seed the textarea from the same auto-detected pass as the symbol rows.
    const [text, setText] = useState(() => seedRef.current.text);

    const parsed = useMemo(() => parseStackFormula(text), [text]);
    const compiled = useMemo(
        () => buildStackFromFormula({ text, symbolMap, refLambda, startFromSubstrate }),
        [text, symbolMap, refLambda, startFromSubstrate]);

    // Symbols actually referenced in the formula (for "used but unassigned"
    // highlighting in the assignment list).
    const usedSyms = useMemo(
        () => new Set(parsed.ok ? neededSymbols(parsed.atoms, symbolMap) : []),
        [parsed, symbolMap]);

    // Auto-surface any unknown symbol used in the formula as a new assignment
    // row so the user immediately gets a picker for it.
    useEffect(() => {
        if (!parsed.ok) return;
        const unknown = collectUnknownSymbols(parsed.atoms, symbolMap);
        const missing = unknown.filter(u => !symRows.some(r => r.sym === u));
        if (missing.length)
            setSymRows(prev => [...prev, ...missing.map(s => ({ sym: s, matId: '', fixed: false }))]);
    }, [parsed, symbolMap, symRows]);

    // ESC closes
    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose]);

    const applyToDesign = useCallback((mode) => {
        if (!compiled.ok) return;
        const stamp = Date.now();
        const reId = (layers, pfx) => layers.map((l, i) => ({ ...l, id: `${pfx}${i}` }));
        // compiled.layers are in FRONT storage order (ambient→substrate). The
        // back stack stores substrate→exit, so the same physical coating on the
        // back is mirrorLayers(front) (reversed) — matching the Design Editor,
        // where both sides list the substrate-touching layer first.

        if (mode === 'new') {
            const base = makeDefaultDesign(newName);
            const seed = base.id;
            const rb = buildStackFromFormula({ text, symbolMap, refLambda, startFromSubstrate, idSeed: seed });
            const f = rb.layers;
            const b = mirrorLayers(rb.layers, `b-${seed}-`);
            let frontLayers = [], backLayers = [], surfaceMode = 'front_only';
            if (effSide === 'front')      { frontLayers = f; surfaceMode = 'front_only'; }
            else if (effSide === 'back')  { backLayers = b;  surfaceMode = 'back_only'; }
            else                          { frontLayers = f; backLayers = b; surfaceMode = 'both_independent'; }
            const designObj = {
                ...base, name: newName, referenceWavelength: refLambda,
                incidentMedium: incidentMat, exitMedium: exitMat,
                substrate: { ...base.substrate, material: substrateMat },
                surfaceMode, frontLayers, backLayers, stackFormula: text,
                notes: `Generated from stack formula (${effSide}):\n${text}\nλ₀ = ${refLambda} nm`,
            };
            onCreateNew && onCreateNew(designObj);
            onClose();
            return;
        }

        // replace / append into the active design
        checkpoint();
        const patch = {};
        if (mode === 'replace') {
            patch.referenceWavelength = refLambda;
            patch.substrate = { ...design.substrate, material: substrateMat };
            patch.stackFormula = text;
        }

        if (isSym) {
            // Symmetric: front drives, back auto-mirrors. Exit medium is N/A.
            if (mode === 'replace') patch.incidentMedium = incidentMat;
            const f = mode === 'replace'
                ? compiled.layers
                : [...(design.frontLayers || []), ...reId(compiled.layers, `sf-${stamp}-f`)];
            patch.frontLayers = f;
            patch.backLayers  = mirrorLayers(f);
            updateDesign(patch);
            onClose();
            return;
        }

        const toFront = effSide === 'front' || effSide === 'both';
        const toBack  = effSide === 'back'  || effSide === 'both';
        if (toFront) {
            if (mode === 'replace') patch.incidentMedium = incidentMat;
            patch.frontLayers = mode === 'replace'
                ? compiled.layers
                : [...(design.frontLayers || []), ...reId(compiled.layers, `sf-${stamp}-f`)];
        }
        if (toBack) {
            if (mode === 'replace') patch.exitMedium = exitMat;
            const b = mirrorLayers(compiled.layers, `b-${stamp}-`);
            patch.backLayers = mode === 'replace'
                ? b
                : [...(design.backLayers || []), ...reId(b, `sf-${stamp}-b`)];
        }
        // Promote surfaceMode so a newly-populated side is visible/optimizable
        // (never demote a deliberate both_independent / symmetric).
        const cur = design.surfaceMode || 'front_only';
        const hasFront = (patch.frontLayers ?? design.frontLayers ?? []).length > 0;
        const hasBack  = (patch.backLayers  ?? design.backLayers  ?? []).length > 0;
        if (cur === 'front_only' && hasBack) patch.surfaceMode = hasFront ? 'both_independent' : 'back_only';
        else if (cur === 'back_only' && hasFront) patch.surfaceMode = hasBack ? 'both_independent' : 'front_only';

        updateDesign(patch);
        onClose();
    }, [compiled, design, isSym, effSide, refLambda, text, symbolMap, startFromSubstrate, newName,
        incidentMat, substrateMat, exitMat, checkpoint, updateDesign, onClose, onCreateNew]);

    const totalNm = compiled.ok ? compiled.layers.reduce((s, l) => s + l.thickness, 0) : 0;

    // ── render ──
    return h('div', {
        style: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)',
                 display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }
    },
        h('div', {
            style: { backgroundColor: c.panel, borderRadius: 8, padding: 20,
                     width: 860, maxWidth: '96vw', maxHeight: '94vh',
                     display: 'flex', flexDirection: 'column',
                     boxShadow: '0 10px 40px rgba(0,0,0,0.4)', border: `1px solid ${c.border}` }
        },
            // title
            h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                       paddingBottom: 12, borderBottom: `1px solid ${c.border}`, marginBottom: 12 } },
                h('h2', { style: { margin: 0, fontSize: 16, fontWeight: 700, color: c.text } }, sf.title),
                h('button', { onClick: onClose, style: { background: 'transparent', color: c.textDim,
                              border: 'none', cursor: 'pointer', fontSize: 18, padding: '0 6px' } }, '×'),
            ),

            // body: two columns
            h('div', { style: { flex: 1, overflowY: 'auto', display: 'flex', gap: 16, minHeight: 300 } },
                // left: input + symbols
                h('div', { style: { flex: '1 1 420px', display: 'flex', flexDirection: 'column', gap: 10 } },
                    h('div', { style: { fontSize: 12, color: c.textDim } }, sf.intro),
                    h('textarea', {
                        value: text,
                        onChange: (e) => setText(e.target.value),
                        spellCheck: false,
                        style: { width: '100%', minHeight: 64, resize: 'vertical', boxSizing: 'border-box',
                                 fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 14,
                                 padding: '8px 10px', backgroundColor: c.bg, color: c.text,
                                 border: `1px solid ${parsed.ok ? c.border : (c.warning || '#ef5350')}`,
                                 borderRadius: 4, outline: 'none' }
                    }),

                    // error line
                    !compiled.ok && h('div', {
                        style: { fontSize: 12, color: c.warning || '#ef5350',
                                 fontFamily: 'ui-monospace, Consolas, monospace' }
                    },
                        compiled.errorPos != null
                            ? `${' '.repeat(0)}↳ @${compiled.errorPos}: ${compiled.error}`
                            : compiled.error),

                    // options row
                    h('div', { style: { display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' } },
                        h('label', { style: { display: 'flex', flexDirection: 'column', gap: 3,
                                     fontSize: 11, color: c.textDim } },
                            h('span', {}, sf.refLambda),
                            h('input', { type: 'number', min: 100, max: 5000, step: 1, value: refLambda,
                                onChange: (e) => { const v = parseFloat(e.target.value); if (v > 0) setRefLambda(v); },
                                style: { width: 90, padding: '5px 7px', fontSize: 13, backgroundColor: c.bg,
                                         color: c.text, border: `1px solid ${c.border}`, borderRadius: 4, outline: 'none' } })
                        ),
                        h('label', { style: { display: 'flex', alignItems: 'center', gap: 6,
                                     fontSize: 12, color: c.textDim, marginTop: 14 } },
                            h(Checkbox, { c, checked: startFromSubstrate,
                                onChange: (e) => setStartFromSubstrate(e.target.checked) }),
                            h('span', { title: sf.startFromSubstrateTip }, sf.startFromSubstrate),
                        ),
                    ),

                    // media dropdowns — front coating: incident + substrate;
                    // back coating: substrate + exit medium.
                    h('div', { style: { display: 'flex', gap: 12, flexWrap: 'wrap' } },
                        showIncident && h('label', { key: 'inc', style: { display: 'flex', flexDirection: 'column', gap: 3,
                                     fontSize: 11, color: c.textDim, width: 190, maxWidth: '48%' } },
                            h('span', {}, sf.incidentMedium),
                            h(MaterialPicker, { value: incidentMat, onChange: setIncidentMat, c, t })),
                        h('label', { key: 'sub', style: { display: 'flex', flexDirection: 'column', gap: 3,
                                     fontSize: 11, color: c.textDim, width: 190, maxWidth: '48%' } },
                            h('span', {}, sf.substrate),
                            h(MaterialPicker, { value: substrateMat, onChange: setSubstrateMat, c, t })),
                        showExit && h('label', { key: 'exit', style: { display: 'flex', flexDirection: 'column', gap: 3,
                                     fontSize: 11, color: c.textDim, width: 190, maxWidth: '48%' } },
                            h('span', {}, sf.exitMedium),
                            h(MaterialPicker, { value: exitMat, onChange: setExitMat, c, t })),
                    ),

                    // symbols (always shown — assign H/L/M and add your own)
                    h('div', { style: { marginTop: 4 } },
                        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 } },
                            h('div', { style: { fontSize: 11, fontWeight: 600, color: c.text } }, sf.symbolsHeader),
                            h('button', {
                                onClick: addRow,
                                title: sf.addSymbolTip,
                                style: { fontSize: 11, padding: '2px 8px', cursor: 'pointer',
                                         backgroundColor: c.bg, color: c.text,
                                         border: `1px solid ${c.border}`, borderRadius: 3 }
                            }, sf.addSymbol),
                        ),
                        h('div', { style: { display: 'flex', flexDirection: 'column', gap: 5 } },
                            symRows.map((row, idx) => {
                                const used = row.sym && usedSyms.has(row.sym);
                                const unassigned = used && !row.matId;
                                const nameColor = unassigned ? (c.warning || '#ef5350') : c.text;
                                return h('div', { key: idx, style: { display: 'flex', alignItems: 'center', gap: 6 } },
                                    row.fixed
                                        ? h('div', { style: { width: 54, flexShrink: 0,
                                            fontFamily: 'ui-monospace, Consolas, monospace',
                                            fontSize: 14, fontWeight: 600, color: nameColor } }, row.sym)
                                        : h('input', {
                                            type: 'text', value: row.sym, placeholder: sf.symPlaceholder,
                                            onChange: (e) => setRowSym(idx, e.target.value.trim()),
                                            style: { width: 54, flexShrink: 0, boxSizing: 'border-box',
                                                fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 13,
                                                fontWeight: 600, padding: '4px 5px', textAlign: 'center',
                                                backgroundColor: c.bg, color: nameColor,
                                                border: `1px solid ${unassigned ? (c.warning || '#ef5350') : c.border}`,
                                                borderRadius: 3, outline: 'none' } }),
                                    h('div', { style: { flex: 1, minWidth: 0 } },
                                        h(MaterialPicker, { value: row.matId || '', onChange: (v) => setRowMat(idx, v), c, t })),
                                    row.fixed
                                        ? h('div', { style: { width: 22, flexShrink: 0 } })
                                        : h('button', {
                                            onClick: () => removeRow(idx), title: sf.removeSymbol,
                                            style: { width: 22, height: 22, flexShrink: 0, cursor: 'pointer',
                                                background: 'transparent', color: c.textDim,
                                                border: 'none', fontSize: 15, lineHeight: 1, outline: 'none' } }, '×'),
                                );
                            })
                        ),
                        h('div', { style: { fontSize: 10.5, color: c.textDim, marginTop: 5, opacity: 0.85 } },
                            sf.symbolsHint),
                    ),
                ),

                // right: parsed layers + preview
                h('div', { style: { flex: '1 1 360px', display: 'flex', flexDirection: 'column', gap: 8, minWidth: 320 } },
                    h('div', { style: { fontSize: 11, color: c.textDim, display: 'flex', gap: 14 } },
                        compiled.ok && h('span', { key: 'lc' }, sf.layersCount(compiled.layers.length)),
                        compiled.ok && h('span', { key: 'th' }, sf.totalThickness(totalNm.toFixed(1))),
                    ),
                    // layer table
                    h('div', { style: { maxHeight: 150, overflowY: 'auto', border: `1px solid ${c.border}`, borderRadius: 4 } },
                        h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 11.5, color: c.text } },
                            h('thead', {},
                                h('tr', { style: { backgroundColor: c.hover, position: 'sticky', top: 0 } },
                                    ['#', sf.colMaterial, 'QWOT', sf.colThickness].map((col, i) =>
                                        h('th', { key: i, style: { textAlign: i >= 2 ? 'right' : 'left',
                                            padding: '4px 8px', borderBottom: `1px solid ${c.border}`, fontWeight: 600 } }, col)))
                            ),
                            h('tbody', {},
                                compiled.ok ? compiled.layers.map((l, i) => {
                                    const n = resolveMat(l.material).getNK(refLambda)[0];
                                    const qwot = n > 0 ? (4 * n * l.thickness) / refLambda : 0;
                                    return h('tr', { key: i },
                                        h('td', { style: { padding: '2px 8px', color: c.textDim } }, i + 1),
                                        h('td', { style: { padding: '2px 8px' } }, materialLabel(l.material)),
                                        h('td', { style: { padding: '2px 8px', textAlign: 'right', color: c.textDim } }, qwot.toFixed(3)),
                                        h('td', { style: { padding: '2px 8px', textAlign: 'right' } }, l.thickness.toFixed(2)),
                                    );
                                }) : h('tr', {}, h('td', { colSpan: 4, style: { padding: '10px', color: c.textDim,
                                        textAlign: 'center', fontStyle: 'italic' } }, sf.invalidFormula))
                            )
                        )
                    ),
                    // preview — for the back coating the spectrum is seen from the
                    // exit medium (compiled.layers are in the same traversal order).
                    h(PreviewPlot, {
                        compiled,
                        incidentId: effSide === 'back' ? exitMat : incidentMat,
                        substrateId: substrateMat, refLambda, c, height: 200,
                    }),
                ),
            ),

            // footer
            h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                       paddingTop: 12, borderTop: `1px solid ${c.border}`, marginTop: 12, gap: 12, flexWrap: 'wrap' } },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
                    h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                        h('span', { style: { fontSize: 12, color: c.textDim } }, sf.applyToSide),
                        h(SideSeg, { value: applySide, onChange: setApplySide, disabled: isSym, c, sf }),
                        isSym && h('span', { style: { fontSize: 10.5, color: c.textDim, fontStyle: 'italic' } }, sf.symmetricNote),
                    ),
                    h('label', { style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: c.textDim } },
                        h('span', {}, sf.newName),
                        h('input', { type: 'text', value: newName, onChange: (e) => setNewName(e.target.value),
                            style: { width: 140, padding: '5px 8px', fontSize: 12, backgroundColor: c.bg, color: c.text,
                                     border: `1px solid ${c.border}`, borderRadius: 4, outline: 'none' } }),
                    ),
                ),
                h('div', { style: { display: 'flex', gap: 8 } },
                    h(FooterBtn, { onClick: onClose, c }, sf.cancel),
                    h(FooterBtn, { onClick: () => applyToDesign('append'), c,
                        disabled: !compiled.ok || !hasActiveDesign,
                        title: !hasActiveDesign ? sf.noActiveDesign : sf.appendTip }, sf.append),
                    h(FooterBtn, { onClick: () => applyToDesign('replace'), c,
                        disabled: !compiled.ok || !hasActiveDesign,
                        title: !hasActiveDesign ? sf.noActiveDesign : sf.replaceTip }, sf.replace),
                    h(FooterBtn, { onClick: () => applyToDesign('new'), c, primary: true,
                        disabled: !compiled.ok || !folderName,
                        title: !folderName ? sf.noFolder : sf.newTip }, sf.newDesign),
                )
            )
        )
    );
}

function SideSeg({ value, onChange, disabled, c, sf }) {
    const opts = [['front', sf.sideFront], ['back', sf.sideBack], ['both', sf.sideBoth]];
    return h('div', {
        style: { display: 'flex', border: `1px solid ${c.border}`, borderRadius: 4,
                 overflow: 'hidden', opacity: disabled ? 0.5 : 1 }
    },
        opts.map(([v, l], i) => h('button', {
            key: v, disabled, onClick: () => onChange(v),
            style: {
                padding: '5px 11px', fontSize: 12, cursor: disabled ? 'default' : 'pointer',
                border: 'none', borderLeft: i ? `1px solid ${c.border}` : 'none',
                backgroundColor: value === v ? c.accent : c.bg,
                color: value === v ? '#fff' : c.text, outline: 'none',
            }
        }, l))
    );
}

function FooterBtn({ onClick, disabled, primary, title, children, c }) {
    return h('button', {
        onClick, disabled, title,
        style: {
            padding: '8px 18px', fontSize: 13, fontWeight: primary ? 600 : 400,
            backgroundColor: disabled ? c.border : (primary ? c.accent : c.bg),
            color: primary ? '#fff' : c.text,
            border: primary ? 'none' : `1px solid ${c.border}`, borderRadius: 4,
            cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.55 : 1,
        }
    }, children);
}
