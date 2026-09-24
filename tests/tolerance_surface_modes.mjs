/**
 * Tolerance windows — back_only / both(total) surface-mode support.
 *
 * Verifies the side-aware machinery the Inhomogeneities and RoughnessScattering
 * windows rely on:
 *   1. Back-stack interlayers expand with substrate→exit media (back layers are
 *      stored substrate→exit; interlayer afterIndex=-1 sits at Sub→firstLayer).
 *   2. Roughness puts a transition layer at every interface of the front stack
 *      (air-first) and of the back stack (substrate-first), which total mode
 *      evaluates together.
 *   3. Per-interface back σ array is independent of the front array.
 *
 * Pure-function level (no WASM / materials DB needed) — run:  node tests/tolerance_surface_modes.mjs
 */
import { expandLayersWithInterlayers, enumerateInterfaces } from '../src/utils/physics/inhomogeneity.js';
import {
    resolveSigmas, countInterfaces, roughenFrontStack, roughenBackStack,
} from '../src/utils/physics/scattering.js';

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

// ── 2. Front and back stacks each get a transition layer per interface ───────
const inc = mk(1.0, 0, 'Air');
const frontRaw = [{ material: H, thickness: 100 }, { material: L, thickness: 80 }, { material: H, thickness: 60 }];
const frontN = countInterfaces(frontRaw.length);  // 3 layers → 4 interfaces
const backN  = countInterfaces(backRaw.length);   // 2 layers → 3 interfaces
const long = n => new Array(n).fill('long');
const front = roughenFrontStack(frontRaw, { incident: inc, substrate: sub },
    { sigmas: resolveSigmas({ mode: 'uniform', sigma: 1.0 }, frontN), ranges: long(frontN) }, 16).layers;
const back = roughenBackStack(backRaw, { substrate: sub, exit },
    { sigmas: resolveSigmas({ mode: 'uniform', sigma: 1.0 }, backN), ranges: long(backN) }, 16).layers;
ok(front.length === 3 + 4, `front: 3 layers + 4 transition layers (got ${front.length})`);
ok(back.length === 2 + 3, `back: 2 layers + 3 transition layers (got ${back.length})`);
ok(approx(back[1].thickness, 98) && approx(back[3].thickness, 78),
    `back: each layer gives 2σ to the interface on its exit side (got ${back[1].thickness}, ${back[3].thickness})`);

// ── 3. Per-interface back array independent of front ────────────────────────
const bkPI = resolveSigmas({ mode: 'perInterface', sigma: 0, sigmas: [2, 0, 3] }, 3);
const backPI = roughenBackStack(backRaw, { substrate: sub, exit }, { sigmas: bkPI, ranges: long(3) }, 16).layers;
ok(backPI.length === 4 && approx(backPI[0].thickness, 4) && approx(backPI[3].thickness, 6),
    `back perInterface: transitions only where σ > 0, 2σ thick (got ${backPI.map(l => l.thickness).join(', ')})`);

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
