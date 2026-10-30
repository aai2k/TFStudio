/**
 * Per-descriptor characteristic sensitivity d(char)/d(needle) — the front_only /
 * back_only / full-system chain rule that turns a needleScan pass into the
 * merit-relevant ∂R/∂T/∂A for one insertion descriptor.
 *
 * Derivatives (d → 0), full-system composition (Macleod §2.6.4):
 *   FRONT insertion:
 *     ∂T/∂d = (P·T_b/D²) · [ D·∂T_f/∂d + T_f·P²·R_b·∂R_f'/∂d ]
 *     ∂R/∂d = ∂R_f/∂d + (P²·R_b/D²) · [ D·(∂T_f/∂d·T_f' + T_f·∂T_f'/∂d)
 *                                     + T_f·T_f'·P²·R_b·∂R_f'/∂d ]
 *   BACK insertion:
 *     ∂R/∂d = T_f·T_f'·P²·∂R_b/∂d / D²
 *     ∂T/∂d = (P·T_f/D²) · [ D·∂T_b/∂d + T_b·P²·R_f'·∂R_b/∂d ]
 */

// Read needle derivative {dR, dT} at a position descriptor from a needleScan
// result, with optional position mirroring (used for the reverse-front and
// symmetric-back passes: gap p ↔ N-p, intra (k, fi) ↔ (N-1-k, nIntra-1-fi)).
function _readDeriv(scan, d, NLayers, mirror, nIntra) {
    if (d.kind === 'gap') {
        const p = mirror ? (NLayers - d.pos) : d.pos;
        return scan.gaps[p][d.ci];
    }
    const k  = mirror ? (NLayers - 1 - d.k)  : d.k;
    const fi = mirror ? (nIntra - 1 - d.fi)  : d.fi;
    return scan.intra[k][fi].perCand[d.ci];
}

// Characteristic sensitivity d(char)/d(needle) at one (λ,pol,aoi) scan result for
// descriptor `d`. `cfg` carries { side, surfaceMode, Nf, Nb, nIntra }.
export function _charDerivAt(cfg, res, char, d) {
    const { side, surfaceMode, Nf, Nb, nIntra } = cfg;
    if (res.mode === 'front_only') return _readDeriv(res.fwd, d, Nf, false, nIntra)['d' + char];
    if (res.mode === 'back_only')  return _readDeriv(res.bck, d, Nb, true, nIntra)['d' + char];
    const { D, P, P2, Tf, Rfp, Tfp, Rb, Tb, fwd, rev, bck } = res;
    const invD2 = 1 / (D * D);
    let dR = 0, dT = 0;
    if (side === 'front' || surfaceMode === 'symmetric') {
        const fM = _readDeriv(fwd, d, Nf, false, nIntra);
        const rM = _readDeriv(rev, d, Nf, true, nIntra);              // mirror p→N-p
        const dRf = fM.dR, dTf = fM.dT, dRfp = rM.dR, dTfp = rM.dT;
        dT += (P * Tb) * invD2 * (D * dTf + Tf * P2 * Rb * dRfp);
        dR += dRf + (P2 * Rb) * invD2 * (D * (dTf * Tfp + Tf * dTfp) + Tf * Tfp * P2 * Rb * dRfp);
    }
    if (side === 'back' || surfaceMode === 'symmetric') {
        const bM = _readDeriv(bck, d, Nb, surfaceMode === 'symmetric', nIntra);
        const dRb = bM.dR, dTb = bM.dT;
        dR += (Tf * Tfp * P2) * invD2 * dRb;
        dT += (P * Tf) * invD2 * (D * dTb + Tb * P2 * Rfp * dRb);
    }
    return char === 'R' ? dR : char === 'T' ? dT : -(dR + dT);
}
