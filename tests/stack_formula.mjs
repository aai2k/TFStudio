/**
 * Stack Formula tests.
 *
 * Run: node tests/stack_formula.mjs
 *
 * Validates the "Design Formula" notation semantics:
 *   • prefix coefficient = QWOT multiplier (factor 1 omittable)
 *   • (…)^n group repetition
 *   • single-char adjacency segmentation (HL → H L)
 *   • multi-char material names via spaces / direct catalog resolution
 *   • <incident> | layers | <substrate> media sides
 *   • start-from-substrate reversal into TFStudio ambient→substrate order
 *   • formulaOf emitter round-trip + repeat compression
 *   • parse error positions
 */

import {
    parseStackFormula, tokenizeStackFormula, buildStackFromFormula,
    resolveAtom, collectUnknownSymbols, formulaOf, autoSymbolMap, DEFAULT_SYMBOL_MAP,
} from '../src/utils/synthesis/stackFormula.js';
import { getMaterialById } from '../src/utils/materials/catalogManager.js';

let fails = 0;
const ok   = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };
const near = (a, b, t = 1e-9) => Math.abs(a - b) <= t;

const LAM = 550;
const SM  = { ...DEFAULT_SYMBOL_MAP }; // H=TiO2, L=SiO2, M=Al2O3

const nOf  = (matId) => getMaterialById(matId).getNK(LAM)[0];
const qwOf = (matId) => LAM / (4 * nOf(matId));

// ── 1. Coefficient = QWOT multiplier; factor 1 omittable ─────────────────────
console.log('— QWOT coefficients —');
{
    const r = buildStackFromFormula({ text: 'H 0.5L 2H L', symbolMap: SM, refLambda: LAM });
    ok(r.ok, '"H 0.5L 2H L" parses: ' + (r.error || ''));
    ok(r.layers.length === 4, '4 layers');
    const coefs = [1, 0.5, 2, 1];
    const mats  = ['builtin:TiO2', 'builtin:SiO2', 'builtin:TiO2', 'builtin:SiO2'];
    r.layers.forEach((l, k) => {
        ok(l.material === mats[k], `layer ${k} material = ${mats[k]} (got ${l.material})`);
        ok(near(l.thickness, coefs[k] * qwOf(mats[k]), 1e-7),
            `layer ${k} thickness = ${coefs[k]}·QW`);
    });
}

// ── 2. Group repetition (H L)^4 H ────────────────────────────────────────────
console.log('— group repetition —');
{
    const r = buildStackFromFormula({ text: '(H L)^4 H', symbolMap: SM, refLambda: LAM });
    ok(r.ok, '"(H L)^4 H" parses');
    ok(r.layers.length === 9, '9 layers (4·2 + 1)');
    const expect = ['builtin:TiO2', 'builtin:SiO2', 'builtin:TiO2', 'builtin:SiO2',
                    'builtin:TiO2', 'builtin:SiO2', 'builtin:TiO2', 'builtin:SiO2', 'builtin:TiO2'];
    ok(r.layers.every((l, k) => l.material === expect[k]), 'alternating H L … H sequence');
}

// ── 3. Single-char adjacency segmentation (HL == H L) ────────────────────────
console.log('— adjacency segmentation —');
{
    const a = buildStackFromFormula({ text: '(HL)^4 H', symbolMap: SM, refLambda: LAM });
    const b = buildStackFromFormula({ text: '(H L)^4 H', symbolMap: SM, refLambda: LAM });
    ok(a.ok && b.ok, 'both adjacency and spaced forms parse');
    ok(a.layers.length === b.layers.length && a.layers.length === 9, 'same 9-layer count');
    ok(a.layers.every((l, k) => l.material === b.layers[k].material), 'same material sequence');
    // coefficient binds to first segmented symbol only
    const c = buildStackFromFormula({ text: '2HL', symbolMap: SM, refLambda: LAM });
    ok(c.ok && c.layers.length === 2, '"2HL" → 2 layers');
    ok(near(c.layers[0].thickness, 2 * qwOf('builtin:TiO2'), 1e-7), '2HL: first layer 2·QW');
    ok(near(c.layers[1].thickness, 1 * qwOf('builtin:SiO2'), 1e-7), '2HL: second layer 1·QW');
}

