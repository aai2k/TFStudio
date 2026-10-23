// One script run: the script's text called as the body of an async function
// of (tf, console, require), where tf is the object API (src/api/objects) on
// the API the caller has already started, and tf.design is the design the
// script starts on as a Design (null when none is open). It runs with the
// rights of the thread it runs on: Node's vm compiles it so its errors name
// its own lines, and is no sandbox.

import vm from 'node:vm';
import { inspect } from 'node:util';
import designFile from '../main/designFile.js';
import { TFStudio, Design } from '../api/objects/index.js';

const { validateDesign } = designFile;

// The script's own text starts on the line after this one, so its line 1 is
// line 1 of the file it was saved in. The script runs in strict mode, so
// assigning an attribute that cannot be set, such as tf.design.substrate,
// throws, as it does in Python, and so does assigning a variable the script
// never declared.
const HEAD = "async function (tf, console, require) {'use strict';\n";

// What tf.design holds when it is not a Design, in the words of the code.
function kindOf(value) {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'an array';
    return typeof value === 'object' ? 'an object that is not a Design' : `a ${typeof value}`;
}

// A design as JSON without its name, which applying a design leaves the open
// design's own (state/runDesignApply.js).
const unnamed = design => JSON.stringify({ ...design, name: undefined });

/** What a run started on, `design` or null, as changedDesign compares it. */
export const startedOn = design => (design ? unnamed(design) : null);

/**
 * What a run answers for `data`, the data of the Design a script left in
 * tf.design, given what it started on (startedOn): {} when it holds what it
 * started with but for its name, { design } when it changed (as JSON carries
 * it, and checked as File > Open checks a design), or { invalid } with the
 * reason, in English, when it is not a design. A Python run answers through
 * it too (pythonWorker.js).
 */
export function changedDesign(data, before) {
    if (unnamed(data) === before) return {};
    const changed = JSON.parse(JSON.stringify(data));
    const invalid = validateDesign(changed);
    return invalid ? { invalid } : { design: changed };
}

// What runScript answers for `left`, what tf.design holds at the end, given
// what the script started on (`before`, startedOn).
function answerFor(left, before) {
    if (!(left instanceof Design)) return left === null && before === null ? {} : { invalid: `tf.design is ${kindOf(left)}.` };
    return changedDesign(left._data, before);
}

/**
 * Runs `text` as the script named `fileName`, `info` being what starting the
 * API answered. Resolves to {} when tf.design holds what it started with, but
 * for its name, { design } when the script changed it or put another Design
 * there (as JSON carries it, and checked as File > Open checks a design), or
 * { invalid } with the reason, in English, when what tf.design holds then is
 * not a Design. Rejects with what the script threw.
 */
export async function runScript({ info, text, fileName, design, console, require }) {
    const tf = new TFStudio(info);
    tf.design = design ? new Design(design) : null;
    const before = startedOn(design);
    const script = new vm.Script(`(${HEAD}${text}\n})`, { filename: fileName, lineOffset: -1 });
    await script.runInThisContext()(tf, console, require);
    return answerFor(tf.design ?? null, before);
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

/**
 * The line of the script that `text`, as scriptErrorText gives it, names
 * first: the line a syntax error is on, or the innermost call in the script.
 * null when it names none, as for a value thrown that is not an Error.
 */
export function scriptErrorLine(text, fileName) {
    const name = fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const found = new RegExp(`(?:^|[\\s(])${name}:(\\d+)`, 'm').exec(text);
    return found ? Number(found[1]) : null;
}
