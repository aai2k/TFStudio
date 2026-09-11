// Validate the pure target-construction / drag helpers in
// src/utils/spectrumTargets.js. Run: node tests/spectrum_targets_edit.mjs
import {
    operandOverridesFromDrawnLine, applyHandleEdit,
    buildEditableTargetGeometry, snapDrawnLine, buildTargetGeometry,
    PERCENT_LEVEL, UNIT_LEVEL, levelOperandOverrides,
} from '../src/utils/physics/spectrumTargets.js';
import { targetSeries } from '../src/components/ui/targetSeries.js';

let pass = 0, fail = 0;
const approx = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.error('FAIL:', name); } }

// ── operandOverridesFromDrawnLine ─────────────────────────────────────────────
// Average mode: R line midpoint 1% across 400→700 nm → band-average RAV.
{
    const o = operandOverridesFromDrawnLine({ x0: 400, y0: 1.0, x1: 700, y1: 1.0 }, 'R', 'avg', 'average');
    ok('avg R → RAV', o.type === 'RAV');
    ok('avg RAV λStart', o.lambdaStart === 400);
    ok('avg RAV λEnd', o.lambdaEnd === 700);
    ok('avg RAV target=0.01', approx(o.target, 0.01));
    ok('avg RAV no ramp', o.targetEnd === null);
}
// Average mode ignores slope — uses the midpoint level, stays flat.
{
    const o = operandOverridesFromDrawnLine({ x0: 400, y0: 2, x1: 700, y1: 4 }, 'R', 'avg', 'average');
    ok('avg ignores slope → RAV', o.type === 'RAV');
    ok('avg midpoint level', approx(o.target, 0.03));
    ok('avg no targetEnd', o.targetEnd === null);
}
// Continuous mode: sloped T line 90%→10% → ramp TGT with target/targetEnd.
{
    const o = operandOverridesFromDrawnLine({ x0: 500, y0: 90, x1: 900, y1: 10 }, 'T', 's', 'continuous');
    ok('cont T → TGT', o.type === 'TGT');
    ok('TGT pol', o.pol === 's');
    ok('TGT target 0.9', approx(o.target, 0.9));
    ok('TGT targetEnd 0.1', approx(o.targetEnd, 0.1));
}
// Continuous mode, flat line → flat per-λ target (target == targetEnd).
{
    const o = operandOverridesFromDrawnLine({ x0: 400, y0: 50, x1: 700, y1: 50 }, 'A', 'avg', 'continuous');
    ok('cont A flat → AGT', o.type === 'AGT');
    ok('AGT flat target', approx(o.target, 0.5) && approx(o.targetEnd, 0.5));
}
// Drawn right→left must still normalize to λStart < λEnd, with levels following λ.
{
    const o = operandOverridesFromDrawnLine({ x0: 900, y0: 10, x1: 500, y1: 90 }, 'R', 'avg', 'continuous');
    ok('reversed λStart<λEnd', o.lambdaStart === 500 && o.lambdaEnd === 900);
    ok('reversed ramp target follows λStart', approx(o.target, 0.9));
    ok('reversed ramp targetEnd follows λEnd', approx(o.targetEnd, 0.1));
}
// Level clamps to physical [0,1].
{
    const o = operandOverridesFromDrawnLine({ x0: 400, y0: 140, x1: 700, y1: 140 }, 'R', 'avg', 'average');
    ok('over-100% clamps to 1', approx(o.target, 1));
}

// A target is measured at one angle, so the angle it was drawn at is carried
// into the operand rather than left at normal incidence.
{
    const avg = operandOverridesFromDrawnLine({ x0: 400, y0: 1, x1: 700, y1: 1 }, 'R', 'avg', 'average', 45);
    const cont = operandOverridesFromDrawnLine({ x0: 400, y0: 90, x1: 700, y1: 10 }, 'T', 'p', 'continuous', 30);
    ok('avg carries drawn AOI', avg.aoi === 45);
    ok('cont carries drawn AOI', cont.aoi === 30);
    ok('AOI defaults to normal incidence', operandOverridesFromDrawnLine({ x0: 400, y0: 1, x1: 700, y1: 1 }, 'R', 'avg', 'average').aoi === 0);
}

