/**
 * Stack Formula dialog — characterization test for the pure model layer
 * (src/components/windows/design/stackFormula/model.js).
 *
 * Locks the dialog's contract independently of the parser/builder tests in
 * tests/stack_formula.mjs: seeding, symbol-row edits, and the apply-mode
 * patch/design builders that the dialog's "Append" / "Replace" / "New"
 * buttons drive.
 *
 * Run: node tests/stack_formula_dialog_characterization.mjs
 */

import './_uiShim.mjs';
import {
    computeSeed, buildSymbolMap, withRowMat, withRowSym,
} from '../src/components/windows/design/stackFormula/model.js';
import {
    buildNewDesignFromFormula, buildReplaceAppendPatch,
} from '../src/components/windows/design/stackFormula/designBuild.js';
import { makeDefaultDesign } from '../src/state/DesignContext.js';
import { buildStackFromFormula, DEFAULT_SYMBOL_MAP } from '../src/utils/synthesis/stackFormula.js';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };

const LAM = 550;

// ── computeSeed ──────────────────────────────────────────────────────────────
console.log('— computeSeed —');
{
    const empty = makeDefaultDesign('Empty');
    const seed = computeSeed(empty);
    ok(seed.text === '(H L)^4 H', 'empty design seeds the sample formula');
    ok(seed.rows.length === 3 && seed.rows.every(r => r.fixed), 'empty design seeds fixed H/L/M rows');

    const compiled = buildStackFromFormula({ text: seed.text, symbolMap: DEFAULT_SYMBOL_MAP, refLambda: LAM });
    ok(compiled.ok && compiled.layers.length === 9, 'seeded formula compiles to 9 layers');

    const seeded = { ...empty, frontLayers: compiled.layers, referenceWavelength: LAM };
    const reseed = computeSeed(seeded);
    ok(reseed.text.length > 0, 'non-empty design auto-detects a formula from its front stack');
    ok(reseed.rows.every(r => !r.fixed), 'auto-detected rows are editable, not fixed');
}

// ── symbol row edits ─────────────────────────────────────────────────────────
console.log('— symbol row edits —');
{
    const rows = [{ sym: 'H', matId: 'builtin:TiO2', fixed: true }, { sym: 'L', matId: 'builtin:SiO2', fixed: true }];
    const map = buildSymbolMap(rows);
    ok(map.H === 'builtin:TiO2' && map.L === 'builtin:SiO2', 'buildSymbolMap keeps assigned rows');

    const unassigned = buildSymbolMap([{ sym: 'X', matId: '', fixed: false }, ...rows]);
    ok(unassigned.X === undefined, 'buildSymbolMap excludes empty-material rows');

    const renamed = withRowSym(rows, 0, 'H2');
    ok(renamed[0].sym === 'H2' && renamed[1].sym === 'L', 'withRowSym edits only the targeted row');

    const remapped = withRowMat(rows, 1, 'builtin:Ta2O5');
    ok(remapped[1].matId === 'builtin:Ta2O5' && remapped[0].matId === 'builtin:TiO2', 'withRowMat edits only the targeted row');
}

// ── buildNewDesignFromFormula ────────────────────────────────────────────────
console.log('— buildNewDesignFromFormula —');
{
    const args = {
        newName: 'From Formula', refLambda: LAM,
        incidentMat: 'builtin:Air', substrateMat: 'builtin:BK7', exitMat: 'builtin:Air',
        text: 'H L', symbolMap: DEFAULT_SYMBOL_MAP, startFromSubstrate: false,
    };

    const front = buildNewDesignFromFormula({ ...args, effSide: 'front' });
    ok(front.surfaceMode === 'front_only', 'front side → front_only');
    ok(front.frontLayers.length === 2 && front.backLayers.length === 0, 'front side populates frontLayers only');

    const back = buildNewDesignFromFormula({ ...args, effSide: 'back' });
    ok(back.surfaceMode === 'back_only', 'back side → back_only');
    ok(back.backLayers.length === 2 && back.frontLayers.length === 0, 'back side populates backLayers only');
    // Back storage is substrate→exit; the physical coating is the reverse of front order.
    const front2 = buildNewDesignFromFormula({ ...args, effSide: 'front' });
    ok(back.backLayers.map(l => l.material).join() === front2.frontLayers.slice().reverse().map(l => l.material).join(),
        'back-side layers are the mirror of the same front-side build');

    const both = buildNewDesignFromFormula({ ...args, effSide: 'both' });
    ok(both.surfaceMode === 'both_independent', 'both sides → both_independent');
    ok(both.frontLayers.length === 2 && both.backLayers.length === 2, 'both sides populates front and back');
}

