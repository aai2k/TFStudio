// ── Interactive tutorial / worked-example curriculum ───────────────────────────
//
// Structure-only definitions: each lesson lists its steps with an optional
// `selector` (a [data-tour] anchor to highlight) and an optional action
// (`tool` to open, `loadDesign` to drop a starter design into the project, or
// `layout` to apply a docking preset). All DISPLAY TEXT lives in the locale
// (`t.tutorials.lessons[key]`) — the player merges text in by step index, so the
// per-lesson step COUNT here must match the locale's `steps` array length.
//
// Starter designs are built from the same conventions as makeDefaultDesign;
// merit targets use the real operand model (`makeOperand`) so they load straight
// into the Merit Function table as `design.meritOperands`.

import { makeOperand } from '../physics/optimizer.js';
import { makeDefaultDesign } from '../../state/DesignContext.js';
import { addCatalog, getCatalog, getMaterialById } from '../materials/catalogManager.js';
import { setSynthesisInnerEngine } from '../synthesis/synthesisConfig.js';

// ── Dedicated "Multipassband (TiO2/SiO2)" material catalog ─────────────────────
// The multipassband exercise uses its own two-material catalog (matching the
// canonical OTF benchmark project), so the needle pool is exactly TiO₂ + SiO₂
// and the thick seed is drawn from it — not the full 16-material Built-in
// library. Built lazily by sampling the Built-in TiO₂/SiO₂ dispersion into a
// tabular catalog so it persists to the user's material library and survives a
// restart (Built-in getNK function refs can't be serialised directly).
const MPB_CATALOG_ID = 'multipassband';

function sampleMaterial(srcId, name) {
    const src = getMaterialById(srcId);
    const tabData = [];
    if (src && src.getNK) {
        for (let lam = 380; lam <= 800; lam += 5) {
            const [n, k] = src.getNK(lam);
            tabData.push([lam, +Number(n).toFixed(5), +Number(k || 0).toFixed(6)]);
        }
    }
    return { id: name, name, formulaNum: -1, tabData, group: 'Dielectric' };
}

// Register the catalog if absent; returns the catalog id to qualify materials
// with (falls back to 'builtin' if sampling fails). Idempotent.
function ensureMultipassbandCatalog() {
    if (getCatalog(MPB_CATALOG_ID)) return MPB_CATALOG_ID;
    const TiO2 = sampleMaterial('TiO2', 'TiO2');
    const SiO2 = sampleMaterial('SiO2', 'SiO2');
    if (!TiO2.tabData.length || !SiO2.tabData.length) return 'builtin';
    try {
        addCatalog({
            id: MPB_CATALOG_ID,
            name: 'Multipassband (TiO2/SiO2)',
            source: 'user',
            materials: { TiO2, SiO2 },
        });
        // Let any mounted material panels (pool, editor) pick up the new catalog.
        try { window.dispatchEvent(new CustomEvent('catalogs-loaded')); } catch (_) {}
    } catch (_) { return 'builtin'; }
    return MPB_CATALOG_ID;
}

let _u = 0;
const L = (material, thickness) => ({ id: `tl-${Date.now()}-${_u++}`, material, thickness, locked: false });

function design(name, frontLayers, meritOperands, lam0 = 550) {
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    return {
        id: `design-tut-${ts}`,
        name,
        incidentMedium: 'Air',
        substrate: { material: 'BK7', thickness: 1.0 },
        exitMedium: 'Air',
        surfaceMode: 'front_only',
        mfEvalMode: 'side',
        frontLayers,
        backLayers: [],
        meritOperands: meritOperands || [],
        referenceWavelength: lam0,
        notes: '',
    };
}

// ── Starter designs ────────────────────────────────────────────────────────────

// Broadband-AR reflectance target (R→0) — shared by the refine / synthesis lessons.
const broadbandAR = (lo = 420, hi = 680) =>
    [makeOperand({ type: 'RAV', lambdaStart: lo, lambdaEnd: hi, aoi: 0, pol: 'avg', target: 0, weight: 1 })];

// A deliberately NON-optimal 4-layer TiO2/SiO2 stack the user refines.
const buildBbarStarter = () =>
    design('BBAR starter (refine me)',
        [L('TiO2', 40), L('SiO2', 120), L('TiO2', 30), L('SiO2', 95)],
        broadbandAR());

// Bare substrate + broadband-AR target, for synthesis from scratch.
const buildArFromScratch = () =>
    design('Broadband AR (synthesize)', [], broadbandAR(400, 700));

// ── Multipassband showcase (OTF-Studio demo class) ─────────────────────────────
// A 4-line transmission filter target on a single THICK HIGH-INDEX (TiO2) seed.
// Needle synthesises by *carving* the bulk into many layers (it adds no
// thickness of its own), so it needs a thick starting TOT.
// Passbands T→1, stopbands T→0 across the visible. (TAV band-average operands.)
const buildMultipassband = () => {
    const catId = ensureMultipassbandCatalog();   // 'multipassband' (or 'builtin' fallback)
    const pass = [[425, 437], [495, 507], [565, 577], [638, 650]];
    const stop = [[400, 420], [442, 490], [512, 560], [582, 633], [655, 700]];
    const ops = [
        ...pass.map(([a, b]) => makeOperand({ type: 'TAV', lambdaStart: a, lambdaEnd: b, aoi: 0, pol: 'avg', target: 1, weight: 1 })),
        ...stop.map(([a, b]) => makeOperand({ type: 'TAV', lambdaStart: a, lambdaEnd: b, aoi: 0, pol: 'avg', target: 0, weight: 1 })),
    ];
    // ~7000 nm TiO2 high-index seed (the bulk the needle carves), drawn from the
    // dedicated Multipassband catalog so the design + pool share one library.
    return design('Multipassband 4-line (high-index seed)', [L(`${catId}:TiO2`, 7000)], ops);
};

