// Shared enums for the spectrum-table parser/exporter (see spectrumTable.js).

export const X_UNITS = Object.freeze({
    NM: 'nm',
    UM: 'um',          // micrometers
    CM1: 'cm-1',       // wavenumber (IR instruments, e.g. PerkinElmer FT-IR)
    EV: 'eV',          // photon energy (ellipsometry software works in eV)
    UNKNOWN: 'unknown',
});

// Each unit's key in t.units and t.spectralAxis, which write its symbol and axis title.
export const X_UNIT_KEYS = Object.freeze({
    [X_UNITS.NM]: 'nm',
    [X_UNITS.UM]: 'um',
    [X_UNITS.CM1]: 'cm1',
    [X_UNITS.EV]: 'eV',
});

export const QUANTITIES = Object.freeze(['T', 'R', 'A', 'PSI', 'DEL']);
