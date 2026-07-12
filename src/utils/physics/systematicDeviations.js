/**
 * Systematic Deviations — apply global / per-material perturbations to the
 * design (thickness scale factor + Δn + Δk) and re-evaluate the spectrum, or
 * sweep one perturbation parameter over a range to produce a 2-D map.
 *
 * Pure compose-on-top of the validated `evaluateSpectrum…` family — no new
 * TMM. Layer-thickness multipliers are applied physically (dᵢ' = dᵢ · s_d);
 * Δn / Δk are applied through `wrapMaterial` (same path the Variator uses).
 *
 * Use case: simulate the spectrum of a coating built by a deposition process
 * that systematically over-/under-shoots thickness or has a material-index
 * offset vs nominal.
 */

import { wrapMaterial } from '../misc/variator.js';
import {
    evaluateSpectrum, evaluateSpectrumBack, evaluateSpectrumTotal,
} from './thinFilmMath.js';

// ── Deviation spec ───────────────────────────────────────────────────────────

/**
 * Empty (no-op) deviation. Applying this to a design returns the unperturbed
 * spectrum bit-identically.
 *
 *   globalDeltaN          : added to n(λ) of every layer material
 *   globalDeltaK          : added to k(λ) of every layer material (clamped ≥ 0 in wrapMaterial)
 *   globalThicknessScale  : multiplies every layer's physical thickness
 *   globalThicknessOffset : a FLAT thickness offset ADDED to every layer after
 *                           the scale, expressed in `globalThicknessOffsetUnit`.
 *   globalThicknessOffsetUnit : 'nm' (physical) | 'ot' (optical thickness, nm) |
 *                           'qw' (quarter-waves @ λ₀) | 'fw' (full-waves @ λ₀).
 *                           For ot/qw/fw the optical offset is converted to a
 *                           physical Δd per layer via the layer material's
 *                           n(λ₀) (λ₀ = design.referenceWavelength). This means
 *                           a fixed optical offset maps to a DIFFERENT physical
 *                           nm in each material — exactly what "the run is 1 QW
 *                           long everywhere" physically means.
 *   perMaterial[matId]    : { dn, dk, dScale, dOffset, dOffsetUnit } — combined
 *                           ADDITIVELY for n/k, MULTIPLICATIVELY for the scale,
 *                           and ADDITIVELY (in physical nm, after unit
 *                           conversion) for the offset with the global values,
 *                           so users can express "everything ran 2 % thick, but
 *                           TiO2 also overshot by +3 nm".
 *
 * Final thickness per layer:  d' = max(0, d·scale + offset_phys)
 *   scale      = globalThicknessScale · perMaterial.dScale
 *   offset_phys = toPhysNm(globalOffset) + toPhysNm(perMaterial.dOffset)
 */
export function emptyDeviation() {
    return {
        globalDeltaN: 0,
        globalDeltaK: 0,
        globalThicknessScale: 1.0,
        globalThicknessOffset: 0,
        globalThicknessOffsetUnit: 'nm',
        perMaterial: {},
    };
}

// Thickness-offset units. 'nm' is a direct physical offset; the rest are
// OPTICAL and convert to physical nm using the layer material's n at λ₀:
//   ot : value is an optical-thickness offset Δ(n·d) in nm   → Δd = value / n
//   qw : value is in quarter-waves   (1 QW optical = λ₀/4)   → Δd = value·λ₀/(4n)
//   fw : value is in full-waves      (1 FW optical = λ₀)     → Δd = value·λ₀/n
// (QWOT convention matches the rest of the codebase: QWOT = 4·n·d / λ₀.)
export const THICKNESS_OFFSET_UNITS = ['nm', 'ot', 'qw', 'fw'];

function offsetToPhysicalNm(value, unit, nAtRef, lamRef) {
    if (!value) return 0;
    switch (unit) {
        case 'ot': return nAtRef > 0 ? value / nAtRef : 0;
        case 'qw': return nAtRef > 0 ? (value * lamRef) / (4 * nAtRef) : 0;
        case 'fw': return nAtRef > 0 ? (value * lamRef) / nAtRef : 0;
        case 'nm':
        default:   return value;
    }
}

