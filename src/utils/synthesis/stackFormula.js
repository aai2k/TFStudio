/**
 * Stack Formula — parse a compact symbolic coating description into a layer
 * stack, and emit a formula back from a design.
 *
 * Formula syntax (standard symbolic coating notation):
 *   • Layer materials are written by their abbreviations (symbols).
 *   • A numeric PREFIX coefficient is the layer's optical thickness in
 *     QUARTER-WAVE OPTICAL THICKNESS (QWOT) units; the factor 1 may be omitted.
 *         H 0.5L 2H L   →  QWOT = 1, 0.5, 2, 1
 *   • A repeated group is written  (…)^n :
 *         (H L)^4 H     →  9 layers  (HL repeated 4×, then one H)
 *   • "Start from substrate" toggles whether the sequence is read from the
 *     substrate side or from the ambient (incident) side.
 *   • Two-character (multi-character) abbreviations must be separated by
 *     spaces; single-character symbols may be written adjacently (HL → H, L).
 *
 * TFStudio extension: the formula may carry the media as
 *   <incident> | <layers> | <substrate>
 * e.g.  Air | (HL)^4 H | BK7 .  Either or both sides may be omitted (then the
 * design's current media are kept). 'Sub'/'Substrate' on the right keeps the
 * current substrate material; 'Glass' is an alias for BK7.
 *
 * QWOT → physical thickness:   d = coef · λ₀ / (4·n(λ₀))   (Macleod §3.1).
 * The conversion is exact and lossless in QWOT space, so any physical
 * thickness round-trips through `formulaOf` → `buildStackFromFormula` at a
 * fixed λ₀.
 *
 * This module is pure JS and Node-safe (no React / DOM); material lookups go
 * through catalogManager / materialDatabase, which are also Node-safe.
 */

import { getMaterialById, materialLabel, normalizeId } from '../materials/catalogManager.js';
import { getMaterial } from '../materials/materialDatabase.js';

// ── Default symbol table ────────────────────────────────────────────────────
//
// H / L / M follow the filter-design convention (high / low / medium index).
// These are *defaults*; the UI lets the user reassign them and add symbols.
export const DEFAULT_SYMBOL_MAP = {
    H: 'builtin:TiO2',
    L: 'builtin:SiO2',
    M: 'builtin:Al2O3',
};

// Right-side keywords that mean "keep the current substrate" rather than a
// concrete material.
const SUBSTRATE_KEEP_WORDS = new Set(['sub', 'substrate']);
// Convenience aliases recognised even without an explicit symbol-map entry.
const MATERIAL_ALIASES = { Glass: 'builtin:BK7' };

// ── Material resolvers (injectable for tests) ───────────────────────────────

function defaultResolveMatId(sym) {
    if (!sym) return null;
    if (MATERIAL_ALIASES[sym]) return MATERIAL_ALIASES[sym];
    // Compound or legacy id known to the catalog?
    if (getMaterialById(sym)) return sym.includes(':') ? sym : normalizeId(sym);
    // Legacy builtin name in the materialDatabase map (e.g. 'BK7', 'Air')?
    const direct = getMaterial(sym);
    if (direct && direct.id === sym) return sym;
    return null;
}

function defaultGetN(matId, lambda0) {
    const mat = getMaterialById(matId) || getMaterial(matId) || getMaterial('Air');
    return mat && mat.getNK ? mat.getNK(lambda0)[0] : 1.0;
}

const DEFAULT_RESOLVERS = { resolveMatId: defaultResolveMatId, getN: defaultGetN };

// ── Tokenizer ───────────────────────────────────────────────────────────────
//
// Tokens: '|', '(', ')', '^', '@', number, identifier.
// Identifiers are a maximal run [A-Za-z][A-Za-z0-9_]* (so SiO2, Nb2O5, BK7,
// N-BK7 → split on '-' though; we keep '-' out, see note). Numbers start with a
// digit or a dot.

const TOK = { PIPE: '|', LP: '(', RP: ')', CARET: '^', AT: '@', NUM: 'num', ID: 'id' };

