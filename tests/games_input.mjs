/**
 * Input around the games' message boxes: what dismisses a box, and that
 * nothing else reaches the game while one is up.
 *
 * Run: node tests/games_input.mjs
 */

import en from '../src/constants/locales/en.js';
import { W, makeGame } from './_gamesHarness.mjs';
import { START_IONS } from '../src/components/windows/information/games/sputterStorm.js';

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

console.log('games_input: message boxes and input\n');

// A Sputter Storm box is dismissed on press. Neither that press's release nor a
// release with no press on the box may fire the gun.
check('a Sputter Storm box is taken down by a press, and nothing fires with it', () => {
    const { game, frame, step } = makeGame('sputterStorm');
    const full = en.games.sputterStorm.ionCount(START_IONS);
    step();
    assert(frame.overlays.length === 1, 'the opening box is not up');
    game.onPointer('pointerup', 360, 200);
    step();
    assert(frame.overlays.length === 1, 'a release with no press on the box took it down');

    game.onPointer('pointerdown', 360, 200);
    game.onPointer('pointerup', 360, 200);
    for (let i = 0; i < 10; i++) step();
    assert(frame.overlays.length === 0, 'a click did not take the opening box down');
    assert(frame.texts.some(text => text.str === full), 'the click on the box also fired the gun');

    game.onPointer('pointerdown', 360, 200);
    game.onPointer('pointerup', 360, 200);
    step();
    assert(!frame.texts.some(text => text.str === full), 'a click with no box up did not fire');
    return 'box down on press, its release ignored, the next click fires';
});

// The opening box shows before the first serve only, not after a lost life.
check('the Breakout opening box shows once, not after a lost life', () => {
    const { game, frame, step } = makeGame('refractingBreakout');
    const lives = () => game.hud()[2][1];
    step();
    assert(frame.overlays.length === 1, 'the opening box is not up');
    game.onKey('Space', true);
    for (let i = 0; i < 20000 && lives() === 5; i++) {
        step();
        // Keep the paddle on the far side from the ball, so the ball is lost.
        const ball = frame.dots[frame.dots.length - 1];
        game.onPointer('pointermove', ball.x > W / 2 ? 0 : W, 0);
    }
    assert(lives() === 4, 'the ball was never lost');
    step();
    assert(frame.overlays.length === 0, 'the opening box came back after a lost life');
    return 'box once at the start, none after a lost life';
});

console.log('');
if (fails === 0) { console.log('PASS games_input'); process.exit(0); }
console.error(`${fails} failure(s).`);
process.exit(1);
