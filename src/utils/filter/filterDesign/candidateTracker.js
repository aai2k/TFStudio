/**
 * Dedupe candidates by (mirrors, spacers), keep them sorted by MF ascending, and
 * notify onProgress with the restart the search has reached.
 */
export function makeRecorder(candidates, seen, onProgress) {
    let iteration = 0;
    return (c, advance = false) => {
        if (advance) iteration += 1;
        const key = c.mirrors.join(',') + '|' + c.spacers.join(',');
        if (!seen.has(key)) {
            seen.add(key); candidates.push(c);
            candidates.sort((a, b) => a.mf - b.mf);
        }
        if (onProgress) onProgress(candidates[0], candidates, iteration);
    };
}
