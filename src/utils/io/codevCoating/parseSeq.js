import { CodevParseError } from './parseError.js';
import { commandName, splitCommands } from './tokens.js';
import { MDA_COMMANDS, newStack } from './mdaCommands.js';
import { micCommand } from './micCommands.js';
import { finishStack } from './stackFinish.js';

// Sub-options of MUL. Each ends data entry (MDA); MCH alters the stack, which
// this reader does not apply, so it is reported.
const SUB_OPTIONS = new Set(['MAN', 'MAU', 'MTO', 'MPL', 'MPR', 'MLI', 'MCH']);

// MUL commands that do not define the stack: the immediate commands, and the
// settings of plotting, optimization, tolerancing and file listing. They are
// passed over without a warning wherever they appear.
const NOT_STACK = new Set([
    'GO', 'SAV', 'SVE', 'RES', 'CSA', 'OUT',
    'TRN', 'RFL', 'AVE', 'SPL', 'PPL', 'ALL', 'RAN', 'SPA', 'STL',
    'RPT', 'RST', 'TRT', 'WTW', 'WTA', 'MNT', 'MXT', 'MNC', 'MXC', 'IMP',
    'DLT', 'DLN', 'DIR', 'DEL', 'COP', 'REN',
]);

function mdaCommand(stack, tokens, line, warnings) {
    if (stack.micOpen) return micCommand(stack, tokens, line, warnings);
    const name = commandName(tokens[0]);
    const handler = MDA_COMMANDS[name];
    if (handler) return handler(stack, tokens.slice(1), line, warnings);
    if (!NOT_STACK.has(name)) warnings.push({ kind: 'unknownCommand', command: tokens[0].text, line });
}

const MODE_AFTER = { MEX: 'outside', MDA: 'mda' };

// Where a command leaves the reader: outside MUL, in MUL between sub-options,
// in MDA, or in another sub-option. Returns null for a command that is data.
function nextMode(mode, name) {
    if (name === 'MUL') return 'mul';
    if (mode === 'outside') return 'outside';
    return MODE_AFTER[name] ?? (SUB_OPTIONS.has(name) ? 'other' : null);
}

/**
 * Read a CODE V MUL command file (.seq) into a CodevStack.
 *
 * Only the stack entered in MDA is read; commands outside MUL, and the
 * analysis, plot and optimization sub-options, are passed over. A second MDA
 * starts a new stack, as it does in CODE V.
 *
 * @param {string} text
 * @returns {object} CodevStack, see codevCoatingFile.js
 * @throws {CodevParseError}
 */
export function parseCodevSeq(text) {
    const warnings = [];
    let mode = 'outside';
    let stack = null;
    for (const { line, tokens } of splitCommands(text)) {
        const name = commandName(tokens[0]);
        const next = nextMode(mode, name);
        if (next === null) {
            if (mode === 'mda') mdaCommand(stack, tokens, line, warnings);
            continue;
        }
        if (next === 'mda') stack = newStack();
        if (name === 'MCH' && next === 'other') warnings.push({ kind: 'unknownCommand', command: tokens[0].text, line });
        mode = next;
    }
    if (!stack) throw new CodevParseError('noStack');
    return finishStack(stack, warnings);
}
