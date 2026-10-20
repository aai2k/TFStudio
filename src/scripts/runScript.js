// One script run: the script's text called as the body of an async function
// of (tf, console, require), where tf is the headless API (src/api) without
// init, which the caller has already made, and tf.design is the design the
// script starts on (null when none is open). It runs with the rights of the
// thread it runs on: Node's vm compiles it so its errors name its own lines,
// and is no sandbox.

import vm from 'node:vm';
import { inspect } from 'node:util';
import designFile from '../main/designFile.js';

const { validateDesign } = designFile;

// The script's own text starts on the line after this one, so its line 1 is
// line 1 of the file it was saved in.
const HEAD = 'async function (tf, console, require) {\n';

// What tf.design holds when it is not an object, in the words of the code.
const kindOf = value => (value === null ? 'null' : Array.isArray(value) ? 'an array' : `a ${typeof value}`);

/**
 * Runs `text` as the script named `fileName`. Resolves to {} when tf.design
 * holds what it started with, { design } when the script replaced it or
 * changed it in place (as JSON carries it, and checked as File > Open checks a
 * design), or { invalid } with the reason, in English, when what tf.design
 * holds then is not a design. Rejects with what the script threw.
 */
export async function runScript({ api, text, fileName, design, console, require }) {
    const tf = { ...api, design: design ?? null };
    delete tf.init;
    const before = JSON.stringify(tf.design);
    const script = new vm.Script(`(${HEAD}${text}\n})`, { filename: fileName, lineOffset: -1 });
    await script.runInThisContext()(tf, console, require);
    const after = JSON.stringify(tf.design ?? null);
    if (after === before) return {};
    const changed = JSON.parse(after);
    // validateDesign's reason for a value that is no object at all speaks of a
    // file, which a script has not read.
    if (!changed || typeof changed !== 'object' || Array.isArray(changed)) return { invalid: `tf.design is ${kindOf(changed)}.` };
    const invalid = validateDesign(changed);
    return invalid ? { invalid } : { design: changed };
}

// Whether a stack line is a call frame, and whether that frame is in the
// script: the script's frames name its file alone, the app's a full path.
const isFrame = line => /^\s+at /.test(line);
const inScript = (line, fileName) => line.includes(` ${fileName}:`) || line.includes(`(${fileName}:`);

/**
 * What the script threw, as the output shows it: the message, or for a syntax
 * error the line and the place in it, with only the calls inside the script.
 */
export function scriptErrorText(error, fileName) {
    if (!(error instanceof Error)) return inspect(error);
    return String(error.stack || error).split('\n')
        .filter(line => !isFrame(line) || inScript(line, fileName))
        .join('\n');
}
