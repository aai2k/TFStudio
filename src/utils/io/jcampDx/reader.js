/**
 * XYDATA / XYPOINTS body decoding and spectrum assembly for the JCAMP-DX
 * parser.
 */

import { tokenizeAsdf, decodeAsdfTokens } from './asdf.js';
import { stripComment, unitToX, unitsToQuantity } from './ldr.js';

/**
 * Decode all XYDATA ordinate lines into a flat Y array, honoring the DIF
 * check-value duplicate at line starts. Each line's FIRST token is the abscissa
 * (a plain AFFN number — SQZ/DIF ordinates carry no delimiter from it) and is
 * dropped; the rest are ordinates.
 */
function decodeXydataOrdinates(body) {
    const state = { prevY: 0, lastDiff: null, lastWasDif: false };
    const allY = [];
    let prevLineEndedDif = false;
    let firstLine = true;
    for (const line of body) {
        if (line.trim() === '') continue;
        const allTok = tokenizeAsdf(line.trim());
        if (!allTok.length) continue;
        const { ys, endedDif } = decodeAsdfTokens(allTok.slice(1), state);
        // If the previous line ended in DIF mode, this line's first decoded
        // ordinate repeats the previous line's last value → drop it.
        if (!firstLine && prevLineEndedDif && ys.length) ys.shift();
        for (const y of ys) allY.push(y);
        prevLineEndedDif = endedDif;
        firstLine = false;
    }
    return allY;
}

/**
 * Abscissa step from FIRSTX + i*DELTAX (authoritative; per-line X are only
 * checks). Prefer an explicit ##DELTAX; else derive from FIRSTX/LASTX and the
 * actual point count (NPOINTS may be absent or wrong).
 */
function xydataStep(ctx, firstx, count) {
    let deltax = ctx.deltax;
    if (deltax == null) {
        const npts = (ctx.npoints && ctx.npoints > 1) ? ctx.npoints : count;
        if (npts > 1 && ctx.lastx != null) deltax = (ctx.lastx - firstx) / (npts - 1);
    }
    return deltax != null ? deltax : 1;
}

export function decodeXYDATA(body, ctx) {
    const yfactor = ctx.yfactor ?? 1;
    const firstx = ctx.firstx ?? 0;
    const allY = decodeXydataOrdinates(body).map(y => y * yfactor);
    const step = xydataStep(ctx, firstx, allY.length);
    const x = [];
    for (let i = 0; i < allY.length; i++) x.push(firstx + i * step);
    return { x, y: allY };
}

/**
 * Extract all finite numbers from XYPOINTS/PEAKTABLE body lines, in order.
 * Pairs are separated by ';' or whitespace; x,y within a pair by ',' or
 * whitespace.
 */
function parseXyNumbers(body) {
    const nums = [];
    for (const line of body) {
        const tr = stripComment(line).trim();
        if (!tr) continue;
        for (const tok of tr.split(/[;\s]+/)) {
            if (!tok) continue;
            for (const v of tok.split(',')) {
                const f = parseFloat(v);
                if (Number.isFinite(f)) nums.push(f);
            }
        }
    }
    return nums;
}

export function decodeXYPOINTS(body, ctx) {
    const xfactor = ctx.xfactor ?? 1;
    const yfactor = ctx.yfactor ?? 1;
    const nums = parseXyNumbers(body);
    const x = [], y = [];
    for (let i = 0; i + 1 < nums.length; i += 2) { x.push(nums[i] * xfactor); y.push(nums[i + 1] * yfactor); }
    return { x, y };
}

export function buildSpectrum(data, ctx) {
    const { quantity, isAbsorbance } = unitsToQuantity(ctx.yunits);
    const finiteY = data.y.filter(Number.isFinite);
    const maxY = finiteY.length ? Math.max(...finiteY) : 0;
    return {
        title: ctx.title || 'JCAMP-DX',
        dataType: ctx.dataType || '',
        xUnit: unitToX(ctx.xunits),
        quantity,
        isAbsorbance,
        isPercent: !isAbsorbance && maxY > 1.5,
        x: data.x,
        y: data.y,
    };
}
