/**
 * User-facing text for what the CODE V reader and writer report. Both report a
 * kind and its values, never a sentence, so the text is chosen here from the
 * window's locale namespace `z` (t.codevCoatings).
 */

const PARSE_ERRORS = {
    noStack: (z) => z.errNoStack,
    unknownGroup: (z, d) => z.errUnknownGroup(d.label),
    unknownMaterial: (z, d) => z.errUnknownMaterial(d.label),
    badNumber: (z, d) => z.errBadNumber(d.line, d.text),
    notMul: (z) => z.errNotMul,
    missingCommand: (z, d) => z.errMissingCommand(d.command),
    micMismatch: (z, d) => z.errMicMismatch(d.label, d.line),
};

const EXPORT_ERRORS = {
    layers: (z, d) => z.errTooManyLayers(d.count, d.limit),
    wavelengths: (z, d) => (d.count === 0 ? z.errNoWavelengths : z.errTooManyWavelengths(d.count, d.limit)),
    angles: (z, d) => z.errTooManyAngles(d.count, d.limit),
    noIndex: (z, d) => z.errNoIndex(d.material),
};

// The commands an extraValues warning names by themselves; any other name is
// the label of a MIC entry, whose values sit on a line of their own.
const VALUE_COMMANDS = new Set(['WL', 'MWL', 'EXT']);

const WARNINGS = {
    unknownCommand: (z, w) => z.warnUnknownCommand(w.command, w.line),
    extraValues: (z, w) => (VALUE_COMMANDS.has(w.command)
        ? z.warnExtraValues(w.command, w.line, w.count, w.limit)
        : z.warnExtraMicValues(w.command, w.line, w.count, w.limit)),
    decimalComma: (z, w) => z.warnDecimalComma(w.line),
    refOutsideTable: (z, w) => z.warnRefOutsideTable(w.label),
    coupledLayers: (z, w) => z.warnCoupledLayers(w.count),
    resampled: (z, w) => z.warnResampled(w.material, w.from, w.to),
    mediumAbsorbs: (z, w) => (w.role === 'incident'
        ? z.warnIncidentAbsorbs(w.material) : z.warnSubstrateAbsorbs(w.material)),
};

/** Text for a CodevParseError. */
export function parseErrorText(z, err) {
    const text = PARSE_ERRORS[err.kind];
    return text ? text(z, err.detail || {}) : z.errParse(err.kind);
}

/** Text for a CodevExportError. */
export function exportErrorText(z, err) {
    const text = EXPORT_ERRORS[err.kind];
    return text ? text(z, err.detail || {}) : z.errExport(err.kind);
}

/** Text for one warning of the reader or the writer. */
export function warningText(z, warning) {
    const text = WARNINGS[warning.kind];
    return text ? text(z, warning) : z.warnOther(warning.kind);
}
