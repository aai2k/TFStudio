/**
 * Builds `plot_data.json` — dense TFStudio curves computed on the SAME grids as
 * the tmm reference in `reference_tmm.json`, plus the pointwise residual. Feeds
 * the overlay plots in the validation dossier (TFStudio line vs tmm markers +
 * a residual trace that shows the gap sits at machine epsilon).
 *
 * Run:  node tests/reference/make_plot_data.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
    tmm, computeEllipsometry, computeEFieldProfile,
    computeGroupDelaySpectrum, tmmWithAdmittances,
} from '../../src/utils/physics/thinFilmMath.js';

const here = dirname(fileURLToPath(import.meta.url));
const ref = JSON.parse(readFileSync(join(here, 'reference_tmm.json'), 'utf8'));

const caseByName = (name) => ref.cases.find(c => c.name === name);
const toLayers = (c) => {
    const n = c.n_list, d = c.d_list, L = [];
    for (let i = 1; i < n.length - 1; i++) L.push({ n: n[i], d: Number(d[i]) });
    return { n0: n[0], ns: n[n.length - 1], layers: L };
};
const circDiff = (a, b) => { let d = ((a - b) % 360 + 540) % 360 - 180; return d; };

const P = ref.plots, out = {};

// ── spectral overlays (R/T/A) ────────────────────────────────────────────────
for (const key of ['ar', 'mirror', 'absorb', 'metal']) {
    const spec = P[key]; const { n0, ns, layers } = toLayers(caseByName(spec.case));
    const D = spec.data, lam = D.lam;
    const R = [], T = [], A = [], resR = [], resT = [], resA = [];
    for (let i = 0; i < lam.length; i++) {
        const e = tmm(lam[i], D.th, D.pol, n0, ns, layers);
        R.push(e.R); T.push(e.T); A.push(e.A);
        resR.push(e.R - D.R[i]); resT.push(e.T - D.T[i]); resA.push(e.A - D.A[i]);
    }
    out[key] = {
        case: spec.case, kind: 'spectral', lam,
        tf: { R, T, A }, ref: { R: D.R, T: D.T, A: D.A },
        res: { R: resR, T: resT, A: resA },
    };
}

// ── ellipsometry Ψ/Δ vs angle (bare Cr) ──────────────────────────────────────
{
    const spec = P.ellips; const { n0, ns, layers } = toLayers(caseByName(spec.case));
    const D = spec.data, psi = [], delta = [], resPsi = [], resDelta = [];
    for (let i = 0; i < D.ang.length; i++) {
        const e = computeEllipsometry(D.lam, D.ang[i], n0, ns, layers);
        psi.push(e.psi); delta.push(e.delta);
        resPsi.push(e.psi - D.psi[i]); resDelta.push(circDiff(e.delta, D.delta[i]));
    }
    out.ellips = {
        case: spec.case, kind: 'ellips', lam: D.lam, ang: D.ang,
        tf: { psi, delta }, ref: { psi: D.psi, delta: D.delta },
        res: { psi: resPsi, delta: resDelta },
    };
}

// ── E-field |E|² vs depth (mirror) ───────────────────────────────────────────
{
    const spec = P.efield; const { n0, ns, layers } = toLayers(caseByName(spec.case));
    const D = spec.data;
    const prof = computeEFieldProfile(D.lam, D.th, D.pol, n0, ns, layers, 400);
    const z = prof.z, e2 = prof.e2;
    const interp = (zq) => {
        if (zq <= z[0]) return e2[0];
        for (let i = 1; i < z.length; i++) if (z[i] >= zq) { const f = (zq - z[i - 1]) / (z[i] - z[i - 1] || 1); return e2[i - 1] + f * (e2[i] - e2[i - 1]); }
        return e2[e2.length - 1];
    };
    const tf = D.z.map(interp);
    const res = tf.map((v, i) => v - D.E2[i]);
    out.efield = { case: spec.case, kind: 'efield', z: D.z, tf: { E2: tf }, ref: { E2: D.E2 }, res: { E2: res }, bounds: prof.layerBounds };
}

// ── group delay vs λ (GTI mirror) ────────────────────────────────────────────
{
    const spec = P.gd; const { n0, ns, layers } = toLayers(caseByName(spec.case));
    const D = spec.data, lam = D.lam;
    const coeffR = (L) => tmmWithAdmittances(L, 0, 's', n0, ns, layers).r;
    const g = computeGroupDelaySpectrum(coeffR, lam[0], lam[lam.length - 1], lam.length);
    // align g.lambda (its own grid) onto the reference lam by nearest sample
    const gdAt = (L) => { let b = 0, bd = 1e9; for (let i = 0; i < g.lambda.length; i++) { const dd = Math.abs(g.lambda[i] - L); if (dd < bd) { bd = dd; b = g.gd[i]; } } return b; };
    const tf = lam.map(gdAt);
    const refGd = D.gd_tmm.map(v => -v);              // TFStudio convention = −tmm
    const res = tf.map((v, i) => v - refGd[i]);
    out.gd = { case: spec.case, kind: 'gd', lam, tf: { gd: tf }, ref: { gd: refGd }, res: { gd: res } };
}

writeFileSync(join(here, 'plot_data.json'), JSON.stringify(out));
const worst = {};
for (const [k, v] of Object.entries(out)) {
    let m = 0; for (const arr of Object.values(v.res)) for (const x of arr) m = Math.max(m, Math.abs(x));
    worst[k] = m;
}
console.log('Wrote plot_data.json. Worst residual per plot:');
for (const [k, v] of Object.entries(worst)) console.log(`  ${k.padEnd(8)} ${v.toExponential(2)}`);
