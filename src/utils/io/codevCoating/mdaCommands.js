import { CodevParseError } from './parseError.js';
import { findLabel, numberOf, numbersOf } from './seqValues.js';
import { CODEV_LIMITS } from './serialize.js';

/** The stack as MDA builds it; thicknesses stay in the units they were entered in. */
export function newStack() {
    return {
        title: '', physical: false, wavelengths: [], ref: null, angles: null,
        incident: { n: 1, k: 0 }, substrate: null, layers: [],
        groups: new Map(), openGroup: null,
        micOpen: false, mwl: null, micEntries: new Map(),
    };
}

// INC, SUB and the index of a COA layer: a quoted MIC label, or n with an
// optional k where the command takes one.
function indexOf(tokens, line, withK) {
    const [first, second] = tokens;
    if (first?.quoted) return { label: first.text };
    return { n: numberOf(first, line), k: withK && second ? numberOf(second, line) : 0 };
}

// A layer goes onto the stack and, while a GRO is open, into that group too.
function addLayer(stack, layer) {
    stack.layers.push(layer);
    if (stack.openGroup !== null) stack.groups.get(stack.openGroup).push(layer);
}

function replayGroup(stack, label) {
    const key = findLabel(stack.groups, label);
    if (key === undefined) throw new CodevParseError('unknownGroup', { label });
    for (const layer of [...stack.groups.get(key)]) addLayer(stack, { ...layer });
}

// COA 'g' enters the layers of group g again; COA thickness code index enters one layer.
function coa(stack, args, line) {
    if (args.length === 1 && args[0].quoted) return replayGroup(stack, args[0].text);
    addLayer(stack, {
        thickness: numberOf(args[0], line),
        code: numberOf(args[1], line),
        index: indexOf(args.slice(2), line, true),
        line,
    });
}

// WL λ...: CODE V 11.2 reads the first 21 values of one WL command and
// ignores the rest ("Extra data ... ignored"), so they are left out here too.
function wl(stack, args, line, warnings) {
    const kept = args.slice(0, CODEV_LIMITS.valuesPerWl);
    if (args.length > kept.length) {
        warnings.push({ kind: 'extraValues', command: 'WL', line, count: args.length - kept.length, limit: kept.length });
    }
    stack.wavelengths.push(...numbersOf(kept, line));
}

// WLG min max step: equally spaced wavelengths, both ends included. Each is
// min + i·step, rounded to 12 digits, so no rounding error builds up along it.
// CODE V itself adds the step to a float32 in µm point after point; the .mul
// of its DWDM sample shows the drift, 1.1e-6 relative after 50 steps.
function wlg(stack, args, line) {
    const [min, max, step] = numbersOf(args.slice(0, 3), line);
    if (!(step > 0)) throw new CodevParseError('badNumber', { line, text: args[2]?.text ?? '' });
    const count = Math.floor((max - min) / step + 1e-9) + 1;
    for (let i = 0; i < count; i++) stack.wavelengths.push(Number((min + i * step).toPrecision(12)));
}

function pht(stack, args) {
    const answer = args[0]?.text.charAt(0).toUpperCase();
    if (answer === 'Y' || answer === 'N') stack.physical = answer === 'Y';
}

function gro(stack, args) {
    const label = args[0]?.text ?? '';
    stack.groups.set(label, []);
    stack.openGroup = label;
}

/**
 * The MDA commands that define the stack, from the MDA sub-option page of the
 * CODE V Multilayer Design Reference Manual. Each takes the stack, the tokens
 * after the command, the line number and the warnings list. END here closes a
 * GRO; inside MIC it closes the catalog (micCommands.js).
 */
export const MDA_COMMANDS = {
    PHT: pht,
    TIT: (stack, args) => { stack.title = args.map(token => token.text).join(' '); },
    WL: wl,
    WLG: wlg,
    REF: (stack, args, line) => { stack.ref = numberOf(args[0], line); },
    ANG: (stack, args, line) => { stack.angles = numbersOf(args, line); },
    INC: (stack, args, line) => { stack.incident = indexOf(args, line, false); },
    SUB: (stack, args, line) => { stack.substrate = indexOf(args, line, false); },
    COA: coa,
    GRO: gro,
    END: (stack) => { stack.openGroup = null; },
    MIC: (stack) => { stack.micOpen = true; stack.mwl = null; },
};
