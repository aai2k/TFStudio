/**
 * Sputter Storm levels: the opening arrangement of each level and its random
 * stream. The stream is seeded by the level number, so a level is the same
 * every time it is played.
 *
 * A layout line is one grid row, one character per column:
 *
 *   #   a block
 *   +   a pickup, one more ion per burst for the rest of the level
 *   -   a cannon firing along its row
 *   |   a cannon firing along its column
 *   .   empty
 */

import { makeRng } from './rng.js';
import { COLS } from './sputterStormBoard.js';

export const OPENING_ROWS = 6;

// Rows a level sends after its opening, one per turn. One more per level.
const BASE_ROWS = 6;
export const rowsFor = (level) => BASE_ROWS + level;

export const KINDS = { '#': 'block', '+': 'plus', '-': 'rowCannon', '|': 'colCannon' };

const LAYOUTS = [
    [   // Twin towers.
        '......####..........####......',
        '......####..........####......',
        '..+...####..........####...+..',
        '......####..........####......',
        '......####..........####......',
        '......####..........####......',
    ],
    [   // Butterfly.
        '...######............######...',
        '....####..............####....',
        '.....##....+......+....##.....',
        '.....##................##.....',
        '....####..............####....',
        '...######............######...',
    ],
    [   // Staircase.
        '######........................',
        '..######......................',
        '....######....................',
        '......######..................',
        '........######......+.........',
        '..........######..............',
    ],
    [   // The vault, with a core inside two shells.
        '.....####################.....',
        '.....#..................#.....',
        '.....#....##########....#.....',
        '.....#....##########....#.....',
        '.....#..................#.....',
        '.....####################.....',
    ],
    [   // Comb: tunnels with a cap on each end.
        '##############################',
        '#..##..##..##..##..##..##..##.',
        '#..##..##..##..##..##..##..##.',
        '#..##..##..##..##..##..##..##.',
        '#..##..##..##..##..##..##..##.',
        '##############################',
    ],
    [   // Checkerboard.
        '#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.',
        '.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#',
        '#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.',
        '.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#',
        '#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.',
        '.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#',
    ],
    [   // A wedge, widest at the bottom.
        '............######............',
        '..........##########..........',
        '........##############........',
        '......##################......',
        '....######################....',
        '..##########################..',
    ],
    [   // Scattered clusters.
        '###..+..####...####..+..####..',
        '..####....###...###....####...',
        '#####...#####...#####...#####.',
        '.##..##..##..##..##..##..##..#',
        '####...####...####...####.....',
        '..##..+..##..+..##..+..##..##.',
    ],
    [   // Four rooms, with row cannons walled into them.
        '##########..######..##########',
        '#........#..#....#..#........#',
        '#..----..#..#.--.#..#..----..#',
        '#........#..#....#..#........#',
        '##########..######..##########',
        '......+..........+............',
    ],
    [   // Pillars, every other one a cannon firing down its own column.
        '##..##..##..##..##..##..##..##',
        '||..##..||..##..||..##..||..##',
        '##..##..##..##..##..##..##..##',
        '##..+...##..+...##..+...##..##',
        '##..##..##..##..##..##..##..##',
        '##..##..##..##..##..##..##..##',
    ],
];

export const LEVEL_COUNT = LAYOUTS.length;

export function layoutFor(level) {
    return LAYOUTS[(level - 1) % LAYOUTS.length];
}

/** Random stream for a level, the same on every play. */
export function levelRng(level) {
    return makeRng(Math.imul(level, 2246822519) ^ 0x85ebca6b);
}

/** The filled columns of a layout line and the kind of cell in each. */
export function readLine(line) {
    const filled = [];
    for (let col = 0; col < COLS; col++) {
        const kind = KINDS[line[col]];
        if (kind) filled.push({ col, kind });
    }
    return filled;
}
