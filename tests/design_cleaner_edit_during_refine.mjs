/**
 * Design Cleaner keeps an edit made while its re-optimize runs.
 *
 * The window stays usable while the pass after a cleanup refines the stack,
 * so the design can change under it: an operand retargeted, the angle moved.
 * The app's design store applies each updateDesign patch to the design as it
 * was in the render that made that updateDesign (DesignContext, controlled
 * mode). Writing the result with the updateDesign from the Apply click puts the
 * design back as it was at the click, with only the layers new.
 *
 *   1. A cleanup whose pass is still running when the operands change ends
 *      with the cleaned, refined layers and the changed operands.
 *   2. With no edit, the same cleanup ends on the same layers.
 *
 * Run: node tests/design_cleaner_edit_during_refine.mjs
 */
import { shimBrowserGlobals, loadApp } from './_uiShim.mjs';
import { makeHookRuntime, importWithHookRuntime } from './_hookHarness.mjs';

shimBrowserGlobals();
await loadApp();
// No worker: the pass steps on this thread, one step per timer tick.
globalThis.Worker = class BlockedWorker { constructor() { throw new Error('module workers blocked'); } };

const { makeOperand } = await import('../src/utils/physics/optimizer.js');
const { designMaterialLookup } = await import('../src/utils/materials/designMaterials.js');
const { computeCleanupPreview } = await import('../src/components/windows/optimization/designCleaner/model.js');
const runtime = makeHookRuntime();
const { useCleanupRun } = await importWithHookRuntime(
    '../src/components/windows/optimization/designCleaner/useDesignCleaner.js', runtime);

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };

const dc = { appliedMsg: (rem, mer) => `applied ${rem}/${mer}`, mfRefineMsg: (a, b) => `mf ${a} -> ${b}` };
const settings = { reoptimize: true, reoptIters: 10, dMin: 5 };

// Ten alternating TiO2/SiO2 layers (nm) off any optimum, with a 2 nm Ta2O5
// layer the cleanup removes. Merit: R averaged over 450-650 nm, target 0.
const rav = target => makeOperand({ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, aoi: 0, pol: 'avg', target, weight: 1 });
const base = [25, 40, 110, 20];
const frontLayers = Array.from({ length: 10 }, (_, i) => ({
    id: `L${i + 1}`, material: i % 2 === 0 ? 'TiO2' : 'SiO2',
    thickness: base[i % base.length] * (1 + 0.25 * Math.sin(1.7 * i + 0.3)), locked: false,
}));
frontLayers.splice(3, 0, { id: 'thin', material: 'Ta2O5', thickness: 2, locked: false });
const design0 = {
    id: 'cleaner-edit', incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1.0 },
    frontLayers, backLayers: [], surfaceMode: 'front_only', mfEvalMode: 'side',
    meritOperands: [rav(0)],
};
const resolveMaterial = designMaterialLookup(design0);
const preview = computeCleanupPreview(design0, { dMin: settings.dMin, mergeAdjacent: true, cleanBack: true });

// One Apply. `edit`, when given, changes the design right after the click,
// while the pass is running, and the window renders again with it.
async function applyWithEdit(edit) {
    let stored = design0;
    const render = design => runtime.render(() => useCleanupRun({
        dc, design, preview, settings, resolveMaterial, checkpoint: () => {},
        // The store's rule: the patch lands on the design this render saw.
        updateDesign: (patch) => { stored = { ...design, ...patch }; },
    }));
    const pending = render(design0).apply();
    if (edit) { stored = edit(stored); render(stored); }
    await pending;
    return stored;
}

// ── 1. An operand retargeted while the pass runs ────────────────────────────
const retarget = d => ({ ...d, meritOperands: [rav(0.01)] });
const edited = await applyWithEdit(retarget);
ok(edited.meritOperands[0].target === 0.01, `the retargeted operand survives the result (target ${edited.meritOperands[0].target})`);
ok(edited.frontLayers.length === preview.design.frontLayers.length, 'the result carries the cleaned stack');

// ── 2. No edit ──────────────────────────────────────────────────────────────
const plain = await applyWithEdit(null);
ok(plain.meritOperands[0].target === 0, 'with no edit the operands are unchanged');
ok(plain.frontLayers.every((l, i) => l.thickness === edited.frontLayers[i].thickness),
    'and the layers are the same as with the edit: the pass ran on the design as clicked');
ok(plain.frontLayers.some((l, i) => l.thickness !== preview.design.frontLayers[i].thickness),
    'the pass moved the thicknesses');

if (fails === 0) { console.log('PASS: design cleaner keeps an edit made while it refines'); process.exit(0); }
console.error(`\n${fails} assertion(s) failed`);
process.exit(1);
