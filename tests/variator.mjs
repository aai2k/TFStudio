/**
 * Variator helper tests — wrapMaterial offset + clamp behaviour, and
 * thicknessRangeNm slider-range floor.
 *
 * Run: node tests/variator.mjs
 */
import { wrapMaterial, thicknessRangeNm } from '../src/utils/misc/variator.js';

let fails = 0;
const ok   = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };
const near = (a, b, tol = 1e-12) => Math.abs(a - b) <= tol;

const base = {
    id: 'TestMat',
    name: 'Test Material',
    color: '#abc',
    getNK: (lam) => [1.5 + 1e-4 * (lam - 550), 0.001 * (lam < 400 ? 1 : 0)],
};

// 1) Identity short-circuit — both offsets zero returns the SAME object
//    (so consumers can rely on object identity for caching).
{
    const w = wrapMaterial(base, 0, 0);
    ok(w === base, 'Δn=Δk=0 returns base by identity (no wrapping)');
}

// 2) Δn,Δk apply additively at every λ
{
    const dn = 0.10, dk = 0.005;
    const w = wrapMaterial(base, dn, dk);
    ok(w !== base, 'non-zero offsets produce a new wrapper');
    ok(typeof w.getNK === 'function', 'wrapper exposes getNK');

    for (const lam of [350, 450, 550, 650, 800]) {
        const [n0, k0] = base.getNK(lam);
        const [n1, k1] = w.getNK(lam);
        ok(near(n1, n0 + dn), `n offset @ λ=${lam}: ${n1} vs ${n0}+${dn}`);
        ok(near(k1, Math.max(0, k0 + dk)), `k offset @ λ=${lam}: ${k1} vs max(0,${k0}+${dk})`);
    }
}

// 3) k clamped to ≥ 0 — absorption physically can't go negative.
{
    const noiselessNK = { id: 'NK', name: 'NK', getNK: () => [1.4, 0.02] };
    const w = wrapMaterial(noiselessNK, 0, -0.5);   // pushes k negative
    const [, k] = w.getNK(550);
    ok(near(k, 0), `k clamped to 0 (got ${k})`);
}

// 4) wrapper carries id + color metadata so the renderer can colour-code it.
{
    const w = wrapMaterial(base, 0.05, 0);
    ok(w.id.endsWith("'"), `wrapped id ends with ' (got ${w.id})`);
    ok(w.color === base.color, 'colour carried over');
    ok(w.name.includes('Δn'), `name shows Δn (got: ${w.name})`);
}

// 5) Pass-through on null / malformed material — Variator may resolve a
//    missing material; we must not throw.
{
    ok(wrapMaterial(null, 0.1, 0) === null, 'null base passes through');
    ok(wrapMaterial({}, 0.1, 0).getNK === undefined,
       'malformed base (no getNK) passes through unchanged');
}

// 6) thicknessRangeNm — floor at ±20 nm for thin layers, scales with base
{
    const r1 = thicknessRangeNm(10);    // thin
    ok(near(r1.min, -20) && near(r1.max, 20), `thin layer range = ±20 (got ${r1.min}..${r1.max})`);
    const r2 = thicknessRangeNm(500);   // thick
    ok(near(r2.min, -100) && near(r2.max, 100), `thick layer range = ±20 % (got ${r2.min}..${r2.max})`);
    const r3 = thicknessRangeNm(100);   // boundary
    ok(near(r3.min, -20) && near(r3.max, 20), `100-nm base hits ±20 floor (got ${r3.min}..${r3.max})`);
}

if (fails === 0) {
    console.log('OK — all Variator helper tests pass.');
    process.exit(0);
} else {
    console.error(`FAILED — ${fails} assertion(s) failed.`);
    process.exit(1);
}
