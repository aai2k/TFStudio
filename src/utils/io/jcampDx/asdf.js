/**
 * ASDF (ASCII-Squeezed-Difference-Form) ordinate decoding for JCAMP-DX
 * XYDATA lines (JCAMP-DX §5): tokenizing a line's ordinate stream into
 * AFFN/PAC numbers and SQZ/DIF/DUP pseudo-digits, then decoding those tokens
 * into Y values.
 */

import { isDigit, readTrailingDigits, readAffnNumber, pseudoToken } from './pseudoDigit.js';

/**
 * Tokenize one ASDF ordinate stream (the part of a line AFTER the abscissa).
 * Returns [{ type:'abs'|'dif'|'dup', val:number }, …].
 */
export function tokenizeAsdf(s) {
    const tokens = [];
    let i = 0;
    const n = s.length;
    while (i < n) {
        const ch = s[i];
        if (ch === ' ' || ch === '\t' || ch === ',') { i++; continue; }
        // PAC / AFFN signed or bare number (absolute).
        if (ch === '+' || ch === '-' || isDigit(ch) || ch === '.') {
            const { str, end } = readAffnNumber(s, i);
            tokens.push({ type: 'abs', val: parseFloat(str) });
            i = end;
            continue;
        }
        // SQZ / DIF / DUP pseudo-digit.
        const { str: trailing, end } = readTrailingDigits(s, i + 1);
        const tok = pseudoToken(ch, trailing);
        if (tok) { tokens.push(tok); i = end; continue; }
        i++; // skip unknown char
    }
    return tokens;
}

/**
 * Decode a sequence of ASDF tokens (one line's ordinates) into Y values.
 * Carries prevY / lastDiff across lines via `state`.
 * Returns { ys, endedDif } where endedDif marks the line finished in DIF mode
 * (so the NEXT line's leading value is a check duplicate to drop).
 */
export function decodeAsdfTokens(tokens, state) {
    const ys = [];
    for (const t of tokens) {
        if (t.type === 'abs') {
            ys.push(t.val); state.prevY = t.val; state.lastWasDif = false; state.lastDiff = null;
        } else if (t.type === 'dif') {
            const y = state.prevY + t.val; ys.push(y);
            state.prevY = y; state.lastDiff = t.val; state.lastWasDif = true;
        } else if (t.type === 'dup') {
            const extra = t.val - 1;
            for (let k = 0; k < extra; k++) {
                if (state.lastWasDif && state.lastDiff != null) state.prevY = state.prevY + state.lastDiff;
                ys.push(state.prevY);
            }
        }
    }
    return { ys, endedDif: state.lastWasDif };
}
