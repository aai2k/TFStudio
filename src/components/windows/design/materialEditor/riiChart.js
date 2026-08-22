/** Imperative n/k preview used by the refractiveindex.info browser. */
import { sampleMaterial } from '../../../../utils/materials/riiDatabase.js';
import { clearMaterialChart, drawIndexChart } from './materialChart.js';

export function drawRiiChart(element, material, c) {
    if (!element) return;
    if (!material) { clearMaterialChart(element); return; }
    const samples = sampleMaterial(material, 200, 20000, 10);
    if (!samples.length) { clearMaterialChart(element); return; }
    const wavelengths = samples.map(row => row[0]);
    const n = samples.map(row => row[1]);
    const k = samples.map(row => row[2]);
    drawIndexChart(element, {
        wavelengths, n, k, hasK: k.some(value => value > 1e-8), c,
        xLabel: 'Wavelength (nm)', nLabel: 'n(λ)', kLabel: 'k(λ)',
    });
}