// True when the deviation has any optical-unit (ot/qw/fw) thickness offset, so
// callers know they must look up n(λ₀) per layer (a plain 'nm' offset doesn't).
function needsRefIndex(dev) {
    const opt = (u) => u === 'ot' || u === 'qw' || u === 'fw';
    if ((dev?.globalThicknessOffset || 0) && opt(dev?.globalThicknessOffsetUnit)) return true;
    if (dev?.perMaterial) {
        for (const k of Object.keys(dev.perMaterial)) {
            const v = dev.perMaterial[k] || {};
            if ((v.dOffset || 0) && opt(v.dOffsetUnit)) return true;
        }
    }
    return false;
}

/**
 * Deep-clone a deviation spec — used by the sweep so we don't mutate the
 * caller's baseline while stepping a parameter.
 */
export function cloneDeviation(dev) {
    const out = emptyDeviation();
    if (!dev) return out;
    out.globalDeltaN = dev.globalDeltaN || 0;
    out.globalDeltaK = dev.globalDeltaK || 0;
    out.globalThicknessScale = (dev.globalThicknessScale ?? 1);
    out.globalThicknessOffset = dev.globalThicknessOffset || 0;
    out.globalThicknessOffsetUnit = dev.globalThicknessOffsetUnit || 'nm';
    if (dev.perMaterial) {
        for (const k of Object.keys(dev.perMaterial)) {
            const v = dev.perMaterial[k] || {};
            out.perMaterial[k] = {
                dn: v.dn || 0, dk: v.dk || 0, dScale: (v.dScale ?? 1),
                dOffset: v.dOffset || 0, dOffsetUnit: v.dOffsetUnit || 'nm',
            };
        }
    }
    return out;
}

/**
 * Has-any-perturbation check. Useful for the UI to know whether to draw the
 * baseline overlay (skip when dev is identity → both curves coincide anyway).
 */
export function isIdentityDeviation(dev) {
    if (!dev) return true;
    const nonZero  = (x) => Math.abs(x || 0) > 1e-12;         // additive term ≠ 0
    const notUnity = (x) => Math.abs((x ?? 1) - 1) > 1e-12;   // scale factor ≠ 1
    if (nonZero(dev.globalDeltaN) || nonZero(dev.globalDeltaK) ||
        notUnity(dev.globalThicknessScale) || nonZero(dev.globalThicknessOffset)) return false;
    if (dev.perMaterial) {
        for (const k of Object.keys(dev.perMaterial)) {
            const v = dev.perMaterial[k] || {};
            if (nonZero(v.dn) || nonZero(v.dk) || notUnity(v.dScale) || nonZero(v.dOffset)) return false;
        }
    }
    return true;
}

// ── Unique-material enumeration ──────────────────────────────────────────────

/**
 * Enumerate unique materials referenced in the design — front + back + media.
 * Returns [{ id, source }] in stable insertion order (front first, then back,
 * then substrate/incident/exit). `source` is purely informational for the UI.
 */
export function enumerateUniqueMaterials(design) {
    if (!design) return [];
    // One entry per unique material id (deviations are keyed by material id, so a
    // single perturbation governs every place that material appears). We still
    // collect ALL roles it plays so the UI can show e.g. "Air (incident, exit)" —
    // previously only the first role was kept, which made the exit medium look
    // missing whenever it shared a material (the common Air|…|Air case).
    const order = [];
    const roles = new Map();   // id → ['incident', 'exit', …] (insertion order, deduped)
    const add = (id, role) => {
        if (!id) return;
        if (!roles.has(id)) { roles.set(id, []); order.push(id); }
        const r = roles.get(id);
        if (!r.includes(role)) r.push(role);
    };
    for (const l of (design.frontLayers || [])) add(l.material, 'front');
    for (const l of (design.backLayers  || [])) add(l.material, 'back');
    add(design.substrate?.material, 'substrate');
    add(design.incidentMedium, 'incident');
    add(design.exitMedium, 'exit');
    return order.map(id => ({ id, roles: roles.get(id), source: roles.get(id).join(', ') }));
}