export function tokenizeStackFormula(text) {
    const tokens = [];
    const s = String(text ?? '');
    let i = 0;
    const isDigit = (ch) => ch >= '0' && ch <= '9';
    const isAlpha = (ch) => (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z');
    const isAlnum = (ch) => isAlpha(ch) || isDigit(ch);

    while (i < s.length) {
        const ch = s[i];
        if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i++; continue; }
        if (ch === '|') { tokens.push({ type: TOK.PIPE, pos: i }); i++; continue; }
        if (ch === '(') { tokens.push({ type: TOK.LP,  pos: i }); i++; continue; }
        if (ch === ')') { tokens.push({ type: TOK.RP,  pos: i }); i++; continue; }
        if (ch === '^') { tokens.push({ type: TOK.CARET, pos: i }); i++; continue; }
        if (ch === '@') { tokens.push({ type: TOK.AT, pos: i }); i++; continue; }
        if (isDigit(ch) || ch === '.') {
            let j = i + 1;
            while (j < s.length && (isDigit(s[j]) || s[j] === '.')) j++;
            const raw = s.slice(i, j);
            const val = parseFloat(raw);
            // Reject malformed numbers. parseFloat("1.2.3") silently returns 1.2
            // (dropping ".3"), so guard against more than one decimal point in
            // the consumed run in addition to the non-finite check.
            if (!isFinite(val) || (raw.match(/\./g) || []).length > 1) {
                return { error: `Invalid number "${raw}"`, errorPos: i };
            }
            tokens.push({ type: TOK.NUM, value: val, raw, pos: i });
            i = j; continue;
        }
        if (isAlpha(ch)) {
            let j = i + 1;
            while (j < s.length && (isAlnum(s[j]) || s[j] === '_')) j++;
            tokens.push({ type: TOK.ID, value: s.slice(i, j), pos: i });
            i = j; continue;
        }
        return { error: `Unexpected character "${ch}"`, errorPos: i };
    }
    return { tokens };
}

// ── Parser ──────────────────────────────────────────────────────────────────
//
// Grammar (recursive descent):
//   Stack    := (Side '|')? Layers ('|' Side)?     -- 0 or 2 pipes
//   Side     := Identifier ('@' Number)?
//   Layers   := Group+
//   Group    := '(' Layers ')' '^' Integer  |  Atom
//   Atom     := Number? Identifier            -- coef is a QWOT multiplier
//
// Result atoms are FLAT (groups expanded) and symbol-agnostic: each atom is
// { coef, sym, pos } where `sym` is the raw identifier string. Single-char
// adjacency segmentation is deferred to `buildStackFromFormula` because it
// needs the symbol map.

export function parseStackFormula(text) {
    const tk = tokenizeStackFormula(text);
    if (tk.error) return { ok: false, error: tk.error, errorPos: tk.errorPos };
    const tokens = tk.tokens;
    if (tokens.length === 0) return { ok: false, error: 'Empty formula', errorPos: 0 };

    // Split on top-level pipes (pipes never appear inside groups in this grammar).
    const pipeIdx = [];
    tokens.forEach((t, idx) => { if (t.type === TOK.PIPE) pipeIdx.push(idx); });
    if (pipeIdx.length !== 0 && pipeIdx.length !== 2) {
        const at = pipeIdx.length === 1 ? tokens[pipeIdx[0]].pos : tokens[0].pos;
        return { ok: false, error: 'Use exactly two "|" separators (incident | layers | substrate) or none', errorPos: at };
    }

    let incident = null, exit = null, layerToks = tokens, refLambdaOverride = null;
    if (pipeIdx.length === 2) {
        const sides = splitSides(tokens, pipeIdx);
        if (sides.error) return { ok: false, error: sides.error, errorPos: sides.errorPos };
        ({ incident, exit, layerToks, refLambdaOverride } = sides);
    }

    const ctx = { toks: layerToks, i: 0 };
    const atoms = [];
    const res = parseLayers(ctx, atoms, /*topLevel*/ true);
    if (res.error) return { ok: false, error: res.error, errorPos: res.errorPos };
    if (atoms.length === 0) return { ok: false, error: 'No layers in formula', errorPos: layerToks[0]?.pos ?? 0 };

    return {
        ok: true,
        atoms,                       // [{coef, sym, pos}]
        incident, exit,
        hasSides: pipeIdx.length === 2,
        refLambdaOverride,
    };
}

