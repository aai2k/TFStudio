/**
 * The Edge Filter's settings from one opening to the next, kept in
 * localStorage as the other tool windows keep theirs (ui/usePersistentState.js).
 * Only REMEMBERED_INPUTS are kept; initialInputs decides which of them a
 * design can use.
 */

import { REMEMBERED_INPUTS } from './model.js';

const KEY = 'tfstudio_edgeFilter_inputs';

/** The settings of the last opening, or {} when there are none. */
export function readRememberedInputs(storage = globalThis.localStorage) {
    try {
        const kept = JSON.parse(storage?.getItem(KEY) ?? 'null');
        return kept && typeof kept === 'object' ? kept : {};
    } catch {
        return {};
    }
}

/** Keeps the remembered part of `inputs` for the next opening. */
export function rememberInputs(inputs, storage = globalThis.localStorage) {
    try {
        storage?.setItem(KEY, JSON.stringify(Object.fromEntries(REMEMBERED_INPUTS.map(key => [key, inputs[key]]))));
    } catch {
        // No storage: the next opening starts from the defaults.
    }
}
