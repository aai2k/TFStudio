/**
 * Interior split positions per layer that automatic synthesis (Needle and
 * Gradual Evolution) scans for a needle: 16 evenly spaced fractions of the
 * layer. The Needle window's profile uses the same count by default.
 *
 * Inside a layer the needle function is built from the field there
 * (Tikhonravov, Trubetskov & DeBell, Appl. Opt. 35, 5493 (1996)), which
 * repeats every λ/(2n) of depth: about 105 nm in TiO2 at 500 nm. Four splits of
 * a 300 nm layer land 60 nm apart and can step over a minimum; sixteen land
 * 18 nm apart. The candidate queue keeps only the minima along each layer
 * (scanners/intraMinima.js), so the denser sampling does not fill it with near
 * copies of one insertion.
 */
export const SYNTHESIS_INTRA_SAMPLES = 16;
