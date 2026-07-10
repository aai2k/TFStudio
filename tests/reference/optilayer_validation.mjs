/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  OPTILAYER CROSS-CHECK — TFStudio vs OptiLayer 8.18n (the reference of record)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Reproduces two real coating designs measured/computed in OptiLayer and diffs
 * TFStudio against OptiLayer's own transmittance output (`*.res`), using the
 * SAME user materials the design was built from (ZrO2P / SiO2P, catalog "p").
 *
 * Design (from the .res headers):
 *   air │ ZrO2P 46.429 nm │ SiO2P 199.251 nm │ K8 substrate │ (bare back) air
 *   01.res = single ZrO2P layer (46.429 nm); 02.res = the full 2-layer AR.
 *   Front surface coated, back surface BARE — so the model is the coated front +
 *   substrate + uncoated back-surface reflection (OptiLayer "Ta", %).
 *
 * Materials:
 *   ZrO2P / SiO2P — the user's exact tabulated n,k (catalog "p"), sampled by the
 *   SAME linear interpolation TFStudio uses (catalogManager makeGetNK).
 *   K8 substrate — a Russian crown glass not in the catalogs; BK7 is used as a
 *   proxy (Δn < 0.001 ⇒ back-surface ΔT < 0.01 %). Labelled as such.
 *
 * Caveat: OptiLayer's own interpolation of the sparse ZrO2P/SiO2P tables may
 * differ slightly from linear between tabulated points, and ZrO2P has data only
 * to 850 nm (TFStudio and OptiLayer both extrapolate beyond). So the clean
 * comparison window is 400–850 nm; 850–1100 nm is reported separately.
 *
 * Run:  node tests/reference/optilayer_validation.mjs
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import { evaluateSpectrumTotal, computeEllipsometry } from '../../src/utils/physics/thinFilmMath.js';
import { getMaterial } from '../../src/utils/materials/materialDatabase.js';

const RES_DIR = 'X:/TFStudio Dev/reference/For spectrophotometer';

// ── user materials (catalog "p"), exact tabData, linear interp (as TFStudio) ──
const ZrO2P_tab = [[350,2.3],[370,2.2],[400,2.05],[420,2.0],[450,1.98],[470,1.965],[500,1.955],[550,1.953],[600,1.952],[700,1.952],[750,1.951],[800,1.95],[850,1.95]];
const SiO2P_tab = [[300,1.478],[350,1.472],[400,1.467],[450,1.463],[500,1.459],[550,1.455],[600,1.452],[650,1.45],[700,1.446],[900,1.437],[1000,1.434],[1100,1.432]];
function tabMat(tab) {
    const d = tab.slice().sort((a,b)=>a[0]-b[0]);
    return { getNK: (lam) => {
        if (lam <= d[0][0]) return [d[0][1], 0];
        if (lam >= d[d.length-1][0]) return [d[d.length-1][1], 0];
        let lo=0,hi=d.length-1; while(hi-lo>1){const m=(lo+hi)>>1; if(d[m][0]<=lam)lo=m;else hi=m;}
        const f=(lam-d[lo][0])/(d[hi][0]-d[lo][0]);
        return [d[lo][1]+f*(d[hi][1]-d[lo][1]), 0];
    } };
}
// K8 substrate — LZOS Clear optical glass catalogue (via refractiveindex.info,
// CC0), tabulated n (k = 0), λ in nm. This is the actual substrate glass.
const K8_tab = [[365,1.53582],[404.66,1.52982],[435.83,1.526266],[479.99,1.522408],[486.13,1.521955],[488,1.52181],[514,1.52009],[520.8,1.51968],[530,1.51916],[546.07,1.518294],[568.2,1.51722],[587.56,1.516373],[589.29,1.5163],[632.8,1.51466],[643.85,1.514292],[647.1,1.51419],[656.27,1.513895],[694.3,1.51279],[706.52,1.51246],[768.2,1.511],[852.1,1.50937],[890,1.50872],[1013.9,1.50687],[1060,1.50625],[1128.6,1.50536]];
const ZrO2P = tabMat(ZrO2P_tab), SiO2P = tabMat(SiO2P_tab), K8 = tabMat(K8_tab);
const AIR = getMaterial('Air');
const SUB_MM = 3.0;                        // substrate thickness (witness ≈ 3 mm)

