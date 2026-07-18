/**
 * Depth-resolved section data: ellipsometry spectrum Ψ(λ)/Δ(λ), refractive-index
 * profile n(z), and electric-field profile |E(z)|².
 */

import {
  computeRIProfile, computeEFieldProfile, computeEllipsometry,
} from '../../physics/thinFilmMath.js';
import { resolveMaterial, materialName, mediumId } from './engines.js';

// ── Ellipsometry spectrum Ψ(λ), Δ(λ) per AOI ────────────────────────────────
export function computeEllipsometrySpectrum(design, opts = {}) {
  const { lambdaStart = 400, lambdaEnd = 800, lambdaStep = 5 } = opts;
  const thetas = (opts.thetas && opts.thetas.length) ? opts.thetas
               : (opts.aoi != null ? [opts.aoi] : [65]);
  const n0mat = resolveMaterial(mediumId(design.incidentMedium));
  const nsmat = resolveMaterial(design.substrate?.material);
  const layerMats = (design.frontLayers || []).filter(l => l.material && l.thickness > 0);

  const lambda = [];
  for (let l = lambdaStart; l <= lambdaEnd + 1e-9; l += lambdaStep) lambda.push(Math.round(l * 1000) / 1000);

  const series = thetas.map(theta => {
    const psi = [], delta = [];
    for (const lam of lambda) {
      const n0 = n0mat.getNK(lam), ns = nsmat.getNK(lam);
      const layers = layerMats.map(l => ({ n: resolveMaterial(l.material).getNK(lam), d: l.thickness }));
      const e = computeEllipsometry(lam, theta, n0, ns, layers);
      psi.push(e.psi); delta.push(e.delta);
    }
    return { theta, psi, delta };
  });
  return { lambda, series };
}

// ── Refractive-index profile n(z) ───────────────────────────────────────────
export function computeRiProfile(design, opts = {}) {
  const lam = opts.lambda ?? design.referenceWavelength ?? 550;
  // getNK() returns a complex pair [re, im]; computeRIProfile wants { n, k }.
  const [n0n, n0k] = resolveMaterial(mediumId(design.incidentMedium)).getNK(lam);
  const [nsn, nsk] = resolveMaterial(design.substrate?.material).getNK(lam);
  const layers = (design.frontLayers || [])
    .filter(l => l.material && l.thickness > 0)
    .map(l => { const [nr, nk] = resolveMaterial(l.material).getNK(lam);
                return { n: nr, k: nk, d: l.thickness, name: materialName(l.material) }; });
  const prof = computeRIProfile({ n: n0n, k: n0k }, { n: nsn, k: nsk }, layers);
  return prof ? { lambda: lam, ...prof } : { lambda: lam, z: [], n: [], k: [], layerBounds: [] };
}

// ── Electric-field profile |E(z)|² ──────────────────────────────────────────
export function computeEField(design, opts = {}) {
  const lam = opts.lambda ?? design.referenceWavelength ?? 550;
  const theta = opts.theta ?? 0;
  const pol = opts.pol === 'p' ? 'p' : 's';
  // computeEFieldProfile takes complex pairs [re, im] directly from getNK().
  const n0 = resolveMaterial(mediumId(design.incidentMedium)).getNK(lam);
  const ns = resolveMaterial(design.substrate?.material).getNK(lam);
  const layers = (design.frontLayers || [])
    .filter(l => l.material && l.thickness > 0)
    .map(l => ({ n: resolveMaterial(l.material).getNK(lam), d: l.thickness }));
  const prof = computeEFieldProfile(lam, theta, pol, n0, ns, layers, 50);
  return { lambda: lam, theta, pol, ...prof };
}
