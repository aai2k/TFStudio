/**
 * Spectrophotometer text-spectrum import/export — shared numeric-table core.
 *
 * This is the reusable backbone for every *text* instrument importer (generic
 * CSV/TXT, PerkinElmer ASCII, EssentOptics Photon RT .txt, Shimadzu UVProbe
 * .asc, …). The research catalog (docs/spectrophotometer-formats-research.md)
 * identified that all of these are "λ value [value …]" tables wrapped in some
 * header text, differing only in delimiter, header, units and axis direction —
 * so the parser is written ONCE here and the per-format wrappers (later steps)
 * just pre-strip their format-specific header before calling parseSpectrumTable.
 *
 * Everything in this file is pure (no DOM, no Node, no Electron) so it is unit-
 * testable directly and usable from a worker.
 *
 * Conventions (CLAUDE.md): X is resolved to NANOMETERS, Y is resolved to a
 * fraction (0..1) internally; the source's original unit / percent-ness is
 * remembered on the curve for display + round-trip export.
 *
 * Implementation lives in ./spectrumTable/ (number parsing, header heuristics,
 * unit conversions, the table parser, the measuredCurve model, and CSV export);
 * this file re-exports the public API from a single stable path.
 */

export { X_UNITS, QUANTITIES } from './spectrumTable/constants.js';
export { parseNumber, sniffDelimiter, detectDecimal } from './spectrumTable/numberParsing.js';
export {
    detectXUnit,
    guessXUnitFromRange,
    detectQuantity,
    detectIsPercent,
    isAbsorbanceHeader,
} from './spectrumTable/headerHeuristics.js';
export { xToNm, absorbanceToT } from './spectrumTable/conversions.js';
export { parseSpectrumTable } from './spectrumTable/tableParser.js';
export { makeMeasuredCurve } from './spectrumTable/measuredCurve.js';
export { curvesToCsv, tableToCsv } from './spectrumTable/csvExport.js';