// Split an "incident | layers | substrate" token stream into its three parts
// and parse the two side materials. Called only when exactly two pipes exist.
// Returns { incident, exit, layerToks, refLambdaOverride } or { error, errorPos }.
function splitSides(tokens, pipeIdx) {
    const layerToks = tokens.slice(pipeIdx[0] + 1, pipeIdx[1]);
    const lside = parseSide(tokens.slice(0, pipeIdx[0]));
    if (lside.error) return { error: lside.error, errorPos: lside.errorPos };
    const rside = parseSide(tokens.slice(pipeIdx[1] + 1));
    if (rside.error) return { error: rside.error, errorPos: rside.errorPos };
    let refLambdaOverride = null;
    if (lside.refLambda != null) refLambdaOverride = lside.refLambda;
    if (rside.refLambda != null) refLambdaOverride = rside.refLambda;
    return {
        layerToks,
        incident: lside.sym ? { sym: lside.sym, pos: lside.pos } : null,
        exit:     rside.sym ? { sym: rside.sym, pos: rside.pos } : null,
        refLambdaOverride,
    };
}

function parseSide(toks) {
    if (toks.length === 0) return { sym: null };   // empty side = keep current
    if (toks[0].type !== TOK.ID) return { error: 'Side must be a material symbol', errorPos: toks[0].pos };
    const sym = toks[0].value, pos = toks[0].pos;
    let refLambda = null;
    let k = 1;
    if (k < toks.length && toks[k].type === TOK.AT) {
        if (k + 1 >= toks.length || toks[k + 1].type !== TOK.NUM)
            return { error: 'Expected wavelength after "@"', errorPos: toks[k].pos };
        refLambda = toks[k + 1].value;
        k += 2;
    }
    if (k < toks.length) return { error: 'Unexpected token after side material', errorPos: toks[k].pos };
    return { sym, pos, refLambda };
}

function parseLayers(ctx, out, topLevel) {
    let produced = 0;
    while (ctx.i < ctx.toks.length) {
        const t = ctx.toks[ctx.i];
        if (t.type === TOK.RP) {
            if (topLevel) return { error: 'Unmatched ")"', errorPos: t.pos };
            return { ok: true, produced };
        }
        const g = parseGroup(ctx, out);
        if (g.error) return g;
        produced += g.produced;
    }
    if (!topLevel) return { error: 'Missing ")"', errorPos: ctx.toks[ctx.toks.length - 1]?.pos ?? 0 };
    return { ok: true, produced };
}

function parseGroup(ctx, out) {
    const t = ctx.toks[ctx.i];
    return t.type === TOK.LP ? parseRepeatGroup(ctx, out, t) : parseAtom(ctx, out, t);
}

// '(' Layers ')' '^' Integer — parse a repeated group and expand it in place by
// duplicating the block produced between [start, out.length) (n−1) more times.
function parseRepeatGroup(ctx, out, t) {
    ctx.i++; // consume '('
    const start = out.length;
    const inner = parseLayers(ctx, out, /*topLevel*/ false);
    if (inner.error) return inner;
    // ctx.i now points at the matching ')'
    if (ctx.toks[ctx.i]?.type !== TOK.RP) return { error: 'Missing ")"', errorPos: t.pos };
    ctx.i++; // consume ')'
    if (ctx.toks[ctx.i]?.type !== TOK.CARET) return { error: 'Expected "^n" after group', errorPos: ctx.toks[ctx.i]?.pos ?? t.pos };
    ctx.i++; // consume '^'
    const nTok = ctx.toks[ctx.i];
    if (!nTok || nTok.type !== TOK.NUM) return { error: 'Expected repeat count after "^"', errorPos: nTok?.pos ?? t.pos };
    const n = nTok.value;
    if (!(Number.isInteger(n) && n >= 1)) return { error: 'Repeat count must be a positive integer', errorPos: nTok.pos };
    ctx.i++; // consume number
    const block = out.slice(start);
    let produced = block.length;
    for (let r = 1; r < n; r++) {
        for (const a of block) out.push({ ...a });
        produced += block.length;
    }
    return { ok: true, produced };
}

