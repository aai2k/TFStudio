/**
 * The colours of the Games window, taken from the app theme the way a Windows 95
 * appearance scheme recoloured the desktop: the dialog face, the title bar and
 * the page follow the theme, while the bevels, the font and the 16-colour game
 * palette keep their Windows 95 form.
 *
 * A light theme gives a grey face and a white page, as Windows Standard does. A
 * dark theme gives a dark face and page, and the games switch to the bright half
 * of the 16-colour palette, since the dark half does not read on a dark page.
 */

import { mix, parseHex } from '../../../../constants/colorPalettes.js';

const luminance = (hex) => {
    const c = parseHex(hex) || { r: 0, g: 0, b: 0 };
    return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
};

export const FONT_STACK = 'Tahoma, "MS Sans Serif", Arial, sans-serif';

/** Black or white, whichever reads on `fill`. */
export const readableOn = (fill) => (luminance(fill) > 140 ? '#000000' : '#ffffff');

/** Windows Standard, used when there is no app palette. */
const STANDARD = {
    light: true,
    face: '#c0c0c0', faceText: '#000000', faceDim: '#808080',
    hi: '#ffffff', lite: '#dfdfdf', shadow: '#808080', dark: '#000000',
    doc: '#ffffff', ink: '#000000',
    title: '#000080', titleText: '#ffffff',
};

/**
 * A Windows 95 appearance scheme for an app palette (see colorPalettes.js).
 *
 * face       dialog grey; mixed from the theme's page and text colours
 * hi, lite   the two light bevel edges; shadow, dark the two dark ones
 * doc, ink   the page the games are drawn on, and text on it
 * title      title bar; the theme accent
 */
export function win95Scheme(c) {
    if (!c) return STANDARD;
    const light = typeof c.light === 'boolean' ? c.light : luminance(c.bg) > 140;
    const face = light ? mix(c.bg, c.text, 0.22) : mix(c.panel, c.text, 0.16);
    const faceText = readableOn(face);
    const shadow = mix(face, '#000000', 0.34);
    return {
        light, face, faceText,
        faceDim: light ? shadow : mix(faceText, face, 0.45),
        hi: light ? '#ffffff' : mix(face, '#ffffff', 0.32),
        lite: mix(face, '#ffffff', light ? 0.55 : 0.16),
        shadow,
        dark: '#000000',
        doc: light ? c.panel : mix(c.bg, '#000000', 0.3),
        ink: light ? '#000000' : c.text,
        title: c.accent,
        titleText: readableOn(c.accent),
    };
}

/**
 * The same scheme for the DOM parts of the window. A bevel is four inset
 * shadows, two for the outer edge and two for the inner.
 */
export function win95Chrome(s) {
    return {
        face: s.face,
        doc: s.doc,
        ink: s.faceText,
        dim: s.faceDim,
        fontStack: FONT_STACK,
        raised: `inset -1px -1px ${s.dark}, inset 1px 1px ${s.hi}, inset -2px -2px ${s.shadow}, inset 2px 2px ${s.lite}`,
        pressed: `inset 1px 1px ${s.dark}, inset -1px -1px ${s.hi}, inset 2px 2px ${s.shadow}, inset -2px -2px ${s.lite}`,
        well: `inset 1px 1px ${s.shadow}, inset -1px -1px ${s.hi}, inset 2px 2px ${s.dark}, inset -2px -2px ${s.lite}`,
        groove: `inset 1px 1px ${s.shadow}, inset -1px -1px ${s.hi}`,
    };
}

// The 16-colour palette the games draw with: the dark half on a light page, the
// bright or middle entries on a dark one.
const DAY = { photon: '#000080', h: '#800000', l: '#000080', danger: '#ff0000', good: '#008000' };
const NIGHT = { photon: '#00ffff', h: '#808000', l: '#008080', danger: '#ff0000', good: '#00ff00' };

/** The colours a game names, for one scheme. */
export function gameColors(s) {
    return {
        ...(s.light ? DAY : NIGHT),
        bg: s.doc,
        panel: s.face,
        ink: s.ink,
        dim: s.light ? s.shadow : mix(s.ink, s.doc, 0.45),
        grid: s.light ? s.face : mix(s.doc, s.ink, 0.18),
        obstacle: s.light ? s.shadow : mix(s.doc, s.ink, 0.4),
        paddle: s.face,
    };
}