// ── applyHandleEdit ───────────────────────────────────────────────────────────
// Band average: kept flat, target = midpoint level.
{
    const op = { type: 'RAV' };
    const patch = applyHandleEdit({ kind: 'band', type: 'RAV' }, op, { x0: 410, x1: 690, y0: 2, y1: 4 });
    ok('RAV edit λ', patch.lambdaStart === 410 && patch.lambdaEnd === 690);
    ok('RAV edit flat midpoint', approx(patch.target, 0.03));
    ok('RAV edit no targetEnd', !('targetEnd' in patch));
}
// Range target: endpoints → target / targetEnd (ramp).
{
    const op = { type: 'TGT' };
    const patch = applyHandleEdit({ kind: 'band', type: 'TGT' }, op, { x0: 500, x1: 900, y0: 80, y1: 20 });
    ok('TGT edit target', approx(patch.target, 0.8));
    ok('TGT edit targetEnd', approx(patch.targetEnd, 0.2));
}
// Point: collapses to single λ at the midpoint, level = mean.
{
    const op = { type: 'R' };
    const patch = applyHandleEdit({ kind: 'point', type: 'R' }, op, { x0: 545, x1: 555, y0: 12, y1: 12 });
    ok('point λ midpoint', approx(patch.lambdaStart, 550) && approx(patch.lambdaEnd, 550));
    ok('point target', approx(patch.target, 0.12));
}

// ── buildEditableTargetShapes ─────────────────────────────────────────────────
{
    const ops = [
        { id: 'a', enabled: true, type: 'RAV', lambdaStart: 400, lambdaEnd: 700, target: 0.01 },
        { id: 'b', enabled: true, type: 'TGT', lambdaStart: 500, lambdaEnd: 600, target: 0.9, targetEnd: 0.1 },
        { id: 'c', enabled: true, type: 'R',   lambdaStart: 550, target: 0.5 },
        { id: 'd', enabled: false, type: 'RAV', lambdaStart: 400, lambdaEnd: 700, target: 0.01 },
    ];
    const geometry = buildEditableTargetGeometry(ops, { min: 400, max: 700 });
    ok('handles skip disabled', geometry.length === 3);
    ok('geometry carries operand ids', geometry.map(item => item.opId).join(',') === 'a,b,c');
    ok('RAV handle flat', geometry[0].y0 === 1 && geometry[0].y1 === 1);
    ok('TGT handle ramp', approx(geometry[1].y0, 90) && approx(geometry[1].y1, 10));
    ok('point handle has fixed data width', geometry[2].x0 < 550 && geometry[2].x1 > 550);
    ok('geometry identifies edit kind', geometry.map(item => item.kind).join(',') === 'band,band,point');
    ok('handles family-coloured', geometry[0].color === '#ef5350' && geometry[1].color === '#4fc3f7');
}

// ── snapDrawnLine ─────────────────────────────────────────────────────────────
// Grid snap: x→nearest snapNm, y→nearest snapPct.
{
    const s = snapDrawnLine({ x0: 403, y0: 48, x1: 698, y1: 52 }, { operands: [], snapNm: 10, snapPct: 5 });
    ok('snap x0→400', s.x0 === 400);
    ok('snap x1→700', s.x1 === 700);
    // |48-52| = 4 <= snapPct(5) → ortho flat at snapped midpoint (50).
    ok('snap ortho flat', s.y0 === s.y1);
    ok('snap flat level 50', s.y0 === 50);
}
// Horizontal-line-at-50% case: draw a roughly flat line near 50 → exact 50 flat.
{
    const s = snapDrawnLine({ x0: 410, y0: 49.5, x1: 690, y1: 50.4 }, { operands: [], snapNm: 5, snapPct: 5 });
    ok('horizontal snaps to 50 flat', s.y0 === 50 && s.y1 === 50);
}
// Object-snap: an endpoint near an existing target end connects to it exactly.
{
    const ops = [{ id: 'x', type: 'RGT', lambdaStart: 500, lambdaEnd: 600, target: 0.9, targetEnd: 0.1 }];
    // Draw a second segment starting near (600, 10) → should snap onto it.
    const s = snapDrawnLine({ x0: 603, y0: 11, x1: 700, y1: 9 }, { operands: ops, snapNm: 10, snapPct: 5 });
    ok('object-snap x0→600', s.x0 === 600);
    ok('object-snap y0→10', s.y0 === 10);
}
// Steep line is NOT forced flat (slope preserved beyond snapPct).
{
    const s = snapDrawnLine({ x0: 500, y0: 90, x1: 900, y1: 10 }, { operands: [], snapNm: 10, snapPct: 5 });
    ok('steep keeps slope', s.y0 !== s.y1);
}
// excludeId: dragging an operand doesn't snap to its own old endpoints.
{
    const ops = [{ id: 'self', type: 'RAV', lambdaStart: 400, lambdaEnd: 700, target: 0.2 }];
    const s = snapDrawnLine({ x0: 402, y0: 33, x1: 698, y1: 33 }, { operands: ops, snapNm: 10, snapPct: 5, excludeId: 'self' });
    ok('exclude self → grid snap not self-snap', s.x0 === 400 && s.x1 === 700);
}