// Atom := Number? Identifier — the coefficient (QWOT multiplier) binds to the
// following material symbol; a bare symbol implies coefficient 1.
function parseAtom(ctx, out, t) {
    if (t.type === TOK.NUM) {
        const idx = ctx.i + 1;
        const idTok = ctx.toks[idx];
        if (!idTok || idTok.type !== TOK.ID)
            return { error: 'Expected a material symbol after the coefficient', errorPos: idTok?.pos ?? t.pos };
        out.push({ coef: t.value, sym: idTok.value, pos: t.pos });
        ctx.i = idx + 1;
        return { ok: true, produced: 1 };
    }
    if (t.type === TOK.ID) {
        out.push({ coef: 1, sym: t.value, pos: t.pos });
        ctx.i++;
        return { ok: true, produced: 1 };
    }
    return { error: 'Expected a layer, "(", or coefficient', errorPos: t.pos };
}

// ── Symbol resolution + single-char segmentation ────────────────────────────

/**
 * Resolve one atom's raw symbol to a list of {matId, coef} layer specs.
 * Tries: (1) symbol map, (2) direct material, (3) greedy single-char
 * segmentation against the symbol map (so "HL" → H, L). The coefficient binds
 * to the FIRST resulting layer; the rest get coef 1.
 * Returns { specs } or { unknown: <substring that failed> }.
 */
export function resolveAtom(atom, symbolMap, resolvers = DEFAULT_RESOLVERS) {
    const { sym, coef } = atom;
    // (1) symbol map
    if (Object.prototype.hasOwnProperty.call(symbolMap, sym)) {
        return { specs: [{ matId: symbolMap[sym], coef }] };
    }
    // (2) direct material (alias / catalog / legacy)
    const direct = resolvers.resolveMatId(sym);
    if (direct) return { specs: [{ matId: direct, coef }] };
    // (3) single-char segmentation against the symbol map
    const singles = new Set(Object.keys(symbolMap).filter(k => k.length === 1));
    if (sym.length > 1 && singles.size > 0) {
        const parts = [];
        for (const chr of sym) {
            if (singles.has(chr)) parts.push(chr);
            else { parts.length = 0; break; }
        }
        if (parts.length === sym.length) {
            return { specs: parts.map((chr, k) => ({ matId: symbolMap[chr], coef: k === 0 ? coef : 1 })) };
        }
    }
    return { unknown: sym };
}

/**
 * Collect the distinct raw symbols in the parsed atoms that DON'T resolve under
 * the given symbol map (so the UI can prompt the user to assign them). Symbols
 * that segment into known single-char symbols are considered resolved.
 */
export function collectUnknownSymbols(atoms, symbolMap, resolvers = DEFAULT_RESOLVERS) {
    const unknown = [];
    const seen = new Set();
    for (const a of atoms) {
        const r = resolveAtom(a, symbolMap, resolvers);
        if (r.unknown && !seen.has(r.unknown)) { seen.add(r.unknown); unknown.push(r.unknown); }
    }
    return unknown;
}

// ── Build a layer stack from a formula ──────────────────────────────────────

let _seq = 0;
function newLayerId(seed) { return `l-${seed}-${_seq++}`; }

/**
 * Compile a formula string into layers + media.
 *
 * opts:
 *   text                 — formula string
 *   symbolMap            — { sym: matId }
 *   refLambda            — λ₀ (nm) for QWOT→nm conversion
 *   startFromSubstrate   — if true the layer sequence is read substrate→ambient
 *                          and reversed into TFStudio's ambient→substrate order
 *   idSeed               — string seed for stable layer ids (tests/determinism)
 *   resolvers            — { resolveMatId, getN } (injectable; defaults provided)
 *
 * Returns:
 *   { ok, error?, errorPos?,
 *     layers: [{id, material, thickness, locked:false}],   // ambient→substrate
 *     incidentMaterial: matId|null,    // null = side omitted, keep current
 *     substrateMaterial: matId|null,   // null = omitted OR 'Sub' keep-current
 *     refLambda,
 *     unknownSymbols: [...] }
 */
