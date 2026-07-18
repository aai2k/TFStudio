/**
 * CIEDE2000 colour difference (Sharma, Wu & Dalal, *Color Res. Appl.* 30, 21
 * (2005)). See ../colorimetry.js for the full physics provenance.
 */

// CIEDE2000 hue angle h'(b,a) in degrees [0,360); 0 when both components are 0.
const _hueP = (b, a) => {
  if (b === 0 && a === 0) return 0;
  const v = Math.atan2(b, a) * 180 / Math.PI;
  return v < 0 ? v + 360 : v;
};

// CIEDE2000 hue difference Δh' (Sharma, Wu & Dalal 2005, Eq. 10).
function _deltaHueP(C1p, C2p, h1p, h2p) {
  if (C1p * C2p === 0) return 0;
  let dhp = h2p - h1p;
  if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360;
  return dhp;
}

// CIEDE2000 mean hue h̄' (Sharma, Wu & Dalal 2005, Eq. 14).
function _meanHueP(C1p, C2p, h1p, h2p) {
  if (C1p * C2p === 0) return h1p + h2p;
  if (Math.abs(h1p - h2p) <= 180) return (h1p + h2p) / 2;
  return (h1p + h2p + (h1p + h2p < 360 ? 360 : -360)) / 2;
}

/**
 * CIEDE2000 colour difference (Sharma, Wu & Dalal 2005). kL=kC=kH=1.
 */
export function ciede2000(l1, l2) {
  const { L: L1, a: a1, b: b1 } = l1;
  const { L: L2, a: a2, b: b2 } = l2;
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const Cbar7 = Math.pow(Cbar, 7);
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + Math.pow(25, 7))));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const h1p = _hueP(b1, a1p), h2p = _hueP(b2, a2p);
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  const dhp = _deltaHueP(C1p, C2p, h1p, h2p);
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dhp * rad / 2);
  const Lbp = (L1 + L2) / 2;
  const Cbp = (C1p + C2p) / 2;
  const hbp = _meanHueP(C1p, C2p, h1p, h2p);
  const T = 1 - 0.17 * Math.cos((hbp - 30) * rad) + 0.24 * Math.cos(2 * hbp * rad)
              + 0.32 * Math.cos((3 * hbp + 6) * rad) - 0.20 * Math.cos((4 * hbp - 63) * rad);
  const dTheta = 30 * Math.exp(-Math.pow((hbp - 275) / 25, 2));
  const Cbp7 = Math.pow(Cbp, 7);
  const Rc = 2 * Math.sqrt(Cbp7 / (Cbp7 + Math.pow(25, 7)));
  const Sl = 1 + (0.015 * Math.pow(Lbp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbp - 50, 2));
  const Sc = 1 + 0.045 * Cbp;
  const Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt(
    Math.pow(dLp / Sl, 2) + Math.pow(dCp / Sc, 2) + Math.pow(dHp / Sh, 2)
    + Rt * (dCp / Sc) * (dHp / Sh));
}
