/** Dedupe candidates by (mirrors, spacers), keep them sorted by MF ascending, and notify onProgress. */
export function makeRecorder(candidates, seen, onProgress) {
    return (c) => {
        const key = c.mirrors.join(',') + '|' + c.spacers.join(',');
        if (seen.has(key)) return;
        seen.add(key); candidates.push(c);
        candidates.sort((a, b) => a.mf - b.mf);
        if (onProgress) onProgress(candidates[0], candidates);
    };
}
