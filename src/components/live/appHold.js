/**
 * The hold the live link puts on the app while it waits for a program or a
 * program works on the open design (LiveDialogs.js): whether it is on, for the
 * windows that cover themselves while it is, and the keyboard shut out of a
 * window.
 *
 * A held window takes keys only on the live link's own dialogs, the elements
 * that carry LIVE_DIALOG: a key pressed on one of them works its buttons and
 * goes no further, so no shortcut of the app or of a window behind acts on
 * it, and a key pressed anywhere else does nothing. Focus that leaves those
 * dialogs goes back to where it last was in them, or is dropped.
 */

const { useSyncExternalStore } = React;

/** The attribute that marks a live link dialog. */
export const LIVE_DIALOG = 'data-live-dialog';

const KEY_EVENTS = ['keydown', 'keypress', 'keyup'];
const inDialog = target => !!target?.closest?.(`[${LIVE_DIALOG}]`);

let held = false;
const listeners = new Set();
const subscribe = listener => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};

/** Turns the hold on or off. */
export function setAppHeld(on) {
    if (held === on) return;
    held = on;
    for (const listener of listeners) listener();
}

/** Whether the hold is on now, for code that runs outside a render. */
export function isAppHeld() {
    return held;
}

/** Whether the hold is on, rendered again when that changes. */
export function useAppHeld() {
    return useSyncExternalStore(subscribe, isAppHeld, isAppHeld);
}

/** Shuts the keyboard out of the window `win`, as above, until the function it returns is called. */
export function holdKeys(win) {
    let inside = null;
    const onKey = event => {
        event.stopPropagation();
        if (!inDialog(event.target)) event.preventDefault();
    };
    const onFocus = event => {
        if (inDialog(event.target)) inside = event.target;
        else if (inside?.isConnected) inside.focus();
        else event.target?.blur?.();
    };
    onFocus({ target: win.document.activeElement });
    for (const type of KEY_EVENTS) win.addEventListener(type, onKey, true);
    win.addEventListener('focusin', onFocus, true);
    return () => {
        for (const type of KEY_EVENTS) win.removeEventListener(type, onKey, true);
        win.removeEventListener('focusin', onFocus, true);
    };
}
