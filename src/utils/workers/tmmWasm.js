/**
 * tmmWasm.js — loader + ergonomic wrappers for the WASM TMM kernel.
 *
 * The kernel (`src/wasm/tmm_kernel.c`, built to `tmm_kernel.wasm`) is a faithful
 * port of the JS TMM in `thinFilmMath.js`. This module instantiates it (in the
 * main thread, a Web Worker, or Node) and exposes wrappers whose signatures
 * mirror the JS functions. Everything is OPT-IN and FALLS BACK to JS:
 *
 *   • If the `.wasm` has not been built, or instantiation fails, or the feature
 *     flag is off → the wrappers return `null` and callers use the JS path.
 *   • Nothing changes in optimizer output until the artifact exists, the flag is
 *     enabled, and `tests/wasm_tmm_equivalence.mjs` passes.
 *
 * Instances are NOT shared across threads (no shared memory) — each context
 * instantiates its own from the same bytes. Use `instantiateTmmWasm(bytes)` in
 * workers (bytes arrive in the init message) and `initTmmWasmFromUrl(url)` in
 * the renderer.
 */

let _instance = null;     // TmmWasmInstance | null
let _enabled = false;     // feature flag (default OFF)
let _initPromise = null;  // de-dupe concurrent init

// Permissive imports: a STANDALONE_WASM build of pure-math C usually needs no
// imports, but ALLOW_MEMORY_GROWTH may emit `emscripten_notify_memory_growth`,
// and some toolchains emit WASI stubs. Cover them so instantiation never throws.
function wasmImports() {
    return {
        env: { emscripten_notify_memory_growth: () => {} },
        wasi_snapshot_preview1: new Proxy({}, { get: () => () => 0 }),
    };
}

export class TmmWasmInstance {
    constructor(instance) {
        const ex = instance.exports;
        this.exports = ex;
        // STANDALONE_WASM reactor modules expose an initializer that must run
        // before malloc (sets up the allocator + any static ctors). Call it once.
        if (typeof ex._initialize === 'function') ex._initialize();
        else if (typeof ex.__wasm_call_ctors === 'function') ex.__wasm_call_ctors();
        this.memory = ex.memory;
        this.malloc = ex.malloc || ex._malloc;
        this.free = ex.free || ex._free;
        this._tmm_one = ex.tmm_one || ex._tmm_one;
        this._tmm_spectrum = ex.tmm_spectrum || ex._tmm_spectrum;
        this._tmm_jacobian = ex.tmm_jacobian || ex._tmm_jacobian;
        this._tmm_needle_scan = ex.tmm_needle_scan || ex._tmm_needle_scan;
        // Optional (added later for SQP/Newton accel): a .wasm built before the
        // Hessian kernel existed simply lacks it → callers fall back to JS.
        this._tmm_hessian = ex.tmm_hessian || ex._tmm_hessian || null;
        if (!this.malloc || !this.free || !this._tmm_one ||
            !this._tmm_spectrum || !this._tmm_jacobian || !this._tmm_needle_scan) {
            throw new Error('tmmWasm: required exports missing from module');
        }
        this._scratchPtr = 0;   // persistent per-call scratch arena (lazy)
        this._scratchN = 0;
    }

    _alloc(nDoubles) {
        const ptr = this.malloc(nDoubles * 8);
        if (!ptr) throw new Error('tmmWasm: malloc failed');
        return ptr;
    }
    // Fresh view — memory.buffer is detached after any growth, so re-create
    // views AFTER all mallocs for a call are done.
    _view(ptr, nDoubles) {
        return new Float64Array(this.memory.buffer, ptr, nDoubles);
    }

    // Persistent scratch arena for the per-call hot paths (tmmOne/tmmJacobian).
    // These are invoked thousands of times per optimization run; malloc/free +
    // typed-array churn per call would dominate the JS↔WASM boundary cost and
    // can make per-call WASM SLOWER than JS. Reusing one buffer (grown on demand,
    // never freed between calls) makes each call just write-args / read-result.
    _scratch(nDoubles) {
        if (this._scratchN < nDoubles) {
            if (this._scratchPtr) this.free(this._scratchPtr);
            this._scratchPtr = this._alloc(nDoubles);
            this._scratchN = nDoubles;
        }
        return this._scratchPtr;
    }

