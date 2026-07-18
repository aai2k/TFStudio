/**
 * ASDF pseudo-digit decoding (JCAMP-DX §5): the leading-character tables for
 * SQZ (squeezed absolute), DIF (difference), and DUP (duplicate count), and
 * the AFFN/PAC plain-number reader shared with the tokenizer.
 *
 * SQZ: @=+0 A..I=+1..+9  a..i=-1..-9
 * DIF: %=0  J..R=+1..+9  j..r=-1..-9
 * DUP: S..Z=1..8  s=9
 */

function sqzLead(ch) {
    if (ch >= '@' && ch <= 'I') return { sign: 1,  d: ch.charCodeAt(0) - 64 }; // '@'→0
    if (ch >= 'a' && ch <= 'i') return { sign: -1, d: ch.charCodeAt(0) - 96 }; // 'a'→1
    return null;
}
function difLead(ch) {
    if (ch === '%') return 0;
    if (ch >= 'J' && ch <= 'R') return ch.charCodeAt(0) - 73;     // 'J'→1
    if (ch >= 'j' && ch <= 'r') return -(ch.charCodeAt(0) - 105); // 'j'→-1
    return null;
}
function dupLead(ch) {
    if (ch >= 'S' && ch <= 'Z') return ch.charCodeAt(0) - 82;     // 'S'→1 … 'Z'→8
    if (ch === 's') return 9;
    return null;
}
export const isDigit = (ch) => ch >= '0' && ch <= '9';

// Consume a run of digits and decimal points starting at `start`.
export function readTrailingDigits(s, start) {
    let j = start, str = '';
    while (j < s.length && (isDigit(s[j]) || s[j] === '.')) { str += s[j]; j++; }
    return { str, end: j };
}

// Read a PAC / AFFN number (optional sign, digits, optional E-exponent).
export function readAffnNumber(s, start) {
    const n = s.length;
    let j = start, str = '';
    if (s[j] === '+' || s[j] === '-') { str += s[j]; j++; }
    const t = readTrailingDigits(s, j); str += t.str; j = t.end;
    if (j < n && (s[j] === 'E' || s[j] === 'e')) {
        str += 'E'; j++;
        if (j < n && (s[j] === '+' || s[j] === '-')) { str += s[j]; j++; }
        const e = readTrailingDigits(s, j); str += e.str; j = e.end;
    }
    return { str, end: j };
}

// Decode one SQZ / DIF / DUP pseudo-digit token given its leading char and the
// trailing digit run. Returns null when `ch` is not a pseudo-digit.
export function pseudoToken(ch, trailing) {
    const sq = sqzLead(ch);
    if (sq) return { type: 'abs', val: sq.sign * parseFloat(`${sq.d}${trailing}`) };
    const df = difLead(ch);
    if (df !== null) {
        const mag = parseFloat(`${Math.abs(df)}${trailing}`);
        return { type: 'dif', val: df < 0 ? -mag : mag };
    }
    const dp = dupLead(ch);
    if (dp !== null) return { type: 'dup', val: parseInt(`${dp}${trailing}`, 10) };
    return null;
}
