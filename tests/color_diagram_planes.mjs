/**
 * The Color Evaluation diagrams' colour math (src/utils/physics/colorimetry):
 *
 *   - the fill colour of a chromaticity: the D65 white is white and each sRGB
 *     primary is its own channel alone; a spectral colour outside the sRGB
 *     primaries is brought in by adding white, so the colour shown keeps its
 *     dominant wavelength (Macleod, Thin-Film Optical Filters 5th ed., §12.2);
 *     adapted from an illuminant's white, as on the CIELAB and CIELUV planes,
 *     that white is white and the primaries seen under it are their channels;
 *   - the sRGB primaries and white: the IEC 61966-2-1 matrix takes each primary
 *     to one channel and the white to equal channels;
 *   - CIELAB and CIELUV solved back for XYZ are the inverses of the forward
 *     formulas, on both branches of L*;
 *   - every plane takes a chromaticity there and back, and places a computed
 *     colour where its report says: x, y; u′, v′; a*, b*; u*, v*;
 *   - no optimal colour, the most saturated a surface can have, reaches a
 *     chroma of 200, so no coating's point on the CIELAB and CIELUV planes
 *     does unless R or T is above 1;
 *   - the Planckian locus at 2856 K is CIE illuminant A's chromaticity, CIE
 *     15:2004 Table T.3, as far as the 5 nm table and the two values of c2
 *     allow.
 *
 * Run: node tests/color_diagram_planes.mjs
 */

import assert from 'node:assert/strict';
import {
    chromaticityDisplayRgb, chromaticityXy, colorReport, diagramPlane, DIAGRAM_IDS, dominantWavelength,
    ILLUMINANTS, lab, labToXyz, locusOutline, luv, luvToXyz, OBSERVERS, planckianLocus, planckianXyz,
    spectralLocusXy, SRGB_PRIMARIES, srgbPrimariesUnder, srgbTriangle, tristimulus, whitePoint,
} from '../src/utils/physics/colorimetry.js';

let failures = 0;
function check(name, fn) {
    try {
        fn();
        console.log('  ok', name);
    } catch (error) {
        failures++;
        console.error('FAIL', name, '\n    ', error.message);
    }
}

const close = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
const grid = Array.from({ length: 801 }, (_, i) => 380 + 0.5 * i);
const D65 = whitePoint(grid, '2', 'D65');

// sRGB encoded 0..255 back to linear, then to XYZ through the inverse of the
// IEC 61966-2-1 matrix (its published RGB to XYZ form, D65).
const decode = v => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};
const RGB_XYZ = [[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]];
function shownChromaticity(rgb) {
    const lin = rgb.map(decode);
    const [X, Y, Z] = RGB_XYZ.map(row => row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2]);
    return chromaticityXy({ X, Y, Z });
}

check('the D65 white fills white and each sRGB primary fills its own channel', () => {
    assert.deepEqual(chromaticityDisplayRgb(SRGB_PRIMARIES.white.x, SRGB_PRIMARIES.white.y), [255, 255, 255]);
    assert.deepEqual(chromaticityDisplayRgb(SRGB_PRIMARIES.red.x, SRGB_PRIMARIES.red.y), [255, 0, 0]);
    assert.deepEqual(chromaticityDisplayRgb(SRGB_PRIMARIES.green.x, SRGB_PRIMARIES.green.y), [0, 255, 0]);
    assert.deepEqual(chromaticityDisplayRgb(SRGB_PRIMARIES.blue.x, SRGB_PRIMARIES.blue.y), [0, 0, 255]);
    assert.equal(chromaticityDisplayRgb(0.3, 0), null);
});

check('a spectral colour is filled with its own dominant wavelength, 450 to 620 nm', () => {
    const white = SRGB_PRIMARIES.white;
    for (const point of spectralLocusXy('2').filter(p => p.lam >= 450 && p.lam <= 620)) {
        const shown = shownChromaticity(chromaticityDisplayRgb(point.x, point.y));
        const dom = dominantWavelength(shown, white, '2').dom;
        close(dom, point.lam, 1.5, `${point.lam} nm shown as`);
    }
});

