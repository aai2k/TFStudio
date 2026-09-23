/**
 * The Games window's colours under every app theme: the Windows 95 scheme made
 * from each palette, and the real skin drawing every game in it.
 *
 * Run: node tests/games_theme.mjs
 */

import { colorPalettes, parseHex } from '../src/constants/colorPalettes.js';
import { win95Scheme, gameColors } from '../src/components/windows/information/games/win95Scheme.js';
import { createWin95Skin } from '../src/components/windows/information/games/win95Skin.js';
import { GAMES, makeGame, stubCtx } from './_gamesHarness.mjs';

let fails = 0;
function check(name, fn) {
    try {
        console.log(`  ok   ${name}  (${fn() || ''})`);
    } catch (e) {
        console.error(`  FAIL ${name}: ${e.message}`);
        fails++;
    }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

const lum = (hex) => {
    const c = parseHex(hex);
    assert(c, `"${hex}" is not a colour`);
    return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
};
const gap = (a, b) => Math.abs(lum(a) - lum(b));

console.log('games_theme: the Win95 scheme under every app theme\n');

// No palette is Windows Standard, colour for colour.
check('without an app palette the scheme is Windows Standard', () => {
    const s = win95Scheme();
    const want = { face: '#c0c0c0', hi: '#ffffff', shadow: '#808080', dark: '#000000', doc: '#ffffff', title: '#000080' };
    for (const [key, value] of Object.entries(want)) {
        assert(s[key] === value, `${key} is ${s[key]}, not ${value}`);
    }
    return 'grey face, white page, navy title bar';
});

// Every shipped theme has to give a scheme that still reads as Windows 95: bevel
// edges in light-to-dark order, so a raised block looks raised, and every text
// and game colour readable on what it is drawn on.
check('every theme gives a readable scheme with raised bevels', () => {
    let worst = Infinity;
    const need = (name, what, a, b, min) => {
        const d = gap(a, b);
        worst = Math.min(worst, d);
        assert(d >= min, `${name}: ${what} are only ${d.toFixed(0)} apart in luminance`);
    };
    for (const [name, palette] of Object.entries(colorPalettes)) {
        const s = win95Scheme(palette);
        assert(lum(s.hi) > lum(s.face) && lum(s.face) > lum(s.shadow) && lum(s.shadow) >= lum(s.dark),
            `${name}: the bevel edges are not in light-to-dark order`);
        need(name, 'text and the dialog face', s.faceText, s.face, 100);
        need(name, 'the title text and the title bar', s.titleText, s.title, 100);
        need(name, 'text and the page', s.ink, s.doc, 120);
        const skin = createWin95Skin(s);
        const colors = gameColors(s);
        for (const key of ['photon', 'h', 'l', 'good', 'danger']) {
            need(name, `the ${key} colour and the page`, colors[key], s.doc, 40);
            need(name, `the ${key} colour and text on it`, colors[key], skin.on(colors[key]), 90);
        }
    }
    return `${Object.keys(colorPalettes).length} themes, closest pair ${worst.toFixed(0)} apart`;
});

// A theme change recolours the skin a running game holds, instead of replacing
// it, so the game carries on.
check('changing the theme recolours the same skin', () => {
    const skin = createWin95Skin(win95Scheme(colorPalettes['Light']));
    const lightPage = skin.colors.bg;
    assert(!skin.dark, 'a light theme gave a dark skin');
    skin.use(win95Scheme(colorPalettes['Dark Gray']));
    assert(skin.dark, 'a dark theme gave a light skin');
    assert(skin.colors.bg !== lightPage, 'the page kept its light colour after a switch to a dark theme');
    return 'same skin, new colours';
});

// The real skin, not the recording one, drawing every game in a light and a
// dark scheme. The band pattern needs a document to build its tile in.
check('every game draws with the real skin in a light and a dark scheme', () => {
    globalThis.document = { createElement: () => ({ getContext: () => stubCtx() }) };
    for (const theme of ['Light', 'Monokai']) {
        const skin = createWin95Skin(win95Scheme(colorPalettes[theme]));
        for (const id of Object.keys(GAMES)) {
            const { game, step } = makeGame(id, 1, { skin });
            step();
            game.onKey('Space', true);
            game.onKey('Space', false);
            for (let i = 0; i < 120; i++) step();
        }
    }
    return `${Object.keys(GAMES).length} games in Light and Monokai`;
});

console.log('');
if (fails === 0) { console.log('PASS games_theme'); process.exit(0); }
console.error(`${fails} failure(s).`);
process.exit(1);
