/**
 * Canvas drawing primitives in a Windows 95 style: a document area in a dialog,
 * bevelled blocks, and a message box for start and end screens. The colours come
 * from a scheme made from the app theme; see win95Scheme.js.
 *
 * Games draw through these calls and take colours from `colors`. Photon
 * Runner's spectrum tiers and night palette are its own.
 *
 *   clear(ctx, {night})                    background
 *   text(ctx, str, x, y, {size, color, align, bold})
 *   width(ctx, str, {size, bold})          measured width, in stage units
 *   on(color)                              black or white, whichever reads on color
 *   dot(ctx, x, y, r, color)               filled circle: ball, photon, ion
 *   ring(ctx, x, y, r, color)              circle outline
 *   block(ctx, {x, y, w, h}, color)        bevelled rectangle: brick, layer, paddle
 *   line(ctx, points, color, w, {dash})
 *   trail(ctx, points, color)              oldest point first
 *   band(ctx, y0, y1, color)               tinted horizontal region
 *   plate(ctx, x, y, w, h)                 opaque background behind a label
 *   overlay(ctx, title, lines, tone, buttonLabel)
 *   post(ctx)                              called after the game has drawn
 *
 * `use(scheme)` recolours the skin in place, so a game already running picks up
 * a theme change on its next frame. `dark` is true for a dark scheme.
 *
 * Coordinates are in the fixed 720x420 stage; see stage.js.
 */

import { W, H } from './stage.js';
import { FONT_STACK, gameColors, readableOn } from './win95Scheme.js';

// The black chamber Photon Runner switches to at night, whatever the scheme.
const NIGHT_BG = '#000000';
const NIGHT_INK = '#ffffff';

function font(size, bold) {
    return (bold ? 'bold ' : '') + size + 'px ' + FONT_STACK;
}

function strokePts(ctx, pts) {
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
        if (i === 0) ctx.moveTo(pts[i][0], pts[i][1]);
        else ctx.lineTo(pts[i][0], pts[i][1]);
    }
    ctx.stroke();
}

function wrapText(ctx, str, maxW) {
    if (!str) return [''];
    const words = String(str).split(' ');
    const lines = [];
    let cur = '';
    for (const word of words) {
        const test = cur ? cur + ' ' + word : word;
        if (cur && ctx.measureText(test).width > maxW) { lines.push(cur); cur = word; }
        else cur = test;
    }
    lines.push(cur);
    return lines;
}