check('CIELAB and CIELUV solved back for XYZ return the XYZ they came from', () => {
    for (const XYZ of [
        { X: 30, Y: 25, Z: 60 }, { X: 0.4, Y: 0.5, Z: 0.3 }, { X: 90, Y: 95, Z: 100 }, { X: 5, Y: 0.6, Z: 12 },
    ]) {
        const back = labToXyz(lab(XYZ, D65), D65);
        const backLuv = luvToXyz(luv(XYZ, D65), D65);
        for (const k of ['X', 'Y', 'Z']) {
            close(back[k], XYZ[k], 1e-9 * Math.max(1, XYZ[k]), `Lab ${k}`);
            close(backLuv[k], XYZ[k], 1e-9 * Math.max(1, XYZ[k]), `Luv ${k}`);
        }
    }
});

check('every plane takes a chromaticity there and back', () => {
    const inside = [[0.3127, 0.329], [0.2, 0.1], [0.5, 0.4], [0.25, 0.6], [0.6, 0.3], [0.17, 0.02]];
    for (const id of DIAGRAM_IDS) {
        for (const lightness of [5, 50, 90]) {
            const plane = diagramPlane(id, { white: D65, lightness });
            for (const [x, y] of inside) {
                const back = plane.fromPlane(...plane.toPlane(x, y));
                close(back.x, x, 1e-9, `${id} L* ${lightness} x`);
                close(back.y, y, 1e-9, `${id} L* ${lightness} y`);
            }
        }
    }
});

check('a computed colour sits where its report says, and the white at the white', () => {
    const lambda = grid;
    const report = colorReport({ lambda, values: lambda.map(l => 0.2 + 0.6 * Math.exp(-(((l - 520) / 40) ** 2))) },
        { observer: '2', illuminant: 'D65' });
    const at = { xy: [report.xy.x, report.xy.y], uv: [report.uvP.up, report.uvP.vp],
        ab: [report.Lab.a, report.Lab.b], chAb: [report.Lab.a, report.Lab.b],
        chUv: [report.Luv.u, report.Luv.v] };
    for (const id of DIAGRAM_IDS) {
        // Drawn at the colour's own lightness, the plane puts its chromaticity
        // where the report puts the colour.
        const plane = diagramPlane(id, { white: report.white, lightness: report.Lab.L });
        const placed = plane.toPlane(report.xy.x, report.xy.y);
        assert.deepEqual(plane.ofReport(report), at[id]);
        close(placed[0], at[id][0], 1e-9, `${id} first`);
        close(placed[1], at[id][1], 1e-9, `${id} second`);
        if (['ab', 'chUv', 'chAb'].includes(id)) {
            close(plane.white[0], 0, 1e-12, `${id} white`);
            close(plane.white[1], 0, 1e-12, `${id} white`);
        }
    }
});

check('adapted from an illuminant\'s white, that white fills white and its primaries their own channel', () => {
    for (const { id } of ILLUMINANTS) {
        const white = whitePoint(grid, '2', id);
        const w = chromaticityXy(white);
        assert.deepEqual(chromaticityDisplayRgb(w.x, w.y, white), [255, 255, 255], `${id} white`);
        // The triangle drawn on a plane relative to that white bounds the
        // colours shown with no white added.
        const { red, green, blue } = srgbPrimariesUnder(white);
        assert.deepEqual(chromaticityDisplayRgb(red.x, red.y, white), [255, 0, 0], `${id} red`);
        assert.deepEqual(chromaticityDisplayRgb(green.x, green.y, white), [0, 255, 0], `${id} green`);
        assert.deepEqual(chromaticityDisplayRgb(blue.x, blue.y, white), [0, 0, 255], `${id} blue`);
        const corners = srgbTriangle(diagramPlane('xy', { white, lightness: 50 }));
        const relative = diagramPlane('ab', { white, lightness: 50 });
        assert.deepEqual(srgbTriangle(relative)[0], relative.toPlane(red.x, red.y), `${id}: a*, b* triangle at the adapted red`);
        assert.deepEqual(corners[0], [SRGB_PRIMARIES.red.x, SRGB_PRIMARIES.red.y], `${id}: x, y triangle at the red primary`);
    }
});