// ── 4. Media sides + aliases ─────────────────────────────────────────────────
console.log('— media sides —');
{
    const r = buildStackFromFormula({ text: 'Air | (HL)^4 H | BK7', symbolMap: SM, refLambda: LAM });
    ok(r.ok, 'sided formula parses');
    ok(r.incidentMaterial && r.incidentMaterial.includes('Air'), 'incident = Air (got ' + r.incidentMaterial + ')');
    ok(r.substrateMaterial && r.substrateMaterial.includes('BK7'), 'substrate = BK7 (got ' + r.substrateMaterial + ')');

    const keep = buildStackFromFormula({ text: 'Air | H L | Sub', symbolMap: SM, refLambda: LAM });
    ok(keep.ok && keep.substrateMaterial === null, '"Sub" keeps current substrate (null)');

    const glass = buildStackFromFormula({ text: 'Air | H L | Glass', symbolMap: SM, refLambda: LAM });
    ok(glass.ok && glass.substrateMaterial && glass.substrateMaterial.includes('BK7'), 'Glass alias → BK7');
}

// ── 5. Multi-char material names via spaces (direct catalog resolution) ───────
console.log('— direct material names —');
{
    const r = buildStackFromFormula({ text: 'SiO2 TiO2 Nb2O5', symbolMap: SM, refLambda: LAM });
    ok(r.ok, 'direct material names parse: ' + (r.error || ''));
    ok(r.layers.length === 3, '3 layers');
    ok(r.layers[0].material.includes('SiO2') && r.layers[2].material.includes('Nb2O5'),
        'materials resolved directly from catalog');
}

// ── 6. start-from-substrate reversal ─────────────────────────────────────────
console.log('— start from substrate —');
{
    const amb = buildStackFromFormula({ text: 'H L M', symbolMap: SM, refLambda: LAM, startFromSubstrate: false });
    const sub = buildStackFromFormula({ text: 'H L M', symbolMap: SM, refLambda: LAM, startFromSubstrate: true });
    ok(amb.ok && sub.ok, 'both directions parse');
    ok(amb.layers.map(l => l.material).join() ===
       sub.layers.map(l => l.material).reverse().join(), 'startFromSubstrate reverses order');
}

// ── 7. formulaOf round-trip ──────────────────────────────────────────────────
console.log('— emitter round-trip —');
{
    const built = buildStackFromFormula({ text: 'H 0.5L 2H L', symbolMap: SM, refLambda: LAM });
    const f = formulaOf({ layers: built.layers, refLambda: LAM, symbolMap: SM });
    const rebuilt = buildStackFromFormula({ text: f, symbolMap: SM, refLambda: LAM });
    ok(rebuilt.ok, 'emitted formula re-parses: "' + f + '"');
    ok(rebuilt.layers.length === built.layers.length, 'same layer count after round-trip');
    ok(built.layers.every((l, k) =>
        l.material === rebuilt.layers[k].material &&
        near(l.thickness, rebuilt.layers[k].thickness, 1e-6)), 'thicknesses + materials round-trip');
}

// ── 8. Repeat compression in emitter ─────────────────────────────────────────
console.log('— repeat compression —');
{
    const built = buildStackFromFormula({ text: 'H L H L H L H L H', symbolMap: SM, refLambda: LAM });
    const f = formulaOf({ layers: built.layers, refLambda: LAM, symbolMap: SM, compress: true });
    ok(f.replace(/\s+/g, '') === '(HL)^4H', 'HLHLHLHLH compresses to (H L)^4 H (got "' + f + '")');
    const f0 = formulaOf({ layers: built.layers, refLambda: LAM, symbolMap: SM, compress: false });
    ok(f0.replace(/\s+/g, '') === 'HLHLHLHLH', 'compress:false leaves it flat');
}

// ── 9. @λ override ───────────────────────────────────────────────────────────
console.log('— @lambda override —');
{
    const r = buildStackFromFormula({ text: 'Air@1064 | H L | BK7', symbolMap: SM, refLambda: 550 });
    ok(r.ok, '@λ formula parses');
    ok(r.refLambda === 1064, 'refLambda overridden to 1064');
    ok(near(r.layers[0].thickness, 1064 / (4 * getMaterialById('builtin:TiO2').getNK(1064)[0]), 1e-6),
        'thickness uses overridden λ');
}