// Resolve the optional incident / substrate side materials of a parsed formula.
// A null result means the side was omitted (or the substrate keyword 'Sub'),
// i.e. keep the design's current medium.
function resolveStackSides(parsed, symbolMap, resolvers) {
    const sideMat = (sym) => resolvers.resolveMatId(sym) || symbolMap[sym] || null;
    const incidentMaterial = parsed.incident ? sideMat(parsed.incident.sym) : null;
    let substrateMaterial = null;
    if (parsed.exit && !SUBSTRATE_KEEP_WORDS.has(parsed.exit.sym.toLowerCase())) {
        substrateMaterial = sideMat(parsed.exit.sym);
    }
    return { incidentMaterial, substrateMaterial };
}

export function buildStackFromFormula(opts) {
    const {
        text,
        symbolMap = DEFAULT_SYMBOL_MAP,
        refLambda: refLambdaIn = 550,
        startFromSubstrate = false,
        idSeed = 'sf',
        resolvers = DEFAULT_RESOLVERS,
    } = opts || {};

    const parsed = parseStackFormula(text);
    if (!parsed.ok) return { ok: false, error: parsed.error, errorPos: parsed.errorPos };

    const refLambda = parsed.refLambdaOverride != null ? parsed.refLambdaOverride : refLambdaIn;
    if (!(refLambda > 0)) return { ok: false, error: 'Reference wavelength must be > 0', errorPos: 0 };

    // Resolve every atom; collect unknowns.
    const unknownSymbols = collectUnknownSymbols(parsed.atoms, symbolMap, resolvers);
    if (unknownSymbols.length > 0) {
        const bad = parsed.atoms.find(a => resolveAtom(a, symbolMap, resolvers).unknown);
        return {
            ok: false,
            error: `Unknown symbol${unknownSymbols.length > 1 ? 's' : ''}: ${unknownSymbols.join(', ')} — assign a material`,
            errorPos: bad ? bad.pos : 0,
            unknownSymbols,
        };
    }

    // Expand atoms → layer specs (segmentation), then to physical layers.
    const specs = [];
    for (const a of parsed.atoms) {
        const r = resolveAtom(a, symbolMap, resolvers);
        for (const sp of r.specs) specs.push(sp);
    }

    const layers = specs.map(sp => {
        const n = resolvers.getN(sp.matId, refLambda);
        const qw = n > 0 ? refLambda / (4 * n) : 0;     // quarter-wave physical thickness
        return {
            id: newLayerId(idSeed),
            material: sp.matId,
            thickness: sp.coef * qw,
            locked: false,
        };
    });

    // TFStudio stores frontLayers ambient→substrate (frontLayers[0] = outermost).
    // If the user wrote the formula starting at the substrate, reverse it.
    if (startFromSubstrate) layers.reverse();

    const { incidentMaterial, substrateMaterial } = resolveStackSides(parsed, symbolMap, resolvers);

    return { ok: true, layers, incidentMaterial, substrateMaterial, refLambda, unknownSymbols: [] };
}

// ── Auto-detect symbols from an existing stack ──────────────────────────────

/**
 * Map a design's distinct layer materials to clean H/L/M symbols ranked by
 * refractive index (highest → H, lowest → L), so a formula seeded from an
 * existing design is compact and readable instead of dumping raw material ids
 * as pseudo-symbols.
 *
 *   layers    — [{material, …}]
 *   refLambda — λ₀ (nm) at which to rank by n
 *   resolvers — { getN } (injectable)
 * Returns { symbolMap:{sym:matId}, id2sym:{matId:sym}, ranked:[matId…] }.
 */
export function autoSymbolMap(layers, refLambda = 550, resolvers = DEFAULT_RESOLVERS) {
    const ids = [];
    for (const l of (layers || [])) if (l.material && !ids.includes(l.material)) ids.push(l.material);
    const ranked = ids.slice().sort((a, b) => resolvers.getN(b, refLambda) - resolvers.getN(a, refLambda));
    const id2sym = {};
    const n = ranked.length;
    if (n === 1) {
        id2sym[ranked[0]] = 'H';
    } else if (n === 2) {
        id2sym[ranked[0]] = 'H'; id2sym[ranked[1]] = 'L';
    } else if (n === 3) {
        id2sym[ranked[0]] = 'H'; id2sym[ranked[1]] = 'M'; id2sym[ranked[2]] = 'L';
    } else if (n > 3) {
        const mids = ['M', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'J', 'K', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];
        id2sym[ranked[0]] = 'H';
        for (let i = 1; i < n - 1; i++) id2sym[ranked[i]] = mids[i - 1] || `Z${i}`;
        id2sym[ranked[n - 1]] = 'L';
    }
    const symbolMap = {};
    for (const id of ranked) symbolMap[id2sym[id]] = id;
    return { symbolMap, id2sym, ranked };
}

