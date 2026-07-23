import { getMaterialById } from '../../../../utils/materials/catalogManager.js';
import { getMaterial } from '../../../../utils/materials/materialDatabase.js';

export function resolveMat(id) {
    if (!id) return getMaterial('Air');
    return getMaterialById(id) || getMaterial(id) || getMaterial('Air');
}

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
};

export function isPct(meta) { return meta?.fmt === 'pct'; }