// ── Effective (combined) per-material perturbation ───────────────────────────

function effectiveForMaterial(dev, matId) {
    const pm = (dev?.perMaterial && matId && dev.perMaterial[matId]) || null;
    return {
        dn:     (dev?.globalDeltaN || 0)            + (pm?.dn || 0),
        dk:     (dev?.globalDeltaK || 0)            + (pm?.dk || 0),
        dScale: (dev?.globalThicknessScale ?? 1)    * (pm?.dScale ?? 1),
    };
}

/**
 * Combined physical thickness offset (nm) for a layer of material `matId`.
 * Global and per-material offsets are converted to physical nm (using the
 * layer material's n at λ₀ for optical units) and summed.
 *
 * @param {object} dev
 * @param {string} matId
 * @param {number} nAtRef   the layer material's n(λ₀) — only used for ot/qw/fw
 * @param {number} lamRef   reference wavelength λ₀ in nm
 */
function effectiveOffsetNm(dev, matId, nAtRef, lamRef) {
    const pm = (dev?.perMaterial && matId && dev.perMaterial[matId]) || null;
    const g = offsetToPhysicalNm(dev?.globalThicknessOffset || 0,
                                 dev?.globalThicknessOffsetUnit || 'nm', nAtRef, lamRef);
    const m = offsetToPhysicalNm(pm?.dOffset || 0, pm?.dOffsetUnit || 'nm', nAtRef, lamRef);
    return g + m;
}

// ── Layer / medium perturbation ──────────────────────────────────────────────

/**
 * Return a perturbed copy of a layer list, suitable for handing to
 * evaluateSpectrum… The output uses resolved material *objects* (the
 * spectrum API expects them).
 *
 * @param {{material:string, thickness:number, locked?:boolean}[]} layers
 * @param {object} dev
 * @param {(id:string)=>object} resolveMat
 * @param {number} [lamRef=550]  reference λ₀ (nm) for optical-unit (ot/qw/fw) offsets
 * @returns {{material:object, thickness:number, locked:boolean}[]}
 */
export function perturbLayers(layers, dev, resolveMat, lamRef = 550) {
    if (!Array.isArray(layers)) return [];
    // Only look up n(λ₀) when an optical-unit offset is actually present — keeps
    // the scale-only / identity paths bit-identical (no extra getNK calls).
    const wantRefIndex = needsRefIndex(dev);
    return layers.map(l => {
        const matId   = (typeof l.material === 'string') ? l.material : l.material?.id;
        const baseMat = (typeof l.material === 'string') ? resolveMat(l.material) : l.material;
        const { dn, dk, dScale } = effectiveForMaterial(dev, matId);
        let offsetNm = 0;
        const hasOffset = (dev?.globalThicknessOffset || 0) ||
            (matId && dev?.perMaterial?.[matId]?.dOffset);
        if (hasOffset) {
            let nRef = 0;
            if (wantRefIndex) {
                const nk = baseMat?.getNK ? baseMat.getNK(lamRef) : null;
                nRef = Array.isArray(nk) ? nk[0] : 0;
            }
            offsetNm = effectiveOffsetNm(dev, matId, nRef, lamRef);
        }
        return {
            material:  wrapMaterial(baseMat, dn, dk),
            thickness: Math.max(0, (l.thickness || 0) * dScale + offsetNm),
            locked:    !!l.locked,
        };
    });
}

/**
 * Perturb a named medium (incident / substrate / exit). Δn,Δk applied;
 * physical substrate thickness is NOT scaled (it is not a coating layer).
 */
export function perturbMedium(matId, dev, resolveMat) {
    const baseMat = resolveMat(matId);
    const { dn, dk } = effectiveForMaterial(dev, matId);
    return wrapMaterial(baseMat, dn, dk);
}

// ── Deviated design for Specification evaluation ─────────────────────────────

