/**
 * tmmWasm.js loader MARSHALLING test (no compiled kernel required).
 *
 * The loader packs JS data into WASM linear memory and unpacks the results. That
 * index/layout math is the half of the WASM feature that is NOT in C, so it can
 * and should be validated in-session. Here we back the EXACT C ABI
 * (src/wasm/tmm_kernel.c) with a JS mock that reads/writes the same memory
 * layout and delegates the actual physics to the authoritative JS TMM. If the
 * loader's pointer arithmetic is wrong, the wrappers return wrong numbers.
 *
 * This does NOT test the C kernel itself (that's tests/wasm_tmm_equivalence.mjs,
 * run after `npm run build:wasm`). It tests that tmmWasm.js talks to a kernel
 * that obeys the documented ABI correctly.
 *
 * Run: node tests/wasm_loader_marshalling.mjs
 */

import { TmmWasmInstance } from '../src/utils/workers/tmmWasm.js';
import { tmm, tmmThicknessJacobian, tmmNeedleScan } from '../src/utils/physics/thinFilmMath.js';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };

// ── A JS-backed mock implementing the C ABI over a real WebAssembly.Memory ───
function makeMockInstance() {
    const memory = new WebAssembly.Memory({ initial: 64 }); // 4 MiB
    let bump = 16; // leave 0 as "null"
    const malloc = (bytes) => {
        bump = (bump + 7) & ~7;          // 8-byte align
        const p = bump; bump += bytes; return p;
    };
    const free = () => {};               // bump allocator: no-op free
    const f64 = (p, n) => new Float64Array(memory.buffer, p, n);

    const tmm_one = (lam, theta, pol, n0re, n0im, nsre, nsim, layPtr, N, outPtr) => {
        const lay = f64(layPtr, Math.max(1, 3 * N));
        const layers = [];
        for (let i = 0; i < N; i++) layers.push({ n: [lay[3 * i], lay[3 * i + 1]], d: lay[3 * i + 2] });
        const r = tmm(lam, theta, pol === 1 ? 'p' : 's', [n0re, n0im], [nsre, nsim], layers);
        const out = f64(outPtr, 3); out[0] = r.R; out[1] = r.T; out[2] = r.A;
    };

    const tmm_spectrum = (lamPtr, nLam, n0Ptr, nsPtr, mPtr, thPtr, N, theta,
                          rsPtr, tsPtr, asPtr, rpPtr, tpPtr, apPtr) => {
        const lam = f64(lamPtr, nLam), n0a = f64(n0Ptr, 2 * nLam), nsa = f64(nsPtr, 2 * nLam);
        const mv = f64(mPtr, Math.max(1, 2 * N * nLam)), thv = f64(thPtr, Math.max(1, N));
        const Rs = f64(rsPtr, nLam), Ts = f64(tsPtr, nLam), As = f64(asPtr, nLam);
        const Rp = f64(rpPtr, nLam), Tp = f64(tpPtr, nLam), Ap = f64(apPtr, nLam);
        for (let li = 0; li < nLam; li++) {
            const n0 = [n0a[2 * li], n0a[2 * li + 1]];
            const ns = [nsa[2 * li], nsa[2 * li + 1]];
            const layers = [];
            for (let k = 0; k < N; k++) {
                const base = (k * nLam + li) * 2;
                layers.push({ n: [mv[base], mv[base + 1]], d: thv[k] });
            }
            const s = tmm(lam[li], theta, 's', n0, ns, layers);
            const p = tmm(lam[li], theta, 'p', n0, ns, layers);
            Rs[li] = s.R; Ts[li] = s.T; As[li] = s.A;
            Rp[li] = p.R; Tp[li] = p.T; Ap[li] = p.A;
        }
    };

    const tmm_jacobian = (lam, theta, pol, n0re, n0im, nsre, nsim, layPtr, N, dRptr, dTptr, dAptr, basePtr) => {
        const lay = f64(layPtr, Math.max(1, 3 * N));
        const layers = [];
        for (let i = 0; i < N; i++) layers.push({ n: [lay[3 * i], lay[3 * i + 1]], d: lay[3 * i + 2] });
        const j = tmmThicknessJacobian(lam, theta, pol === 1 ? 'p' : 's', [n0re, n0im], [nsre, nsim], layers);
        const dR = f64(dRptr, Math.max(1, N)), dT = f64(dTptr, Math.max(1, N)), dA = f64(dAptr, Math.max(1, N));
        for (let k = 0; k < N; k++) { dR[k] = j.dRdd[k]; dT[k] = j.dTdd[k]; dA[k] = j.dAdd[k]; }
        const base = f64(basePtr, 3); base[0] = j.R; base[1] = j.T; base[2] = j.A;
    };

    const tmm_needle_scan = (lam, theta, pol, n0re, n0im, nsre, nsim, layPtr, N, candPtr, nCand, fracPtr, nFrac, basePtr, gapPtr, intraPtr) => {
        const lay = f64(layPtr, Math.max(1, 3 * N));
        const layers = [];
        for (let i = 0; i < N; i++) layers.push({ n: [lay[3 * i], lay[3 * i + 1]], d: lay[3 * i + 2] });
        const cand = f64(candPtr, Math.max(1, 2 * nCand)), candNs = [];
        for (let c = 0; c < nCand; c++) candNs.push([cand[2 * c], cand[2 * c + 1]]);
        const fv = f64(fracPtr, Math.max(1, nFrac)), fracs = [];
        for (let i = 0; i < nFrac; i++) fracs.push(fv[i]);
        const res = tmmNeedleScan(lam, theta, pol === 1 ? 'p' : 's', [n0re, n0im], [nsre, nsim], layers, candNs, fracs);
        const base = f64(basePtr, 3); base[0] = res.R; base[1] = res.T; base[2] = res.A;
        const gap = f64(gapPtr, Math.max(1, (N + 1) * nCand * 3));
        for (let pos = 0; pos <= N; pos++) for (let c = 0; c < nCand; c++) {
            const o = (pos * nCand + c) * 3, m = res.gaps[pos][c];
            gap[o] = m.dR; gap[o + 1] = m.dT; gap[o + 2] = m.dA;
        }
        if (nFrac > 0) {
            const intra = f64(intraPtr, Math.max(1, N * nFrac * nCand * 3));
            for (let k = 0; k < N; k++) for (let fi = 0; fi < nFrac; fi++) for (let c = 0; c < nCand; c++) {
                const o = ((k * nFrac + fi) * nCand + c) * 3, m = res.intra[k][fi].perCand[c];
                intra[o] = m.dR; intra[o + 1] = m.dT; intra[o + 2] = m.dA;
            }
        }
    };
    return { exports: { memory, malloc, free, tmm_one, tmm_spectrum, tmm_jacobian, tmm_needle_scan } };
}

