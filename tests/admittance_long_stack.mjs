/**
 * Admittance Diagram on a long stack.
 *
 * ECharts lays out and paints every series on each pan and zoom frame, at a
 * cost per series far above its cost per point, so the chart draws the arcs of
 * one colour and dash as one line series, a gap between arcs, and every arc's
 * end as a point of one scatter series. On a 189-layer stack that is 6 series
 * where one per arc would be 381. The arcs are cut to the area the view can
 * reach, so a mirror's arcs out at admittances of 1e16 are not laid out on
 * every frame for nothing.
 *
 * Pinned here: the series count does not grow with the layers, the chart draws
 * the sampled arcs exactly wherever the view can go and nothing beyond, zooming
 * out past the axes cuts them to the grown area, the arcs turn smoothly, the
 * drawn arc ends are the transfer-matrix admittances the table lists, and how
 * many points the chart is handed for this stack. Pan frame time grows with
 * that count, so a change that raises it should be a decision made here.
 *
 * Run: node tests/admittance_long_stack.mjs
 */
import assert from 'node:assert/strict';
import { loadApp, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const { initCatalogs } = await import('../src/utils/materials/catalogManager.js');
initCatalogs({});
const { buildDiagramData, buildMatColorMap, sideStackLayers } = await import(
    '../src/components/windows/analysis/admittanceDiagram/model.js'
);
const { admittanceLociWithin, buildAdmittanceOption } = await import(
    '../src/components/windows/analysis/admittanceDiagram/chartFigure.js'
);
const { clipPolyline } = await import('../src/components/windows/analysis/admittanceDiagram/clipPolyline.js');
const { buildAdmittanceTableRows, buildMaterialNames } = await import(
    '../src/components/windows/analysis/admittanceDiagram/tableModel.js'
);

// ── The clip itself ─────────────────────────────────────────────────────────
{
    const box = { x: [-1, 2], y: [-1, 2] };
    assert.deepEqual(clipPolyline([-2, 0, 0, 3], [0, 0, 3, 3], box), [[[-1, 0], [0, 0], [0, 2]]],
        'a line entering, turning and leaving keeps its inside part, cut where it crosses');
    assert.deepEqual(clipPolyline([0, 4, 0], [0, 0, 1], box), [[[0, 0], [2, 0]], [[2, 0.5], [0, 1]]],
        'a line that leaves and comes back is two runs');
    assert.deepEqual(clipPolyline([0, 1, 1.5], [0, 1, -0.5], box), [[[0, 0], [1, 1], [1.5, -0.5]]],
        'a line wholly inside comes back as given');
    assert.deepEqual(clipPolyline([3, 5, 5], [3, 3, -5], box), [], 'a line wholly outside is dropped');
}

// Quarter waves near 550 nm, a high reflector there; 1471 nm lies outside its
// stop band, where every locus stays finite and inside the view's reach.
function stack(layers) {
    return {
        incidentMedium: 'builtin:Air',
        substrate: { material: 'builtin:BK7' },
        backLayers: [],
        frontLayers: Array.from({ length: layers }, (_, index) => (index % 2 === 0
            ? { id: `l${index}`, material: 'builtin:SiO2', thickness: 94.18383085873734 }
            : { id: `l${index}`, material: 'builtin:TiO2', thickness: 54.6376359331482 })),
    };
}

const COLORS = { paper: '#222', background: '#111', text: '#eee', border: '#333' };
const MAX_TURN_DEG = 2.0;
// The documented margin a cut end lies beyond the axes, as a fraction of their span.
const CLIP_MARGIN = 0.01;

function draw(design, lambda_nm, pol) {
    const layers = sideStackLayers(design, 'front');
    const matName = buildMaterialNames(design, layers);
    const matColorMap = buildMatColorMap(layers);
    const series = buildDiagramData(design, { lambda_nm, theta_deg: 0, pol, side: 'front' });
    const option = buildAdmittanceOption(series, matColorMap, matName, COLORS);
    return { series, option, matColorMap, matName, rows: buildAdmittanceTableRows(series, matName, design) };
}

// A line series split at its gaps, one run of [re, im] points per piece.
function runs(data) {
    const out = [[]];
    for (const point of data) {
        if (point === null) out.push([]);
        else out.at(-1).push(point);
    }
    return out;
}

function maxTurnDeg(points) {
    let worst = 0;
    for (let i = 1; i < points.length - 1; i++) {
        const ax = points[i][0] - points[i - 1][0], ay = points[i][1] - points[i - 1][1];
        const bx = points[i + 1][0] - points[i][0], by = points[i + 1][1] - points[i][1];
        if (Math.hypot(ax, ay) < 1e-12 || Math.hypot(bx, by) < 1e-12) continue;
        worst = Math.max(worst, Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by)) * 180 / Math.PI);
    }
    return worst;
}

