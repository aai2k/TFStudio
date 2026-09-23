/**
 * The games, in picker order. An id is also the key of the game's strings in
 * `t.games` and of its stored session, so do not rename one.
 *
 * `ladder` marks a game with levels. Its value is the score key for the highest
 * level cleared, which decides which levels the picker offers.
 */

import { createTurningPoint } from './turningPoint.js';
import { createPhotonRunner } from './photonRunner.js';
import { createFlappyPhoton } from './flappyPhoton.js';
import { createRefractingBreakout } from './refractingBreakout.js';
import { createShutterPong } from './shutterPong.js';
import { createSputterStorm } from './sputterStorm.js';

export const GAMES = [
    { id: 'turningPoint', create: createTurningPoint, ladder: 'turningPoint' },
    { id: 'photonRunner', create: createPhotonRunner },
    { id: 'flappyPhoton', create: createFlappyPhoton },
    { id: 'refractingBreakout', create: createRefractingBreakout, ladder: 'breakout' },
    { id: 'sputterStorm', create: createSputterStorm, ladder: 'sputter' },
    { id: 'shutterPong', create: createShutterPong },
];

export function gameById(id) {
    return GAMES.find(entry => entry.id === id) || GAMES[0];
}
