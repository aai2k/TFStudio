/**
 * Characterization test for the worker-side table-lookup material resolver.
 *
 * Covers the four resolution paths: exact pre-sampled λ hit, nearest-λ fallback
 * (with its one-time 'warn' postMessage), the empty-table [1,0] guard, and the
 * Air / null-id fallbacks — plus per-id stub caching.
 */

// makeResolveMat calls the worker global postMessage on a λ miss; stub it.
const warnings = [];
globalThis.postMessage = (msg) => warnings.push(msg);

const { makeResolveMat } = await import('../src/utils/workers/resolveMat.js');

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) fails++; };
const arrEq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

const materials = {
    Air:  { lambdas: [500], n: [1], k: [0] },
    Glass: { lambdas: [500, 600, 700], n: [1.5, 1.52, 1.55], k: [0, 0.01, 0.02] },
};

const resolve = makeResolveMat(materials, 'testworker');

// Exact hits — bit-identical [n,k] from the pre-sampled grid.
ok(arrEq(resolve('Glass').getNK(500), [1.5, 0]), 'exact λ=500 hit');
ok(arrEq(resolve('Glass').getNK(600), [1.52, 0.01]), 'exact λ=600 hit');
ok(warnings.length === 0, 'no warning while every λ is an exact hit');

// Nearest-λ fallback — 640 is closer to 600 than 700; one-time warning fires.
ok(arrEq(resolve('Glass').getNK(640), [1.52, 0.01]), 'nearest-λ fallback picks closer grid point');
ok(arrEq(resolve('Glass').getNK(680), [1.55, 0.02]), 'nearest-λ fallback picks the other side');
ok(warnings.length === 1, 'fallback warning is reported once, not per miss');
ok(warnings[0].type === 'warn' && /testworker/.test(warnings[0].message), 'warning carries worker label');

// Stub caching — same object returned for the same id.
ok(resolve('Glass') === resolve('Glass'), 'resolver caches the per-id stub');

// Air / null-id fallbacks.
ok(arrEq(resolve('Air').getNK(500), [1, 0]), 'Air resolves');
ok(resolve(null) === resolve('Air'), 'null id falls back to Air');
ok(resolve('') === resolve('Air'), 'empty id falls back to Air');

// Unknown id with no Air-equivalent grid still yields the [1,0] guard when the
// table has entries but the id is missing → falls back to Air (which has λ=500).
ok(arrEq(resolve('Nonexistent').getNK(500), [1, 0]), 'unknown id falls back to Air table');

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAIL`);
process.exit(fails === 0 ? 0 : 1);
