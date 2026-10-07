import { CodevParseError } from './parseError.js';
import { findLabel, keptValues, numberOf, numbersOf } from './seqValues.js';

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

// WL λ...: the first 21 values of one WL command, as CODE V 11.2 reads it.
function wl(stack, args, line, warnings) {
    stack.wavelengths.push(...keptValues(args, 'WL', line, warnings));
}

// WLG min max step: equally spaced wavelengths, both ends included, built as
// CODE V builds them: min and step as float32 in µm, the step added point
// after point in float32. The .mul files CODE V saved from WLG store exactly
// that running sum, to the 10 digits written: the DWDM sample's (WLG 1547
// 1557 .2), whose last point sits 1.7e-3 nm above 1557 nm, and one CODE V
// 11.2 saved from WLG 400 800 10, whose last sits 3.5e-4 nm below 800 nm.
// With them the DWDM sample matches the R and T CODE V 11.2 prints on the
// steep edge of its passband to 8.8e-5; with min + i·step only to 2.1e-3.
function wlg(stack, args, line) {
    const [min, max, step] = numbersOf(args.slice(0, 3), line);
    if (!(step > 0)) throw new CodevParseError('badNumber', { line, text: args[2]?.text ?? '' });
    const count = Math.floor((max - min) / step + 1e-9) + 1;
    const stepUm = Math.fround(step / 1000);
    let um = Math.fround(min / 1000);
    for (let i = 0; i < count; i++) {
        stack.wavelengths.push(um * 1000);
        um = Math.fround(um + stepUm);
    }
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
