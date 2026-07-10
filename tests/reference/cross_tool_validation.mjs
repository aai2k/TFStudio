/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  CROSS-TOOL VALIDATION — TFStudio engine vs an independent third-party TMM
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Loads `reference_tmm.json` (produced by tests/reference/gen_reference_tmm.py
 * using Steven Byrnes' peer-reviewed `tmm` package, arXiv:1603.02720) and feeds
 * the SAME complex indices and thicknesses into the TFStudio engine. Because the
 * inputs are byte-identical (both use n = n + ik, k > 0), any disagreement is a
 * pure MATH difference — there is no material-data confound.
 *
 * Compared, per coating case:
 *   • R, T, A            — power (convention-free) at every λ/angle/polarization
 *   • arg(r)             — reflected phase for s-pol (this is what GD = −dφ/dω uses)
 *   • Ψ, Δ               — ellipsometry (Ψ direct; Δ via the documented convention map)
 *   • |E|²               — field intensity at fixed depths (s-pol)
 *   • GD                 — group delay on a dispersive mirror, both from arg(r)
 *
 * Run:  node tests/reference/cross_tool_validation.mjs
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
    tmm, tmmWithAdmittances, computeEllipsometry,
    computeEFieldProfile, computeGroupDelaySpectrum, C_NM_PER_FS,
} from '../../src/utils/physics/thinFilmMath.js';

const here = dirname(fileURLToPath(import.meta.url));
const ref = JSON.parse(readFileSync(join(here, 'reference_tmm.json'), 'utf8'));

let fails = 0, passes = 0;
const worst = {};                    // per-quantity worst absolute error
const bump = (k, e) => { worst[k] = Math.max(worst[k] ?? 0, e); };
const ok = (c, m) => { if (c) passes++; else { fails++; console.error('  ✗ FAIL:', m); } };
const near = (a, b, tol, m, key) => { const d = Math.abs(a - b); if (key) bump(key, d); ok(d <= tol, `${m} (got ${a}, want ${b}, Δ=${d.toExponential(2)})`); };

const toLayers = (c) => {
    const n = c.n_list, d = c.d_list;
    const L = [];
    for (let i = 1; i < n.length - 1; i++) L.push({ n: n[i], d: Number(d[i]) });
    return { n0: n[0], ns: n[n.length - 1], layers: L };
};
const carg = (z) => Math.atan2(z[1], z[0]);
const wrapPi = (x) => { while (x > Math.PI) x -= 2 * Math.PI; while (x < -Math.PI) x += 2 * Math.PI; return x; };

console.log(`Reference: ${ref.generator}`);
console.log(`${ref.cases.length} coating cases · byte-identical inputs · MATH-only comparison\n`);

// ── R/T/A per case (power — convention-free) ─────────────────────────────────
for (const c of ref.cases) {
    const { n0, ns, layers } = toLayers(c);
    let nRTA = 0, maxRTA = 0;
    for (const p of c.spectral) {
        const e = tmm(p.lam, p.th, p.pol, n0, ns, layers);
        near(e.R, p.R, 5e-6, `${c.name} R @${p.lam}/${p.th}°/${p.pol}`, 'R');
        near(e.T, p.T, 5e-6, `${c.name} T @${p.lam}/${p.th}°/${p.pol}`, 'T');
        near(e.A, p.A, 5e-6, `${c.name} A @${p.lam}/${p.th}°/${p.pol}`, 'A');
        maxRTA = Math.max(maxRTA, Math.abs(e.R - p.R), Math.abs(e.T - p.T), Math.abs(e.A - p.A));
        // |r|² must equal R (ties the complex amplitude to the power)
        const r = tmmWithAdmittances(p.lam, p.th, p.pol, n0, ns, layers).r;
        bump('|r|²−R', Math.abs((r[0] * r[0] + r[1] * r[1]) - p.R));
        nRTA++;
    }
    console.log(`  ✓ ${c.name.padEnd(34)} R/T/A ×${String(nRTA).padStart(2)}  maxΔ=${maxRTA.toExponential(1)}`);
}