/**
 * Build a (design, resolveMat) pair that represents the design *with the
 * deviation applied*, suitable for `evaluateQualifiers`. Layer thicknesses are
 * scaled (global × per-material d-scale, keeping material id strings so the
 * qualifier pipeline still resolves them), and Δn/Δk are applied by wrapping the
 * resolver per material id (deviations are per-material, so this is exact).
 *
 * @returns {{ design: object, resolve: (id:string)=>object }}
 */
export function deviatedDesignForSpec(design, dev, resolveMat) {
    const d = dev || emptyDeviation();
    const lamRef = design?.referenceWavelength || 550;
    const wantRefIndex = needsRefIndex(d);
    const scaleLayers = (layers) => (layers || []).map(l => {
        const matId = (typeof l.material === 'string') ? l.material : l.material?.id;
        const { dScale } = effectiveForMaterial(d, matId);
        let offsetNm = 0;
        const hasOffset = (d.globalThicknessOffset || 0) ||
            (matId && d.perMaterial?.[matId]?.dOffset);
        if (hasOffset) {
            let nRef = 0;
            if (wantRefIndex) {
                const nk = resolveMat(matId)?.getNK ? resolveMat(matId).getNK(lamRef) : null;
                nRef = Array.isArray(nk) ? nk[0] : 0;
            }
            offsetNm = effectiveOffsetNm(d, matId, nRef, lamRef);
        }
        return { ...l, thickness: Math.max(0, (l.thickness || 0) * dScale + offsetNm) };
    });
    const devDesign = {
        ...design,
        frontLayers: scaleLayers(design?.frontLayers),
        backLayers:  scaleLayers(design?.backLayers),
    };
    const resolve = (id) => {
        const { dn, dk } = effectiveForMaterial(d, id);
        return wrapMaterial(resolveMat(id), dn, dk);
    };
    return { design: devDesign, resolve };
}

// ── Spectrum computation under a deviation ───────────────────────────────────

/**
 * Compute the (deviated) spectrum for a design.
 *
 * @param {object}  design
 * @param {object}  params     { lambdaStart, lambdaEnd, lambdaStep, theta, polarization }
 * @param {object}  deviation  see emptyDeviation()
 * @param {string}  evalMode   'front' | 'back' | 'total'
 * @param {function} resolveMat
 * @returns {{lambda:number[], R:number[], T:number[], A:number[], Rs,Ts,As,Rp,Tp,Ap}}
 */
export function computeDeviatedSpectrum(design, params, deviation, evalMode, resolveMat) {
    if (!design) throw new Error('computeDeviatedSpectrum: no design');
    const dev = deviation || emptyDeviation();
    // λ₀ for optical-unit (ot/qw/fw) thickness offsets — the design reference
    // wavelength (fixed; matches Stack Formula's QWOT basis).
    const lamRef = design.referenceWavelength || 550;

    if (evalMode === 'back') {
        const exitMat = perturbMedium(design.exitMedium, dev, resolveMat);
        const subMat  = perturbMedium(design.substrate?.material, dev, resolveMat);
        const layers  = perturbLayers(design.backLayers || [], dev, resolveMat, lamRef);
        return evaluateSpectrumBack(params, exitMat, subMat, layers);
    }
    if (evalMode === 'total') {
        const incMat  = perturbMedium(design.incidentMedium, dev, resolveMat);
        const subMat  = perturbMedium(design.substrate?.material, dev, resolveMat);
        const exitMat = perturbMedium(design.exitMedium, dev, resolveMat);
        const front   = perturbLayers(design.frontLayers || [], dev, resolveMat, lamRef);
        const back    = perturbLayers(design.backLayers  || [], dev, resolveMat, lamRef);
        const subThk  = design.substrate?.thickness ?? 1.0;
        return evaluateSpectrumTotal(params, incMat, subMat, exitMat, front, back, subThk);
    }
    // default: front
    const incMat = perturbMedium(design.incidentMedium, dev, resolveMat);
    const subMat = perturbMedium(design.substrate?.material, dev, resolveMat);
    const layers = perturbLayers(design.frontLayers || [], dev, resolveMat, lamRef);
    return evaluateSpectrum(params, incMat, subMat, layers);
}

