/**
 * Dominant and complementary wavelength against the CIE table solved by hand.
 *
 * Macleod, Thin-Film Optical Filters 5th ed., §12.2, p. 462: the line from the
 * white point through the colour meets the spectrum locus at the dominant
 * wavelength; for a purple it meets the purple line instead, and the line
 * produced backward meets the locus at the complementary wavelength. Eq. (12.6)
 * gives the excitation purity as the fraction of the distance from the white
 * point to the locus, or for a purple to the purple line.
 *
 * The hand solve walks the CIE 15:2004 5 nm locus table, finds the interval
 * whose two ends lie on opposite sides of the line, and interpolates linearly
 * inside it. The Color window must land in the same interval at the same point:
 *   - the reflected and transmitted colour of two corpus designs, one of them a
 *     purple, in the window's shipped settings;
 *   - a set of xy colours on both observers, a purple among them.
 *
 * Run: node tests/color_dominant_wavelength.mjs
 */

import assert from 'node:assert/strict';
import { dominantWavelength, spectralLocusXy } from '../src/utils/physics/colorimetry.js';
import { computeColorReport } from '../src/components/windows/analysis/colorEvaluation/colorModel.js';
import { designEvalMode } from '../src/utils/report/reportData/engines.js';
import { sessionDefaults } from '../src/constants/analysisDefaults.js';
import { fixtureFile } from './_apiCorpus.mjs';

const api = await import('../src/api/index.js');

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

// The locus crossing of the line from `white` through `xy` on side `dir` (1 in
// front of the white point, -1 behind it), nearest the white point.
function handCrossing(xy, white, observer, dir) {
    const locus = spectralLocusXy(observer);
    const dx = xy.x - white.x, dy = xy.y - white.y;
    const side = point => (point.x - white.x) * dy - (point.y - white.y) * dx;
    let best = null;
    for (let i = 0; i + 1 < locus.length; i++) {
        const a = side(locus[i]), b = side(locus[i + 1]);
        if (a === b || a * b > 0) continue;
        const t = a / (a - b);
        const px = locus[i].x + t * (locus[i + 1].x - locus[i].x);
        const py = locus[i].y + t * (locus[i + 1].y - locus[i].y);
        if (dir * ((px - white.x) * dx + (py - white.y) * dy) <= 0) continue;
        const dist = Math.hypot(px - white.x, py - white.y);
        if (!best || dist < best.dist) {
            best = { lam: locus[i].lam + t * (locus[i + 1].lam - locus[i].lam), dist };
        }
    }
    return best;
}

function assertMatchesHand(got, xy, white, observer, what) {
    const forward = handCrossing(xy, white, observer, 1);
    if (forward) {
        assert.equal(got.comp, null, `${what}: no complementary wavelength`);
        assert.ok(Math.abs(got.dom - forward.lam) < 1e-6, `${what}: dominant ${got.dom} nm, hand ${forward.lam} nm`);
        const purity = Math.hypot(xy.x - white.x, xy.y - white.y) / forward.dist;
        assert.ok(Math.abs(got.purity - purity) < 1e-9, `${what}: purity ${got.purity}, hand ${purity}`);
        return 'dominant';
    }
    const backward = handCrossing(xy, white, observer, -1);
    assert.equal(got.dom, null, `${what}: no dominant wavelength`);
    assert.ok(got.comp != null && Math.abs(got.comp - backward.lam) < 1e-6,
        `${what}: complementary ${got.comp} nm, hand ${backward.lam} nm`);
    // A purple's excitation purity is measured to the purple line, the chord
    // joining the two ends of the locus (Macleod Eq. 12.6, p. 462).
    const locus = spectralLocusXy(observer);
    const a = locus[0], b = locus[locus.length - 1];
    const dx = xy.x - white.x, dy = xy.y - white.y, ex = b.x - a.x, ey = b.y - a.y;
    const reach = ((a.x - white.x) * ey - (a.y - white.y) * ex) / (dx * ey - dy * ex);
    assert.ok(Math.abs(got.purity - 1 / reach) < 1e-9, `${what}: purity ${got.purity}, hand ${1 / reach}`);
    return 'complementary';
}

check('the Color window matches the hand solve on corpus designs', () => {
    const shipped = sessionDefaults('colorEvaluation');
    const kinds = [];
    for (const name of ['builtin-bare-ids-qw-mirror', 'measured-curve-ppef']) {
        const design = api.openDesign(fixtureFile(name));
        for (const characteristic of ['R', 'T']) {
            const report = computeColorReport({
                ...shipped, design, evalMode: designEvalMode(design), characteristic,
                setError: (error) => { if (error) throw new Error(error); },
            });
            kinds.push(assertMatchesHand(report.dom, report.xy, report.whiteXy, shipped.observer,
                `${name} ${characteristic}`));
        }
    }
    assert.ok(kinds.includes('complementary'), 'one of the corpus colours is a purple');
});

check('xy colours on both observers match the hand solve', () => {
    const white = { x: 0.31272, y: 0.32903 };
    const colours = [
        { x: 0.36, y: 0.26 }, { x: 0.30, y: 0.20 }, { x: 0.40, y: 0.30 },
        { x: 0.25, y: 0.40 }, { x: 0.45, y: 0.45 }, { x: 0.20, y: 0.20 }, { x: 0.55, y: 0.35 },
    ];
    for (const observer of ['2', '10']) {
        for (const xy of colours) {
            assertMatchesHand(dominantWavelength(xy, white, observer), xy, white, observer,
                `${observer}° x ${xy.x} y ${xy.y}`);
        }
    }
});

check('the purple at x 0.36, y 0.26 is complementary to 510.8 nm', () => {
    const got = dominantWavelength({ x: 0.36, y: 0.26 }, { x: 0.31272, y: 0.32903 }, '2');
    assert.ok(got.dom == null && got.comp != null && Math.abs(got.comp - 510.8) < 0.05, `comp ${got.comp} nm`);
});

if (failures) {
    console.error(`\ncolor_dominant_wavelength: ${failures} check(s) failed`);
    process.exit(1);
}
console.log('\ncolor_dominant_wavelength: passed');