const axesOf = option => ({ x: [option.xAxis.min, option.xAxis.max], y: [option.yAxis.min, option.yAxis.max] });
const inside = (point, box) => point[0] >= box.x[0] && point[0] <= box.x[1] && point[1] >= box.y[0] && point[1] <= box.y[1];
function grown(box, fraction) {
    const by = Math.max(box.x[1] - box.x[0], box.y[1] - box.y[0]) * fraction;
    return { x: [box.x[0] - by, box.x[1] + by], y: [box.y[0] - by, box.y[1] + by] };
}

// The sampled arcs each line series holds, in stack order.
function sampledArcs(series, lines, matColorMap) {
    const expected = new Map(lines.map(line => [line.id, []]));
    for (const item of series) {
        const dash = item.pol === 'p' ? 'dashed' : 'solid';
        for (const arc of item.arcs) {
            const line = lines.find(one => one.lineStyle.type === dash && one.lineStyle.color === matColorMap[arc.material]);
            expected.get(line.id).push(arc.re.map((re, index) => [re, arc.im[index]]));
        }
    }
    return expected;
}

// Every sampled segment with both ends in `box` is drawn as it is, every drawn
// point lies within `box` grown by the margin, and a run that does not end on
// a sampled vertex ends exactly on that grown edge, never short of it.
function assertDrawnWithin(data, arcs, box, tag) {
    const reach = grown(box, CLIP_MARGIN);
    const vertices = new Set(arcs.flatMap(arc => arc.map(String)));
    const onEdge = ([x, y]) => x === reach.x[0] || x === reach.x[1] || y === reach.y[0] || y === reach.y[1];
    const drawn = new Set();
    const pieces = runs(data);
    for (const piece of pieces) {
        for (let i = 1; i < piece.length; i++) drawn.add(`${piece[i - 1]}|${piece[i]}`);
        for (const point of piece) {
            assert.ok(inside(point, grown(box, CLIP_MARGIN + 1e-9)), `${tag}: drew ${point}, outside the reach`);
        }
        for (const end of [piece[0], piece.at(-1)]) {
            assert.ok(vertices.has(String(end)) || onEdge(end), `${tag}: a cut end at ${end} stops short of the edge`);
        }
    }
    for (const arc of arcs) {
        for (let i = 1; i < arc.length; i++) {
            if (inside(arc[i - 1], box) && inside(arc[i], box)) {
                assert.ok(drawn.has(`${arc[i - 1]}|${arc[i]}`), `${tag}: a segment within reach is missing`);
            }
        }
    }
    return pieces.reduce((n, piece) => n + piece.length, 0);
}

const long = stack(189);
const short = stack(2);

// [wavelength nm, polarization, points the sampler gives, points handed to the chart]
const CASES = [
    [550, 's', 15165, 1928],
    [1471, 's', 12765, 13144],
    [1471, 'avg', 25530, 26288],
];

