/**
 * Design Cleaner tests.
 *
 * Run: node tests/design_cleaner.mjs
 *
 * Properties asserted:
 *   • Merge same-material adjacent layers combines thicknesses (locked layers
 *     break the chain).
 *   • Remove sub-threshold layers preserves locked layers regardless of size.
 *   • Symmetric surface mode mirrors the cleaned front into the back.
 *   • Idempotency: applying cleanupDesign twice gives the same result as once.
 *   • No-op design (no thin layers, no same-material adjacents) returns
 *     identical layer counts and an empty ops list.
 *   • listThinLayers reports the right rows and excludes locked layers.
 */

import { cleanupDesign, listThinLayers } from '../src/utils/synthesis/designCleaner.js';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };
const near = (a, b, t = 1e-9) => Math.abs(a - b) <= t;

// ── 1. Merge same-material adjacent ──────────────────────────────────────────
console.log('— merge same-material —');
{
    const design = {
        id: 't1', name: 't1',
        substrate: { material: 'BK7', thickness: 1.0 },
        incidentMedium: 'Air', exitMedium: 'Air',
        frontLayers: [
            { id: 'A', material: 'TiO2', thickness: 60, locked: false },
            { id: 'B', material: 'SiO2', thickness: 20, locked: false },
            { id: 'C', material: 'SiO2', thickness: 30, locked: false },   // ← merges into B
            { id: 'D', material: 'TiO2', thickness: 50, locked: false },
        ],
        backLayers: [], surfaceMode: 'front_only',
    };

    const r = cleanupDesign(design, { dMin: 5.0, mergeAdjacent: true });
    ok(r.layersAfter.front === 3, `merged: 3 layers (got ${r.layersAfter.front})`);
    ok(r.design.frontLayers[1].material === 'SiO2', 'merged layer keeps material');
    ok(near(r.design.frontLayers[1].thickness, 50),
       `merged thickness = 20 + 30 (got ${r.design.frontLayers[1].thickness})`);
    ok(r.mergedCount === 1 && r.removedCount === 0,
       `1 merge, 0 remove (got ${r.mergedCount}/${r.removedCount})`);
}

// ── 2. Locked layer breaks merge chain ────────────────────────────────────────
console.log('— locked breaks merge —');
{
    const design = {
        substrate: { material: 'BK7' }, incidentMedium: 'Air', exitMedium: 'Air',
        frontLayers: [
            { id: 'A', material: 'SiO2', thickness: 20, locked: false },
            { id: 'B', material: 'SiO2', thickness: 30, locked: true  },   // ← can't merge
            { id: 'C', material: 'SiO2', thickness: 40, locked: false },
        ],
        backLayers: [], surfaceMode: 'front_only',
    };
    const r = cleanupDesign(design, { dMin: 5.0, mergeAdjacent: true });
    ok(r.layersAfter.front === 3,
       `locked breaks merge: 3 layers (got ${r.layersAfter.front})`);
    ok(r.mergedCount === 0, `0 merges (got ${r.mergedCount})`);
}

// ── 3. Remove sub-threshold; locked layer is preserved ───────────────────────
console.log('— remove threshold —');
{
    const design = {
        substrate: { material: 'BK7' }, incidentMedium: 'Air', exitMedium: 'Air',
        frontLayers: [
            { id: 'A', material: 'TiO2', thickness: 100, locked: false },
            { id: 'B', material: 'SiO2', thickness: 0.5, locked: false },  // → drop
            { id: 'C', material: 'TiO2', thickness: 50,  locked: false },
            { id: 'D', material: 'SiO2', thickness: 0.3, locked: true  },  // → keep (locked)
            { id: 'E', material: 'TiO2', thickness: 30,  locked: false },
        ],
        backLayers: [], surfaceMode: 'front_only',
    };
    const r = cleanupDesign(design, { dMin: 5.0, mergeAdjacent: false });
    ok(r.layersAfter.front === 4,
       `dropped B, kept locked D: 4 layers (got ${r.layersAfter.front})`);
    ok(r.removedCount === 1, `1 remove (got ${r.removedCount})`);
    ok(r.design.frontLayers.some(l => l.id === 'D' && l.locked),
       `locked D preserved`);
    ok(!r.design.frontLayers.some(l => l.id === 'B'),
       `sub-threshold B is gone`);
}

