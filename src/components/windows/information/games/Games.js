/**
 * Six small games on one canvas, styled as a Windows 95 dialog in a scheme made
 * from the app theme (win95Scheme.js). Hidden from the ribbon and search until
 * the version number in About is clicked seven times (AboutDialog, appMenuItems).
 */

import { useWindowSession } from '../../windowSession.js';
import { GAMES, gameById } from './catalog.js';
import { gamesSession } from './sessionState.js';
import { loadScores, bestScore, fewestScore } from './scores.js';
import { startStage, W, H } from './stage.js';
import { win95Scheme, win95Chrome } from './win95Scheme.js';
import { createWin95Skin } from './win95Skin.js';

const { createElement: h, useRef, useEffect, useState, useMemo } = React;

// The readouts are polled instead of updated every frame: a React render per
// frame costs more than the game itself.
const HUD_INTERVAL_MS = 150;

const EMPTY_VIEW = { rows: [], level: 1, unlocked: 1 };

function buttonStyle(chrome, active, padding) {
    return {
        font: `12px ${chrome.fontStack}`,
        color: chrome.ink,
        background: chrome.face,
        border: 'none',
        borderRadius: 0,
        padding,
        cursor: 'pointer',
        boxShadow: active ? chrome.pressed : chrome.raised,
        outline: active ? `1px dotted ${chrome.ink}` : 'none',
        outlineOffset: '-5px',
    };
}

function GamePicker({ t, chrome, current, onPick }) {
    return h('div', {
        style: { display: 'flex', gap: '4px', flexWrap: 'wrap', flex: '0 0 auto' },
    }, GAMES.map(entry => h('button', {
        key: entry.id,
        type: 'button',
        'aria-pressed': entry.id === current,
        onClick: () => onPick(entry.id),
        style: buttonStyle(chrome, entry.id === current, '5px 12px'),
    }, t[entry.id].name)));
}

// One button per level reached, so any of them can be replayed.
function LevelPicker({ chrome, label, count, current, onPick }) {
    const levels = [];
    for (let n = 1; n <= count; n++) levels.push(n);
    return h('div', {
        style: { display: 'flex', alignItems: 'center', gap: '6px', flex: '0 0 auto' },
    },
        h('span', { style: { color: chrome.dim, fontSize: '11px' } }, label),
        h('div', {
            style: {
                display: 'flex', flexWrap: 'wrap', gap: '3px', padding: '3px',
                flex: '1 1 auto', maxHeight: '54px', overflowY: 'auto',
                boxShadow: chrome.well, background: chrome.face,
            },
        }, levels.map(n => h('button', {
            key: n,
            type: 'button',
            'aria-pressed': n === current,
            onClick: () => onPick(n),
            style: { ...buttonStyle(chrome, n === current, '2px 0'), minWidth: '24px' },
        }, n))),
    );
}

function Readouts({ chrome, rows }) {
    return h('div', {
        style: {
            display: 'flex', flexWrap: 'wrap', gap: '4px',
            fontSize: '11px', fontVariantNumeric: 'tabular-nums', flex: '0 0 auto',
        },
    }, rows.map(([label, value]) => h('span', {
        key: label,
        style: { padding: '3px 8px', boxShadow: chrome.groove },
    },
        h('span', { style: { color: chrome.dim, marginRight: '6px' } }, label),
        h('span', null, String(value)),
    )));
}

export function Games({ c, t }) {
    const g = t.games;
    const [session, setField, patch] = useWindowSession(gamesSession, null);
    const [view, setView] = useState(EMPTY_VIEW);
    const canvasRef = useRef(null);

    const scheme = useMemo(() => win95Scheme(c), [c]);
    const chrome = useMemo(() => win95Chrome(scheme), [scheme]);
    // One skin for the life of the window, recoloured in place when the theme
    // changes, so a game in progress is not restarted by it.
    const [skin] = useState(() => createWin95Skin(scheme));
    useEffect(() => { skin.use(scheme); }, [skin, scheme]);

    const entry = gameById(session.game);
    const startLevel = session.levels[entry.id] || 1;

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return undefined;
        loadScores();
        const game = entry.create({
            W, H, skin, t: g, seed: Date.now(), level: startLevel,
            best: bestScore, fewest: fewestScore,
        });
        const stop = startStage({ canvas, game, skin });

        let shown = '';
        const sample = () => {
            const next = {
                rows: game.hud(),
                level: game.level ? game.level() : 1,
                unlocked: entry.ladder ? bestScore(entry.ladder, 0) + 1 : 1,
            };
            const key = JSON.stringify(next);
            if (key !== shown) { shown = key; setView(next); }
        };
        sample();
        const poll = setInterval(sample, HUD_INTERVAL_MS);

        // Runs on tab switch as well as on close: only the active tab of a dock
        // group is mounted.
        return () => { clearInterval(poll); stop(); };
        // The stored level is where the game started, not where it is now, so
        // picking it again changes nothing else. `picks` restarts the game anyway.
    }, [entry, startLevel, session.picks, g, skin]);

    const game = g[session.game];

    return h('div', {
        style: {
            height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', gap: '8px',
            padding: '10px', background: chrome.face, color: chrome.ink,
            font: `12px ${chrome.fontStack}`,
        },
    },
        h(GamePicker, { t: g, chrome, current: session.game, onPick: id => setField('game', id) }),

        entry.ladder && h(LevelPicker, {
            chrome,
            label: game.pickLevel,
            // Always include the level in play.
            count: Math.max(view.unlocked, view.level),
            current: view.level,
            onPick: n => patch({
                levels: { ...session.levels, [entry.id]: n },
                picks: session.picks + 1,
            }),
        }),

        // The canvas is as large as fits in this box at the stage's aspect ratio.
        // Sized from the box in container units, because max-height on a canvas
        // with a set width squashes it instead of narrowing it.
        h('div', {
            style: {
                flex: '1 1 auto', minHeight: 0, display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                containerType: 'size',
            },
        },
            h('canvas', {
                ref: canvasRef,
                width: W,
                height: H,
                tabIndex: 0,
                'aria-label': game.name,
                style: {
                    display: 'block',
                    aspectRatio: `${W} / ${H}`,
                    width: `min(100cqw, 100cqh * ${W / H})`, height: 'auto',
                    userSelect: 'none',
                    background: chrome.doc,
                    boxShadow: chrome.well,
                    touchAction: 'none',
                    cursor: 'crosshair',
                },
            }),
        ),

        h(Readouts, { chrome, rows: view.rows }),
        h('div', { style: { flex: '0 0 auto', maxWidth: '80ch' } },
            h('div', null, g.caption(game.name, game.tagline)),
            h('div', { style: { marginTop: '3px', color: chrome.dim } },
                g.keysHint(game.controls)),
        ),
    );
}
