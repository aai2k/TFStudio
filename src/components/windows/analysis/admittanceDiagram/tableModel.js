import { designMaterialLookup } from '../../../../utils/materials/designMaterials.js';
import { reflectionCoefficient } from './model.js';

// Catalog names carry their source and data range, which is far wider than the
// column needs. Copy CSV still emits the full name.
const MAX_MATERIAL_CHARS = 30;

function shortMaterial(name) {
    const text = String(name ?? '');
    return text.length > MAX_MATERIAL_CHARS ? `${text.slice(0, MAX_MATERIAL_CHARS - 1)}…` : text;
}

export function tableColumns(t) {
    return [
        { key: 'layer', label: t.admittance.colLayer, align: 'left' },
        { key: 'material', label: t.admittance.colMaterial, align: 'left', fmt: shortMaterial },
        { key: 're', label: 'Re(Y)', fmt: v => v.toFixed(5) },
        { key: 'im', label: 'Im(Y)', fmt: v => v.toFixed(5) },
        { key: 'gRe', label: 'Re(Γ)', fmt: v => v.toFixed(5) },
        { key: 'gIm', label: 'Im(Γ)', fmt: v => v.toFixed(5) },
    ];
}

export function buildMaterialNames(design, layers) {
    const resolveMaterial = designMaterialLookup(design);
    const matName = {};
    for (const l of layers) {
        if (l.material && !matName[l.material]) {
            const m = resolveMaterial(l.material);
            matName[l.material] = m?.name || l.material;
        }
    }
    return matName;
}

function mediumName(resolveMaterial, design, side) {
    const id = side === 'back' ? design?.exitMedium : design?.incidentMedium;
    return resolveMaterial(id)?.name || '—';
}

function boundaryRow(layer, material, Y, eta0) {
    const gamma = reflectionCoefficient(Y, eta0);
    return { layer, material, re: Y[0], im: Y[1], gRe: gamma[0], gIm: gamma[1] };
}

/**
 * One row per layer boundary, following the diagram from the substrate outwards:
 * the substrate admittance, then the admittance reached after each layer, then
 * the incident medium the last value is compared against. Each row also carries
 * that boundary's reflection coefficient, so |Gamma|^2 reads as the reflectance
 * the stack would have if it stopped there. The layer values are the
 * transfer-matrix admittances marking each arc's end, not the points the arc is
 * drawn from.
 */
export function buildAdmittanceTableRows(series, matName, design) {
    if (!series?.length) return [];
    const isMultiPol = series.length > 1;
    const resolveMaterial = designMaterialLookup(design);
    const rows = [];
    for (const s of series) {
        const polLabel = isMultiPol ? ` (${s.pol})` : '';
        const substrateName = resolveMaterial(design?.substrate?.material)?.name || '—';
        rows.push(boundaryRow(`η_s${polLabel}`, substrateName, s.etaS, s.eta0));
        for (const arc of s.arcs) {
            const material = matName[arc.material] || arc.material || '—';
            rows.push(boundaryRow(`L${arc.layerNum}${polLabel}`, material, s.Y[arc.layerNum - 1], s.eta0));
        }
        rows.push(boundaryRow(`η₀${polLabel}`, mediumName(resolveMaterial, design, s.side), s.eta0, s.eta0));
    }
    return rows;
}