    /**
     * Single (λ, θ, pol) — mirrors tmm() in thinFilmMath.js.
     * @returns {{R:number,T:number,A:number}}
     */
    tmmOne(lambda_nm, theta_deg, polCode /* 0=s,1=p */, n0, ns, layers) {
        const N = layers.length;
        const need = 3 * N + 3;                  // layers [0..3N) + out [3N..3N+3)
        const ptr = this._scratch(need);         // may grow→detach; view created AFTER
        const buf = this._view(ptr, need);
        for (let i = 0; i < N; i++) {
            buf[3 * i + 0] = layers[i].n[0];
            buf[3 * i + 1] = layers[i].n[1];
            buf[3 * i + 2] = layers[i].d;
        }
        const outPtr = ptr + 3 * N * 8;
        this._tmm_one(lambda_nm, theta_deg, polCode | 0,
            n0[0], n0[1], ns[0], ns[1], ptr, N, outPtr);
        return { R: buf[3 * N], T: buf[3 * N + 1], A: buf[3 * N + 2] };
    }

    /**
     * Batched spectrum over a λ grid for BOTH polarizations — the boundary-
     * amortizing path behind evaluateSpectrum().
     * @param {number[]} lambdas
     * @param {[number,number][]} n0List  incident ñ per λ
     * @param {[number,number][]} nsList  substrate ñ per λ
     * @param {[number,number][][]} layerNK  [layer][λ] = ñ
     * @param {number[]} thick   layer thicknesses (nm), length N
     * @param {number}   theta_deg
     * @returns {{Rs,Ts,As,Rp,Tp,Ap}} each a Float64Array(nLam)
     */
    tmmSpectrum(lambdas, n0List, nsList, layerNK, thick, theta_deg) {
        const nLam = lambdas.length;
        const N = thick.length;

        const lamPtr = this._alloc(nLam);
        const n0Ptr  = this._alloc(2 * nLam);
        const nsPtr  = this._alloc(2 * nLam);
        const mPtr   = this._alloc(Math.max(1, 2 * N * nLam));
        const thPtr  = this._alloc(Math.max(1, N));
        const rsPtr = this._alloc(nLam), tsPtr = this._alloc(nLam), asPtr = this._alloc(nLam);
        const rpPtr = this._alloc(nLam), tpPtr = this._alloc(nLam), apPtr = this._alloc(nLam);

        // Views created after all mallocs (buffer may have grown/detached).
        const lam = this._view(lamPtr, nLam);
        const n0v = this._view(n0Ptr, 2 * nLam);
        const nsv = this._view(nsPtr, 2 * nLam);
        const mv  = this._view(mPtr, Math.max(1, 2 * N * nLam));
        const thv = this._view(thPtr, Math.max(1, N));
        for (let i = 0; i < nLam; i++) {
            lam[i] = lambdas[i];
            n0v[2 * i] = n0List[i][0]; n0v[2 * i + 1] = n0List[i][1];
            nsv[2 * i] = nsList[i][0]; nsv[2 * i + 1] = nsList[i][1];
        }
        for (let k = 0; k < N; k++) {
            thv[k] = thick[k];
            const row = layerNK[k];
            const base = k * nLam * 2;
            for (let i = 0; i < nLam; i++) {
                mv[base + 2 * i]     = row[i][0];
                mv[base + 2 * i + 1] = row[i][1];
            }
        }

        this._tmm_spectrum(lamPtr, nLam, n0Ptr, nsPtr, mPtr, thPtr, N, theta_deg,
            rsPtr, tsPtr, asPtr, rpPtr, tpPtr, apPtr);

        // Copy outputs out of wasm memory before freeing.
        const cp = (p) => Float64Array.from(this._view(p, nLam));
        const res = { Rs: cp(rsPtr), Ts: cp(tsPtr), As: cp(asPtr),
                      Rp: cp(rpPtr), Tp: cp(tpPtr), Ap: cp(apPtr) };
        for (const p of [lamPtr, n0Ptr, nsPtr, mPtr, thPtr,
                         rsPtr, tsPtr, asPtr, rpPtr, tpPtr, apPtr]) this.free(p);
        return res;
    }

