/**
 * The Games window around the games: the stage, the level picker, and the
 * strings of the end screens.
 *
 * Run: node tests/games_window.mjs
 */

import en from '../src/constants/locales/en.js';
import { W, H, SEED, makeGame, stubCtx, textBoxes, overlaps } from './_gamesHarness.mjs';
import { startStage } from '../src/components/windows/information/games/stage.js';
import { PATTERNS } from '../src/components/windows/information/games/turningPointLevels.js';

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

console.log('games_window: stage, picker and panels\n');

// Frames and resize events must come from the canvas's own window, which for a
// torn-off window is not the one this module was loaded in. There is no global
// `window` here, so any use of it fails the test.
check('the stage is driven by the window its canvas is in', () => {
    const asked = { frames: 0, cancelled: false, listeners: 0, watching: 0 };
    let paneResized = null;
    const view = {
        devicePixelRatio: 2,
        requestAnimationFrame: () => { asked.frames++; return asked.frames; },
        cancelAnimationFrame: () => { asked.cancelled = true; },
        addEventListener: () => { asked.listeners++; },
        removeEventListener: () => { asked.listeners--; },
        ResizeObserver: class {
            constructor(fn) { paneResized = fn; }
            observe() { asked.watching++; }
            disconnect() { asked.watching--; }
        },
    };
    let painted = 0;
    let onScreen = W;
    const canvas = {
        ownerDocument: { defaultView: view },
        getContext: () => stubCtx(),
        getBoundingClientRect: () => ({ left: 0, top: 0, width: onScreen, height: onScreen * H / W }),
        addEventListener: () => {}, removeEventListener: () => {},
    };
    const stop = startStage({
        canvas,
        game: { update: () => {}, draw: () => { painted++; } },
        skin: { post: () => {} },
    });
    assert(painted === 1, `the stage painted ${painted} opening frames rather than one`);
    assert(asked.frames === 1, `the loop asked the canvas's own window for ${asked.frames} frames`);
    assert(canvas.width === W * 2, `the backing store is ${canvas.width} wide at a pixel ratio of 2`);

    // The backing store follows the on-screen size, up to the ceiling.
    onScreen = W * 1.5;
    paneResized();
    assert(canvas.width === W * 3, `a pane 1.5 stages wide at ratio 2 got a store ${canvas.width} wide`);
    onScreen = W * 5;
    paneResized();
    assert(canvas.width === W * 4, `a pane 5 stages wide got a store ${canvas.width} wide, past the ceiling`);

    stop();
    assert(asked.cancelled, 'stopping the stage left a frame request outstanding');
    assert(asked.listeners === 0, 'stopping the stage left a resize listener behind');
    assert(asked.watching === 0, 'stopping the stage left the pane being watched');
    return 'opening frame painted, loop and listeners on the canvas window, store follows the pane';
});

// A key held when the canvas loses focus is released, since its key-up goes
// elsewhere. Pointerdown is not cancelled, since that would also cancel the
// mousedown that closes open menus.
check('the stage lets go of held keys on blur and does not cancel a click', () => {
    const on = {};
    const view = {
        devicePixelRatio: 1,
        requestAnimationFrame: () => 1, cancelAnimationFrame: () => {},
        addEventListener: () => {}, removeEventListener: () => {},
        ResizeObserver: class { observe() {} disconnect() {} },
    };
    const canvas = {
        ownerDocument: { defaultView: view },
        getContext: () => stubCtx(),
        getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H }),
        focus: () => {}, setPointerCapture: () => {},
        addEventListener: (type, fn) => { on[type] = fn; },
        removeEventListener: (type) => { delete on[type]; },
    };
    const keys = [];
    const stop = startStage({
        canvas,
        game: { update: () => {}, draw: () => {}, onKey: (code, down) => keys.push(`${code}:${down}`), onPointer: () => {} },
        skin: { post: () => {} },
    });
    const key = { preventDefault: () => {}, repeat: false };
    on.keydown({ ...key, code: 'ArrowLeft' });
    on.keydown({ ...key, code: 'Space' });
    on.keyup({ ...key, code: 'Space' });
    on.blur();
    assert(keys.join() === 'ArrowLeft:true,Space:true,Space:false,ArrowLeft:false',
        `the game was told ${keys.join()}`);

    let cancelled = false;
    on.pointerdown({ preventDefault: () => { cancelled = true; }, pointerId: 1, clientX: 10, clientY: 10 });
    assert(!cancelled, 'a pointerdown on the canvas was cancelled');
    stop();
    assert(!on.blur && !on.pointerdown, 'stopping the stage left listeners on the canvas');
    return 'held key released on blur, click passed on';
});

