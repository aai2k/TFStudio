import { FAMILY_COLOR } from './controls.js';

const { createElement: h } = React;

export function MiniPlot({ curve, c, W = 320, H = 120 }) {
    if (!curve || !curve.x.length) return null;
    const pad = 4;
    const xs = curve.x, ys = curve.y;
    const xMin = xs[0], xMax = xs[xs.length - 1];
    let yMin = Infinity, yMax = -Infinity;
    for (const value of ys) {
        if (value < yMin) yMin = value;
        if (value > yMax) yMax = value;
    }
    if (!(xMax > xMin)) return null;
    if (!(yMax > yMin)) yMax = yMin + 1;
    const px = (x) => pad + (x - xMin) / (xMax - xMin) * (W - 2 * pad);
    const py = (y) => H - pad - (y - yMin) / (yMax - yMin) * (H - 2 * pad);
    const step = Math.max(1, Math.floor(xs.length / 400));
    let d = '';
    for (let i = 0; i < xs.length; i += step) {
        d += (d ? 'L' : 'M') + px(xs[i]).toFixed(1) + ' ' + py(ys[i]).toFixed(1);
    }
    return h('svg', { width: W, height: H, style: { background: c.bg, border: `1px solid ${c.border}`, borderRadius: 4 } },
        h('path', { d, fill: 'none', stroke: curve.color || FAMILY_COLOR[curve.quantity], strokeWidth: 1.5 }),
    );
}