// ── Parameter sweep ──────────────────────────────────────────────────────────

/**
 * Sweep parameter encoding:
 *   - 'globalDeltaN' | 'globalDeltaK' | 'globalThicknessScale' | 'globalThicknessOffset'
 *   - 'mat:<materialId>:dn'
 *   - 'mat:<materialId>:dk'
 *   - 'mat:<materialId>:dScale'
 *   - 'mat:<materialId>:dOffset'
 *
 * For the *Offset params the swept value is in the deviation's current offset
 * unit (globalThicknessOffsetUnit / perMaterial[id].dOffsetUnit) — the sweep
 * varies the magnitude, the unit is fixed by the setup.
 */
export function applyParamValue(dev, param, v) {
    if (!param) return dev;
    if (param === 'globalDeltaN')          { dev.globalDeltaN = v; return dev; }
    if (param === 'globalDeltaK')          { dev.globalDeltaK = v; return dev; }
    if (param === 'globalThicknessScale')  { dev.globalThicknessScale = v; return dev; }
    if (param === 'globalThicknessOffset') { dev.globalThicknessOffset = v; return dev; }
    if (param.startsWith('mat:')) {
        const parts = param.split(':');
        if (parts.length === 3) {
            const id = parts[1], field = parts[2];
            dev.perMaterial = dev.perMaterial || {};
            dev.perMaterial[id] = dev.perMaterial[id] || { dn: 0, dk: 0, dScale: 1, dOffset: 0, dOffsetUnit: 'nm' };
            if (field === 'dn' || field === 'dk' || field === 'dScale' || field === 'dOffset') {
                dev.perMaterial[id][field] = v;
            }
        }
    }
    return dev;
}

/**
 * Human label for a sweep parameter (for UI / hover text).
 */
export function paramLabel(param) {
    if (param === 'globalDeltaN')          return 'Global Δn';
    if (param === 'globalDeltaK')          return 'Global Δk';
    if (param === 'globalThicknessScale')  return 'Global thickness scale';
    if (param === 'globalThicknessOffset') return 'Global thickness offset';
    if (param && param.startsWith('mat:')) {
        const [, id, field] = param.split(':');
        const f = field === 'dn' ? 'Δn' : field === 'dk' ? 'Δk'
                : field === 'dOffset' ? 'd-offset' : 'd-scale';
        return `${id} ${f}`;
    }
    return param || '';
}

/**
 * Run a sweep: vary `sweep.param` linearly across [from, to] in `steps`
 * uniformly-spaced points, recording T/R/A vs λ at each.
 *
 * Returns 2-D arrays of shape [steps × nLambda], indexed [paramIndex][λIndex].
 *
 * @param {object}  design
 * @param {object}  params
 * @param {object}  baseDev   baseline deviation (not mutated)
 * @param {{param:string, from:number, to:number, steps:number}} sweep
 * @param {string}  evalMode
 * @param {function} resolveMat
 * @returns {{paramValues:number[], lambda:number[], T2D:number[][], R2D:number[][], A2D:number[][]}}
 */
export function runDeviationSweep(design, params, baseDev, sweep, evalMode, resolveMat) {
    const nSteps = Math.max(2, Math.floor(sweep?.steps || 11));
    const from   = Number.isFinite(sweep?.from) ? sweep.from : 0;
    const to     = Number.isFinite(sweep?.to)   ? sweep.to   : 1;

    const paramValues = [];
    for (let i = 0; i < nSteps; i++) {
        const t = nSteps === 1 ? 0 : i / (nSteps - 1);
        paramValues.push(from + (to - from) * t);
    }

    let lambda = null;
    const T2D = [], R2D = [], A2D = [];

    for (const v of paramValues) {
        const dev = cloneDeviation(baseDev);
        applyParamValue(dev, sweep.param, v);
        const sp = computeDeviatedSpectrum(design, params, dev, evalMode, resolveMat);
        if (!lambda) lambda = sp.lambda;
        T2D.push(sp.T); R2D.push(sp.R); A2D.push(sp.A);
    }
    return { paramValues, lambda, T2D, R2D, A2D };
}