    /**
     * Analytic thickness Jacobian for one (λ, θ, pol) — mirrors
     * tmmThicknessJacobian(). layers used AS-IS (index parity).
     * @returns {{R,T,A, dRdd:Float64Array, dTdd, dAdd, N}}
     */
    tmmJacobian(lambda_nm, theta_deg, polCode, n0, ns, layers) {
        const N = layers.length;
        const M = Math.max(1, N);
        // arena layout: layers[3N] | dRdd[M] | dTdd[M] | dAdd[M] | base[3]
        const oLay = 0, oDR = 3 * N, oDT = oDR + M, oDA = oDT + M, oBase = oDA + M;
        const need = oBase + 3;
        const ptr = this._scratch(need);
        const buf = this._view(ptr, need);
        for (let i = 0; i < N; i++) {
            buf[3 * i + 0] = layers[i].n[0];
            buf[3 * i + 1] = layers[i].n[1];
            buf[3 * i + 2] = layers[i].d;
        }
        const P = (off) => ptr + off * 8;
        this._tmm_jacobian(lambda_nm, theta_deg, polCode | 0,
            n0[0], n0[1], ns[0], ns[1], P(oLay), N, P(oDR), P(oDT), P(oDA), P(oBase));
        // Re-create the view AFTER the kernel call (like tmmSpectrum): under
        // ALLOW_MEMORY_GROWTH the kernel may grow wasm memory, which detaches the
        // ArrayBuffer `buf` was created over — reading the stale `buf` then yields
        // garbage / throws. `out` is a fresh view over the current buffer.
        const out = this._view(ptr, need);
        return {
            R: out[oBase], T: out[oBase + 1], A: out[oBase + 2], N,
            dRdd: out.slice(oDR, oDR + N),
            dTdd: out.slice(oDT, oDT + N),
            dAdd: out.slice(oDA, oDA + N),
        };
    }

    /** True if the loaded module carries the Hessian kernel (newer build). */
    hasHessian() { return !!this._tmm_hessian; }

    /**
     * Analytic thickness Hessian for one (λ, θ, pol) — mirrors
     * tmmThicknessHessian(). Returns first AND second derivatives; the N×N
     * second-derivative blocks are reshaped into nested arrays (one Float64Array
     * row per layer, FULL symmetric) so the shape matches the JS oracle exactly.
     * @returns {{R,T,A, dRdd, dTdd, dAdd, d2Rdd, d2Tdd, d2Add, N}}
     */
    tmmHessian(lambda_nm, theta_deg, polCode, n0, ns, layers) {
        const N = layers.length;
        const M = Math.max(1, N);
        const NN = Math.max(1, N * N);
        // arena: layers[3N] | dRdd[M] | dTdd[M] | dAdd[M] | d2R[NN] | d2T[NN] | d2A[NN] | base[3]
        const oLay = 0, oDR = 3 * N, oDT = oDR + M, oDA = oDT + M,
              oR2 = oDA + M, oT2 = oR2 + NN, oA2 = oT2 + NN, oBase = oA2 + NN;
        const need = oBase + 3;
        const ptr = this._scratch(need);
        const buf = this._view(ptr, need);
        for (let i = 0; i < N; i++) {
            buf[3 * i + 0] = layers[i].n[0];
            buf[3 * i + 1] = layers[i].n[1];
            buf[3 * i + 2] = layers[i].d;
        }
        const P = (off) => ptr + off * 8;
        this._tmm_hessian(lambda_nm, theta_deg, polCode | 0,
            n0[0], n0[1], ns[0], ns[1], P(oLay), N,
            P(oDR), P(oDT), P(oDA), P(oR2), P(oT2), P(oA2), P(oBase));
        // Fresh view after the call (memory may have grown → buf detached).
        const out = this._view(ptr, need);
        const reshape = (off) => {
            const rows = new Array(N);
            for (let i = 0; i < N; i++) rows[i] = out.slice(off + i * N, off + i * N + N);
            return rows;
        };
        return {
            R: out[oBase], T: out[oBase + 1], A: out[oBase + 2], N,
            dRdd: out.slice(oDR, oDR + N),
            dTdd: out.slice(oDT, oDT + N),
            dAdd: out.slice(oDA, oDA + N),
            d2Rdd: reshape(oR2), d2Tdd: reshape(oT2), d2Add: reshape(oA2),
        };
    }

