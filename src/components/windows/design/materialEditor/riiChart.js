/** Imperative n/k preview used by the refractiveindex.info browser. */
import { sampleMaterial, RII_SAMPLE_RANGE_NM } from '../../../../utils/materials/riiDatabase.js';
import { clearMaterialChart, drawIndexChart } from './materialChart.js';

export function drawRiiChart(element, material, c, xLabel) {
    if (!element) return;
    if (!material) { clearMaterialChart(element); return; }
    const samples = sampleMaterial(material, ...RII_SAMPLE_RANGE_NM, 10);
    if (!samples.length) { clearMaterialChart(element); return; }
    const wavelengths = samples.map(row => row[0]);
    const n = samples.map(row => row[1]);
    const k = samples.map(row => row[2]);
    drawIndexChart(element, {
        wavelengths, n, k, hasK: k.some(value => value > 1e-8), c,
        xLabel, nLabel: 'n(λ)', kLabel: 'k(λ)',
    });
}
