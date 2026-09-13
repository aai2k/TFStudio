/**
 * The source of the docking layer, for the assertions that pin behaviour with
 * no runtime handle: which host tearing off is gated on, what the drag preview
 * falls back to, which id a window is drawn as.
 *
 * The whole folder is read rather than one module, because those are properties
 * of the layer and not of the file they happen to be written in. Comments come
 * out first, so a pattern has to match code that runs: matching prose would let
 * a deleted behaviour keep its test green as long as something still described
 * it.
 *
 * Deliberately free of import-time side effects, so a test that does not build
 * a React tree can use it without pulling the UI shim in.
 */

import { readdirSync, readFileSync } from 'node:fs';

const DOCKING_DIR = new URL('../src/components/docking/', import.meta.url);

// Block comments, then line comments. A `//` is only taken as the start of a
// comment at the start of a line or after whitespace, so the `//` in a URL
// such as https://example survives.
function stripComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|\s)\/\/.*$/gm, '$1');
}

export function readDockingSource() {
    return readdirSync(DOCKING_DIR)
        .filter(name => name.endsWith('.js'))
        .map(name => stripComments(readFileSync(new URL(name, DOCKING_DIR), 'utf8')))
        .join('\n');
}
