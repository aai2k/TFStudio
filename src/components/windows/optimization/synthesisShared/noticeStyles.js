// The optimizer windows' warning badge and the note under a setting, in the
// theme's colours. Words in the warning colour are too faint to read on a light
// theme, so the badge carries the theme's text on a tint of it.

/**
 * A message that stops a run, such as an empty merit function, drawn alike in
 * every optimizer window. Spread it and add the positioning at the call site.
 */
export function warnBadgeStyle(c) {
    return {
        fontSize: 11, padding: '2px 9px', borderRadius: 4,
        background: c.warning + '22', color: c.text, border: `1px solid ${c.warning}66`,
        fontWeight: 600, fontStyle: 'normal', whiteSpace: 'nowrap',
    };
}

/** A note under a setting, such as a floor that differs from the MNT row's. */
export function settingNoteStyle(c) {
    return { fontSize: 10, color: c.textDim, marginTop: -1, marginBottom: 4, lineHeight: 1.3 };
}