// ── Level readings: the same drawing code serves a plot in any unit ───────────
// The R/T/A plot reads a fraction as percent and clamps; a plot in a raw unit
// such as fs² reads the axis value as it is and bounds nothing.
{
    ok('percent reading scales a fraction', PERCENT_LEVEL.toAxis(0.25) === 25);
    ok('percent reading clamps to physical range', PERCENT_LEVEL.fromAxis(140) === 1);
    ok('unit reading is the identity', UNIT_LEVEL.toAxis(-60) === -60 && UNIT_LEVEL.fromAxis(12000) === 12000);
    const o = levelOperandOverrides(
        { x0: 800, y0: -63, x1: 700, y1: -57 }, { type: 'GDDFLAT', pol: 'avg', aoi: 0 }, UNIT_LEVEL);
    ok('unit level: mean height in the axis unit', approx(o.target, -60) && o.targetEnd === null);
    ok('unit level: the caller\'s fields are kept', o.type === 'GDDFLAT' && o.pol === 'avg');
    ok('unit level: wavelengths put in order', o.lambdaStart === 700 && o.lambdaEnd === 800);
    const patch = applyHandleEdit({ kind: 'band', type: 'GDDFLAT' }, { type: 'GDDFLAT' },
        { x0: 700, x1: 900, y0: -70, y1: -50 }, UNIT_LEVEL);
    ok('unit level edit is flat, unclamped', approx(patch.target, -60) && !('targetEnd' in patch));
    const pointPatch = applyHandleEdit({ kind: 'point', type: 'GDD' }, { type: 'GDD' },
        { x0: 610, x1: 630, y0: -40, y1: -40 }, UNIT_LEVEL);
    ok('unit level point edit', pointPatch.lambdaStart === 620 && pointPatch.target === -40);
    const anchors = [{ id: 'g', type: 'GDD', lambdaStart: 600, lambdaEnd: 600, target: -50 }];
    const s = snapDrawnLine({ x0: 603, y0: -52, x1: 700, y1: -20 },
        { operands: anchors, snapNm: 10, snapPct: 10, types: new Set(['GDD']), level: UNIT_LEVEL });
    ok('object-snap reads the anchors through the plot\'s level', s.x0 === 600 && s.y0 === -50);
    ok('a steep line in the raw unit keeps its slope', s.y1 === -20);
    const ignored = snapDrawnLine({ x0: 603, y0: -52, x1: 700, y1: -20 },
        { operands: anchors, snapNm: 10, snapPct: 10, level: UNIT_LEVEL });
    ok('operands of another plot are not anchors', ignored.x0 === 600 && ignored.y0 === -50 && ignored.x0 === 600);
}

