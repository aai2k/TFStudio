const isBlank = (c) => c === ' ' || c === '\t' || c === '\f' || c === '\v';
const BREAKS = "!;'\"";

// A quoted string from `start` (the opening quote) to the matching quote, or
// to the end of the line when it is never closed.
function quotedToken(line, start) {
    const end = line.indexOf(line[start], start + 1);
    const stop = end < 0 ? line.length : end;
    return { token: { text: line.slice(start + 1, stop), quoted: true }, next: stop + 1 };
}

function bareToken(line, start) {
    let end = start;
    while (end < line.length && !isBlank(line[end]) && !BREAKS.includes(line[end])) end++;
    return { token: { text: line.slice(start, end), quoted: false }, next: end };
}

// The tokens of one line up to its comment; a ";" is kept as null.
function lineTokens(line) {
    const tokens = [];
    let i = 0;
    while (i < line.length) {
        const c = line[i];
        if (c === '!') break;
        if (isBlank(c)) { i++; continue; }
        if (c === ';') { tokens.push(null); i++; continue; }
        const { token, next } = c === "'" || c === '"' ? quotedToken(line, i) : bareToken(line, i);
        tokens.push(token);
        i = next;
    }
    return tokens;
}

// Whether the line ends in "&", the mark that the command goes on; the mark is
// taken off the tokens.
function takeContinuation(tokens) {
    const last = tokens[tokens.length - 1];
    if (!last || last.quoted || !last.text.endsWith('&')) return false;
    last.text = last.text.slice(0, -1);
    if (!last.text) tokens.pop();
    return true;
}

function flush(commands, current) {
    if (current && current.tokens.length) commands.push(current);
    return null;
}

/**
 * Split CODE V command text into commands.
 *
 * The command line conventions of CODE V: blanks separate tokens, ";" separates
 * commands on one line, "&" at the end of a line continues the command on the
 * next, and "!" starts a comment that runs to the end of the line. A string is
 * enclosed in single quotes; double quotes are read the same way, as some
 * CODE V sample files write TIT with them and Essential Macleod's CODE V
 * export writes its SAV file name with them.
 *
 * @param {string} text
 * @returns {Array<{line:number, tokens:Array<{text:string, quoted:boolean}>}>}
 *   each command with the 1-based line it starts on
 */
export function splitCommands(text) {
    const commands = [];
    let current = null;
    String(text ?? '').split(/\r\n|\r|\n/).forEach((line, index) => {
        const tokens = lineTokens(line);
        const continues = takeContinuation(tokens);
        for (const token of tokens) {
            if (token === null) { current = flush(commands, current); continue; }
            if (!current) current = { line: index + 1, tokens: [] };
            current.tokens.push(token);
        }
        if (!continues) current = flush(commands, current);
    });
    flush(commands, current);
    return commands;
}

/**
 * The command a token names. CODE V commands are 1 to 3 letters and a longer
 * word is read by its first three ("Group" is GRO); case does not matter.
 */
export function commandName(token) {
    return token && !token.quoted ? token.text.slice(0, 3).toUpperCase() : '';
}
