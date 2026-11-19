// ── Interactive tutorial / worked-example curriculum ───────────────────────────
//
// Structure-only definitions: each lesson lists its steps with an optional
// `selector` to highlight (a CSS selector, or a list of them of which the first
// one on screen is ringed: the control a step names, then its window; see
// useTargetRect for `{ all }`), an optional `panel` side for the coach panel,
// and an optional action (`tool` to open, `loadDesign(name)` to drop a starter
// design into the project under the locale's `designName`, or `layout` to
// apply a docking preset). All DISPLAY TEXT lives in the locale
// (`t.tutorials.lessons[key]`) — the player merges text in by step index, so the
// per-lesson step COUNT here must match the locale's `steps` array length.
//
// Starter designs are built from the same conventions as makeDefaultDesign;
// merit targets use the real operand model (`makeOperand`) so they load straight
// into the Merit Function table as `design.meritOperands`.

import { makeOperand, makeConstraintOperand, DEFAULT_CONSTRAINT_LAST_LAYER } from '../physics/optimizer.js';
import { makeDefaultDesign } from '../../state/DesignContext.js';
import { addCatalog, getCatalog, getMaterialById } from '../materials/catalogManager.js';
import { setSynthesisInnerEngine } from '../synthesis/synthesisConfig.js';
import { TABULATED_INTERPOLATION } from '../materials/pchip.js';
import { savePersist as saveProcessExport } from '../../components/windows/dataExchange/processSimulator/persistence.js';

// ── Dedicated "Multipassband (TiO2/SiO2)" material catalog ─────────────────────
// The multipassband exercise uses its own two-material catalog (matching the
// canonical OTF benchmark project), so the needle pool is exactly TiO₂ + SiO₂
// and the thick seed is drawn from it — not the full Built-in
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
    return {
        id: name,
        name,
        formulaNum: -1,
        interp: TABULATED_INTERPOLATION,
        tabData,
        group: 'Dielectric',
    };
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

// Quarter-wave physical thickness of a Built-in material at lam0 (nm), d = λ₀ / 4n.
const quarterWave = (id, lam0 = 550) => +(lam0 / (4 * getMaterialById(id).getNK(lam0)[0])).toFixed(2);

// A thickness floor (MNT) or ceiling (MXT) over every layer, as the merit
// wizard's thickness limits write it.
const thicknessLimit = (type, nm) =>
    makeConstraintOperand({ type, lambdaStart: 1, lambdaEnd: DEFAULT_CONSTRAINT_LAST_LAYER, target: nm });

// One MgF2 quarter wave at 550 nm on BK7. No merit rows: the lesson reads the
// spectrum, and a target band would shade the plot it reads.
const buildSingleLayerAR = (name) => design(name, [L('MgF2', quarterWave('MgF2'))], []);

// Two quarter waves at 550 nm on BK7, SiO2 on the air side and ZrO2 on the
// glass. They leave R near 3.2 %: two quarter waves cancel only when
// n(ZrO2) / n(SiO2) = √n(BK7). The lesson then has the user type the compact
// root of Re r = Im r = 0 at 550 nm for these Built-in materials, SiO2
// 121.97 nm over ZrO2 21.33 nm (the other root is 66.40 over 106.29 nm).
const buildVCoatStart = (name) =>
    design(name, [L('SiO2', quarterWave('SiO2')), L('ZrO2', quarterWave('ZrO2'))], []);

// The four-layer start of the published refinement walkthrough (blog
// "Refining a Four-Layer Broadband AR Coating"), air side first, with its
// targets: R = 0 and T = 1 over 450-650 nm, and every layer kept between
// 30 and 250 nm. Sequential QP, the Refinement window's default, takes it to
// MF 0.000981 in 29 iterations, as the article shows.
const buildRefineStarter = (name) => design(name,
    [L('MgF2', 100), L('HfO2', 70), L('SiO2', 50), L('HfO2', 35)],
    [
        makeOperand({ type: 'RGT', lambdaStart: 450, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 0, targetEnd: 0, weight: 1 }),
        makeOperand({ type: 'TGT', lambdaStart: 450, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 1, targetEnd: 1, weight: 1 }),
        thicknessLimit('MNT', 30),
        thicknessLimit('MXT', 250),
    ]);

