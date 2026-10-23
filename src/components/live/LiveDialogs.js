/**
 * The live link's dialogs (main/ipc/liveBridge.js says when the app listens
 * for programs and which are in).
 *
 * LiveHoldDialog holds the app from the click on Interactive until Terminate,
 * and while a program let in some other way is connected: it says whether a
 * program is connected and which, and Terminate lets the programs go and
 * gives the app back. The windows behind it go on drawing what a program
 * changes, but take no press and no key (appHold.js), torn-off windows too, so
 * meanwhile the user cannot edit, switch designs or start a run in them.
 *
 * LiveAskDialog asks whether a program may come in, while TFStudio listens
 * from its start (Preferences > Automation).
 */

import { BACKDROP, BTN_BASE, MODAL_BASE, TITLE_STYLE } from '../dialogs/InputDialog.js';
import { LIVE_DIALOG, holdKeys, setAppHeld } from './appHold.js';

const { createElement: h, Fragment, useEffect, useState } = React;

// Above every other dialog and the guided tour, so nothing behind the hold
// takes a press; a question comes above the hold.
const HOLD_Z = 10004;
const ASK_Z = 10005;

// Lighter than a dialog's backdrop, so the windows that follow a program's
// changes stay readable behind the hold.
const HOLD_BACKDROP = { ...BACKDROP, backgroundColor: 'rgba(0,0,0,0.2)', zIndex: HOLD_Z };
const ASK_BACKDROP = { ...BACKDROP, zIndex: ASK_Z };

const hintStyle = c => ({ margin: '0 0 16px 0', color: c.textDim, fontSize: 13, lineHeight: 1.5 });
const statusStyle = c => ({
    margin: '0 0 8px 0', color: c.text, fontSize: 13,
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
});
const BUTTONS = { display: 'flex', gap: 8, justifyContent: 'flex-end' };
const primary = c => ({ ...BTN_BASE, backgroundColor: c.accent, color: '#fff' });
const secondary = c => ({ ...BTN_BASE, backgroundColor: c.panel, color: c.text, border: `1px solid ${c.border}` });
const panel = c => ({ style: MODAL_BASE(c), role: 'dialog', 'aria-modal': true, [LIVE_DIALOG]: '' });

/**
 * `programs` the names of the programs in, null for one that gave none;
 * `onTerminate` lets them go.
 */
export function LiveHoldDialog({ c, t, programs, onTerminate }) {
    useEffect(() => {
        setAppHeld(true);
        const release = holdKeys(window);
        return () => {
            release();
            setAppHeld(false);
        };
    }, []);
    const status = programs.length
        ? t.live.connected(programs.map(program => program ?? t.live.unnamed).join(', '))
        : t.live.waiting;
    return h('div', { style: HOLD_BACKDROP },
        h('div', panel(c),
            h('h3', { style: TITLE_STYLE(c) }, t.live.title),
            h('p', { role: 'status', title: status, style: statusStyle(c) }, status),
            h('p', { style: hintStyle(c) }, t.live.holdHint),
            h('div', { style: BUTTONS },
                h('button', { onClick: onTerminate, autoFocus: true, style: primary(c) }, t.live.terminate))));
}

/** `ask` { id, program }, the program that asks to come in; `onAnswer(id, allowed)`. */
export function LiveAskDialog({ c, t, ask, onAnswer }) {
    return h('div', { style: ASK_BACKDROP },
        h('div', panel(c),
            h('h3', { style: { ...TITLE_STYLE(c), overflowWrap: 'anywhere' } }, t.live.asks(ask.program)),
            h('p', { style: hintStyle(c) }, t.live.askHint),
            h('div', { style: BUTTONS },
                h('button', { onClick: () => onAnswer(ask.id, false), autoFocus: true, style: secondary(c) }, t.live.deny),
                h('button', { onClick: () => onAnswer(ask.id, true), style: primary(c) }, t.live.allow))));
}

/**
 * The dialogs as the main process has the link: the hold while Interactive is
 * on or a program is in, and the first question not yet answered. Only the
 * desktop app has the link.
 */
export function LiveDialogs({ c, t }) {
    const [link, setLink] = useState({ interactive: false, programs: [] });
    const [asks, setAsks] = useState([]);
    useEffect(() => {
        const api = window.electronAPI;
        const offs = [api?.onLiveState?.(setLink), api?.onLiveAsk?.(ask => setAsks(asked => [...asked, ask]))];
        return () => { for (const off of offs) if (typeof off === 'function') off(); };
    }, []);
    const answer = (id, allowed) => {
        setAsks(asked => asked.filter(ask => ask.id !== id));
        window.electronAPI.answerLive(id, allowed);
    };
    return h(Fragment, null,
        (link.interactive || link.programs.length > 0) && h(LiveHoldDialog, {
            c, t, programs: link.programs, onTerminate: () => window.electronAPI.terminateLive(),
        }),
        asks.length > 0 && h(LiveAskDialog, { key: asks[0].id, c, t, ask: asks[0], onAnswer: answer }));
}

/**
 * Interactive: the app listens for programs and holds itself for them until
 * Terminate. `notify` (useNoticeStack) says why it could not start, or that
 * only the desktop app has it.
 */
export async function startInteractive(t, notify) {
    const api = window.electronAPI;
    if (!api?.startInteractive) {
        notify({ type: 'info', message: t.live.desktopOnly });
        return;
    }
    const status = await api.startInteractive();
    if (!status?.open) notify({ type: 'error', message: t.live.failed(status?.error ?? '') });
}
