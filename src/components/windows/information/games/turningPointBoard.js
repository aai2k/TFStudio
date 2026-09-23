/**
 * Turning Point Cutter drawing: the scrolling monitor trace, the stack built so
 * far, and the error budget left for the run.
 */

const TRACE_L = 172, TRACE_R = 706, TRACE_T = 74, TRACE_B = 360;
const PANEL_W = 152;
const PX_PER_QWOT = 210;
const STACK_ROWS = 11;

// Baselines of the three header rows: run, layer, and the trace label.
const RUN_Y = 20;
const LAYER_Y = 44;
const SIGNAL_Y = TRACE_T - 12;

function drawStackBars(s, ctx, base) {
    const c = s.S.colors;
    let y = base;
    for (const d of s.stack.slice(-STACK_ROWS).reverse()) {
        const h = Math.max(6, d.nm * 0.26);
        if (y - h < 44) break;
        // Layers cut more than 6 nm off are drawn grey instead of in their material colour.
        s.S.block(ctx, { x: 16, y: y - h, w: 84, h: h - 2 }, d.err > 6 ? c.obstacle : c[d.mat.key]);
        if (h >= 13) s.S.text(ctx, d.mat.name, 106, y - h / 2 + 4, { color: c.dim, size: 10 });
        y -= h;
    }
}

function drawStackPanel(s, ctx) {
    const c = s.S.colors;
    const base = s.H - 26;
    s.S.block(ctx, { x: 0, y: 0, w: PANEL_W, h: s.H }, c.panel);
    s.S.text(ctx, s.g.stack, 16, 26, { color: c.dim, size: 10 });
    drawStackBars(s, ctx, base);

    s.S.block(ctx, { x: 16, y: base, w: 84, h: 14 }, c.obstacle);
    s.S.text(ctx, s.g.glass, 106, base + 11, { color: c.dim, size: 10 });

    const frac = Math.max(0, s.budget) / s.budgetMax;
    s.S.text(ctx, s.g.budget, 16, 52, { color: c.dim, size: 10 });
    s.S.block(ctx, { x: 16, y: 58, w: 120, h: 8 }, c.grid);
    s.S.block(ctx, { x: 16, y: 58, w: 120 * frac, h: 8 },
        frac > 0.5 ? c.good : frac > 0.22 ? c.h : c.danger);
}

function tracePoints(s) {
    const sx = x => TRACE_R - (s.layer.x - x) * PX_PER_QWOT;
    const sy = v => TRACE_B - Math.max(0, Math.min(1, v)) * (TRACE_B - TRACE_T);
    const pts = [];
    for (const p of s.history) {
        const px = sx(p.x);
        if (px >= TRACE_L - 4) pts.push([px, sy(p.v)]);
    }
    return { pts, sy };
}

function drawTrace(s, ctx) {
    const c = s.S.colors;
    ctx.save();
    ctx.beginPath();
    ctx.rect(TRACE_L, TRACE_T - 10, TRACE_R - TRACE_L, TRACE_B - TRACE_T + 22);
    ctx.clip();

    // Horizontal grid lines only, so the grid does not show where the turning points are.
    for (let i = 0; i <= 4; i++) {
        const gy = TRACE_T + (TRACE_B - TRACE_T) * i / 4;
        s.S.line(ctx, [[TRACE_L, gy], [TRACE_R, gy]], c.grid, 1);
    }

    const { pts, sy } = tracePoints(s);
    if (pts.length > 1) s.S.line(ctx, pts, c.photon, 2);
    if (s.history.length) s.S.dot(ctx, TRACE_R, sy(s.history[s.history.length - 1].v), 4, c.photon);
    ctx.restore();

    s.S.line(ctx, [[TRACE_R, TRACE_T - 10], [TRACE_R, TRACE_B + 12]], c.dim, 1, { dash: true });
    s.S.text(ctx, s.g.signal, TRACE_L, SIGNAL_Y, { color: c.dim, size: 10 });
}

function drawHeader(s, ctx) {
    const c = s.S.colors;
    const big = { size: 13, bold: true };
    let x = TRACE_L;
    // Clamped: a finished run has moved past its last layer.
    const label = s.g.layerOf(Math.min(s.layerIndex + 1, s.plan.layers), s.plan.layers);
    s.S.text(ctx, label, x, LAYER_Y, { ...big, color: c.ink });
    x += s.S.width(ctx, label, big) + 14;
    s.S.text(ctx, s.layer.mat.name, x, LAYER_Y, { ...big, color: c[s.layer.mat.key] });
    x += s.S.width(ctx, s.layer.mat.name, big) + 14;
    s.S.text(ctx, s.g.cutAt(s.layer.target), x, LAYER_Y, { color: c.dim, size: 12 });
    s.S.text(ctx, (s.layer.x * s.layer.qwot).toFixed(1) + ' nm', TRACE_R, LAYER_Y,
        { color: c.dim, size: 12, align: 'right' });
    s.S.text(ctx, s.g.runOf(s.level, s.g.patterns[s.plan.pattern]), TRACE_L, RUN_Y,
        { color: c.dim, size: 11 });
}

function drawFlash(s, ctx) {
    const c = s.S.colors;
    const nm = s.flash.err.toFixed(1);
    const good = s.flash.err < 2;
    const message = s.flash.auto ? s.g.scrapped(nm) : good ? s.g.onPoint(nm) : s.g.offBy(nm);
    s.S.text(ctx, message, (TRACE_L + TRACE_R) / 2, TRACE_T + 26,
        { color: s.flash.auto ? c.danger : good ? c.good : c.h, size: 15, align: 'center', bold: true });
}

function drawOverlay(s, ctx) {
    if (s.state === 'ready') {
        if (s.level > 1) return;
        s.S.overlay(ctx, s.g.name, [s.g.howTo, '', s.g.controls], 'info', s.t.start);
    } else if (s.state === 'cleared') {
        s.S.overlay(ctx, s.g.runCleared(s.level),
            [s.g.totalError(s.totalErr.toFixed(1))], 'good', s.g.nextRun);
    } else if (s.state === 'dead') {
        s.S.overlay(ctx, s.g.aborted, [
            s.g.runsCleared(s.level - s.startLevel),
            s.g.deposited(s.stack.length),
            s.g.bestRun(s.best('turningPoint', 0)),
        ], 'bad', s.t.playAgain);
    }
}

export function draw(s, ctx) {
    s.S.clear(ctx);
    drawTrace(s, ctx);
    drawHeader(s, ctx);
    drawStackPanel(s, ctx);
    if (s.flash) drawFlash(s, ctx);
    drawOverlay(s, ctx);
}
