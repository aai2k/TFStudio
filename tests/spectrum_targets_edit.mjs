// Validate the pure target-construction / drag helpers in
// src/utils/spectrumTargets.js. Run: node tests/spectrum_targets_edit.mjs
import {
    operandOverridesFromDrawnLine, applyHandleEdit,
    buildEditableTargetShapes, snapDrawnLine, buildTargetTraces,
} from '../src/utils/physics/spectrumTargets.js';

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
    const { shapes, meta } = buildEditableTargetShapes(ops, { min: 400, max: 700 });
    ok('handles skip disabled', shapes.length === 3 && meta.length === 3);
    ok('handle/meta aligned', meta[0].opId === 'a' && meta[1].opId === 'b' && meta[2].opId === 'c');
    ok('RAV handle flat', shapes[0].y0 === 1 && shapes[0].y1 === 1);
    ok('TGT handle ramp', approx(shapes[1].y0, 90) && approx(shapes[1].y1, 10));
    ok('point handle has width', shapes[2].x0 < 550 && shapes[2].x1 > 550);
    ok('all handles editable', shapes.every(s => s.editable === true && s.type === 'line'));
    ok('handles tagged with opId name', shapes[0].name === 'a' && shapes[1].name === 'b' && shapes[2].name === 'c');
    ok('handles family-coloured', shapes[0].line.color === '#ef5350' && shapes[1].line.color === '#4fc3f7');
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

// ── buildTargetTraces: line is densely sampled + click-taggable ──────────────
{
    const ops = [{ id: 'b1', enabled: true, type: 'RGT', lambdaStart: 400, lambdaEnd: 700, target: 0.5, targetEnd: 0.5 }];
    const tr = buildTargetTraces(ops);
    const line = tr.find(t => t.mode === 'lines');
    ok('band has a line trace', !!line);
    ok('line densely sampled', line.x.length >= 10);
    ok('line spans the band', line.x[0] === 400 && line.x[line.x.length - 1] === 700);
    ok('every line point tagged with opId', line.customdata.every(id => id === 'b1'));
    // Point operand → marker carries customdata for click-to-delete.
    const pt = buildTargetTraces([{ id: 'p1', enabled: true, type: 'R', lambdaStart: 550, target: 0.5 }]);
    const m = pt.find(t => t.mode === 'markers');
    ok('point marker tagged with opId', m && m.customdata[0] === 'p1');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
