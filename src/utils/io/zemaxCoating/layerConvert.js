import { sanitizeZemaxName } from './names.js';

/**
 * Convert a parsed COAT layer stack to TFStudio layers (physical nm thickness).
 *
 * @param {object} coat   {type:'layers', name, layers:[…]}
 * @param {object} resolve
 *   @param {(zemaxName:string)=>(string|null)} resolve.materialId  Zemax name → TFStudio material id
 *   @param {(zemaxName:string, lamNm:number)=>number} resolve.realIndex  real n of a Zemax material at λ
 *   @param {number} resolve.refWavelengthUm   λ₀ for relative thicknesses (default 0.55)
 *   @param {(zemaxName:string)=>boolean} [resolve.isMedium]  treat as ambient/medium (skip as a layer)
 * @returns {{layers:Array<{material:string,thickness:number,locked:boolean}>, warnings:string[]}}
 *   thickness in nm.  Layer order is preserved as written in the file
 *   (Zemax COAT order = incident-medium-side → substrate-side).
 */
export function coatToTfLayers(coat, resolve) {
    const refUm = resolve.refWavelengthUm > 0 ? resolve.refWavelengthUm : 0.55;
    const refNm = refUm * 1000;
    const warnings = [];
    const layers = [];

    for (const L of (coat.layers || [])) {
        const id = resolve.materialId(L.material);
        if (!id) {
            warnings.push(`Coating "${coat.name}": material "${L.material}" not found — layer skipped.`);
            continue;
        }
        let dNm;
        if (L.isAbsolute) {
            dNm = L.thickness * 1000;                 // µm → nm
        } else {
            // d = T · λ₀ / n₀   (Help: "The COAT Data Section")
            const n0 = resolve.realIndex(L.material, refNm);
            if (!(n0 > 0)) {
                warnings.push(`Coating "${coat.name}": no real index for "${L.material}" at λ₀ — layer skipped.`);
                continue;
            }
            dNm = (L.thickness * refUm / n0) * 1000;
        }
        layers.push({ material: id, thickness: dNm, locked: false });
    }
    return { layers, warnings };
}

/**
 * Build a COAT record from a TFStudio layer stack.
 *
 * @param {string} name       coating name
 * @param {Array<{material:string, thickness:number}>} layers  thickness in nm,
 *        order = incident-side → substrate-side (TFStudio frontLayers order)
 * @param {object} opts
 *   @param {(materialId:string)=>string} opts.zemaxName        TFStudio id → MATE name
 *   @param {'absolute'|'relative'} [opts.mode='absolute']
 *   @param {number} [opts.refWavelengthUm=0.55]                λ₀ for relative mode
 *   @param {(materialId:string, lamNm:number)=>number} [opts.realIndex]  needed for relative mode
 * @returns {{name:string, layers:Array<{material:string,thickness:number,isAbsolute:number}>}}
 */
export function tfLayersToCoat(name, layers, opts) {
    const mode = opts.mode === 'relative' ? 'relative' : 'absolute';
    const refUm = opts.refWavelengthUm > 0 ? opts.refWavelengthUm : 0.55;
    const refNm = refUm * 1000;
    const out = [];
    for (const L of (layers || [])) {
        const mat = opts.zemaxName(L.material);
        const dNm = L.thickness;
        if (mode === 'absolute') {
            out.push({ material: mat, thickness: dNm / 1000, isAbsolute: 1 });   // nm → µm
        } else {
            const n0 = opts.realIndex(L.material, refNm);
            // T = n₀ · d / λ₀   (inverse of d = T·λ₀/n₀)
            const T = (n0 > 0) ? (n0 * (dNm / 1000)) / refUm : 0;
            out.push({ material: mat, thickness: T, isAbsolute: 0 });
        }
    }
    return { name: sanitizeZemaxName(name), layers: out };
}
