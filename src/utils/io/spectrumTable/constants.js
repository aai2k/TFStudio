// Shared enums for the spectrum-table parser/exporter (see spectrumTable.js).

export const X_UNITS = Object.freeze({
    NM: 'nm',
    UM: 'um',          // micrometers
    CM1: 'cm-1',       // wavenumber (IR instruments, e.g. PerkinElmer FT-IR)
    UNKNOWN: 'unknown',
});

export const QUANTITIES = Object.freeze(['T', 'R', 'A']);