// A picked level is where the game starts and where it restarts after a loss.
check('a picked level is where the game starts and where it restarts', () => {
    const breakout = makeGame('refractingBreakout', SEED, { level: 7 });
    assert(breakout.game.level() === 7, `breakout opened on level ${breakout.game.level()}`);

    const cutter = makeGame('turningPoint', SEED, { level: 12 });
    assert(cutter.game.level() === 12, `the cutter opened on run ${cutter.game.level()}`);

    const storm = makeGame('sputterStorm', SEED, { level: 9 });
    assert(storm.game.level() === 9, `sputter storm opened on level ${storm.game.level()}`);

    // With no input a layer is scrapped, which costs more than the whole budget.
    cutter.game.onKey('Space', true);
    let aborted = false;
    for (let i = 0; i < 1800 && !aborted; i++) {
        cutter.step();
        aborted = cutter.frame.overlays.includes(en.games.turningPoint.aborted);
    }
    assert(aborted, 'the cutter did not abort a run left with no input for 30 s');
    cutter.game.onKey('Space', true);
    assert(cutter.game.level() === 12, `play again went to run ${cutter.game.level()}`);
    return 'level 7, run 12 and level 9, all restarting where they were picked';
});

// No two strings above the trace may overlap.
check('nothing above the Turning Point trace is drawn over anything else', () => {
    const { game, frame, step } = makeGame('turningPoint');
    game.onKey('Space', true);
    let checked = 0;
    for (let i = 0; i < 600; i++) {
        step();
        const header = textBoxes(frame).filter(box => box.y + box.h <= 74);
        assert(header.length >= 4, `only ${header.length} strings above the trace`);
        for (let a = 0; a < header.length; a++) {
            for (let b = a + 1; b < header.length; b++) {
                assert(!overlaps(header[a], header[b]),
                    `"${header[a].str}" and "${header[b].str}" are drawn on top of each other`);
            }
        }
        checked = header.length;
    }
    return `${checked} strings, 600 frames, none overlapping`;
});

// The smoke run never finishes a level, so the end-screen strings are checked
// directly.
check('the strings a finished level needs are there', () => {
    const tp = en.games.turningPoint;
    const rb = en.games.refractingBreakout;
    const ss = en.games.sputterStorm;
    const values = [
        ['turningPoint.layerOf', tp.layerOf(2, 6)],
        ['turningPoint.runOf', tp.runOf(3, tp.patterns.mixed)],
        ['turningPoint.runCleared', tp.runCleared(3)],
        ['turningPoint.runsCleared', tp.runsCleared(3)],
        ['turningPoint.nextRun', tp.nextRun],
        ['turningPoint.pickLevel', tp.pickLevel],
        ['refractingBreakout.level', rb.level(3)],
        ['refractingBreakout.levelCleared', rb.levelCleared(3)],
        ['refractingBreakout.levelsCleared', rb.levelsCleared(3)],
        ['refractingBreakout.bestLevels', rb.bestLevels(3)],
        ['refractingBreakout.nextLevel', rb.nextLevel],
        ['refractingBreakout.pickLevel', rb.pickLevel],
        ['sputterStorm.chamberFull', ss.chamberFull],
        ['sputterStorm.levelCleared', ss.levelCleared(3)],
        ['sputterStorm.clearedIn', ss.clearedIn(12)],
        ['sputterStorm.bestTurns', ss.bestTurns(10)],
        ['sputterStorm.nextLevel', ss.nextLevel],
        ['sputterStorm.levelsCleared', ss.levelsCleared(3)],
        ['sputterStorm.bestLevels', ss.bestLevels(3)],
        ['sputterStorm.pickLevel', ss.pickLevel],
    ];
    for (const [name, value] of values) {
        assert(typeof value === 'string' && value.length > 0, `${name} is missing or empty`);
    }
    for (const pattern of PATTERNS) {
        assert(typeof tp.patterns[pattern] === 'string', `no name for the ${pattern} pattern`);
    }
    return `${values.length} strings and ${PATTERNS.length} pattern names`;
});

console.log('');
if (fails === 0) { console.log('PASS games_window'); process.exit(0); }
console.error(`${fails} failure(s).`);
process.exit(1);
