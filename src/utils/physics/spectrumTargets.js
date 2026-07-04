/**
 * Shared helpers for rendering merit-operand "target" markers and band-shaded
 * zones on a wavelength-axis Plotly chart, plus the interactive editing layer
 * (draw / drag targets directly on the spectrum).
 *
 * Used by Optical Evaluation (read-only AND interactive) and Variator
 * (read-only) so both windows draw identical target overlays for the design's
 * enabled operands.
 *
 * Conventions:
 *   - y axis is in % (target values are multiplied by 100 here)
 *   - x axis is wavelength in nm
 *   - Operand types TAV / RAV / AAV are band-averaged — drawn as a tinted
 *     zone spanning [lambdaStart, lambdaEnd] in x, full chart height in y,
 *     with the target level marked by a dotted line + X markers.
 *   - Continuous per-λ target types (TGT / RGT / AGT) draw a dotted target
 *     line (flat or linear ramp start→end) with X markers, plus a band zone.
 *   - Point operand types (T, TS, TP, R, RS, RP, A, AS, AP) are drawn as an
 *     X marker at the single λ = lambdaStart, at the target level.
 *
 * Interactive layer:
 *   - buildEditableTargetShapes() emits one editable Plotly *line* shape per
 *     band / point operand (the draggable "handle"), with a parallel `meta`
 *     array mapping shape index → operand id + kind.
 *   - applyHandleEdit() converts dragged shape coords back into an operand
 *     field patch.
 *   - operandOverridesFromDrawnLine() converts a freshly drawn line into the
 *     overrides for a brand-new operand (flat → band-average, sloped → ramp).
 */

// Legacy per-curve palette (kept for any external importers). The overlay now
// colours targets by R/T/A *family* and encodes polarization via dash instead,
// so avg / s / p of the same quantity stay clearly distinguishable (they were
// near-identical hues before).
export const CURVE_COLOR = {
    T:  '#4fc3f7',
    R:  '#ef5350',
    A:  '#66bb6a',
    Ts: '#81d4fa',
    Rs: '#ef9a9a',
    Tp: '#0277bd',
    Rp: '#c62828',
};

// Strong, fully-saturated family colours used for ALL polarizations.
export const FAMILY_COLOR = { T: '#4fc3f7', R: '#ef5350', A: '#66bb6a' };

export const RANGE_AVG_TYPES    = new Set(['TAV', 'RAV', 'AAV']);
// Continuous per-λ target operands (flat or linear ramp). Drawn as a dotted
// target line (start→end) spanning the band — plus a shaded band zone.
export const RANGE_TARGET_TYPES = new Set(['TGT', 'RGT', 'AGT']);
export const OPTICAL_TYPES   = new Set([
    'T','TS','TP','TAV','TGT', 'R','RS','RP','RAV','RGT', 'A','AS','AP','AAV','AGT',
]);

// A band operand spans [λStart, λEnd] (either an average or a per-λ target).
function isBandType(type) {
    return RANGE_AVG_TYPES.has(type) || RANGE_TARGET_TYPES.has(type);
}

export function operandCurveKey(op) {
    // Range-target / argwave / etc. don't carry an S/P suffix — fall back to op.pol.
    const polSuffix = (op.type.endsWith('S') && !RANGE_TARGET_TYPES.has(op.type)) ? 's'
                    : (op.type.endsWith('P') && !RANGE_TARGET_TYPES.has(op.type)) ? 'p'
                    : (op.pol ?? 'avg');
    if (op.type.startsWith('T')) return polSuffix === 's' ? 'Ts' : polSuffix === 'p' ? 'Tp' : 'T';
    if (op.type.startsWith('R')) return polSuffix === 's' ? 'Rs' : polSuffix === 'p' ? 'Rp' : 'R';
    return 'A';
}

// The R/T/A family of an operand type — used to pick the operand type for a
// newly drawn target and to colour-code markers.
export function operandFamily(type) {
    if (type.startsWith('T')) return 'T';
    if (type.startsWith('R')) return 'R';
    return 'A';
}

// Polarization of an operand: explicit S/P point types carry it in the suffix,
// everything else uses op.pol.
function operandPol(op) {
    if (op.type.endsWith('S') && !RANGE_TARGET_TYPES.has(op.type)) return 's';
    if (op.type.endsWith('P') && !RANGE_TARGET_TYPES.has(op.type)) return 'p';
    return op.pol ?? 'avg';
}

// Colour = R/T/A family (full saturation). Dash = polarization, mirroring the
// Optical-Evaluation curve convention (avg solid, s dot, p dash).
function targetColor(op) { return FAMILY_COLOR[operandFamily(op.type)] || '#aaaaaa'; }
function targetDash(op) {
    const p = operandPol(op);
    return p === 's' ? 'dot' : p === 'p' ? 'dash' : 'solid';
}

