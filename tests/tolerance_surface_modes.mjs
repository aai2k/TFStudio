/**
 * Tolerance windows — back_only / both(total) surface-mode support.
 *
 * Verifies the side-aware machinery the Inhomogeneities and RoughnessScattering
 * windows rely on:
 *   1. Back-stack interlayers expand with substrate→exit media (back layers are
 *      stored substrate→exit; interlayer afterIndex=-1 sits at Sub→firstLayer).
 *   2. Uncorrelated system roughness σ_eff² = Σσ² combines front + back
 *      interfaces in total mode (Macleod Eq. 16.30 summed over the system).
 *   3. Per-interface back σ array is independent of the front array.
 *
 * Pure-function level (no WASM / materials DB needed) — run:  node tests/tolerance_surface_modes.mjs
 */
import { expandLayersWithInterlayers, enumerateInterfaces } from '../src/utils/physics/inhomogeneity.js';
import { effectiveRoughness, resolveSigmas, countInterfaces } from '../src/utils/physics/scattering.js';

let fail = 0;
const approx = (a, b, e = 1e-4) => Math.abs(a - b) < e;
const ok = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) fail++; };

const mk = (n, k = 0, id = 'M') => ({ id, getNK: () => [n, k] });
const sub = mk(1.52, 0, 'Sub'), exit = mk(1.0, 0, 'Air'), H = mk(2.3, 0, 'H'), L = mk(1.46, 0, 'L');

// ── 1. Back-stack interlayer expansion (substrate→exit media) ────────────────
const backRaw = [{ material: H, thickness: 100 }, { material: L, thickness: 80 }];
const ifaces = enumerateInterfaces(backRaw, 'Sub', 'Exit');
ok(ifaces[0].label === 'Sub → L1', `back iface[0] label is "Sub → L1" (got "${ifaces[0].label}")`);
ok(ifaces[ifaces.length - 1].label === 'L2 → Exit', `back last iface is "L2 → Exit" (got "${ifaces[ifaces.length - 1].label}")`);

const il = [{ afterIndex: -1, thickness: 10, profile: 'linear', slices: 8, enabled: true }];
const exp = expandLayersWithInterlayers(backRaw, sub, exit, il);
ok(exp.length === 10, `2 back layers + 8 slices = 10 expanded (got ${exp.length})`);
const firstSliceN = exp[0].material.getNK(550)[0];
ok(firstSliceN > 1.52 && firstSliceN < 2.30, `first slice grades Sub→H: 1.52 < ${firstSliceN.toFixed(3)} < 2.30`);

// Interlayer at the exit end (afterIndex = last) grades lastLayer→Exit.
const il2 = [{ afterIndex: 1, thickness: 6, profile: 'linear', slices: 5, enabled: true }];
const exp2 = expandLayersWithInterlayers(backRaw, sub, exit, il2);
const lastSliceN = exp2[exp2.length - 1].material.getNK(550)[0];
ok(lastSliceN > 1.0 && lastSliceN < 1.46, `last slice grades L→Exit: 1.0 < ${lastSliceN.toFixed(3)} < 1.46`);

// ── 2. Total-mode roughness combines front + back interfaces ─────────────────
const frontN = countInterfaces(3);  // 3 layers → 4 interfaces
const backN  = countInterfaces(2);  // 2 layers → 3 interfaces
const fr = resolveSigmas({ mode: 'uniform', sigma: 1.0 }, frontN);
const bk = resolveSigmas({ mode: 'uniform', sigma: 1.0 }, backN);
const effFront = effectiveRoughness(fr);
const effTotal = effectiveRoughness([...fr, ...bk]);
ok(approx(effFront, 2.0),        `front-only σ_eff = √4 = 2.0 (got ${effFront.toFixed(4)})`);
ok(approx(effTotal, Math.sqrt(7)), `total σ_eff = √7 = 2.6458 (got ${effTotal.toFixed(4)})`);
ok(effTotal > effFront,          'back interfaces add scatter (total > front-only)');

// ── 3. Per-interface back array independent of front ────────────────────────
const bkPI = resolveSigmas({ mode: 'perInterface', sigma: 0, sigmas: [2, 0, 3] }, 3);
ok(approx(effectiveRoughness(bkPI), Math.sqrt(13)), `back perInterface σ_eff = √13 = 3.6056 (got ${effectiveRoughness(bkPI).toFixed(4)})`);

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
