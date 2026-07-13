import { resolveMaterial } from './model.js';

export const tableColumns = [
    { key: 'layer', label: 'Layer', align: 'left' },
    { key: 'material', label: 'Material', align: 'left' },
    { key: 're', label: 'Re(Y)', fmt: v => v.toFixed(5) },
    { key: 'im', label: 'Im(Y)', fmt: v => v.toFixed(5) },
];

export function buildMaterialNames(layers) {
    const matName = {};
    for (const l of layers) {
        if (l.material && !matName[l.material]) {
            const m = resolveMaterial(l.material);
            matName[l.material] = m?.name || l.material;
        }
    }
    return matName;
}

export function buildAdmittanceTableRows(series, matName) {
    if (!series?.length) return [];
    const isMultiPol = series.length > 1;
    const rows = [];
    for (const s of series) {
        const polLabel = isMultiPol ? ` (${s.pol})` : '';
        for (const arc of s.arcs) {
            const layerLabel = `L${arc.layerNum}${polLabel}`;
            const mat = matName[arc.material] || arc.material || '—';
            const len = Math.min(arc.re.length, arc.im.length);
            for (let j = 0; j < len; j++) {
                rows.push({ layer: layerLabel, material: mat, re: arc.re[j], im: arc.im[j] });
            }
        }
    }
    return rows;
}