// ── buildReplaceAppendPatch ──────────────────────────────────────────────────
console.log('— buildReplaceAppendPatch —');
{
    const design = { ...makeDefaultDesign('D'), surfaceMode: 'front_only', frontLayers: [], backLayers: [] };
    const compiled = buildStackFromFormula({ text: 'H L', symbolMap: DEFAULT_SYMBOL_MAP, refLambda: LAM });
    ok(compiled.ok, 'test fixture formula compiles');

    // Replace, front_only, effSide front — new frontLayers, no promotion needed.
    const rep = buildReplaceAppendPatch({
        design, mode: 'replace', isSym: false, effSide: 'front', compiled, refLambda: LAM,
        substrateMat: 'builtin:BK7', incidentMat: 'builtin:Air', exitMat: 'builtin:Air',
        text: 'H L', stamp: 1,
    });
    ok(rep.frontLayers.length === 2 && rep.surfaceMode === undefined, 'replace front_only keeps front_only (no promotion)');
    ok(rep.incidentMedium === 'builtin:Air' && rep.stackFormula === 'H L', 'replace writes media + formula fields');

    // Append onto an existing front stack — grows, doesn't overwrite.
    const withExisting = { ...design, frontLayers: [{ id: 'x0', material: 'builtin:SiO2', thickness: 100 }] };
    const app = buildReplaceAppendPatch({
        design: withExisting, mode: 'append', isSym: false, effSide: 'front', compiled, refLambda: LAM,
        substrateMat: 'builtin:BK7', incidentMat: 'builtin:Air', exitMat: 'builtin:Air',
        text: 'H L', stamp: 42,
    });
    ok(app.frontLayers.length === 3, 'append grows the existing front stack');
    ok(app.frontLayers[0].id === 'x0', 'append preserves the existing layer order/ids');
    ok(app.frontLayers[1].id === 'sf-42-f0' && app.frontLayers[2].id === 'sf-42-f1', 'appended layers get stamped ids');
    ok(app.referenceWavelength === undefined, 'append does not touch referenceWavelength (replace-only field)');

    // Append to the back side of a front_only design promotes to both_independent.
    const back = buildReplaceAppendPatch({
        design, mode: 'append', isSym: false, effSide: 'back', compiled, refLambda: LAM,
        substrateMat: 'builtin:BK7', incidentMat: 'builtin:Air', exitMat: 'builtin:Air',
        text: 'H L', stamp: 7,
    });
    ok(back.backLayers.length === 2, 'append to back populates backLayers');
    ok(back.surfaceMode === 'back_only', 'append to back on an empty-front design → back_only (no front present)');

    // Symmetric design: front drives, back is always the mirror.
    const symDesign = { ...design, surfaceMode: 'symmetric' };
    const sym = buildReplaceAppendPatch({
        design: symDesign, mode: 'replace', isSym: true, effSide: 'front', compiled, refLambda: LAM,
        substrateMat: 'builtin:BK7', incidentMat: 'builtin:Air', exitMat: 'builtin:Air',
        text: 'H L', stamp: 1,
    });
    ok(sym.frontLayers.length === 2, 'symmetric replace writes frontLayers');
    ok(sym.backLayers.map(l => l.material).join() === sym.frontLayers.slice().reverse().map(l => l.material).join(),
        'symmetric replace auto-mirrors backLayers from frontLayers');
}

if (fails > 0) { console.error(`\n${fails} FAILED`); process.exit(1); }
console.log('\nAll stack formula dialog characterization tests passed.');