    /**
     * Analytic needle P-function scan — mirrors tmmNeedleScan() in
     * thinFilmMath.js, reshaping the flat WASM output into the SAME nested
     * structure the synthesis scanners consume.
     * @param {{n:[number,number],d:number}[]} layers   used AS-IS (index parity)
     * @param {[number,number][]} candidateNs           candidate ñ
     * @param {number[]} intraFracs                      intra-layer split fractions
     * @returns {{R,T,A,N, gaps:Array, intra:Array}}
     *   gaps[pos][ci] = {dR,dT,dA}  (pos = 0..N)
     *   intra[k][fi]  = {frac, perCand:[{dR,dT,dA}]}
     */
    tmmNeedleScan(lambda_nm, theta_deg, polCode, n0, ns, layers, candidateNs, intraFracs = []) {
        const N = layers.length;
        const nCand = candidateNs.length;
        const nFrac = intraFracs.length;
        const nGap = (N + 1) * nCand * 3;
        const nIntra = Math.max(1, N * nFrac * nCand * 3);

        const layPtr = this._alloc(Math.max(1, 3 * N));
        const candPtr = this._alloc(Math.max(1, 2 * nCand));
        const fracPtr = this._alloc(Math.max(1, nFrac));
        const basePtr = this._alloc(3);
        const gapPtr = this._alloc(Math.max(1, nGap));
        const intraPtr = this._alloc(nIntra);

        const lay = this._view(layPtr, Math.max(1, 3 * N));
        for (let i = 0; i < N; i++) {
            lay[3 * i + 0] = layers[i].n[0];
            lay[3 * i + 1] = layers[i].n[1];
            lay[3 * i + 2] = layers[i].d;
        }
        const cand = this._view(candPtr, Math.max(1, 2 * nCand));
        for (let c = 0; c < nCand; c++) { cand[2 * c] = candidateNs[c][0]; cand[2 * c + 1] = candidateNs[c][1]; }
        const frac = this._view(fracPtr, Math.max(1, nFrac));
        for (let i = 0; i < nFrac; i++) frac[i] = intraFracs[i];

        this._tmm_needle_scan(lambda_nm, theta_deg, polCode | 0,
            n0[0], n0[1], ns[0], ns[1], layPtr, N, candPtr, nCand, fracPtr, nFrac,
            basePtr, gapPtr, intraPtr);

        // Copy outputs out before freeing, reshaping to the JS nested layout.
        const base = this._view(basePtr, 3);
        const R = base[0], T = base[1], A = base[2];
        const gapV = this._view(gapPtr, Math.max(1, nGap));
        const gaps = new Array(N + 1);
        for (let pos = 0; pos <= N; pos++) {
            const row = new Array(nCand);
            for (let c = 0; c < nCand; c++) {
                const o = (pos * nCand + c) * 3;
                row[c] = { dR: gapV[o], dT: gapV[o + 1], dA: gapV[o + 2] };
            }
            gaps[pos] = row;
        }
        const intra = [];
        if (nFrac > 0) {
            const intraV = this._view(intraPtr, nIntra);
            for (let k = 0; k < N; k++) {
                const rowK = [];
                for (let fi = 0; fi < nFrac; fi++) {
                    const perCand = new Array(nCand);
                    for (let c = 0; c < nCand; c++) {
                        const o = ((k * nFrac + fi) * nCand + c) * 3;
                        perCand[c] = { dR: intraV[o], dT: intraV[o + 1], dA: intraV[o + 2] };
                    }
                    rowK.push({ frac: intraFracs[fi], perCand });
                }
                intra.push(rowK);
            }
        }

        for (const p of [layPtr, candPtr, fracPtr, basePtr, gapPtr, intraPtr]) this.free(p);
        return { R, T, A, gaps, intra, N };
    }
}

