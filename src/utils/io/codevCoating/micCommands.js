import { CodevParseError } from './parseError.js';
import { commandName } from './tokens.js';
import { findLabel, keptValues } from './seqValues.js';

/**
 * One command inside MIC ... END, the Multilayer Index Catalog. MWL sets the
 * wavelengths (nm) for the entries that follow it; 'label' n... adds an entry
 * with n at those wavelengths; EXT 'label' k... gives its extinction
 * coefficients, 0 when absent; END closes the catalog. Anything else is
 * reported as an unknown command. MWL, 'label' and EXT keep their first 21
 * values, as CODE V 11.2 does (keptValues).
 */
export function micCommand(stack, tokens, line, warnings) {
    const [head, ...args] = tokens;
    if (head.quoted) {
        stack.micEntries.set(head.text, { mwl: stack.mwl, n: keptValues(args, head.text, line, warnings), k: null, line });
        return;
    }
    const name = commandName(head);
    if (name === 'MWL') stack.mwl = keptValues(args, 'MWL', line, warnings);
    else if (name === 'EXT') setExtinction(stack, args, line, warnings);
    else if (name === 'END') stack.micOpen = false;
    else warnings.push({ kind: 'unknownCommand', command: head.text, line });
}

function setExtinction(stack, args, line, warnings) {
    const label = args[0]?.text ?? '';
    const key = findLabel(stack.micEntries, label);
    if (key === undefined) throw new CodevParseError('unknownMaterial', { label });
    Object.assign(stack.micEntries.get(key), { k: keptValues(args.slice(1), 'EXT', line, warnings), kLine: line });
}

/**
 * The catalog as [λ_nm, n, k] rows per label, in MWL order.
 * @throws {CodevParseError} micMismatch when an entry's n or k count differs from its MWL
 */
export function micTables(stack) {
    const tables = {};
    for (const [label, entry] of stack.micEntries) {
        const mwl = entry.mwl || [];
        if (!mwl.length || entry.n.length !== mwl.length) throw new CodevParseError('micMismatch', { label, line: entry.line });
        if (entry.k && entry.k.length !== mwl.length) throw new CodevParseError('micMismatch', { label, line: entry.kLine });
        tables[label] = mwl.map((lam, i) => [lam, entry.n[i], entry.k ? entry.k[i] : 0]);
    }
    return tables;
}