for (const [lambda, pol, arcPoints, chartPoints] of CASES) {
    const tag = `${lambda} nm, ${pol}`;
    const { series, option, matColorMap, matName } = draw(long, lambda, pol);
    const lines = option.series.filter(item => item.type === 'line');
    const ends = option.series.find(item => item.type === 'scatter' && item.data.length > 1);

    assert.equal(option.series.length, draw(short, lambda, pol).option.series.length,
        `${tag}: 189 layers draw as many series as 2 of the same materials`);
    assert.equal(lines.length, 2 * series.length, `${tag}: one line series per material and polarization`);
    assert.equal(series.reduce((n, item) => n + item.arcs.reduce((m, arc) => m + arc.re.length, 0), 0), arcPoints,
        `${tag}: arc points`);
    assert.equal(option.series.reduce((n, item) => n + item.data.length, 0), chartPoints,
        `${tag}: points handed to the chart`);

    const sampled = sampledArcs(series, lines, matColorMap);
    for (const line of lines) {
        assertDrawnWithin(line.data, sampled.get(line.id), axesOf(option), `${tag}, ${line.name}`);
    }

    // Zooming out past the axes doubles them; the arcs are cut to the grown area.
    const axes = axesOf(option);
    const wider = grown(axes, 0.5);
    const regrown = admittanceLociWithin(series, matColorMap, matName, wider);
    assert.deepEqual(regrown.map(item => item.id), lines.map(line => line.id), `${tag}: re-cut series merge by id`);
    for (const item of regrown) assertDrawnWithin(item.data, sampled.get(item.id), wider, `${tag}, grown, ${item.id}`);

    // The drawn end of each arc is the admittance the table reports for its layer.
    const drawnEnds = ends.data.map(point => point.value);
    const tableEnds = series.flatMap(item => item.arcs.map(arc => item.Y[arc.k]));
    assert.equal(drawnEnds.length, tableEnds.length, `${tag}: one end point per arc`);
    drawnEnds.forEach(([re, im], index) => {
        const [wantRe, wantIm] = tableEnds[index];
        const error = Math.hypot(re - wantRe, im - wantIm) / Math.max(Math.hypot(wantRe, wantIm), 1);
        assert.ok(error < 1e-12, `${tag}: arc ${index} ends ${error.toExponential(2)} off its table value`);
    });
}

// Outside the stop band every arc lies within reach, so each is drawn whole,
// exactly as sampled, and turns smoothly.
{
    const { series, option, matColorMap } = draw(long, 1471, 'avg');
    const lines = option.series.filter(item => item.type === 'line');
    const sampled = sampledArcs(series, lines, matColorMap);
    for (const line of lines) {
        assert.deepEqual(runs(line.data), sampled.get(line.id), `1471 nm: ${line.name} draws its arcs as sampled`);
        for (const [index, run] of runs(line.data).entries()) {
            const turn = maxTurnDeg(run);
            assert.ok(turn <= MAX_TURN_DEG, `1471 nm ${line.name} arc ${index}: turns by ${turn.toFixed(2)} deg`);
        }
    }
}

// The table, boundary by boundary, at the values the transfer matrix gives.
const { rows } = draw(long, 1471, 's');
assert.equal(rows.length, 191);
assert.deepEqual([rows[1], rows[95], rows[189]], [
    { layer: 'L1', material: 'SiO2 (Fused Silica)', re: 1.4662705296958294, im: -0.05178801286537725, gRe: -0.1894163719899407, gIm: 0.017021050549968022 },
    { layer: 'L95', material: 'SiO2 (Fused Silica)', re: 1.449212101758622, im: -0.5427813961785419, gRe: -0.22163858314907162, gIm: 0.17249632903026207 },
    { layer: 'L189', material: 'SiO2 (Fused Silica)', re: 1.94116941621108, im: -0.821200995955207, gRe: -0.36917594289658845, gIm: 0.17613175939833317 },
]);

console.log('PASS: admittance_long_stack');
