import { getMaterial } from '../../../../utils/materials/materialDatabase.js';
import { getMaterialById } from '../../../../utils/materials/catalogManager.js';
import { evaluateSpectrum } from '../../../../utils/physics/thinFilmMath.js';
import {
    formulaOf, autoSymbolMap, collectUnknownSymbols,
    resolveAtom, DEFAULT_SYMBOL_MAP,
} from '../../../../utils/synthesis/stackFormula.js';

export function resolveMat(id) {
    if (!id) return getMaterial('Air');
    return getMaterialById(id) || getMaterial(id) || getMaterial('Air');
}

// Which symbols in the parsed atoms need a symbol→material assignment row?
// Direct catalog material names (SiO2, BK7, …) don't; H/L/M and any unknown
// token do. Multi-char tokens that segment into singles contribute the singles.
export function neededSymbols(atoms, symbolMap) {
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

// Symbol → material map from the editable row list. Empty-material rows are
// intentionally EXCLUDED so a used but unassigned symbol resolves to
// "unknown" (→ a clear error) instead of Air.
export function buildSymbolMap(symRows) {
    const m = {};
    for (const r of symRows) if (r.sym && r.matId) m[r.sym] = r.matId;
    return m;
}

export function withRowMat(rows, idx, matId) {
    return rows.map((r, i) => i === idx ? { ...r, matId } : r);
}

export function withRowSym(rows, idx, sym) {
    return rows.map((r, i) => i === idx ? { ...r, sym } : r);
}

// Symbols actually referenced in the formula (for "used but unassigned"
// highlighting in the assignment list).
export function usedSymbolSet(parsed, symbolMap) {
    return new Set(parsed.ok ? neededSymbols(parsed.atoms, symbolMap) : []);
}

// New assignment rows for any symbol used in the formula but not yet
// tracked, or null if there's nothing to add.
export function missingSymbolRows(parsed, symbolMap, symRows) {
    if (!parsed.ok) return null;
    const unknown = collectUnknownSymbols(parsed.atoms, symbolMap);
    const missing = unknown.filter(u => !symRows.some(r => r.sym === u));
    return missing.length ? missing.map(s => ({ sym: s, matId: '', fixed: false })) : null;
}

export function stackTotalThickness(compiled) {
    return compiled.ok ? compiled.layers.reduce((s, l) => s + l.thickness, 0) : 0;
}

// Compute the initial formula text + symbol-assignment rows for the dialog.
// For an existing front stack: auto-detect symbols (autoSymbolMap) and emit a
// compact formula. For an empty design: H/L/M defaults + a sample formula.
export function computeSeed(design) {
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

// T/R spectrum for the preview plot, or { error } when the compiled stack /
// media aren't resolvable. Pure of DOM/Plotly — PreviewPlot only draws it.
export function previewSpectrum(compiled, incidentId, substrateId, refLambda) {
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
}