// ── 10. Errors with positions ────────────────────────────────────────────────
console.log('— error handling —');
{
    const e1 = parseStackFormula('Air | H L');
    ok(!e1.ok && /two "\|"/.test(e1.error), 'single pipe rejected');

    const e2 = parseStackFormula('(H L H');
    ok(!e2.ok, 'unmatched paren rejected');

    const e3 = parseStackFormula('H 2');
    ok(!e3.ok && /coefficient/.test(e3.error), 'coefficient without symbol rejected');

    const e4 = buildStackFromFormula({ text: 'H X L', symbolMap: SM, refLambda: LAM });
    ok(!e4.ok && e4.unknownSymbols.includes('X'), 'unknown symbol reported');
    ok(e4.errorPos === 2, 'error position points at X (pos 2), got ' + e4.errorPos);

    const e5 = parseStackFormula('(H L)^0');
    ok(!e5.ok && /positive integer/.test(e5.error), '^0 rejected');

    const e6 = parseStackFormula('');
    ok(!e6.ok, 'empty formula rejected');
}

// ── 11. collectUnknownSymbols / resolveAtom ──────────────────────────────────
console.log('— symbol collection —');
{
    const p = parseStackFormula('H L Foo Bar');
    const unk = collectUnknownSymbols(p.atoms, SM);
    ok(unk.length === 2 && unk.includes('Foo') && unk.includes('Bar'), 'collects Foo, Bar');
    const r = resolveAtom({ coef: 1, sym: 'H' }, SM);
    ok(r.specs && r.specs[0].matId === 'builtin:TiO2', 'resolveAtom maps H → TiO2');
}

// ── 12. autoSymbolMap (seed from existing design) ────────────────────────────
console.log('— auto-detect symbols —');
{
    // Two materials: Nb2O5 (high n) and SiO2 (low n) — like beamsplitter.tfs.
    // Whatever the catalog ids, ranking by n must give H=high, L=low and the
    // emitted formula must use H/L (no raw material-id slop) and round-trip.
    const layers = [
        { material: 'builtin:SiO2',  thickness: 80 },
        { material: 'builtin:Nb2O5', thickness: 120 },
        { material: 'builtin:SiO2',  thickness: 95 },
        { material: 'builtin:Nb2O5', thickness: 60 },
    ];
    const { symbolMap, id2sym, ranked } = autoSymbolMap(layers, LAM);
    ok(id2sym['builtin:Nb2O5'] === 'H', 'higher-index Nb2O5 → H');
    ok(id2sym['builtin:SiO2'] === 'L', 'lower-index SiO2 → L');
    ok(ranked.length === 2, 'two distinct materials');

    const f = formulaOf({ layers, refLambda: LAM, symbolMap });
    ok(/^[0-9. HL()^]+$/.test(f), 'emitted formula uses only H/L symbols, no material-id slop: "' + f + '"');
    ok(!/SiO2|Nb2O5|_/.test(f), 'no raw material names/ids leak into the formula');

    // round-trip back to the same materials + thicknesses
    const rb = buildStackFromFormula({ text: f, symbolMap, refLambda: LAM });
    ok(rb.ok && rb.layers.length === 4, 'auto-symbol formula re-parses to 4 layers');
    ok(layers.every((l, k) => l.material === rb.layers[k].material &&
        near(l.thickness, rb.layers[k].thickness, 1e-3)), 'round-trips materials + thicknesses (≤1e-3 nm)');

    // three materials → H/M/L
    const three = autoSymbolMap([
        { material: 'builtin:TiO2' }, { material: 'builtin:Al2O3' }, { material: 'builtin:SiO2' },
    ], LAM).id2sym;
    ok(three['builtin:TiO2'] === 'H' && three['builtin:SiO2'] === 'L' && three['builtin:Al2O3'] === 'M',
        'three materials → H (TiO2) / M (Al2O3) / L (SiO2)');
}

// ── tokenizer sanity ─────────────────────────────────────────────────────────
console.log('— tokenizer —');
{
    const t = tokenizeStackFormula('2H (L M)^3');
    ok(!t.error && t.tokens.length === 8, 'tokenizes "2H (L M)^3" into 8 tokens (got ' + (t.tokens?.length) + ')');
    const bad = tokenizeStackFormula('H $ L');
    ok(bad.error && bad.errorPos === 2, 'bad char flagged at pos 2');
}

console.log(fails === 0 ? '\n✅ all stack-formula tests passed' : `\n❌ ${fails} assertion(s) failed`);
process.exit(fails === 0 ? 0 : 1);