// ── Emitter: design → formula (best-effort round-trip) ──────────────────────

function fmtCoef(coef) {
    // Omit factor 1 (standard convention). Render near-integers as integers,
    // otherwise up to 6 decimals (trailing zeros trimmed) — keeps the QWOT→nm
    // round-trip accurate to ~1e-4 nm while staying human-readable.
    if (Math.abs(coef - 1) < 5e-7) return '';
    const r = Math.round(coef);
    if (Math.abs(coef - r) < 5e-7) return String(r);
    let s = coef.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
    return s;
}

/**
 * Greedy adjacent-repeat compression of rendered layer tokens into (…)^n.
 * Single level; picks at each position the period that covers the most tokens.
 */
function compressTokens(tokenStrs) {
    const out = [];
    let i = 0;
    const n = tokenStrs.length;
    while (i < n) {
        let best = null; // { period, count, coverage }
        const maxPeriod = Math.floor((n - i) / 2);
        for (let p = 1; p <= maxPeriod; p++) {
            // how many times does block [i, i+p) repeat consecutively?
            let count = 1;
            while (true) {
                const base = i + count * p;
                if (base + p > n) break;
                let same = true;
                for (let q = 0; q < p; q++) {
                    if (tokenStrs[i + q] !== tokenStrs[base + q]) { same = false; break; }
                }
                if (!same) break;
                count++;
            }
            if (count >= 2) {
                const coverage = count * p;
                if (!best || coverage > best.coverage || (coverage === best.coverage && p < best.period)) {
                    best = { period: p, count, coverage };
                }
            }
        }
        if (best && best.count >= 2) {
            const block = tokenStrs.slice(i, i + best.period).join(' ');
            out.push(best.period > 1 ? `(${block})^${best.count}` : `${blockGroupSingle(tokenStrs[i])}^${best.count}`);
            i += best.coverage;
        } else {
            out.push(tokenStrs[i]);
            i++;
        }
    }
    return out;
}
function blockGroupSingle(tok) { return `(${tok})`; }

/**
 * Emit a stack formula from a design's layers (best-effort).
 *
 * opts:
 *   layers        — [{material, thickness}]  in ambient→substrate order
 *   refLambda     — λ₀ (nm)
 *   symbolMap     — { sym: matId } ; reverse-mapped so matId → sym
 *   incident      — incident material id (optional, emits left side)
 *   substrate     — substrate material id (optional, emits right side)
 *   startFromSubstrate — if true, list substrate→ambient
 *   resolvers     — { getN } (injectable)
 *   compress      — group repeats into (…)^n (default true)
 */
export function formulaOf(opts) {
    const {
        layers = [],
        refLambda = 550,
        symbolMap = DEFAULT_SYMBOL_MAP,
        incident = null,
        substrate = null,
        startFromSubstrate = false,
        resolvers = DEFAULT_RESOLVERS,
        compress = true,
    } = opts || {};

    // matId → symbol (prefer shortest symbol; fall back to material label).
    const rev = {};
    for (const [sym, matId] of Object.entries(symbolMap)) {
        if (!(matId in rev) || sym.length < rev[matId].length) rev[matId] = sym;
    }
    const symbolFor = (matId) => rev[matId] || materialLabel(matId) || matId;

    const seq = startFromSubstrate ? [...layers].reverse() : layers;
    const tokenStrs = seq.map(l => {
        const n = resolvers.getN(l.material, refLambda);
        const qw = n > 0 ? refLambda / (4 * n) : 0;
        const coef = qw > 0 ? (l.thickness || 0) / qw : 0;
        return `${fmtCoef(coef)}${symbolFor(l.material)}`;
    });

    const body = (compress ? compressTokens(tokenStrs) : tokenStrs).join(' ');

    const left  = incident  ? `${symbolFor(incident)} | `  : '';
    const right = substrate ? ` | ${symbolFor(substrate)}` : '';
    return `${left}${body}${right}`;
}
