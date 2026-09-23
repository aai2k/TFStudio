/**
 * Per-window state across a restart: from the preferences file to the
 * renderer's copy and back. The renderer's copy is what the next save writes,
 * so every block read must be a block written back.
 *
 * Run: node tests/tool_state_persistence.mjs
 */

let fails = 0;
async function check(name, fn) {
    try {
        const note = await fn();
        console.log(`  ok   ${name}  (${note || ''})`);
    } catch (e) {
        console.error(`  FAIL ${name}: ${e.message}`);
        fails++;
    }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

// A preferences file as it comes back off disk, with something stored for two
// different windows.
const ON_DISK = {
    version: 1,
    analysis: { spectrum: { colors: { line: '#ff0000' } } },
    quickAccess: ['optical-evaluation'],
    toolState: {
        games: { unlocked: true, best: { turningPoint: 6, breakout: 3, sputter: 11 } },
        'monitor-worksheet': { lastChip: 'B' },
    },
};

const saved = [];
globalThis.window = {
    electronAPI: {
        loadPreferences: async () => ({ success: true, prefs: ON_DISK }),
        saveToolState: async (block) => { saved.push(block); return { success: true }; },
    },
};

const { readPreferences } = await import('../src/utils/io/settingsFile.js');
const { setToolState, toolState, patchToolState } = await import('../src/utils/misc/toolState.js');

console.log('tool_state_persistence: records and flags across a restart\n');

await check('every block of the preferences file reaches the renderer', async () => {
    const prefs = await readPreferences();
    for (const name of ['analysis', 'quickAccess', 'toolState']) {
        assert(name in prefs, `the read dropped the ${name} block`);
    }
    assert(prefs.toolState.games?.unlocked === true, 'the unlock flag did not survive the read');
    assert(prefs.toolState.games?.best?.sputter === 11, 'the best scores did not survive the read');
    return '3 blocks, unlock flag and scores intact';
});

await check('a missing or unreadable file leaves every block empty rather than undefined', async () => {
    const real = globalThis.window.electronAPI.loadPreferences;
    globalThis.window.electronAPI.loadPreferences = async () => { throw new Error('no file'); };
    const prefs = await readPreferences();
    globalThis.window.electronAPI.loadPreferences = real;
    assert(prefs.toolState && Object.keys(prefs.toolState).length === 0,
        'a failed read should give an empty tool-state block, not a missing one');
    assert(prefs.quickAccess === null, 'a failed read should leave quickAccess unchosen');
    return 'empty blocks, no throw';
});

// The renderer's copy is what a save writes, so a store that starts from
// nothing wipes the file.
await check('storing one thing does not wipe what everything else had stored', async () => {
    const prefs = await readPreferences();
    setToolState(prefs.toolState);

    assert(toolState('games').unlocked === true, 'the unlock flag was not seeded into the copy');
    assert(toolState('games').best.turningPoint === 6, 'the best scores were not seeded into the copy');

    await patchToolState('games', { best: { turningPoint: 9, breakout: 3, sputter: 11 } });

    const written = saved[saved.length - 1];
    assert(written.games.best.turningPoint === 9, 'the new score was not written');
    assert(written.games.unlocked === true, 'writing a score dropped the unlock flag');
    assert(written['monitor-worksheet']?.lastChip === 'B', 'writing one window wiped another window');
    return 'score updated, unlock flag and the other window kept';
});

await check('what was written is what comes back on the next start', async () => {
    const written = saved[saved.length - 1];
    globalThis.window.electronAPI.loadPreferences =
        async () => ({ success: true, prefs: { ...ON_DISK, toolState: written } });

    const prefs = await readPreferences();
    setToolState(prefs.toolState);
    assert(toolState('games').unlocked === true, 'the games were locked again by a restart');
    assert(toolState('games').best.turningPoint === 9, 'the best score was lost by a restart');
    assert(toolState('games').best.sputter === 11, 'a score for another game was lost by a restart');
    return 'unlock flag and all three scores survive';
});

// A best held back for a moment is lost if the app is closed in that moment,
// so a new best goes to the file at once.
await check('a new best score is written as soon as it is set', async () => {
    const { bestScore, fewestScore } = await import('../src/components/windows/information/games/scores.js');
    const before = saved.length;
    bestScore('photonRunner', 4200);
    assert(saved.length === before + 1, 'a new best was not written at once');
    assert(saved[saved.length - 1].games.best.photonRunner === 4200, 'the write did not carry the new best');
    assert(saved[saved.length - 1].games.unlocked === true, 'writing a score dropped the unlock flag');

    fewestScore('sputter:1', 14);
    fewestScore('sputter:1', 12);
    assert(saved[saved.length - 1].games.best['sputter:1'] === 12, 'the fewest-turns record was not written');
    bestScore('photonRunner', 100);
    fewestScore('sputter:1', 20);
    assert(saved.length === before + 3, 'a score that is not a new best was written');
    return 'written at once, and only when it is a new best';
});

console.log('');
if (fails === 0) { console.log('PASS tool_state_persistence'); process.exit(0); }
console.error(`${fails} failure(s).`);
process.exit(1);
