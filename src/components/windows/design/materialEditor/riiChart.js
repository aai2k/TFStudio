/** n/k preview of the page selected in the refractiveindex.info browser. */
import { sampleMaterial } from '../../../../utils/materials/riiDatabase.js';
import { useChartTeardown } from '../../../ui/plotSurface.js';
import { clearMaterialChart, drawIndexChart } from './materialChart.js';

const { createElement: h, useRef, useEffect } = React;

function drawRiiChart(element, material, c, xLabel) {
    if (!element) return;
    if (!material) { clearMaterialChart(element); return; }
    const samples = sampleMaterial(material);
    if (!samples.length) { clearMaterialChart(element); return; }
    const wavelengths = samples.map(row => row[0]);
    const n = samples.map(row => row[1]);
    const k = samples.map(row => row[2]);
    drawIndexChart(element, {
        wavelengths, n, k, hasK: k.some(value => value > 1e-8), c,
        xLabel, nLabel: 'n(λ)', kLabel: 'k(λ)',
    });
}

// Redraws on every render, the house convention for charts. The box gets the
// height the details above it leave, and that changes from page to page, so the
// canvas follows the box rather than keeping the size it was created at.
export function RiiChart({ material, c, xLabel }) {
    const ref = useRef(null);
    const chartRef = useRef(null);
    useEffect(() => { drawRiiChart(ref.current, material, c, xLabel); });
    useChartTeardown(ref, chartRef);
    return h('div', { ref, style: { flex: 1, minHeight: 160 } });
}
