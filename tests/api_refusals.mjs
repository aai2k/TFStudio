/**
 * Names, options and values the headless API (src/api/) cannot use are
 * refused, each with a message naming what the call takes; a refused save
 * leaves the file as it was.
 *
 * Run: node tests/api_refusals.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const api = await import('../src/api/index.js');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};
const throws = (fn, pattern) => { try { fn(); return false; } catch (err) { return pattern.test(err.message); } };
const rejects = async (fn, pattern) => { try { await fn(); return false; } catch (err) { return pattern.test(err.message); } };

await api.init();
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tfs-api-refusals-'));
const blank = api.newDesign();
// ── Refusals ─────────────────────────────────────────────────────────────
const start = api.setMerit(api.insertLayer(api.insertLayer(blank, { material: 'TiO2', thickness: 30 }), { material: 'SiO2', thickness: 50 }),
    [{ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, target: 0, weight: 1 }]);
const noSubstrate = path.join(TEMP, 'no substrate.tfs');
fs.writeFileSync(noSubstrate, JSON.stringify({ name: 'x', frontLayers: [] }));
const kept = path.join(TEMP, 'kept.tfs');
api.saveDesign(start, kept);
const REFUSALS = [
    ['a file that is not there', () => api.openDesign(path.join(TEMP, 'absent.tfs')), /Could not read design/],
    ['a design with no substrate material', () => api.openDesign(noSubstrate), /no substrate material/],
    ['a save over a file without overwrite', () => api.saveDesign(start, kept), /exists; pass \{ overwrite: true \}/],
    ['an unknown save option', () => api.saveDesign(start, kept, { overWrite: true }), /unknown option 'overWrite'/],
    ['an unknown material, naming close ones', () => api.newDesign({ substrate: 'BK-7' }), /Unknown material 'BK-7'\. Close matches: BK7/],
    ['an empty material name', () => api.insertLayer(blank, { material: '', thickness: 10 }), /Unknown material ''/],
    ['an unknown surface mode', () => api.newDesign({ surfaceMode: 'front' }), /surfaceMode is one of/],
    ['a misspelt setup', () => api.newDesign({ substrateThickness: 3 }), /unknown option 'substrateThickness'; the options are .*substrateThicknessMm/],
    ['a substrate of no thickness', () => api.newDesign({ substrateThicknessMm: 0 }), /substrateThicknessMm/],
    ['a reference wavelength that is not one', () => api.newDesign({ referenceWavelength: -5 }), /referenceWavelength is a wavelength in nm above 0/],
    ['a layer index outside the stack', () => api.insertLayer(blank, { index: 1, material: 'TiO2', thickness: 10 }), /index 1 is outside 0\.\.0/],
    ['a layer of no thickness', () => api.insertLayer(blank, { material: 'TiO2', thickness: 0 }), /thickness is a physical thickness/],
    ['a misspelt layer field', () => api.setLayer(start, { index: 0, thicknessNm: 35 }), /unknown option 'thicknessNm'/],
    ['a lock given as text', () => api.setLayer(start, { index: 0, locked: 'false' }), /locked is true or false/],
    ['an unknown side', () => api.deleteLayer(blank, { side: 'top', index: 0 }), /side is 'front' or 'back'/],
    ['a stack formula that does not read', () => api.stackFromFormula(blank, { formula: '(HL^3' }), /the formula does not read: Expected a layer, "\(", or coefficient, at character 4/],
    ['a formula letter with no material', () => api.stackFromFormula(blank, { formula: 'H Q' }), /Unknown symbol: Q\. Assign a material/],
    ['a formula that names media', () => api.stackFromFormula(blank, { formula: 'Air | H L | BK7' }), /names media; .*setDesignSetup/],
    ['symbols that are not an object', () => api.stackFromFormula(blank, { formula: 'H', symbols: 'abc' }), /symbols is an object/],
    ['a symbol naming no material', () => api.stackFromFormula(blank, { formula: 'H', symbols: { H: 'NoSuch' } }), /Unknown material 'NoSuch'\. Close matches/],
    ['the back of a symmetric design in a formula', () => api.stackFromFormula(api.newDesign({ surfaceMode: 'symmetric' }), { side: 'back', formula: 'H' }), /mirrors the front/],
    ['an unknown setup option', () => api.setDesignSetup(blank, { substrateMaterial: 'SiO2' }), /unknown option 'substrateMaterial'/],
    ['an unknown scoring mode', () => api.setDesignSetup(blank, { mfEvalMode: 'whole' }), /mfEvalMode is 'side'/],
    ['a thickness that is not a number', () => api.insertLayer(blank, { material: 'TiO2', thickness: NaN }), /not NaN/],
    ['a range that runs backwards', () => api.spectrum(start, { from: 700, to: 400 }), /0 < from < to/],
    ['an angle of 90 degrees', () => api.spectrum(start, { from: 400, to: 700, angles: [90] }), /0 <= angle < 90/],
    ['an angle given as the wrong option', () => api.spectrum(start, { from: 400, to: 700, angle: 45 }), /unknown option 'angle'; the options are from, to, step, angles/],
    ['a grid of more than a million points', () => api.spectrum(start, { from: 400, to: 700, step: 0.0001 }), /more than 1000000/],
    ['a grid that is too many points only over its angles', () => api.spectrum(blank, { from: 400, to: 699, step: 0.001, angles: [0, 10, 20, 30] }), /wavelengths times angles/],
    ['an unresolved material', () => api.spectrum({ ...start, frontLayers: [{ id: 'x', material: 'Unobtainium', thickness: 10 }] }, { from: 400, to: 700 }), /resolve to nothing: Unobtainium/],
    ['a wavelength that is not one', () => api.materialNK('SiO2', [NaN]), /wavelengths is a list of wavelengths in nm above 0/],
    ['an unknown operand type', () => api.setMerit(start, [{ type: 'RAVG' }]), /unknown operand type 'RAVG'\. Types: .*RAV/],
    ['a misspelt merit field', () => api.setMerit(start, [{ type: 'RAV', lamStart: 450 }]), /'lamStart' is not a field of a merit row/],
    ['a weight that is not a number', () => api.setMerit(start, [{ type: 'RAV', weight: 'abc' }]), /weight is a number of 0 or more/],
    ['a comparison the thickness rows do not take', () => api.setMerit(start, [{ type: 'TT', cmp: 'lt' }]), /cmp is 'eq', 'le' or 'ge', not "lt"/],
    ['a band that runs backwards', () => api.setMerit(start, [{ type: 'RAV', lambdaStart: 650, lambdaEnd: 450 }]), /lambdaStart 650 is above lambdaEnd 450/],
    ['a band that runs backwards with its end left out', () => api.setMerit(start, [{ type: 'RAV', lambdaStart: 800 }]), /lambdaStart 800 is above lambdaEnd 700/],
    ['a symbol the formula does not use', () => api.stackFromFormula(blank, { formula: 'H L', symbols: { h: 'Ta2O5' } }), /does not use the symbol 'h'; it uses H, L/],
    ['an unknown Monte Carlo quantity', () => api.monteCarlo(start, { quantity: 'X', from: 400, to: 700 }), /quantity is one of/],
    ['a misspelt Monte Carlo option', () => api.monteCarlo(start, { from: 400, to: 700, trials: 1000 }), /unknown option 'trials'/],
    ['a Monte Carlo run of no trial', () => api.monteCarlo(start, { from: 400, to: 700, runs: 0 }), /runs is a whole number of 1/],
    ['a Monte Carlo angle of 90 degrees', () => api.monteCarlo(start, { from: 400, to: 700, angle: 90 }), /angle is an angle/],
    ['a Monte Carlo seed of 0', () => api.monteCarlo(start, { from: 400, to: 700, seed: 0 }), /seed is a whole number from 1/],
    ['a thickness error given as text', () => api.monteCarlo(start, { from: 400, to: 700, thicknessRelPct: 'abc' }), /thicknessRelPct is a number of 0 or more/],
    ['Monte Carlo on a bare substrate', () => api.monteCarlo(blank, { from: 400, to: 700 }), /no layers to perturb/],
    ['layer sensitivity without a merit function', () => api.layerSensitivity(blank), /no merit function/],
    ['a sensitivity step of 0', () => api.layerSensitivity(start, { deltaNm: 0 }), /deltaNm is a thickness change in nm above 0/],
];
for (const [what, fn, pattern] of REFUSALS) ok(`refused: ${what}`, throws(fn, pattern), (() => { try { fn(); return 'not refused'; } catch (err) { return err.message; } })());
const ASYNC_REFUSALS = [
    ['a refinement without a merit function', () => api.refine(blank, { method: 'dls' }), /no merit function/],
    ['an unknown refinement setting', () => api.refine(start, { method: 'dls', maxIters: 5 }), /unknown setting 'maxIters'/],
    ['an unknown hook', () => api.refine(start, { method: 'dls' }, { onprogress: () => {} }), /unknown option 'onprogress'/],
    ['a hook a refinement does not call', () => api.refine(start, { method: 'dls' }, { onRow: () => {} }), /unknown option 'onRow'/],
    ['a hook Deep Synthesis does not call', () => api.synthesize(start, { method: 'deep', pool: ['TiO2'] }, { onProgress: () => {} }), /synthesize deep: unknown option 'onProgress'/],
    ['init with a misspelt option', () => api.init({ datadir: 'X:/data' }), /init: unknown option 'datadir'/],
    ['a hook that is not a function', () => api.refine(start, { method: 'dls' }, { onProgress: 'x' }), /refine: onProgress is a function/],
    ['a signal that is not an AbortSignal', () => api.refine(start, { method: 'dls' }, { signal: true }), /refine: signal is an AbortSignal/],
    ['a synthesis hook that is not a function', () => api.synthesize(start, { method: 'needle', pool: ['TiO2'] }, { onGeneration: 5 }), /synthesize needle: onGeneration is a function/],
    ['init with a path instead of options', () => api.init('X:/data'), /init: the options are an object/],
    ['an unknown synthesis method', () => api.synthesize(start, { method: 'tabu', pool: ['TiO2'] }), /method is one of needle, ge, structural, deep/],
    ['a pool given among the settings', () => api.synthesize(start, { method: 'needle', pool: ['TiO2'], settings: { pool: [] } }), /give the pool as `pool`/],
    ['an empty pool', () => api.synthesize(start, { method: 'needle', pool: [] }), /pool is a list of one or more/],
    ['a pool that names a material twice', () => api.synthesize(start, { method: 'needle', pool: ['TiO2', 'TiO2'] }), /appears twice/],
    ['an unknown pool material', () => api.synthesize(start, { method: 'needle', pool: ['TiO3'] }), /Unknown material 'TiO3'/],
    ['an unknown synthesis setting', () => api.synthesize(start, { method: 'ge', pool: ['TiO2'], settings: { maxLayer: 5 } }), /unknown setting 'maxLayer'/],
    ['a misspelt synthesis request', () => api.synthesize(start, { method: 'ge', materials: ['TiO2'] }), /unknown option 'materials'/],
    ['init with a second data folder', () => api.init({ dataDir: TEMP }), /init already ran/],
];
for (const [what, fn, pattern] of ASYNC_REFUSALS) ok(`refused: ${what}`, await rejects(fn, pattern));
ok('a refused save leaves the file as it was', api.openDesign(kept).frontLayers.length === 2);
{
    let caught = null;
    await api.init({ datadir: 'X:/data' }).catch(err => { caught = err.message; });
    ok('init answers a bad option with a rejected promise', /unknown option 'datadir'/.test(caught), caught);
}

fs.rmSync(TEMP, { recursive: true, force: true });
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