// The refined result of that walkthrough, air side first, as the published
// angle and polarization article measures it. No merit rows: the lesson reads
// the spectrum at angles the coating was not designed for.
const buildRefinedAR = (name) => design(name,
    [L('MgF2', 105.89), L('HfO2', 51.95), L('SiO2', 30.57), L('HfO2', 31.06)], []);

// A single-cavity narrowband filter at 550 nm, H L H L HH L H L H with H TiO2
// and L SiO2 quarter waves: two quarter-wave mirrors around a half-wave TiO2
// spacer. Its pass peak is narrow, so the few-nm shift a 1 % thickness error
// gives shows plainly in Error Analysis, where an AR coating barely moves.
const buildNarrowbandFilter = (name) => {
    const H = () => L('TiO2', quarterWave('TiO2'));
    const Lo = () => L('SiO2', quarterWave('SiO2'));
    return design(name, [H(), Lo(), H(), Lo(), L('TiO2', 2 * quarterWave('TiO2')), Lo(), H(), Lo(), H()], []);
};

// Eight quarter waves at 450 nm, SiO2 on the air side, with no merit rows: the
// user draws a T = 50 % line over 450-650 nm and refines onto it. This start
// is the one the README targets recording uses; Sequential QP takes it onto
// the line.
const buildBeamsplitterStart = (name) => design(name,
    Array.from({ length: 8 }, (_, i) => (i % 2 ? L('TiO2', quarterWave('TiO2', 450)) : L('SiO2', quarterWave('SiO2', 450)))),
    []);

// Bare substrate + broadband-AR target, for synthesis from scratch, with a
// 15 nm floor on every layer. Gradual Evolution's Min thickness follows the MNT
// row. 15 nm is the window's own default floor; from this start a 20 nm floor
// ends at an average R of 0.8 % against 0.12 % at 15 nm (TiO2/SiO2 pool,
// measured headless).
const buildArFromScratch = (name) => design(name, [], [
    makeOperand({ type: 'RAV', lambdaStart: 400, lambdaEnd: 700, aoi: 0, pol: 'avg', target: 0, weight: 1 }),
    thicknessLimit('MNT', 15),
]);