const w = new TmmWasmInstance(makeMockInstance());
const air = [1, 0], sub = [1.52, 0], absSub = [4.0, 0.05];

// ── tmmOne marshalling ───────────────────────────────────────────────────────
{
    const layers = [{ n: [2.35, 0.001], d: 60 }, { n: [1.46, 0], d: 120 }];
    for (const pol of ['s', 'p']) {
        const ref = tmm(550, 30, pol, air, absSub, layers);
        const got = w.tmmOne(550, 30, pol === 'p' ? 1 : 0, air, absSub, layers);
        for (const key of ['R', 'T', 'A']) {
            ok(Math.abs(ref[key] - got[key]) < 1e-15, `tmmOne ${key} ${pol}: ${ref[key]} vs ${got[key]}`);
        }
    }
    // empty stack
    const ref0 = tmm(550, 0, 's', air, sub, []);
    const got0 = w.tmmOne(550, 0, 0, air, sub, []);
    ok(Math.abs(ref0.R - got0.R) < 1e-15, `tmmOne empty R`);
}

// ── tmmSpectrum marshalling (both pols + avg) ────────────────────────────────
{
    const lambdas = [400, 500, 600, 700];
    const layerNK = [
        lambdas.map((l) => [2.3 + 1000 / (l * l), 0.0005]),
        lambdas.map((l) => [1.46, 0]),
        lambdas.map((l) => [2.3 + 1000 / (l * l), 0.0005]),
    ];
    const thick = [70, 120, 55];
    const n0List = lambdas.map(() => air);
    const nsList = lambdas.map(() => sub);
    const theta = 15;
    const sp = w.tmmSpectrum(lambdas, n0List, nsList, layerNK, thick, theta);
    for (let i = 0; i < lambdas.length; i++) {
        const layers = layerNK.map((row, k) => ({ n: row[i], d: thick[k] }));
        const s = tmm(lambdas[i], theta, 's', air, sub, layers);
        const p = tmm(lambdas[i], theta, 'p', air, sub, layers);
        ok(Math.abs(sp.Rs[i] - s.R) < 1e-15, `spectrum Rs[${i}]`);
        ok(Math.abs(sp.Tp[i] - p.T) < 1e-15, `spectrum Tp[${i}]`);
        ok(Math.abs(sp.As[i] - s.A) < 1e-15, `spectrum As[${i}]`);
    }
    ok(sp.Rs.length === 4 && sp.Ap.length === 4, 'spectrum output lengths');
}

