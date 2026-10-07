/** Format a number with at most `decimals` decimals, trailing zeros trimmed. */
export function fmtNum(x, decimals) {
    if (!Number.isFinite(x)) return '0';
    const s = x.toFixed(decimals).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
    return s === '-0' ? '0' : s;
}

/**
 * Write a command and its values, `perLine` values to a line. A line that
 * continues ends with `&`, the CODE V continuation mark.
 */
export function wrapValues(head, values, perLine = 8) {
    if (values.length <= perLine) return [`${head} ${values.join(' ')}`];
    const lines = [];
    for (let i = 0; i < values.length; i += perLine) {
        const chunk = values.slice(i, i + perLine).join(' ');
        const last = i + perLine >= values.length;
        lines.push(`${i === 0 ? head : ' '.repeat(head.length)} ${chunk}${last ? '' : ' &'}`);
    }
    return lines;
}

/** Quote a CODE V string: single quotes, none inside. */
export function quote(text) {
    return `'${String(text).replace(/'/g, '')}'`;
}