// Needle setup for the multipassband exercise — applied (once) when the Needle
// step is entered, so the user doesn't have to touch any advanced setting:
//   • candidate pool  → the Multipassband (TiO2/SiO2) catalog only
//   • inner engine    → CG (benchmark-best for needle)
//   • DLS iterations  → 30  (fast, good result)
//   • max layers      → 60  (the target depth — needle stops there)
function prepMultipassbandNeedle() {
    const catId = ensureMultipassbandCatalog();
    try { localStorage.setItem('tfstudio_needle_selectedCats', JSON.stringify([catId])); } catch (_) {}
    try { setSynthesisInnerEngine('needle', 'cg'); } catch (_) {}
    try {
        localStorage.setItem('tfstudio_needle_dlsIter', '30');
        localStorage.setItem('tfstudio_needle_maxLayers', '60');
    } catch (_) {}
}

// ── Lessons ────────────────────────────────────────────────────────────────────
// `level` ∈ {beginner, intermediate, advanced}. `estMin` = rough minutes.

// Every lesson runs in the Filter-Design layout (Design Editor LEFT, Optical
// Evaluation RIGHT — applied by the renderer at lesson start). Steps that only
// *view* a panel highlight the actual tool window via `data-tutorial-tool`.
// Steps that need a NEW tool open it (docked LEFT, beside the Design Editor) and
// highlight that window too. "Run" steps carry a `gate`: the player blocks Next
// until the gate is satisfied so the user can't skip ahead without optimising:
//   • gate: 'changed'        — the active design changed (refine/GE/cleaner ran)
//   • gate: { minLayers: N }  — the design reached N layers (needle carved enough)

// data-tutorial-tool selector for an open tool window.
const TOOL = (id) => `[data-tutorial-tool="${id}"]`;

export function buildTutorials() {
    const EXPLORER = '[data-tour="explorer"]';
    const DE = TOOL('design-editor');
    const OE = TOOL('optical-eval');

    return [
        {
            key: 'firstDesign', level: 'beginner', estMin: 3,
            steps: [
                { },                                                                       // intro
                { loadDesign: () => makeDefaultDesign('My first design'), selector: EXPLORER }, // create
                { tool: 'design-editor', selector: DE },                                   // Design Editor (left)
                { tool: 'design-editor', selector: DE },                                   // add a layer
                { selector: OE },                                                          // Optical Evaluation (right)
                { },                                                                       // done
            ],
        },
        {
            key: 'singleAR', level: 'beginner', estMin: 4,
            steps: [
                { },                                                                       // intro
                { loadDesign: () => design('Single-layer AR (MgF2)', [L('MgF2', 99.3)], broadbandAR(450, 650)), selector: EXPLORER },
                { },                                                                       // QWOT explanation
                { selector: OE },                                                          // see the dip (OE right)
                { tool: 'design-editor', selector: DE },                                   // experiment (DE left)
                { },                                                                       // done
            ],
        },
        {
            key: 'refine', level: 'intermediate', estMin: 6,
            steps: [
                { },                                                                       // intro
                { loadDesign: buildBbarStarter, selector: EXPLORER },                      // load starter
                { tool: 'merit-function', selector: TOOL('merit-function') },              // the target
                { tool: 'refinement', selector: TOOL('refinement'), gate: 'changed' },     // run refine (gated)
                { selector: OE },                                                          // compare (OE right)
                { },                                                                       // done
            ],
        },
        {
            key: 'synthesize', level: 'advanced', estMin: 8,
            steps: [
                { },                                                                       // intro
                { loadDesign: buildArFromScratch, selector: EXPLORER },                    // bare + target
                { tool: 'merit-function', selector: TOOL('merit-function') },              // confirm target
                { tool: 'gradual', selector: TOOL('gradual'), gate: 'changed' },           // run GE (gated)
                { tool: 'design-editor', selector: DE },                                   // inspect (focus DE left)
                { },                                                                       // done
            ],
        },
        {
            key: 'multipassband', level: 'advanced', estMin: 12,
            steps: [
                { },                                                                       // intro
                { loadDesign: buildMultipassband, selector: EXPLORER },                    // thick seed + 4-line target
                { tool: 'merit-function', selector: TOOL('merit-function') },              // the 4-line target
                { selector: OE },                                                          // bare slab (OE right)
                { tool: 'needle', selector: TOOL('needle'), prep: prepMultipassbandNeedle, gate: { minLayers: 40 } }, // run needle (recommend ~60; gate at 40 so it never stalls below the cap)
                { tool: 'design-editor', selector: DE },                                   // many layers (focus DE left)
                { tool: 'design-cleaner', selector: TOOL('design-cleaner'), gate: 'changed' }, // clean up (gated)
                { selector: OE },                                                          // compare (OE right)
                { },                                                                       // done
            ],
        },
    ];
}