// ── tmmJacobian marshalling ──────────────────────────────────────────────────
{
    const layers = [{ n: [2.35, 0.001], d: 60 }, { n: [1.46, 0], d: 120 }, { n: [2.1, 0], d: 40 }];
    const ref = tmmThicknessJacobian(633, 40, 'p', air, absSub, layers);
    const got = w.tmmJacobian(633, 40, 1, air, absSub, layers);
    ok(got.N === ref.N, `jacobian N`);
    for (let k = 0; k < ref.N; k++) {
        ok(Math.abs(got.dRdd[k] - ref.dRdd[k]) < 1e-15, `jac dRdd[${k}]`);
        ok(Math.abs(got.dTdd[k] - ref.dTdd[k]) < 1e-15, `jac dTdd[${k}]`);
        ok(Math.abs(got.dAdd[k] - ref.dAdd[k]) < 1e-15, `jac dAdd[${k}]`);
    }
    ok(got.dRdd.length === ref.N, `jacobian dRdd length`);
    ok(Math.abs(got.R - ref.R) < 1e-15, `jacobian base R`);
}

// ── tmmNeedleScan marshalling (nested gaps + intra reshape) ──────────────────
{
    const layers = [{ n: [2.35, 0.001], d: 60 }, { n: [1.46, 0], d: 120 }, { n: [2.1, 0], d: 40 }];
    const candNs = [[2.35, 0.001], [1.46, 0], [1.38, 0]];
    const fracs = [0.25, 0.5, 0.75];
    const ref = tmmNeedleScan(550, 20, 's', air, sub, layers, candNs, fracs);
    const got = w.tmmNeedleScan(550, 20, 0, air, sub, layers, candNs, fracs);
    ok(got.N === ref.N, `needle N`);
    ok(got.gaps.length === ref.N + 1, `needle gaps rows (${got.gaps.length})`);
    ok(Math.abs(got.R - ref.R) < 1e-15, `needle base R`);
    let maxg = 0, maxi = 0;
    for (let pos = 0; pos <= ref.N; pos++) for (let c = 0; c < candNs.length; c++)
        for (const m of ['dR', 'dT', 'dA']) maxg = Math.max(maxg, Math.abs(got.gaps[pos][c][m] - ref.gaps[pos][c][m]));
    for (let k = 0; k < ref.N; k++) for (let fi = 0; fi < fracs.length; fi++) {
        ok(got.intra[k][fi].frac === ref.intra[k][fi].frac, `needle intra frac [${k}][${fi}]`);
        for (let c = 0; c < candNs.length; c++) for (const m of ['dR', 'dT', 'dA'])
            maxi = Math.max(maxi, Math.abs(got.intra[k][fi].perCand[c][m] - ref.intra[k][fi].perCand[c][m]));
    }
    ok(maxg < 1e-15, `needle gaps match (max ${maxg.toExponential(2)})`);
    ok(maxi < 1e-15, `needle intra match (max ${maxi.toExponential(2)})`);
    ok(got.intra.length === ref.N && got.intra[0].length === fracs.length, `needle intra shape`);
}

if (fails === 0) {
    console.log('PASS — tmmWasm loader marshalling matches the documented C ABI exactly.');
    process.exit(0);
} else {
    console.error(`${fails} assertion(s) FAILED.`);
    process.exit(1);
}
