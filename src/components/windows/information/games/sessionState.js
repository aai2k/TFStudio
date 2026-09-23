import { createWindowSession } from '../../windowSession.js';

// The game showing and the last level picked in each. Not tied to a design.
export const gamesSession = createWindowSession({
    game: 'turningPoint',
    levels: {},
    // Incremented on every level pick, so picking the stored level again still
    // restarts the game.
    picks: 0,
});