check('the outline, the Planckian locus and the sRGB triangle close where they should', () => {
    const plane = diagramPlane('xy', { white: D65, lightness: 50 });
    const outline = locusOutline(plane, '2');
    const locus = spectralLocusXy('2');
    assert.deepEqual(outline[0], [locus[0].x, locus[0].y]);
    assert.ok(outline.some(([x, y]) => x === locus.at(-1).x && y === locus.at(-1).y), 'reaches 780 nm');
    const triangle = srgbTriangle(plane);
    assert.deepEqual(triangle[0], triangle.at(-1));
    assert.ok(triangle.some(([x, y]) => x === 0.3 && y === 0.6), 'passes the green primary');
    const planck = planckianLocus(plane, '2', [1000, 2000, 4000, 8000, 16000, 100000]);
    assert.deepEqual(planck.map(p => p.T), [1000, 2000, 4000, 8000, 16000, 100000]);
    assert.ok(planck.every((p, i) => i === 0 || p.at[0] < planck[i - 1].at[0]), 'x falls as T rises');
});

// No surface can be more saturated than an optimal colour, R = 1 inside one
// band and 0 outside it or the reverse (Macleod §12.2), so these bound where a
// coating's point can fall on the CIELAB and CIELUV planes. The XYZ of a band
// is a sum of the XYZ of its samples, so every band on the 5 nm grid is checked
// from running sums.
function mostSaturatedOptimalColour(observer, illuminant) {
    const lambda = Array.from({ length: 81 }, (_, i) => 380 + 5 * i);
    const white = whitePoint(lambda, observer, illuminant);
    const sums = [{ X: 0, Y: 0, Z: 0 }];
    for (let k = 0; k < lambda.length; k++) {
        const one = tristimulus({ lambda, values: lambda.map((_, m) => (m === k ? 1 : 0)) }, observer, illuminant);
        const last = sums.at(-1);
        sums.push({ X: last.X + one.X, Y: last.Y + one.Y, Z: last.Z + one.Z });
    }
    const all = sums.at(-1);
    const chroma = XYZ => {
        const { a, b } = lab(XYZ, white);
        const { u, v } = luv(XYZ, white);
        return Math.max(Math.hypot(a, b), Math.hypot(u, v));
    };
    let most = 0;
    for (let i = 0; i < lambda.length; i++) {
        for (let j = i + 1; j <= lambda.length; j++) {
            const pass = { X: sums[j].X - sums[i].X, Y: sums[j].Y - sums[i].Y, Z: sums[j].Z - sums[i].Z };
            const stop = { X: all.X - pass.X, Y: all.Y - pass.Y, Z: all.Z - pass.Z };
            most = Math.max(most, chroma(pass), chroma(stop));
        }
    }
    return most;
}

check('every optimal colour lies within chroma 200 on a*, b* and u*, v*', () => {
    for (const { id: observer } of OBSERVERS) {
        for (const { id: illuminant } of ILLUMINANTS) {
            const most = mostSaturatedOptimalColour(observer, illuminant);
            assert.ok(most > 150 && most < 200, `${illuminant} ${observer}°: ${most.toFixed(1)}`);
        }
    }
});

check('the Planckian radiator at 2856 K is illuminant A, CIE 15:2004 Table T.3', () => {
    const c = chromaticityXy(planckianXyz(2856, '2'));
    close(c.x, 0.44757, 3e-4, 'x');
    close(c.y, 0.40745, 3e-4, 'y');
});

if (failures) {
    console.error(`\ncolor_diagram_planes: ${failures} check(s) failed`);
    process.exit(1);
}
console.log('\ncolor_diagram_planes: passed');