// ── parse an OptiLayer .res (wavelength, Ta%) ────────────────────────────────
function parseRes(path) {
    const txt = readFileSync(path, 'latin1');
    const rows = [];
    let inData = false;
    for (const line of txt.split(/\r?\n/)) {
        if (/Wavelength\s+Ta/i.test(line)) { inData = true; continue; }
        if (!inData) continue;
        const m = line.trim().match(/^([\d.]+)\s+([\d.]+)$/);
        if (m) rows.push([parseFloat(m[1]), parseFloat(m[2])]);
    }
    return rows;
}

// ── TFStudio transmittance: coated front + substrate + bare back, normal ─────
function tfT(front, lam) {
    const p = { lambdaStart: lam, lambdaEnd: lam, lambdaStep: 1, theta: 0, polarization: 'avg' };
    return evaluateSpectrumTotal(p, AIR, K8, AIR, front, [], SUB_MM).T[0] * 100;   // %
}

function compare(name, resFile, front) {
    const ref = parseRes(`${RES_DIR}/${resFile}`);
    let n1=0, s1=0, mx1=0, n2=0, s2=0, mx2=0, atMx1=0;
    for (const [lam, ta] of ref) {
        const t = tfT(front, lam);
        const d = Math.abs(t - ta);
        if (lam >= 400 && lam <= 850) { n1++; s1+=d*d; if(d>mx1){mx1=d;atMx1=lam;} }
        else { n2++; s2+=d*d; if(d>mx2)mx2=d; }
    }
    console.log(`\n── ${name}  (${resFile}, ${ref.length} points) ─────────────────`);
    console.log(`  400–850 nm (ZrO2P has data):  RMS = ${Math.sqrt(s1/n1).toFixed(4)} %   max = ${mx1.toFixed(4)} % @ ${atMx1} nm`);
    console.log(`  850–1100 nm (extrapolated):   RMS = ${Math.sqrt(s2/n2).toFixed(4)} %   max = ${mx2.toFixed(4)} %`);
    // a few explicit side-by-side points
    console.log('   λ(nm)   TFStudio T%   OptiLayer Ta%     Δ%');
    for (const lamT of [400, 500, 600, 700, 800]) {
        const row = ref.reduce((a,b)=>Math.abs(b[0]-lamT)<Math.abs(a[0]-lamT)?b:a);
        const t = tfT(front, row[0]);
        console.log(`  ${row[0].toFixed(1).padStart(7)}   ${t.toFixed(4).padStart(9)}    ${row[1].toFixed(4).padStart(9)}    ${(t-row[1]).toFixed(4).padStart(7)}`);
    }
    return { ref, front };
}

// OptiLayer numbers layers from the substrate outward (layer 1 = ZrO2 ON the
// substrate, layer 2 = SiO2 outer). TFStudio frontLayers are air-first, so the
// air-side order is SiO2 (outer) then ZrO2 (against the substrate).
const front2 = [{ material: SiO2P, thickness: 199.251 }, { material: ZrO2P, thickness: 46.429 }];
const front1 = [{ material: ZrO2P, thickness: 46.429 }];

console.log('OptiLayer 8.18n  vs  TFStudio  —  design "AR 1650 K8", user materials ZrO2P/SiO2P');
compare('Single ZrO2P layer', '01.res', front1);
compare('2-layer AR (ZrO2P/SiO2P)', '02.res', front2);

// ── Ellipsometry at 60° (front reflection; compare to the OptiLayer photo) ───
console.log('\n── Ellipsometry Ψ, Δ @ 60° (2-layer AR, front reflection) ───────────');
console.log('   λ(nm)     Ψ (°)   Δ Woollam   Δ Azzam (360−Δ, OptiLayer)');
const nk = (m, lam) => m.getNK(lam);
for (const lam of [400, 450, 500, 550, 600, 650, 700, 720, 750, 800, 900, 1000, 1100]) {
    const layers = [{ n: nk(SiO2P, lam), d: 199.251 }, { n: nk(ZrO2P, lam), d: 46.429 }];
    const e = computeEllipsometry(lam, 60, [1, 0], K8.getNK(lam), layers);
    const azzam = (360 - e.delta) % 360;
    console.log(`  ${String(lam).padStart(5)}    ${e.psi.toFixed(2).padStart(6)}    ${e.delta.toFixed(2).padStart(7)}      ${azzam.toFixed(2).padStart(7)}`);
}
console.log('\nOptiLayer photo (60°): Ψ min ≈10° @450nm, peak ≈44° @720nm; Δ rises to ≈360°');
console.log('near 720nm then wraps to ≈0 and climbs to ≈80° at 1100nm — the Azzam column.');