// Above this many single-λ ("point") target markers, the per-marker hover
// tooltips overlap the actual R/T/A curve readout and become unusable
// (e.g. a discrete continuous-target expanded at 1 nm → hundreds of markers).
// Past the threshold we MERGE all same-color point markers into one trace and
// turn OFF hover on them, so the spectrum's own hover stays readable.
const POINT_TARGET_HOVER_LIMIT = 30;

// Thin X-marker style shared by point + band target markers. Targets are
// marked with X's, using the slim 'x-thin' symbol so
// they don't read as heavy blobs over the R/T/A curves.
function xMarker(color, size = 8) {
    return { symbol: 'x-thin', size, color, line: { color, width: 1.3 } };
}

export function buildTargetTraces(operands) {
    if (!operands?.length) return [];
    const traces = [];
    const pointOps = [];   // single-λ markers, drawn last (possibly merged)

    for (const op of operands) {
        if (!op.enabled || !OPTICAL_TYPES.has(op.type)) continue;
        const color   = targetColor(op);
        const dash    = targetDash(op);
        const isRangeTarget = RANGE_TARGET_TYPES.has(op.type);

        if (isBandType(op.type)) {
            const isRamp  = isRangeTarget && op.targetEnd != null && op.targetEnd !== op.target;
            const tPct    = op.target * 100;
            const tEndPct = (isRangeTarget && op.targetEnd != null) ? op.targetEnd * 100 : tPct;
            const label   = isRamp
                ? `${op.type} ramp ${tPct.toFixed(2)}→${tEndPct.toFixed(2)}%`
                : `${op.type} ${tPct.toFixed(2)}%`;
            // Bold target line across the band (dash encodes polarization),
            // sampled densely so hover + click register ANYWHERE along it (not
            // just at the endpoints) — each point carries customdata=opId so a
            // click on the line can delete it.
            const N = (op.lambdaEnd === op.lambdaStart) ? 1 : 24;
            const lx = [], ly = [], lid = [];
            for (let i = 0; i < N; i++) {
                const f = N === 1 ? 0 : i / (N - 1);
                lx.push(op.lambdaStart + f * (op.lambdaEnd - op.lambdaStart));
                ly.push(tPct + f * (tEndPct - tPct));
                lid.push(op.id);
            }
            traces.push({
                x: lx, y: ly, customdata: lid,
                type: 'scatter', mode: 'lines',
                line: { color, dash, width: 2.5 },
                showlegend: false,
                hovertemplate: `${label} @ %{x:.0f} nm<extra></extra>`,
            });
            // X markers at the band ends + midpoint as visual emphasis.
            const midPct = (tPct + tEndPct) / 2;
            traces.push({
                x: [op.lambdaStart, (op.lambdaStart + op.lambdaEnd) / 2, op.lambdaEnd],
                y: [tPct, midPct, tEndPct],
                customdata: [op.id, op.id, op.id],
                type: 'scatter', mode: 'markers',
                marker: xMarker(color, 8),
                showlegend: false,
                hovertemplate: `${label}<extra></extra>`,
            });
        } else {
            pointOps.push({ op, color });
        }
    }

    const manyPoints = pointOps.length > POINT_TARGET_HOVER_LIMIT;
    if (manyPoints) {
        // Merge into one marker trace per color; hover OFF so the spectrum
        // curve's own hover isn't buried under hundreds of target tooltips.
        const byColor = new Map();
        for (const { op, color } of pointOps) {
            let g = byColor.get(color);
            if (!g) { g = { x: [], y: [], ids: [] }; byColor.set(color, g); }
            g.x.push(op.lambdaStart);
            g.y.push(op.target * 100);
            g.ids.push(op.id);
        }
        for (const [color, g] of byColor) {
            traces.push({
                x: g.x, y: g.y, customdata: g.ids,
                type: 'scatter', mode: 'markers',
                marker: xMarker(color, 7),
                showlegend: false,
                hoverinfo: 'skip',
            });
        }
    } else {
        for (const { op, color } of pointOps) {
            traces.push({
                x: [op.lambdaStart],
                y: [op.target * 100],
                customdata: [op.id],
                type: 'scatter', mode: 'markers',
                marker: xMarker(color, 10),
                showlegend: false,
                hovertemplate: `${op.type} target: ${(op.target * 100).toFixed(2)}%<br>λ ${op.lambdaStart} nm<extra></extra>`,
            });
        }
    }
    return traces;
}