/** Instantiate from raw bytes (ArrayBuffer / Uint8Array). Sets the singleton. */
export async function instantiateTmmWasm(bytes) {
    const { instance } = await WebAssembly.instantiate(
        bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), wasmImports());
    _instance = new TmmWasmInstance(instance);
    return _instance;
}

/** Renderer/Node helper: fetch the `.wasm` at `url` and instantiate it. */
export function initTmmWasmFromUrl(url) {
    if (_initPromise) return _initPromise;
    _initPromise = (async () => {
        try {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`fetch ${url} → ${resp.status}`);
            const buf = await resp.arrayBuffer();
            await instantiateTmmWasm(buf);
            return true;
        } catch (e) {
            // Not built yet / not found — silent fallback to JS.
            _instance = null;
            return false;
        }
    })();
    return _initPromise;
}

export function setTmmWasmEnabled(on) { _enabled = !!on; }
/** TEST-ONLY: inject a TmmWasmInstance (or null) directly, bypassing the .wasm
 *  fetch/instantiate, so the integration seam can be exercised with a mock. */
export function __setTmmWasmInstanceForTest(inst) { _instance = inst; }

// ── Cross-thread plumbing ────────────────────────────────────────────────────
// The renderer (main thread) loads the .wasm bytes once via IPC, instantiates
// its own module, and BROADCASTS the same bytes to each pool/worker (workers
// can't fetch a file:// asset under contextIsolation). Each worker instantiates
// its OWN module (no shared memory) and enables the flag.

let _workerBytes = null;       // main-side: raw bytes to hand to workers
let _workerInitPromise = null; // worker-side: in-flight instantiation

/**
 * MAIN THREAD bootstrap. Store the bytes for worker broadcast and, if the user
 * enabled the feature, instantiate the main-thread module and flip the flag.
 * Safe to call once at startup; failures fall back to JS silently.
 */
export async function initTmmWasmMainThread(bytes, enabled) {
    if (bytes) _workerBytes = bytes;            // remember for workers + later toggles
    if (!enabled) { _enabled = false; return false; }   // toggle off → JS everywhere
    if (!_workerBytes) return false;            // artifact never loaded
    if (!_instance) {                           // instantiate once; reuse on re-toggle
        try { await instantiateTmmWasm(_workerBytes); }
        catch (_) { _instance = null; _enabled = false; return false; }
    }
    _enabled = true;
    return true;
}

/** MAIN THREAD: bytes to ship to a worker — only when the feature is active. */
export function getTmmWasmBytesForWorker() {
    return (_enabled && _workerBytes) ? _workerBytes : null;
}

/**
 * WORKER side: kick off one-time instantiation from broadcast bytes and enable
 * the flag in this worker. Idempotent; no-op without bytes or once instantiated.
 */
export function noteTmmWasmBytes(bytes) {
    if (!bytes || _instance || _workerInitPromise) return;
    _workerInitPromise = instantiateTmmWasm(bytes)
        .then(() => { _enabled = true; return true; })
        .catch(() => { _instance = null; _enabled = false; return false; });
}

/** WORKER side: await any in-flight instantiation before processing a job. */
export function awaitTmmWasmReady() {
    return _workerInitPromise || Promise.resolve(_instance !== null);
}
export function isTmmWasmEnabled() { return _enabled; }
export function isTmmWasmReady() { return _instance !== null; }
/** Active iff the feature flag is on AND a module is instantiated. */
export function tmmWasmActive() { return _enabled && _instance !== null; }
export function getTmmWasm() { return _instance; }