// ── Visible target geometry: sampled where the axis bends it, click-taggable ─
//
// A ramp is straight in the data and a curve on a logarithmic axis, so it is
// sampled along its length. A flat target is horizontal on either axis, so its
// two ends describe it exactly; a merit function written per wavelength is
// thousands of flat targets, and sampling each into 24 points is what made a
// plot of them slow to draw and slower to resize.
{
    const ops = [{ id: 'b1', enabled: true, type: 'RGT', lambdaStart: 400, lambdaEnd: 700, target: 0.5, targetEnd: 0.5 }];
    const visible = buildTargetGeometry(ops);
    const line = visible.lines[0];
    ok('band fill stays subtle', visible.bands[0]?.opacity === 0.06);
    ok('band has a visible line', !!line);
    ok('flat target is its two ends', line.points.length === 2);
    ok('flat target is level', line.points[0][1] === line.points.at(-1)[1]);
    ok('line spans the band', line.points[0][0] === 400 && line.points.at(-1)[0] === 700);
    ok('line tagged with opId', line.opId === 'b1');

    const ramp = buildTargetGeometry([
        { id: 'r1', enabled: true, type: 'RGT', lambdaStart: 400, lambdaEnd: 700, target: 0.1, targetEnd: 0.9 },
    ]).lines[0];
    ok('ramp densely sampled', ramp.points.length >= 10);
    ok('ramp spans the band', ramp.points[0][0] === 400 && ramp.points.at(-1)[0] === 700);
    ok('ramp rises across it', ramp.points[0][1] < ramp.points.at(-1)[1]);
    const rises = ramp.points.every((p, i) => i === 0 || p[1] > ramp.points[i - 1][1]);
    ok('ramp samples step evenly', rises);

    const point = buildTargetGeometry([{ id: 'p1', enabled: true, type: 'R', lambdaStart: 550, target: 0.5 }]);
    ok('point marker tagged with opId', point.markers[0]?.opId === 'p1');
}

// ── Every band type is drawn the same way ──────────────────────────────────
// Six operand types draw a band: the averages, which are level by definition,
// and the per-λ targets, which are level unless a ramp end says otherwise.
{
    const BAND_TYPES = ['TAV', 'TGT', 'RAV', 'RGT', 'AAV', 'AGT'];
    for (const type of BAND_TYPES) {
        const flat = buildTargetGeometry([
            { id: 'f', enabled: true, type, lambdaStart: 400, lambdaEnd: 700, target: 0.5, targetEnd: 0.5 },
        ]).lines[0];
        ok(`${type} flat target is its two ends`, flat.points.length === 2);
        ok(`${type} carries three markers`,
            buildTargetGeometry([{ id: 'f', enabled: true, type, lambdaStart: 400, lambdaEnd: 700, target: 0.5 }])
                .markers.length === 3);
    }
    for (const type of ['TGT', 'RGT', 'AGT']) {
        const ramp = buildTargetGeometry([
            { id: 'r', enabled: true, type, lambdaStart: 400, lambdaEnd: 700, target: 0.1, targetEnd: 0.9 },
        ]).lines[0];
        ok(`${type} ramp stays sampled`, ramp.points.length >= 10);
    }
}

// ── One series per style, not one per target ────────────────────────────────
// Each target is a short run in one of a few colours. A series apiece is
// thousands for the chart to lay out and redraw while drawing no more ink, so
// runs of one style share a series and are split by a gap.
{
    const many = [];
    for (const type of ['TAV', 'TGT', 'RAV', 'RGT', 'AAV', 'AGT']) {
        for (let i = 0; i < 200; i++) {
            many.push({ id: type + i, enabled: true, type, lambdaStart: 400, lambdaEnd: 700, target: 0.5, targetEnd: 0.5 });
        }
    }
    const series = targetSeries(buildTargetGeometry(many));
    ok('1200 targets do not become 1200 series', series.length < 10);
    const lines = series.filter(s => s.type === 'line' && s.data?.length > 2);
    // T, R and A keep a colour each; the averages and the per-λ targets of one
    // quantity are drawn alike, so they share it.
    ok('the target lines are one series per colour', lines.length === 3);
    for (const line of lines) {
        const drawn = line.data.filter(p => p.value[0] !== null);
        const runs = line.data.filter(p => p.value[0] === null).length + 1;
        ok('each target keeps its own run', runs === 400);
        ok('a run is a pair of ends', drawn.length === 800);
        ok('points still name their operand', drawn[0].operandId.length > 0);
    }
    const colours = new Set(lines.map(l => l.lineStyle.color));
    ok('the three quantities stay visually apart', colours.size === 3);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
