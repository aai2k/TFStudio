/**
 * computeRIProfile structural sanity test.
 *
 * The RI profile carries no wave physics — it is the geometric layout of the
 * already-validated dispersive n,k as a left-hand step. We assert exactly that:
 *   - step edges land on cumulative geometric boundaries,
 *   - each segment carries its own layer's (n,k),
 *   - incident-medium lead-in and substrate tail are present,
 *   - optical thickness = Σ nᵢ·dᵢ.
 *
 * Run: node tests/ri_profile_structure.mjs
 */
import { computeRIProfile } from '../src/utils/physics/thinFilmMath.js';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };
const near = (a, b, t = 1e-9) => Math.abs(a - b) <= t;

const n0 = { n: 1.0,  k: 0 };          // air
const ns = { n: 1.52, k: 0 };          // glass
const layers = [
    { n: 2.35, k: 0.001, d: 100, materialId: 'H' }, // high index, slight absorption
    { n: 1.46, k: 0,     d: 200, materialId: 'L' }, // low index
    { n: 2.35, k: 0.001, d:  50, materialId: 'H' },
];

const p = computeRIProfile(n0, ns, layers);
ok(p !== null, 'profile computed');

// Boundaries: [0, 100, 300, 350]
const eb = [0, 100, 300, 350];
ok(p.layerBounds.length === eb.length && p.layerBounds.every((v, i) => near(v, eb[i])),
   `layerBounds = ${JSON.stringify(p.layerBounds)} (expected ${JSON.stringify(eb)})`);
ok(near(p.totalThk, 350), `totalThk = ${p.totalThk}`);

// 'hv' node alignment: x = [-lead, 0, b1, b2, total, total+lead]  (N=3 ⇒ 6 nodes)
ok(p.z.length === layers.length + 3, `z length = ${p.z.length} (expected 6)`);
ok(p.z[0] < 0, 'lead-in starts at negative z (incident medium shown)');
ok(near(p.z[1], 0) && near(p.z[2], 100) && near(p.z[3], 300) && near(p.z[4], 350),
   `interior z nodes = ${JSON.stringify(p.z.slice(1, 5))}`);
ok(p.z[5] > 350, 'substrate tail extends past total thickness');

// y nodes: n = [n0, n1, n2, n3, ns, ns]
ok(near(p.n[0], 1.0) && near(p.n[1], 2.35) && near(p.n[2], 1.46) &&
   near(p.n[3], 2.35) && near(p.n[4], 1.52) && near(p.n[5], 1.52),
   `n nodes = ${JSON.stringify(p.n)}`);
ok(near(p.k[0], 0) && near(p.k[1], 0.001) && near(p.k[2], 0) &&
   near(p.k[3], 0.001) && near(p.k[4], 0) && near(p.k[5], 0),
   `k nodes = ${JSON.stringify(p.k)}`);

// Optical thickness Σ nᵢ·dᵢ = 2.35·100 + 1.46·200 + 2.35·50 = 644.5
ok(near(p.optThk, 2.35 * 100 + 1.46 * 200 + 2.35 * 50),
   `optThk = ${p.optThk} (expected 644.5)`);
ok(near(p.maxN, 2.35), `maxN = ${p.maxN}`);
ok(near(p.minN, 1.0),  `minN = ${p.minN}`);

// Zero-thickness layers are dropped.
const p2 = computeRIProfile(n0, ns, [{ n: 2.0, k: 0, d: 0 }]);
ok(p2 === null, 'all-zero-thickness design → null');

console.log(fails === 0 ? 'PASS: computeRIProfile structural test' : `${fails} assertion(s) failed`);
process.exit(fails === 0 ? 0 : 1);
