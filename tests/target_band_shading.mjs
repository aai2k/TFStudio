/**
 * Band shading for optical merit targets on the spectrum plot.
 *
 * A band target shades the wavelengths it covers. A merit function carries many
 * of them over the same range — the wizard writes a pair of rows per angle of
 * incidence — and one fill per target compounds its alpha until the region is
 * opaque and the curves behind it are lost. Run: node tests/target_band_shading.mjs
 */
import assert from 'node:assert/strict';
import { targetSeries } from '../src/components/ui/targetSeries.js';
import { buildTargetGeometry } from '../src/utils/physics/spectrumTargets.js';

const decoration = bands => targetSeries({ bands }).find(entry => entry.markArea);
const spans = host => host.markArea.data.map(([start, end]) => [start.xAxis, end.xAxis]);
const shade = host => host.markArea.data.map(([start]) => start.itemStyle);

// ── Targets over one range shade it once ─────────────────────────────────────
{
    const host = decoration(Array.from({ length: 32 }, () => ({ x0: 400, x1: 700, color: '#4fc3f7' })));
    assert.deepEqual(spans(host), [[400, 700]], '32 targets over one range shade it once');
    assert.equal(shade(host)[0].opacity, 0.06, 'the fill keeps the shipped opacity');
    assert.equal(host.markLine.data.length, 2, 'each edge is ruled once');
}

// ── Overlapping ranges shade their union ─────────────────────────────────────
{
    const host = decoration([
        { x0: 400, x1: 500, color: '#ef5350' },
        { x0: 450, x1: 700, color: '#ef5350' },
        { x0: 700, x1: 800, color: '#ef5350' },
    ]);
    assert.deepEqual(spans(host), [[400, 800]], 'touching ranges join into one fill');
    assert.deepEqual(
        host.markLine.data.map(rule => rule.xAxis), [400, 500, 450, 700, 800],
        'every target keeps its own edge rule');
}

// ── Ranges that do not meet stay apart ───────────────────────────────────────
{
    const host = decoration([
        { x0: 1546.4, x1: 1548.4, color: '#4fc3f7' },
        { x0: 1549.7, x1: 1550.3, color: '#4fc3f7' },
        { x0: 1551.6, x1: 1553.6, color: '#4fc3f7' },
    ]);
    assert.deepEqual(spans(host), [[1546.4, 1548.4], [1549.7, 1550.3], [1551.6, 1553.6]],
        'a three-line filter keeps its three shaded passbands');
}

// ── Colour separates the shades ──────────────────────────────────────────────
{
    const host = decoration([
        { x0: 400, x1: 700, color: '#4fc3f7' },
        { x0: 400, x1: 700, color: '#ef5350' },
        { x0: 400, x1: 700, color: '#ef5350' },
    ]);
    assert.deepEqual(spans(host), [[400, 700], [400, 700]], 'T and R keep a fill each');
    assert.deepEqual(shade(host).map(style => style.color), ['#4fc3f7', '#ef5350']);
}

// ── A range written high to low merges with the ones it covers ───────────────
{
    const host = decoration([
        { x0: 700, x1: 400, color: '#66bb6a' },
        { x0: 500, x1: 600, color: '#66bb6a' },
    ]);
    assert.deepEqual(spans(host), [[400, 700]], 'the covered range adds no second fill');
}

// ── An angle-swept AR merit function, as the wizard generates it ─────────────
{
    const operands = [];
    for (let step = 0; step < 16; step++) {
        const aoi = step * 0.5;
        operands.push({ id: `r${step}`, type: 'RGT', enabled: true, pol: 'avg', aoi,
            lambdaStart: 400, lambdaEnd: 700, target: 0, targetEnd: 0 });
        operands.push({ id: `t${step}`, type: 'TGT', enabled: true, pol: 'avg', aoi,
            lambdaStart: 400, lambdaEnd: 700, target: 1, targetEnd: 1 });
    }
    const host = targetSeries(buildTargetGeometry(operands)).find(entry => entry.markArea);
    assert.equal(host.markArea.data.length, 2, '32 rows over 400-700 nm leave one fill per quantity');
    // Two fills at 0.06 leave the plot behind them plainly readable; 32 would
    // not (1 - 0.94**32 = 0.86).
    assert.ok(shade(host).every(style => style.opacity === 0.06));
}

console.log('target_band_shading: passed');
