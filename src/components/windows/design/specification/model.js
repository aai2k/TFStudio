// ── Kind metadata: which fields are relevant for each qualifier kind ─────────
// Drives the row-editor — only show the fields that apply, hide the rest.

export const KIND_META = {
    T_AT:             { channelFixed: 'T', single: true,                                fmt: 'pct' },
    R_AT:             { channelFixed: 'R', single: true,                                fmt: 'pct' },
    A_AT:             { channelFixed: 'A', single: true,                                fmt: 'pct' },
    T_AVG:            { channelFixed: 'T',                                               fmt: 'pct' },
    R_AVG:            { channelFixed: 'R',                                               fmt: 'pct' },
    A_AVG:            { channelFixed: 'A',                                               fmt: 'pct' },
    MIN_MAX:          { channelPick: true, direction: true,                              fmt: 'pct' },
    INTEGRAL:         {                      integral: true,                              fmt: 'pct' },
    CENTRAL_LAMBDA:   { channelPick: true, direction: true,                              fmt: 'nm' },
    FWHM:             { channelPick: true, direction: true, level: true,                 fmt: 'nm' },
    EDGE_LAMBDA:      { channelPick: true,                  level: true, edgeSide: true, fmt: 'nm' },
    THICKNESS_BUDGET: { geomOnly: true,                                                  fmt: 'nm' },
    LAYER_COUNT:      { geomOnly: true,                                                  fmt: 'int' },
    // Read at the measured curve's own points, angle and polarization.
    PPEF:             { curve: true,                                                     fmt: 'dB' },
};

// Kinds that read the spectrum on a wavelength, angle and polarization of
// their own, as opposed to a layer count, a thickness or a measured curve.
export function hasOpticalConditions(meta) {
    return !meta.geomOnly && !meta.curve;
}

export function isPct(meta) { return meta?.fmt === 'pct'; }
