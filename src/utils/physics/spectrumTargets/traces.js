/**
 * Target marker/line Plotly traces for merit-operand overlays. See
 * ../spectrumTargets.js for the overlay conventions this implements.
 */

import {
    OPTICAL_TYPES, RANGE_TARGET_TYPES, isBandType,
    targetColor, targetDash, xMarker, POINT_TARGET_HOVER_LIMIT,
} from './style.js';

// A band operand (average or per-λ target) is drawn as a bold target line
// across [λStart, λEnd] (dash encodes polarization), sampled densely so hover
// + click register ANYWHERE along it (not just at the endpoints) — each point
// carries customdata=opId so a click on the line can delete it — plus X
// markers at the band ends + midpoint as visual emphasis.
function buildBandTraces(op, color, dash) {
    const isRangeTarget = RANGE_TARGET_TYPES.has(op.type);
    const isRamp  = isRangeTarget && op.targetEnd != null && op.targetEnd !== op.target;
    const tPct    = op.target * 100;
    const tEndPct = (isRangeTarget && op.targetEnd != null) ? op.targetEnd * 100 : tPct;
    const label   = isRamp
        ? `${op.type} ramp ${tPct.toFixed(2)}→${tEndPct.toFixed(2)}%`
        : `${op.type} ${tPct.toFixed(2)}%`;

    const N = (op.lambdaEnd === op.lambdaStart) ? 1 : 24;
    const lx = [], ly = [], lid = [];
    for (let i = 0; i < N; i++) {
        const f = N === 1 ? 0 : i / (N - 1);
        lx.push(op.lambdaStart + f * (op.lambdaEnd - op.lambdaStart));
        ly.push(tPct + f * (tEndPct - tPct));
        lid.push(op.id);
    }

    const midPct = (tPct + tEndPct) / 2;
    return [
        {
            x: lx, y: ly, customdata: lid,
            type: 'scatter', mode: 'lines',
            line: { color, dash, width: 2.5 },
            showlegend: false,
            hovertemplate: `${label} @ %{x:.0f} nm<extra></extra>`,
        },
        {
            x: [op.lambdaStart, (op.lambdaStart + op.lambdaEnd) / 2, op.lambdaEnd],
            y: [tPct, midPct, tEndPct],
            customdata: [op.id, op.id, op.id],
            type: 'scatter', mode: 'markers',
            marker: xMarker(color, 8),
            showlegend: false,
            hovertemplate: `${label}<extra></extra>`,
        },
    ];
}

// Above POINT_TARGET_HOVER_LIMIT point targets, merge same-colour markers into
// one trace per colour and turn hover OFF, so the spectrum curve's own hover
// isn't buried under hundreds of target tooltips.
function buildMergedPointTraces(pointOps) {
    const byColor = new Map();
    for (const { op, color } of pointOps) {
        let g = byColor.get(color);
        if (!g) { g = { x: [], y: [], ids: [] }; byColor.set(color, g); }
        g.x.push(op.lambdaStart);
        g.y.push(op.target * 100);
        g.ids.push(op.id);
    }
    const traces = [];
    for (const [color, g] of byColor) {
        traces.push({
            x: g.x, y: g.y, customdata: g.ids,
            type: 'scatter', mode: 'markers',
            marker: xMarker(color, 7),
            showlegend: false,
            hoverinfo: 'skip',
        });
    }
    return traces;
}

function buildIndividualPointTraces(pointOps) {
    return pointOps.map(({ op, color }) => ({
        x: [op.lambdaStart],
        y: [op.target * 100],
        customdata: [op.id],
        type: 'scatter', mode: 'markers',
        marker: xMarker(color, 10),
        showlegend: false,
        hovertemplate: `${op.type} target: ${(op.target * 100).toFixed(2)}%<br>λ ${op.lambdaStart} nm<extra></extra>`,
    }));
}

export function buildTargetTraces(operands) {
    if (!operands?.length) return [];
    const traces = [];
    const pointOps = [];   // single-λ markers, drawn last (possibly merged)

    for (const op of operands) {
        if (!op.enabled || !OPTICAL_TYPES.has(op.type)) continue;
        const color = targetColor(op);
        const dash  = targetDash(op);

        if (isBandType(op.type)) {
            traces.push(...buildBandTraces(op, color, dash));
        } else {
            pointOps.push({ op, color });
        }
    }

    const manyPoints = pointOps.length > POINT_TARGET_HOVER_LIMIT;
    traces.push(...(manyPoints
        ? buildMergedPointTraces(pointOps)
        : buildIndividualPointTraces(pointOps)));
    return traces;
}