// ── Multipassband showcase (OTF-Studio demo class) ─────────────────────────────
// A 4-line transmission filter target on a single THICK HIGH-INDEX (TiO2) seed.
// Needle synthesises by *carving* the bulk into many layers (it adds no
// thickness of its own), so it needs a thick starting TOT.
// Passbands T→1, stopbands T→0 across the visible. (TAV band-average operands.)
const buildMultipassband = (name) => {
    const catId = ensureMultipassbandCatalog();   // 'multipassband' (or 'builtin' fallback)
    const pass = [[425, 437], [495, 507], [565, 577], [638, 650]];
    const stop = [[400, 420], [442, 490], [512, 560], [582, 633], [655, 700]];
    const ops = [
        ...pass.map(([a, b]) => makeOperand({ type: 'TAV', lambdaStart: a, lambdaEnd: b, aoi: 0, pol: 'avg', target: 1, weight: 1 })),
        ...stop.map(([a, b]) => makeOperand({ type: 'TAV', lambdaStart: a, lambdaEnd: b, aoi: 0, pol: 'avg', target: 0, weight: 1 })),
    ];
    // 2500 nm TiO2 high-index seed (the bulk the needle carves), drawn from the
    // dedicated Multipassband catalog so the design + pool share one library.
    // A thicker seed ends at a lower merit but leaves narrow transmission
    // spikes in the stopbands, which the band averages barely count.
    return design(name, [L(`${catId}:TiO2`, 2500)], ops);
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

// Gradual Evolution setup for the synthesis lesson, applied before its window
// opens. A bare substrate offers the pool no material of its own, so the pool
// is set to TiO2 and SiO2 from the Built-in catalog: the whole Built-in library
// with a low floor ends in a stack of 2-8 nm layers including Au and Cr, and
// adding MgF2 to the pair ends on three low-index layers.
const AR_SYNTHESIS_POOL = new Set(['TiO2', 'SiO2']);
function prepArSynthesis() {
    const builtin = Object.keys(getCatalog('builtin')?.materials || {});
    try {
        localStorage.setItem('tfstudio_ge_selectedCats', JSON.stringify(['builtin']));
        localStorage.setItem('tfstudio_ge_selectedCats_excl', JSON.stringify(builtin.filter(id => !AR_SYNTHESIS_POOL.has(id))));
    } catch (_) {}
}

// The Process Exporter plays the process lesson's run at 10×, the fastest
// speed it offers, so the narrowband filter's nine layers (about 720 nm at the
// default 1 nm/s) play in about 70 s: slow enough to see each layer move the
// spectrum, short enough to watch to the end.
function prepProcessExport() {
    saveProcessExport({ playSpeed: 10 });
}

// ── Lessons ────────────────────────────────────────────────────────────────────
// `level` ∈ {beginner, intermediate, advanced}. `estMin` = rough minutes.
// Lessons are listed by level, in the order the browser shows them, since a
// lesson's last step offers the one listed after it.

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
// Selector for an element by its data-tour anchor.
const AT = (anchor) => `[data-tour="${anchor}"]`;
// A control a step names, inside an open tool window, then the window itself
// while the control is not on screen: the player rings the first one it finds.
const CONTROL = (tool, anchor) => [`${TOOL(tool)} ${AT(anchor)}`, TOOL(tool)];
// As CONTROL, ringing every control of that anchor together, such as the
// thickness cells of all the layers when a step sets more than one.
const CONTROLS = (tool, anchor) => [{ all: `${TOOL(tool)} ${AT(anchor)}` }, TOOL(tool)];

export function buildTutorials() {
    const EXPLORER = AT('explorer');
    const DE = TOOL('design-editor');
    const OE = TOOL('optical-eval');
    // Stack Formula is opened from the ribbon: its button once the Setup tab
    // is showing, the tab until then.
    const FORMULA = [AT('ribbon-button-stack-formula'), AT('ribbon-tab-setup')];
    // Optical Evaluation's Settings, where the plot's Y range and angles are
    // set, and where a lesson's last step asks for them back.
    const PLOT_SETTINGS = CONTROL('optical-eval', 'settings');

    return [
        {
            key: 'firstDesign', level: 'beginner', estMin: 3,
            steps: [
                { },                                                                       // intro
                { loadDesign: makeDefaultDesign, selector: EXPLORER },                     // create
                { tool: 'design-editor', selector: DE },                                   // Design Editor (left)
                { tool: 'design-editor', selector: CONTROL('design-editor', 'add-layer') }, // add a TiO2 layer
                { selector: OE },                                                          // R rises (OE right)
                { },                                                                       // done
            ],
        },
        {
            key: 'singleAR', level: 'beginner', estMin: 5,
            steps: [
                { },                                                                       // intro
                { loadDesign: buildSingleLayerAR, selector: EXPLORER },                    // MgF2 quarter wave
                { },                                                                       // QWOT explanation
                { selector: PLOT_SETTINGS },                                               // zoom the Y axis (OE right)
                { selector: OE },                                                          // see the minimum (OE right)
                { tool: 'design-editor', selector: CONTROLS('design-editor', 'thickness') }, // experiment: edit left, read R right
                { selector: PLOT_SETTINGS },                                               // done: Y back to 0-100
            ],
        },
        {
            key: 'bothSides', level: 'beginner', estMin: 4,
            steps: [
                { },                                                                       // a design is a whole part
                { loadDesign: buildSingleLayerAR, selector: CONTROL('design-editor', 'ignore-other-side') }, // MgF2 AR on the front only; reads R right
                { tool: 'design-editor', selector: CONTROL('design-editor', 'ignore-other-side') }, // untick Ignore other side
                { selector: OE },                                                          // the bare back reflects
                { tool: 'design-editor', selector: CONTROL('design-editor', 'copy-to-other-side') }, // Copy to back
                { selector: PLOT_SETTINGS },                                               // done: Y back to 0-100
            ],
        },
        {
            key: 'vCoat', level: 'beginner', estMin: 4,
            steps: [
                { },                                                                       // two layers, two thicknesses
                { loadDesign: buildVCoatStart, selector: EXPLORER },        // quarter-wave pair; reads R right
                { },                                                                       // why quarter waves fail
                { tool: 'design-editor', selector: CONTROLS('design-editor', 'thickness') }, // type the V-coat thicknesses
                { selector: PLOT_SETTINGS },                                               // the V (OE right)
                { selector: PLOT_SETTINGS },                                               // done: Y back to 0-100
            ],
        },
        {
            // Stack Formula is a dialog, which a step cannot open; the user
            // opens it from the ribbon and the step waits for the stack.
            key: 'mirror', level: 'beginner', estMin: 5,
            steps: [
                { },                                                                       // HL pairs add in phase
                { loadDesign: (name) => design(name, [], []), selector: EXPLORER },        // bare BK7
                { selector: FORMULA, gate: 'changed' },                                    // (H L)^8 in Stack Formula
                { selector: OE },                                                          // the high-reflectance band
                { selector: FORMULA, gate: 'changed' },                                    // (H L)^4: fewer pairs
                { tool: 'design-editor', selector: [AT('reference-wavelength'), AT('stack-settings'), DE] }, // λ₀ 700: the band moves
                { },                                                                       // done
            ],
        },
        {
            key: 'refine', level: 'intermediate', estMin: 6,
            steps: [
                { },                                                                       // intro
                { loadDesign: buildRefineStarter, selector: EXPLORER },                    // load starter
                { tool: 'merit-function', selector: TOOL('merit-function') },              // the target
                { tool: 'refinement', selector: CONTROL('refinement', 'run'), gate: 'changed' }, // run refine (gated)
                { selector: OE },                                                          // compare (OE right)
                { selector: PLOT_SETTINGS },                                               // done: Y back to 0-100
            ],
        },
        {
            key: 'anglePolarization', level: 'intermediate', estMin: 5,
            steps: [
                { },                                                                       // coatings are tilted
                { loadDesign: buildRefinedAR, selector: EXPLORER },         // refined 4-layer AR
                { selector: PLOT_SETTINGS },                                               // add 30, 45, 60°
                { selector: OE },                                                          // the curves move and rise
                { selector: CONTROL('optical-eval', 'curves-R') },                         // s against p
                { selector: PLOT_SETTINGS },                                               // done: angles, Y and curves back
            ],
        },
        {
            key: 'admittance', level: 'intermediate', estMin: 5,
            steps: [
                { },                                                                       // how, not what
                { loadDesign: buildSingleLayerAR, selector: EXPLORER },                    // MgF2 quarter wave
                { tool: 'admittance', selector: TOOL('admittance') },                      // the three markers
                { tool: 'admittance', selector: TOOL('admittance') },                      // a quarter wave is half a circle
                { tool: 'design-editor', selector: CONTROLS('design-editor', 'thickness') }, // make it a half wave
                { tool: 'admittance', selector: TOOL('admittance') },                      // the full circle
                { },                                                                       // done
            ],
        },
        {
            key: 'color', level: 'intermediate', estMin: 4,
            steps: [
                { },                                                                       // the spectrum is the colour
                { loadDesign: buildRefinedAR, selector: EXPLORER },         // refined 4-layer AR
                { tool: 'color-eval', selector: TOOL('color-eval') },                      // Y, dominant λ, purity
                { tool: 'color-eval', selector: CONTROL('color-eval', 'settings') },       // Fit hue
                { },                                                                       // done
            ],
        },
        {
            key: 'drawTarget', level: 'intermediate', estMin: 5,
            steps: [
                { },                                                                       // draw the spec
                { loadDesign: buildBeamsplitterStart, selector: EXPLORER }, // 8 quarter waves at 450 nm
                { selector: CONTROL('optical-eval', 'edit-targets') },                     // draw T = 50 %
                { tool: 'refinement', selector: CONTROL('refinement', 'run'), gate: 'changed' }, // refine onto it
                { selector: OE },                                                          // on the line
                { },                                                                       // done
            ],
        },
        {
            key: 'thicknessErrors', level: 'intermediate', estMin: 5,
            steps: [
                { },                                                                       // no coater is exact
                { loadDesign: buildNarrowbandFilter, selector: EXPLORER },  // 9-layer narrowband
                { tool: 'error-analysis', selector: CONTROL('error-analysis', 'quantity') }, // T, then Run
                { tool: 'error-analysis', selector: TOOL('error-analysis') },              // read the corridor
                { tool: 'error-analysis', selector: CONTROL('error-analysis', 'sigma-rel') }, // 2 %
                { },                                                                       // done
            ],
        },
        {
            key: 'zemax', level: 'intermediate', estMin: 4,
            steps: [
                { },                                                                       // coatings by name
                { loadDesign: buildRefinedAR, selector: EXPLORER },         // refined 4-layer AR
                // The Export tab, then Generate preview once the tab is open.
                { tool: 'zemax-coatings', selector: [`${TOOL('zemax-coatings')} ${AT('generate')}`, ...CONTROL('zemax-coatings', 'tab-export')] },
                { tool: 'zemax-coatings', selector: TOOL('zemax-coatings') },              // read the preview
                { tool: 'zemax-coatings', selector: CONTROL('zemax-coatings', 'save') },   // save under a new name
                { },                                                                       // in OpticStudio
            ],
        },
        {
            key: 'processExport', level: 'intermediate', estMin: 5,
            steps: [
                { },                                                                       // layer by layer
                { loadDesign: buildNarrowbandFilter, selector: EXPLORER },                 // 9-layer narrowband
                { tool: 'process-sim', prep: prepProcessExport, selector: CONTROL('process-sim', 'play') }, // Play at 10×
                { tool: 'process-sim', selector: TOOL('process-sim') },                    // what the curves do
                { tool: 'process-sim', selector: CONTROL('process-sim', 'sequence') },     // hold a layer
                { tool: 'process-sim', selector: CONTROL('process-sim', 'save') },         // the .res files
                { },                                                                       // done
            ],
        },
        {
            key: 'monitoring', level: 'advanced', estMin: 6,
            steps: [
                { },                                                                       // before the run
                { loadDesign: buildNarrowbandFilter, selector: EXPLORER },  // 9-layer narrowband
                { tool: 'monitor-worksheet', selector: TOOL('monitor-worksheet') },        // at 550 nm
                { tool: 'monitor-worksheet', selector: CONTROL('monitor-worksheet', 'auto-lambda') }, // Auto λ
                { tool: 'monitor-worksheet', selector: CONTROL('monitor-worksheet', 'layers-per-chip') }, // one chip
                { },                                                                       // done
            ],
        },
        {
            key: 'synthesize', level: 'advanced', estMin: 8,
            steps: [
                { },                                                                       // intro
                { loadDesign: buildArFromScratch, selector: EXPLORER },                    // bare + target
                { tool: 'merit-function', selector: TOOL('merit-function') },              // confirm target
                { tool: 'gradual', selector: CONTROL('gradual', 'run'), prep: prepArSynthesis, gate: 'changed' }, // run GE (gated)
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
                { tool: 'needle', selector: CONTROL('needle', 'run'), prep: prepMultipassbandNeedle, gate: { minLayers: 40 } }, // run needle (recommend ~60; gate at 40 so it never stalls below the cap)
                { tool: 'design-editor', selector: DE },                                   // many layers (focus DE left)
                { tool: 'design-cleaner', selector: CONTROL('design-cleaner', 'run'), gate: 'changed' }, // clean up (gated)
                { selector: OE },                                                          // compare (OE right)
                { },                                                                       // done
            ],
        },
    ];
}