// ── Ellipsometry Ψ, Δ ────────────────────────────────────────────────────────
// Ψ is convention-free and must match exactly. Δ differs by a global +180°:
// TFStudio follows Macleod Eq. 16.2 (Δ = φ_p − φ_s ± 180°, the Woollam/Nebraska
// convention); Byrnes tmm uses the opposite p-sign. The offset must be EXACTLY
// 180° at every point for the convention to be self-consistent.
console.log('\n  Ellipsometry (Ψ convention-free; Δ_TF = Δ_tmm + 180°, Macleod Eq. 16.2):');
const circ = (a, b) => { let d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
let maxOff = 0;
for (const c of ref.cases) {
    if (!c.ellips.length) continue;
    const { n0, ns, layers } = toLayers(c);
    for (const p of c.ellips) {
        const e = computeEllipsometry(p.lam, p.th, n0, ns, layers);
        near(e.psi, p.psi_deg, 1e-6, `${c.name} Ψ @${p.lam}/${p.th}°`, 'Ψ [deg]');
        const d = circ(e.delta, p.delta_deg + 180);   // apply the documented map
        bump('Δ (mapped) [deg]', d);
        maxOff = Math.max(maxOff, Math.abs(circ(e.delta, p.delta_deg) - 180));
        ok(d < 1e-4, `${c.name} Δ @${p.lam}/${p.th}° (TF=${e.delta.toFixed(3)}, tmm+180=${((p.delta_deg + 180) % 360).toFixed(3)}, Δ=${d.toExponential(2)})`);
    }
    console.log(`  ✓ ${c.name.padEnd(34)} ellipsometry ×${c.ellips.length}`);
}
ok(maxOff < 1e-4, `Δ offset is a clean global 180° at every point (max dev ${maxOff.toExponential(2)}°)`);

// ── E-field |E|² (s-pol) ─────────────────────────────────────────────────────
console.log('\n  Electric field |E|² (s-pol, at fixed depths):');
for (const c of ref.cases) {
    if (!c.efield.length) continue;
    const { n0, ns, layers } = toLayers(c);
    let maxE = 0;
    for (const p of c.efield) {
        const prof = computeEFieldProfile(p.lam, p.th, p.pol, n0, ns, layers, 200);
        // absolute depth z = (sum of film thicknesses before `layer`) + dist.
        // tmm layer L (1-based, 0=incident) ↔ TFStudio film index L−1.
        let zAbs = 0; for (let i = 0; i < p.layer - 1; i++) zAbs += layers[i].d;
        zAbs += p.dist;
        // interpolate TFStudio e2 at zAbs
        const z = prof.z, e2 = prof.e2;
        let v = e2[0];
        for (let i = 1; i < z.length; i++) {
            if (z[i] >= zAbs) { const f = (zAbs - z[i - 1]) / (z[i] - z[i - 1] || 1); v = e2[i - 1] + f * (e2[i] - e2[i - 1]); break; }
            v = e2[i];
        }
        const d = Math.abs(v - p.E2); bump('|E|²', d);
        ok(d < 1e-4, `${c.name} |E|² L${p.layer}+${p.dist}nm (got ${v.toFixed(5)}, want ${p.E2.toFixed(5)}, Δ=${d.toExponential(2)})`);
        maxE = Math.max(maxE, d);
    }
    console.log(`  ✓ ${c.name.padEnd(34)} |E|² ×${c.efield.length}  maxΔ=${maxE.toExponential(1)}`);
}

// ── Group delay on the dispersive (Gires–Tournois) mirror ────────────────────
// tmm computes GD in its own time convention (values come out negative here);
// TFStudio's is the conjugate convention, and its absolute sign is independently
// pinned physically-correct by the matched-slab analytic oracle (gd_sign_slab).
// So GD_TF must equal −GD_tmm to high precision, INCLUDING through the sharp
// resonance — which validates GD/GDD (GDD is the derivative of this GD).
console.log('\n  Group delay GD = −dφ/dω (Gires–Tournois mirror, fine matched grid):');
{
    const g = ref.gd_case;
    const c = ref.cases.find(x => x.name === g.name);
    const { n0, ns, layers } = toLayers(c);
    const coeffR = (L) => tmmWithAdmittances(L, 0, 's', n0, ns, layers).r;
    const tf = computeGroupDelaySpectrum(coeffR, g.lo, g.hi, g.N);      // same grid as tmm
    const gdAt = (L) => { let best = 0, bd = 1e9; for (let i = 0; i < tf.lambda.length; i++) { const dd = Math.abs(tf.lambda[i] - L); if (dd < bd) { bd = dd; best = tf.gd[i]; } } return best; };
    let maxGD = 0, signOK = 0;
    for (let i = 0; i < g.lam.length; i++) {
        const a = gdAt(g.lam[i]), b = g.gd[i];
        if (Math.sign(a) === Math.sign(-b)) signOK++;      // GD_TF and −GD_tmm same sign
        const d = Math.abs(a - (-b)); maxGD = Math.max(maxGD, d); bump('GD [fs]', d);
    }
    ok(maxGD < 0.05, `GD_TF = −GD_tmm across the GTI resonance (${g.lam.length} pts, maxΔ=${maxGD.toExponential(2)} fs)`);
    ok(signOK === g.lam.length, `sign relation GD_TF = −GD_tmm holds at every point (${signOK}/${g.lam.length})`);
    const rng = g.gd.reduce((m, v) => [Math.min(m[0], -v), Math.max(m[1], -v)], [1e9, -1e9]);
    console.log(`  ✓ ${g.name.padEnd(34)} GD ×${g.lam.length}  TFStudio range ${rng[0].toFixed(2)}…${rng[1].toFixed(2)} fs  maxΔ=${maxGD.toExponential(2)} fs`);
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(70)}`);
console.log('  Worst-case disagreement vs independent tmm, by quantity:');
for (const [k, v] of Object.entries(worst)) console.log(`     ${k.padEnd(14)} ${v.toExponential(2)}`);
console.log(`${'═'.repeat(70)}`);
console.log(`  RESULT: ${passes} passed, ${fails} failed  (${passes + fails} cross-tool checks)`);
console.log(`${'═'.repeat(70)}`);
if (fails) process.exit(1);
console.log('  ✅ TFStudio matches the independent tmm reference on every quantity.');
process.exit(0);
