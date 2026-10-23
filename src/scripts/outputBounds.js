/**
 * How much of what a Script Console script prints is kept: by the run's
 * thread in each batch it posts (scriptWorker.js, pythonWorker.js), and by the
 * window's output pane. Both keep the newest lines, since a long run prints
 * its progress first and its result last.
 *
 * A line is a string, or { text, cut } for a line longer than OUTPUT_CHARS:
 * its first OUTPUT_CHARS characters and how many more it had, which the window
 * says after the text.
 */

// The pane is one plain textarea, set and laid out whole for each batch, and
// batches come every quarter second while a script prints. Measured in Blink
// with the pane's style, 25,000 short lines take 0.24 s and 100,000 take 0.8 s,
// about 10 µs a line, so 5,000 lines take about 0.05 s, a fifth of the time
// between batches. Characters are bounded for long lines: 10,000 lines of 14
// characters (0.15 MB) took 90 ms in Electron 44, so 100,000 characters take
// about 60 ms. A batch carries no more than the pane keeps, which would drop
// the rest.
export const OUTPUT_LINES = 5000;
export const OUTPUT_CHARS = 100000;

/** How many characters a line holds. */
export const lineLength = line => (typeof line === 'string' ? line.length : line.text.length);

/** `text` as one line of output, cut to OUTPUT_CHARS characters. */
export function cutLine(text) {
    return text.length > OUTPUT_CHARS ? { text: text.slice(0, OUTPUT_CHARS), cut: text.length - OUTPUT_CHARS } : text;
}

/**
 * The newest of `lines` that fit in OUTPUT_LINES lines and OUTPUT_CHARS
 * characters, as { lines, left }, `left` being how many older lines that
 * leaves out. The newest line is kept whatever its length.
 */
export function keepNewest(lines) {
    let start = lines.length;
    let chars = 0;
    while (start > 0 && lines.length - start < OUTPUT_LINES) {
        chars += lineLength(lines[start - 1]);
        if (chars > OUTPUT_CHARS && start < lines.length) break;
        start -= 1;
    }
    return { lines: start ? lines.slice(start) : lines, left: start };
}

/**
 * The lines the script's thread holds for its next batch. `add(text)` holds
 * what one print call printed, a line per line of text, each cut (cutLine).
 * `take()` returns the batch, { lines, dropped }: the newest lines within the
 * bounds and how many older ones it leaves out, and starts the next one empty.
 * `size()` is how many lines are held now.
 *
 * What is held is trimmed to a batch's worth once it holds more than twice
 * that, so a loop printing faster than batches go out holds a bounded amount,
 * and pays a pass over the held lines once per batch's worth, not per line.
 */
export function createHeldOutput() {
    let lines = [];
    let chars = 0;
    let dropped = 0;
    const trim = () => {
        const kept = keepNewest(lines);
        lines = kept.lines;
        chars = lines.reduce((sum, line) => sum + lineLength(line), 0);
        dropped += kept.left;
    };
    function add(text) {
        for (const part of text.split('\n')) {
            const line = cutLine(part);
            lines.push(line);
            chars += lineLength(line);
        }
        if (lines.length > 2 * OUTPUT_LINES || chars > 2 * OUTPUT_CHARS) trim();
    }
    function take() {
        trim();
        const batch = { lines, dropped };
        lines = [];
        chars = 0;
        dropped = 0;
        return batch;
    }
    return { add, take, size: () => lines.length };
}

// The window redraws its output for each batch, so what a script prints goes
// out at most four times a second however fast it prints.
const OUTPUT_EVERY_MS = 250;

/**
 * What a run's thread prints, sent in batches. `print(text)` holds the lines
 * of one print (createHeldOutput), and `flush()` sends what is held at once,
 * as the thread does before the run's answer. `send({ lines, dropped })` gets
 * each batch that holds anything. A batch goes from inside print() itself once
 * the quarter second is up, so a script that never yields, a loop with no
 * await, still shows its output as it goes.
 */
export function createOutputBatches(send) {
    const held = createHeldOutput();
    let lastSent = 0;
    let timer = null;
    function flush() {
        clearTimeout(timer);
        timer = null;
        const batch = held.take();
        if (batch.lines.length || batch.dropped) send(batch);
        lastSent = Date.now();
    }
    function print(text) {
        held.add(text);
        const wait = OUTPUT_EVERY_MS - (Date.now() - lastSent);
        if (wait <= 0) flush();
        else timer ??= setTimeout(flush, wait);
    }
    return { print, flush };
}