// Band-type targets are spectral bands — render a tinted rectangle behind the
// curves so the eye picks out the zone immediately, plus faint dashed vertical
// boundary lines at the band edges. Covers BOTH the band-average types
// (TAV/RAV/AAV) and the continuous per-λ target types (TGT/RGT/AGT). Point
// targets have no width, so no zone is drawn for them.
//
// These shapes are NON-interactive (editable:false, layer below). The
// interactive editing handles live in buildEditableTargetShapes().
export function buildTargetShapes(operands) {
    if (!operands?.length) return [];
    const shapes = [];
    for (const op of operands) {
        if (!op.enabled || !OPTICAL_TYPES.has(op.type)) continue;
        if (!isBandType(op.type)) continue;
        if (op.lambdaStart == null || op.lambdaEnd == null) continue;
        if (op.lambdaStart === op.lambdaEnd) continue;   // zero-width → no zone
        const color = targetColor(op);
        shapes.push({
            type: 'rect', xref: 'x', yref: 'paper',
            x0: op.lambdaStart, x1: op.lambdaEnd, y0: 0, y1: 1,
            fillcolor: color, opacity: 0.12, line: { width: 0 },
            layer: 'below', editable: false,
        });
        // Band-edge delineators.
        for (const xb of [op.lambdaStart, op.lambdaEnd]) {
            shapes.push({
                type: 'line', xref: 'x', yref: 'paper',
                x0: xb, x1: xb, y0: 0, y1: 1,
                line: { color, width: 1, dash: 'dot' },
                opacity: 0.45, layer: 'below', editable: false,
            });
        }
    }
    return shapes;
}

// ── Interactive editing layer ─────────────────────────────────────────────────

// Build the editable Plotly *line* shapes that act as draggable handles for the
// design's band / point target operands. Returns { shapes, meta } where meta[i]
// describes shapes[i] — { opId, kind: 'band' | 'point' }. The arrays are index-
// aligned so a `plotly_relayout` event referencing `shapes[i]` maps straight to
// an operand.
//
// `lamRange` = { min, max } current x-axis range, used to size point handles
// (a point operand has zero band width, so its handle gets a small symmetric
// width around λ purely so Plotly can render + drag it).
export function buildEditableTargetShapes(operands, lamRange) {
    const shapes = [];
    const meta = [];
    if (!operands?.length) return { shapes, meta };

    const span = Math.max(1, (lamRange?.max ?? 1000) - (lamRange?.min ?? 0));
    const pointHalf = Math.max(2, span / 60);

    for (const op of operands) {
        if (!op.enabled || !OPTICAL_TYPES.has(op.type)) continue;
        const color = targetColor(op);
        const dash  = targetDash(op);

        if (isBandType(op.type)) {
            if (op.lambdaStart == null || op.lambdaEnd == null) continue;
            const isRangeTarget = RANGE_TARGET_TYPES.has(op.type);
            const tPct    = op.target * 100;
            const tEndPct = (isRangeTarget && op.targetEnd != null) ? op.targetEnd * 100 : tPct;
            shapes.push({
                type: 'line', xref: 'x', yref: 'y', name: op.id,
                x0: op.lambdaStart, x1: op.lambdaEnd, y0: tPct, y1: tEndPct,
                line: { color, width: 3, dash },
                editable: true, layer: 'above',
            });
            meta.push({ opId: op.id, kind: 'band', type: op.type });
        } else {
            // Point operand → short horizontal handle centred on λ.
            const lam = op.lambdaStart ?? 0;
            const tPct = op.target * 100;
            shapes.push({
                type: 'line', xref: 'x', yref: 'y', name: op.id,
                x0: lam - pointHalf, x1: lam + pointHalf, y0: tPct, y1: tPct,
                line: { color, width: 3, dash },
                editable: true, layer: 'above',
            });
            meta.push({ opId: op.id, kind: 'point', type: op.type });
        }
    }
    return { shapes, meta };
}

// Clamp a target value (fraction). R/T/A are physical 0..1.
function clampFrac(v) { return Math.min(1, Math.max(0, v)); }

// ── CAD-style snapping ────────────────────────────────────────────────────────
// Nearest value in `arr` within `tol`, or null. Used to snap a freshly
// drawn/dragged endpoint onto an existing target end so consecutive segments
// connect (ramp → flat) like object-snap in CAD.
function nearestWithin(arr, v, tol) {
    let best = null, bestD = tol;
    for (const a of arr) {
        const d = Math.abs(a - v);
        if (d <= bestD) { bestD = d; best = a; }
    }
    return best;
}
function snapToStep(v, step) { return step > 0 ? Math.round(v / step) * step : v; }

