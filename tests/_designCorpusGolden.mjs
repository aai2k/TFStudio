/**
 * Test helper for design_file_corpus.mjs: comparing a run with the golden file.
 *
 * The spectrum, everything under a case's `spectrum`, compares to 1e-9
 * absolute; every other number to 1e-9 relative; text, flags and structure
 * exactly.
 */
const TOL = 1e-9;

function numberMoved(before, after, inSpectrum) {
    const gap = Math.abs(before - after);
    return gap > (inSpectrum ? TOL : TOL * Math.max(Math.abs(before), Math.abs(after)));
}

const isObject = v => v && typeof v === 'object' && !Array.isArray(v);

// Differences between two stored values, each as { at, before, after }.
function differences(before, after, at = '', inSpectrum = false) {
    const spectrum = inSpectrum || at.endsWith('.spectrum');
    if (typeof before === 'number' && typeof after === 'number') {
        return numberMoved(before, after, spectrum) ? [{ at, before, after }] : [];
    }
    if (Array.isArray(before) && Array.isArray(after) && before.length === after.length) {
        return before.flatMap((value, i) => differences(value, after[i], `${at}[${i}]`, spectrum));
    }
    if (isObject(before) && isObject(after)) {
        const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
        return keys.flatMap(key => differences(before[key], after[key], `${at}.${key}`, spectrum));
    }
    return JSON.stringify(before) === JSON.stringify(after) ? [] : [{ at, before, after }];
}

// A stored reload block reads 'same' when it matched the load.
function expanded(entry) {
    if (!entry || entry.reload !== 'same') return entry;
    const { design, materials, spectrum, merit } = entry;
    return { ...entry, reload: { design, materials, spectrum, merit } };
}

/**
 * Every value that moved between the golden file's cases and this run's, as
 * { key, at, before, after }, `key` naming the case ('fixture/variant'). A
 * case only one side has is one entry.
 */
export function movedValues(goldenCases, results) {
    const moved = [];
    for (const key of [...new Set([...Object.keys(goldenCases), ...Object.keys(results)])].sort()) {
        const before = goldenCases[key];
        const after = results[key];
        if (!before || !after) moved.push({ key, at: '', before: before ? 'a case' : 'absent', after: after ? 'a case' : 'absent' });
        else for (const diff of differences(expanded(before), expanded(after))) moved.push({ key, ...diff });
    }
    return moved;
}

/** A value for one line of the report. */
export function show(value) {
    const text = JSON.stringify(value);
    if (text === undefined) return 'absent';
    return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

/** The fixture a case key names. */
export const fixtureOf = key => key.slice(0, key.lastIndexOf('/'));