const SKIN = {
    use(scheme) {
        this.scheme = scheme;
        this.colors = gameColors(scheme);
        this.dark = !scheme.light;
        this.patterns = {};
    },

    clear(ctx, o) {
        ctx.fillStyle = o && o.night ? NIGHT_BG : this.scheme.doc;
        ctx.fillRect(0, 0, W, H);
        this.night = !!(o && o.night);
    },

    text(ctx, str, x, y, o = {}) {
        ctx.font = font(o.size || 11, o.bold);
        ctx.fillStyle = o.color || (this.night ? NIGHT_INK : this.scheme.ink);
        ctx.textAlign = o.align || 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(str, x, y);
        ctx.textAlign = 'left';
    },

    width(ctx, str, o = {}) {
        ctx.font = font(o.size || 11, o.bold);
        return ctx.measureText(String(str)).width;
    },

    on(color) {
        return readableOn(color);
    },

    dot(ctx, x, y, r, color) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = this.night ? NIGHT_INK : this.scheme.ink;
        ctx.lineWidth = 1;
        ctx.stroke();
    },

    ring(ctx, x, y, r, color) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.stroke();
    },

    /** The raised edge that makes a rectangle look like a button. */
    bevel(ctx, x, y, w, h) {
        const s = this.scheme;
        ctx.lineWidth = 1;
        ctx.strokeStyle = s.hi;
        ctx.beginPath();
        ctx.moveTo(x + 0.5, y + h - 0.5); ctx.lineTo(x + 0.5, y + 0.5); ctx.lineTo(x + w - 0.5, y + 0.5);
        ctx.stroke();
        ctx.strokeStyle = s.dark;
        ctx.beginPath();
        ctx.moveTo(x + w - 0.5, y + 0.5); ctx.lineTo(x + w - 0.5, y + h - 0.5); ctx.lineTo(x + 0.5, y + h - 0.5);
        ctx.stroke();
        ctx.strokeStyle = s.shadow;
        ctx.beginPath();
        ctx.moveTo(x + w - 1.5, y + 1.5); ctx.lineTo(x + w - 1.5, y + h - 1.5); ctx.lineTo(x + 1.5, y + h - 1.5);
        ctx.stroke();
    },

    block(ctx, rect, color) {
        const { x, y, w, h } = rect;
        if (w < 2 || h < 2) return;
        ctx.fillStyle = color;
        ctx.fillRect(x, y, w, h);
        if (w >= 6 && h >= 6) this.bevel(ctx, x, y, w, h);
    },

    line(ctx, pts, color, w, o) {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = w || 1;
        if (o && o.dash) ctx.setLineDash([4, 4]);
        strokePts(ctx, pts);
        ctx.restore();
    },

    trail(ctx, pts) {
        ctx.fillStyle = this.colors.dim;
        for (let i = pts.length - 1; i >= 0; i -= 2) {
            ctx.fillRect(Math.round(pts[i].x) - 1, Math.round(pts[i].y) - 1, 2, 2);
        }
    },

    /* A sparse dither: a dense one turns into a solid wash when the canvas is
       scaled up. Built on first use rather than at module load, where there
       may be no document. */
    pattern(ctx, color) {
        if (!this.patterns[color]) {
            const tile = document.createElement('canvas');
            tile.width = 6;
            tile.height = 6;
            const tc = tile.getContext('2d');
            tc.fillStyle = color;
            tc.fillRect(0, 0, 1, 1);
            tc.fillRect(3, 3, 1, 1);
            this.patterns[color] = ctx.createPattern(tile, 'repeat');
        }
        return this.patterns[color];
    },

    band(ctx, y0, y1, color) {
        ctx.fillStyle = this.pattern(ctx, color);
        ctx.fillRect(0, y0, W, y1 - y0);
    },

    /** Opaque background behind a label drawn over a pattern. */
    plate(ctx, x, y, w, h) {
        ctx.fillStyle = this.night ? NIGHT_BG : this.scheme.doc;
        ctx.fillRect(x, y, w, h);
    },

    /** A message box with one button, for the start and end screens. */
    overlay(ctx, title, lines, tone, buttonLabel) {
        const s = this.scheme;
        const bw = 420;
        ctx.font = font(12);
        const body = [];
        for (const line of lines) {
            for (const part of wrapText(ctx, line, bw - 40)) body.push(part);
        }
        const bh = 92 + body.length * 18;
        const x = (W - bw) / 2;
        const y = (H - bh) / 2;

        ctx.fillStyle = s.face;
        ctx.fillRect(x, y, bw, bh);
        this.bevel(ctx, x, y, bw, bh);

        ctx.fillStyle = s.title;
        ctx.fillRect(x + 3, y + 3, bw - 6, 18);
        this.text(ctx, title, x + 8, y + 16, { size: 11, bold: true, color: s.titleText });

        ctx.fillStyle = s.face;
        ctx.fillRect(x + bw - 19, y + 5, 13, 13);
        this.bevel(ctx, x + bw - 19, y + 5, 13, 13);
        this.text(ctx, '×', x + bw - 12.5, y + 15, { size: 10, bold: true, align: 'center', color: s.faceText });

        for (let i = 0; i < body.length; i++) {
            this.text(ctx, body[i], x + 20, y + 44 + i * 18, { size: 12, color: s.faceText });
        }

        const bx = x + bw / 2 - 42;
        const by = y + bh - 34;
        ctx.fillStyle = s.face;
        ctx.fillRect(bx, by, 84, 23);
        ctx.strokeStyle = s.dark;
        ctx.lineWidth = 1;
        ctx.strokeRect(bx + 0.5, by + 0.5, 83, 22);
        this.bevel(ctx, bx + 1, by + 1, 82, 21);
        this.text(ctx, buttonLabel, bx + 42, by + 16, { size: 11, align: 'center', color: s.faceText });
    },

    post() {},
};

/** A skin drawing in `scheme`. Call `use` on it to recolour it later. */
export function createWin95Skin(scheme) {
    const skin = Object.create(SKIN);
    skin.night = false;
    skin.use(scheme);
    return skin;
}