// Snap a drawn/dragged line ({x0,y0,x1,y1}; x = nm, y = %) to:
//   1. existing target endpoints (object-snap, so segments connect), else
//   2. the grid (nearest snapNm in x, snapPct in y), and
//   3. ortho — if the two ends are within snapPct in y, force them equal (a
//      perfectly flat line, e.g. a level at 50 %).
// `excludeId` omits one operand's own endpoints (when snapping a drag of it).
export function snapDrawnLine(line, opts = {}) {
    const { operands = [], snapNm = 10, snapPct = 5, ortho = true, excludeId = null } = opts;
    const xs = [], ys = [];
    for (const op of operands) {
        if (op.id === excludeId || !OPTICAL_TYPES.has(op.type)) continue;
        if (op.lambdaStart != null) xs.push(op.lambdaStart);
        if (op.lambdaEnd   != null) xs.push(op.lambdaEnd);
        if (op.target      != null) ys.push(op.target * 100);
        if (op.targetEnd   != null) ys.push(op.targetEnd * 100);
    }
    const snapX = (x) => {
        const near = nearestWithin(xs, x, Math.max(snapNm, 1e-9));
        return near != null ? near : snapToStep(x, snapNm);
    };
    const snapY = (y) => {
        const near = nearestWithin(ys, y, Math.max(snapPct, 1e-9));
        return near != null ? near : snapToStep(y, snapPct);
    };
    let x0 = snapX(line.x0), x1 = snapX(line.x1);
    let y0 = snapY(line.y0), y1 = snapY(line.y1);
    if (ortho && Math.abs(line.y0 - line.y1) <= snapPct) {
        const m = snapY((y0 + y1) / 2);
        y0 = y1 = m;
    }
    return { x0, y0, x1, y1 };
}

// Convert a dragged handle's new coordinates back into an operand field patch.
// `meta` is the entry from buildEditableTargetShapes; `coords` = {x0,x1,y0,y1}
// in data units (x = nm, y = %). Returns a partial operand { ... } to merge.
export function applyHandleEdit(meta, op, coords) {
    const x0 = coords.x0, x1 = coords.x1, y0 = coords.y0, y1 = coords.y1;
    // Order endpoints left→right so λStart < λEnd regardless of drag direction.
    const leftIsStart = x0 <= x1;
    const lamA = Math.max(0.01, Math.min(x0, x1));
    const lamB = Math.max(0.01, Math.max(x0, x1));
    const yStart = leftIsStart ? y0 : y1;   // level at the left (λStart) end
    const yEnd   = leftIsStart ? y1 : y0;   // level at the right (λEnd) end

    if (meta.kind === 'point') {
        const lam = (x0 + x1) / 2;
        const tgt = (y0 + y1) / 2;
        return { lambdaStart: Math.max(0.01, lam), lambdaEnd: Math.max(0.01, lam), target: clampFrac(tgt / 100) };
    }

    // Band operand.
    if (RANGE_TARGET_TYPES.has(op.type)) {
        // Per-λ target line: endpoints map to target (λStart) / targetEnd (λEnd),
        // so a tilted drag becomes a ramp and a flat drag a flat target.
        return {
            lambdaStart: lamA, lambdaEnd: lamB,
            target: clampFrac(yStart / 100),
            targetEnd: clampFrac(yEnd / 100),
        };
    }
    // Band average (TAV/RAV/AAV): single value, kept flat — use the midpoint
    // level so an accidental tilt doesn't desync the average from its handle.
    return {
        lambdaStart: lamA, lambdaEnd: lamB,
        target: clampFrac(((y0 + y1) / 2) / 100),
    };
}

// Convert a freshly drawn line into operand overrides for makeOperand().
// `curve` ∈ {R,T,A}, `pol` ∈ {avg,s,p}, `mode` ∈ {'average','continuous'}:
//   - 'average'    → band-average (TAV/RAV/AAV), a single flat level (the
//                    midpoint of the drawn line); slope is ignored.
//   - 'continuous' → per-λ target (TGT/RGT/AGT); a tilted line becomes a linear
//                    ramp (target at λStart → targetEnd at λEnd), flat stays flat.
export function operandOverridesFromDrawnLine(line, curve, pol, mode = 'average') {
    const leftIsStart = line.x0 <= line.x1;
    const lamA = Math.max(0.01, Math.min(line.x0, line.x1));
    const lamB = Math.max(0.01, Math.max(line.x0, line.x1));
    const yStart = leftIsStart ? line.y0 : line.y1;
    const yEnd   = leftIsStart ? line.y1 : line.y0;
    const fam = (curve === 'T' || curve === 'A') ? curve : 'R';

    if (mode === 'continuous') {
        const type = fam === 'T' ? 'TGT' : fam === 'A' ? 'AGT' : 'RGT';
        return {
            type, pol: pol || 'avg',
            lambdaStart: lamA, lambdaEnd: lamB,
            target: clampFrac(yStart / 100),
            targetEnd: clampFrac(yEnd / 100),
        };
    }
    const type = fam === 'T' ? 'TAV' : fam === 'A' ? 'AAV' : 'RAV';
    return {
        type, pol: pol || 'avg',
        lambdaStart: lamA, lambdaEnd: lamB,
        target: clampFrac(((yStart + yEnd) / 2) / 100),
        targetEnd: null,
    };
}
