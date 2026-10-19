// How the merit tables show a value read at a default step where a row has a
// Step of its own (useMeritValues.js): faded, with ≈ before it, and `tip` after
// the value's own tooltip `title` until the value at the rows' own Steps comes.
export function provisionalMark(provisional, tip, title) {
    return provisional
        ? { prefix: '≈ ', title: [title, tip].filter(Boolean).join('\n'), opacity: 0.6 }
        : { prefix: '', title: title || undefined, opacity: undefined };
}