// ── 4. Symmetric mode mirrors cleaned front into back ────────────────────────
console.log('— symmetric mirror —');
{
    const design = {
        substrate: { material: 'BK7' }, incidentMedium: 'Air', exitMedium: 'Air',
        frontLayers: [
            { id: 'F1', material: 'TiO2', thickness: 80,  locked: false },
            { id: 'F2', material: 'SiO2', thickness: 1.0, locked: false },  // drop
            { id: 'F3', material: 'TiO2', thickness: 40,  locked: false },
        ],
        backLayers: [
            // Junk: should be replaced by reverse(cleaned front)
            { id: 'old', material: 'Air', thickness: 999, locked: false }
        ],
        surfaceMode: 'symmetric',
    };
    const r = cleanupDesign(design, { dMin: 5.0, mergeAdjacent: false });
    ok(r.design.frontLayers.length === 2, `front cleaned: 2 layers`);
    ok(r.design.backLayers.length === 2, `back mirrored: 2 layers`);
    ok(r.design.backLayers[0].material === r.design.frontLayers[1].material &&
       r.design.backLayers[1].material === r.design.frontLayers[0].material,
       `back is reverse(front)`);
}

// ── 5. Idempotency ───────────────────────────────────────────────────────────
console.log('— idempotency —');
{
    const design = {
        substrate: { material: 'BK7' }, incidentMedium: 'Air', exitMedium: 'Air',
        frontLayers: [
            { id: 'A', material: 'TiO2', thickness: 90, locked: false },
            { id: 'B', material: 'TiO2', thickness: 20, locked: false },   // merge into A
            { id: 'C', material: 'SiO2', thickness: 0.4, locked: false },  // remove
            { id: 'D', material: 'TiO2', thickness: 60, locked: false },
        ],
        backLayers: [], surfaceMode: 'front_only',
    };
    const r1 = cleanupDesign(design,         { dMin: 5.0, mergeAdjacent: true });
    const r2 = cleanupDesign(r1.design,      { dMin: 5.0, mergeAdjacent: true });
    ok(r2.ops.length === 0,
       `second pass has 0 ops (idempotent; got ${r2.ops.length})`);
    ok(r2.layersAfter.front === r1.layersAfter.front,
       `layer count unchanged on 2nd pass`);
    // Layer thicknesses identical
    for (let i = 0; i < r1.design.frontLayers.length; i++) {
        ok(near(r2.design.frontLayers[i].thickness, r1.design.frontLayers[i].thickness),
           `2nd pass keeps thickness[${i}]`);
    }
}

// ── 6. No-op (clean design) returns empty ops ────────────────────────────────
console.log('— no-op —');
{
    const design = {
        substrate: { material: 'BK7' }, incidentMedium: 'Air', exitMedium: 'Air',
        frontLayers: [
            { id: 'A', material: 'TiO2', thickness: 100, locked: false },
            { id: 'B', material: 'SiO2', thickness:  80, locked: false },
            { id: 'C', material: 'TiO2', thickness:  50, locked: false },
        ],
        backLayers: [], surfaceMode: 'front_only',
    };
    const r = cleanupDesign(design, { dMin: 5.0, mergeAdjacent: true });
    ok(r.ops.length === 0, `clean design: 0 ops (got ${r.ops.length})`);
    ok(r.layersAfter.front === 3, `clean design: front unchanged`);
}

// ── 7. listThinLayers excludes locked, reports correct rows ─────────────────
console.log('— listThinLayers —');
{
    const design = {
        substrate: { material: 'BK7' }, incidentMedium: 'Air', exitMedium: 'Air',
        frontLayers: [
            { id: 'A', material: 'TiO2', thickness: 100, locked: false },
            { id: 'B', material: 'SiO2', thickness: 0.5, locked: false }, // thin
            { id: 'C', material: 'TiO2', thickness: 1.0, locked: true  }, // thin but locked
            { id: 'D', material: 'SiO2', thickness: 4.5, locked: false }, // thin
        ],
        backLayers: [
            { id: 'B1', material: 'TiO2', thickness: 3.0, locked: false }, // thin (back)
            { id: 'B2', material: 'SiO2', thickness: 50,  locked: false },
        ],
        surfaceMode: 'front_only',
    };
    const list = listThinLayers(design, 5.0);
    ok(list.length === 3,
       `3 thin (B + D + B1; locked C excluded): got ${list.length}`);
    ok(list.some(r => r.side === 'front' && r.layerIndex === 1),
       'front B reported');
    ok(list.some(r => r.side === 'back'  && r.layerIndex === 0),
       'back  B1 reported');
    ok(!list.some(r => r.layerIndex === 2 && r.side === 'front'),
       'locked C not reported');
}

console.log(fails === 0 ? 'PASS: design_cleaner' : `${fails} assertion(s) failed`);
process.exit(fails === 0 ? 0 : 1);
