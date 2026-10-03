/**
 * Process-file export for in-chamber spectrophotometric monitoring.
 *
 * For an N-layer active coating, one .res file is written per deposition
 * step (01.res, 02.res, ...). Each file is the spectrum the spectrophotometer
 * would see at that intermediate state: layers 1..k deposited at full thickness,
 * layers k+1..N still at zero. The non-active surface of the substrate is fixed
 * (either bare or fully coated) for the entire sequence.
 *
 * The same spectra can be written as CSV or text tables instead, one file per
 * step or one table with a column per step; see DEFAULT_OUTPUT.
 *
 * Layer-numbering convention (chamber deposition order):
 *   Layer 1 = first deposited = layer touching substrate.
 *   Layer N = last deposited  = outermost layer.
 *
 * TFStudio array convention:
 *   frontLayers: [topmost, ..., layer touching substrate]   (last = substrate-side)
 *   backLayers:  [layer touching substrate, ..., outermost] (first = substrate-side)
 *
 * Mapping (active = front):
 *   deposition index i (1..N) → frontLayers[N - i]
 * Mapping (active = back):
 *   deposition index i (1..N) → backLayers[i - 1]
 *
 * A .res file is plain ASCII with CRLF line endings (matches reference files
 * produced for Windows 8.18n).
 */

import { runSteps, stepSpectrum } from './processRunSteps.js';
import { spectrumConditionLines, tableToCsv } from './spectrumTable/csvExport.js';

/**
 * What a save writes.
 *
 *   format       'res' | 'csv' | 'txt'. A .res file has one fixed layout and
 *                takes none of the options below. A text file is a CSV file
 *                under a .txt name.
 *   files        'step': one file per deposition step, like .res.
 *                'table': one file with a column per step; one per chip on a
 *                witness-chip run.
 *   header       'layers': the .res header with its layer table.
 *                'conditions': design, step, angle, side and polarization, the
 *                shape the spectrum importer reads them back from.
 *                'none': numbers only, without column names.
 *   delimiter    ',' | ';' | '\t' | ' '
 *   scale        'percent' | 'fraction'
 *   decimals     decimals of every value; wavelengths are written exactly
 *   decimalMark  '.' | ','
 */
export const DEFAULT_OUTPUT = Object.freeze({
    format: 'res', files: 'step', header: 'layers',
    delimiter: ',', scale: 'percent', decimals: 5, decimalMark: '.',
});

// ── Formatting helpers ────────────────────────────────────────────────────────

function pad(s, width) {
    s = String(s);
    return s.length >= width ? s : ' '.repeat(width - s.length) + s;
}

function fmtFixed(num, width, decimals) {
    return pad(num.toFixed(decimals), width);
}

/**
 * Strip any character outside printable ASCII (0x20..0x7E) — the monitoring
 * software reads .res files as Windows ANSI / CP1251; non-ASCII Cyrillic
 * text in design names would otherwise emit UTF-8 multi-byte sequences that
 * the parser doesn't understand. Replace such chars with '?'.
 */
function asciiSafe(s) {
    if (s == null) return '';
    let out = '';
    for (const ch of String(s)) {
        const c = ch.charCodeAt(0);
        out += (c >= 0x20 && c <= 0x7E) ? ch : '?';
    }
    return out;
}

function pad2(n) { return n < 10 ? '0' + n : String(n); }

function timestampString(d = new Date()) {
    // dd.mm.yyyy h:mm:ss  — .res style (no leading zero on hour)
    return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()} `
         + `${d.getHours()}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

// Short material label without catalog prefix (e.g. 'builtin:ZrO2' → 'ZrO2').
function shortMatLabel(id) {
    if (!id) return '';
    const i = id.indexOf(':');
    return asciiSafe(i >= 0 ? id.slice(i + 1) : id);
}

// ── H/L abbreviation ──────────────────────────────────────────────────────────
// The .res layer table tags each layer 'H' (high) or 'L' (low) for compactness in the
// layer table. Threshold n > 1.7 at the control wavelength catches the usual
// pairs (TiO2/SiO2, ZrO2/SiO2, Ta2O5/SiO2, …) without needing to inspect the
// full design.

function abbrFor(n_at_control) {
    return (n_at_control > 1.7) ? 'H' : 'L';
}

// ── Spectrum tag ──────────────────────────────────────────────────────────────
// Column header in the data section: "Ta", "Ra", "Aa".

function tagForQuantity(q) {
    if (q === 'R') return 'Ra';
    if (q === 'A') return 'Aa';
    return 'Ta';
}

function seriesOf(spec, q) {
    if (q === 'R') return spec.R;
    if (q === 'A') return spec.A;
    return spec.T;
}

// ── Build one .res file content for a given partial-deposition state ──────────
//
// allLayers              — full design layer array in DEPOSITION ORDER
//                          (index 0 = first deposited = substrate-side)
// stepK                  — how many layers have been deposited (1..N).
//                          Layers 1..k are at full thickness; k+1..N at 0.
// quantity               — 'R' | 'T' | 'A' (which column to write)
// theta_deg, polarization
// spectralParams         — { lambdaStart, lambdaEnd, lambdaStep }
// substrate              — { material, thickness }   resolved material objects
// incidentMat / exitMat  — material objects
// otherSideLayers        — back/front layers (in DEPOSITION ORDER FOR THAT SIDE)
//                          at full thickness, or [] if bare.
//                          NOTE: this array is converted to TFStudio storage
//                          order INSIDE the spectrum call.
// activeSide             — 'front' | 'back'
// controlLambda          — control wavelength in nm
// designName             — string

function buildLayerTable(allLayers, stepK, controlLambda) {
    const N = allLayers.length;
    const rows = [];
    rows.push('   #  Physical th. Optical th.    FWOT         QWOT   Abbr State Material');
    for (let i = 0; i < N; i++) {
        const deposited = (i + 1) <= stepK;
        const mat       = allLayers[i].matObj;
        const matName   = shortMatLabel(allLayers[i].materialId);
        const n         = mat.getNK(controlLambda)[0];
        const d         = deposited ? allLayers[i].thickness : 0;
        const opt       = n * d;
        const fwot      = controlLambda > 0 ? opt / controlLambda : 0;
        const qwot      = 4 * fwot;

        rows.push(
            pad(i + 1, 4) +
            fmtFixed(d,    11, 3) +
            fmtFixed(opt,  12, 3) +
            fmtFixed(fwot, 13, 6) +
            fmtFixed(qwot, 13, 6) +
            pad(abbrFor(n), 4) +
            pad('A', 5) +
            '   ' + matName
        );
    }
    return rows.join('\r\n');
}

/**
 * @param {object} cfg
 *   cfg.designName     — string
 *   cfg.controlLambda  — nm
 *   cfg.aoi            — degrees
 *   cfg.polarization   — 'avg' | 's' | 'p'
 *   cfg.quantity       — 'R' | 'T' | 'A'
 *   cfg.lambdaStart, cfg.lambdaEnd, cfg.lambdaStep — nm
 *   cfg.allLayers      — [{ materialId, thickness, matObj }, ...] in DEPOSITION ORDER
 *                        (index 0 = substrate-side = first deposited)
 *   cfg.stepK          — 1..N
 *   cfg.substrateMat   — material object
 *   cfg.substrateThk   — mm
 *   cfg.incidentMat    — material object
 *   cfg.exitMat        — material object
 *   cfg.otherSideLayers — [{ materialId, thickness, matObj }, ...] for the OPPOSITE
 *                        coating, in DEPOSITION ORDER from substrate outward.
 *                        Pass [] for a bare opposite surface.
 *   cfg.activeSide     — 'front' | 'back'
 *   cfg.outputDir      — string, the actual destination folder. Embedded in
 *                        the header so the .res file self-documents where it
 *                        was written. Pass '' if unknown.
 *   cfg.appVersion     — string, TFStudio version stamped in the header.
 *   cfg.projectLabel   — string, optional project / design label for the
 *                        4th header line (defaults to the design name).
 *   cfg.comment        the design comment line of the header; 'No comment'
 *                        when absent. A witness-chip file names the design
 *                        layer it belongs to here.
 *   cfg.spectrum       the step's spectrum when the run was evaluated in one
 *                        pass, in the shape evaluateSpectrumTotal returns;
 *                        evaluated here from the layer state otherwise.
 * @returns {string} .res file content with CRLF line endings (ASCII-safe).
 */
export function buildResFileContent(cfg) {
    const { quantity } = cfg;

    // Use spec.lambda as the authoritative wavelength array — building a
    // parallel local grid risks a length mismatch (multiplication vs the
    // engine's float-accumulation loop) that puts undefined in the last row.
    const spec = cfg.spectrum || stepSpectrum(cfg);
    const lambdas = spec.lambda;
    const series = seriesOf(spec, quantity);

    const lines = resHeaderLines(cfg, lambdas.length);
    lines.push(` Wavelength      ${tagForQuantity(quantity)}    `);
    for (let i = 0; i < lambdas.length; i++) {
        const val_pct = series[i] * 100;
        lines.push(`${fmtFixed(lambdas[i], 10, 4)}    ${val_pct.toFixed(5)}`);
    }

    return lines.join('\r\n') + '\r\n';
}

// The .res header, from the report block down to the page line above the
// column names: report, design, layer table and target-file blocks. A CSV or
// text table under the layer-table header carries the same lines.
function resHeaderLines(cfg, nPoints) {
    const {
        designName, controlLambda, aoi, lambdaStart, lambdaEnd,
        allLayers, stepK,
        outputDir = '',
        appVersion = '',
        projectLabel = '',
    } = cfg;

    const N = allLayers.length;
    const lines = [];

    // Header — line count matches the original .res 5-line block so
    // parsers that use fixed line offsets still locate the layer table and
    // spectrum at the expected positions.
    const verStr = appVersion ? `, version: ${asciiSafe(appVersion)}` : '';
    const dirStr = outputDir
        ? asciiSafe(outputDir).replace(/[\\/]+$/, '') + '\\'
        : '';
    const projStr = asciiSafe(projectLabel || designName || '');
    lines.push(`TFStudio Process Deposition Report${verStr}`);
    lines.push(timestampString());
    lines.push(`Output directory:  ${dirStr}`);
    lines.push(`Project:           ${projStr}`);
    lines.push('**********************************************************');
    lines.push('');
    lines.push(`Design: ${asciiSafe(designName)}`);
    lines.push(`Comment: ${asciiSafe(cfg.comment || 'No comment')}`);
    lines.push(`The number of layers = ${N}`);
    lines.push(`Control wavelength   = ${controlLambda} nm`);
    lines.push('Match angle          = 0 deg');
    lines.push('Match medium         = 1.000000    ');
    lines.push('');
    lines.push(buildLayerTable(allLayers, stepK, controlLambda));
    lines.push('');
    lines.push(`Target file: ${Math.round(lambdaStart)}-${Math.round(lambdaEnd)} `);
    lines.push('Comment: No comment');
    lines.push('');
    lines.push(`Spectral characteristics: ${nPoints} points`);
    lines.push('');
    lines.push(`Page # 1,  Angle of incidence = ${aoi.toFixed(2).padStart(5)}`);
    return lines;
}

// ── Public driver: build all step files for one save action ───────────────────
//
// design        — TFStudio design object (id, name, frontLayers, backLayers,
//                 substrate, incidentMedium, exitMedium, referenceWavelength)
// opts:
//   activeSide    'front' | 'back'
//   secondSurface 'bare' | 'coated'
//   quantity      'R' | 'T' | 'A'
//   aoi           degrees
//   polarization  'avg' | 's' | 'p'
//   lambdaStart, lambdaEnd, lambdaStep    nm
//   chips         { chipByStep, chipMaterial, witnessRatio } for a run read on
//                 witness chips, null for the part
//   output        what the files are, merged over DEFAULT_OUTPUT; .res when
//                 absent
//
// Returns [{ filename, content }]: one entry per file, with a `subdir` per
// chip on a witness-chip run written one file per step.

export function buildAllProcessFiles(design, opts) {
    return Array.from(processFileSteps(design, opts), step => step.file).filter(Boolean);
}

/**
 * The files of one save, produced step by step in run order as
 * `{ file, index, total }` so a caller can write them, or hand the window a
 * turn, between steps. One table per run carries its file on the run's last
 * step and `file: null` on the steps before it.
 *
 * The spectra are those of runSteps: a front-side run and a witness chip are
 * evaluated in one pass before the first file, a back-side run step by step
 * as its files are built.
 */
export function* processFileSteps(design, opts) {
    const output = { ...DEFAULT_OUTPUT, ...(opts.output || {}) };
    if (output.format === 'res') {
        for (const { cfg, run, index, total } of runSteps(design, opts)) {
            yield { file: placed(run, `${padK(cfg.stepK)}.res`, buildResFileContent(cfg)), index, total };
        }
    } else if (output.files === 'table') {
        yield* runTables(design, opts, output);
    } else {
        for (const { cfg, run, index, total } of runSteps(design, opts)) {
            const columns = [{ name: valueLabel(cfg.quantity, output), values: seriesOf(cfg.spectrum, cfg.quantity) }];
            const content = tableContent(cfg, columns, stepConditions(cfg, run), output);
            yield { file: placed(run, `${padK(cfg.stepK)}.${output.format}`, content), index, total };
        }
    }
}

// One table per run: the part, or each chip. Its columns are the run's steps
// in order, and its layer-table header shows the run complete.
function* runTables(design, opts, output) {
    let columns = [];
    for (const { cfg, run, index, total } of runSteps(design, opts)) {
        columns.push({
            name: `Step ${cfg.stepK} ${valueLabel(cfg.quantity, output)}`,
            values: seriesOf(cfg.spectrum, cfg.quantity),
        });
        if (cfg.stepK < run.size) {
            yield { file: null, index, total };
            continue;
        }
        const finished = run.chip == null ? cfg : {
            ...cfg,
            outputDir: opts.outputDir || '',
            comment: `Witness chip ${run.chip}, ${counted(run.size, 'layer')} on the chip: `
                + `${designLayers(run)} of ${cfg.runSize}`,
        };
        const chipPart = run.chip == null ? '' : `_chip-${run.chip}`;
        const filename = `${fileBase(design)}${chipPart}.${output.format}`;
        yield { file: { filename, content: tableContent(finished, columns, runConditions(cfg, run), output) }, index, total };
        columns = [];
    }
}

function padK(k) {
    return k < 10 ? '0' + k : String(k);
}

// A chip's step files go in the chip's own folder.
function placed(run, filename, content) {
    return run.subdir ? { subdir: run.subdir, filename, content } : { filename, content };
}

// The design name as a file name: the characters Windows refuses become '_'.
function fileBase(design) {
    return String(design.name || '').replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '_').trim() || 'process';
}

// "%T" or "T": the quantity letter of the .res column tag.
function valueLabel(quantity, output) {
    const q = tagForQuantity(quantity)[0];
    return output.scale === 'fraction' ? q : `%${q}`;
}

function plural(n, noun) {
    return n === 1 ? noun : `${noun}s`;
}

function counted(n, noun) {
    return `${n} ${plural(n, noun)}`;
}

// The design layers a chip carries: "design layer 3", "design layers 3, 6".
function designLayers(run) {
    return `design ${plural(run.size, 'layer')} ${run.designLayers.join(', ')}`;
}

// The conditions lines of a table. Every spectrum of a run is lit from the
// front, whichever side is being coated, so the side the importer reads is
// always the front; on the part the side being coated goes in the run
// description, and a chip, grown on bare glass, names its design layers.
function conditionsOf(cfg, run, description) {
    const design = cfg.designName || 'design';
    const name = run.chip == null ? design : `${design}, witness chip ${run.chip}`;
    return { name, run: description, aoi: cfg.aoi, pol: cfg.polarization, side: 'front' };
}

function stepConditions(cfg, run) {
    const k = cfg.stepK;
    return conditionsOf(cfg, run, run.chip == null
        ? `Step ${k} of ${run.size}, ${cfg.activeSide} coating`
        : `Step ${k} of ${run.size} on the chip, design layer ${run.designLayers[k - 1]} of ${cfg.runSize}`);
}

function runConditions(cfg, run) {
    return conditionsOf(cfg, run, run.chip == null
        ? `${counted(run.size, 'step')}, ${cfg.activeSide} coating`
        : `${counted(run.size, 'step')} on the chip, ${designLayers(run)} of ${cfg.runSize}`);
}

function tableHeaderLines(cfg, nPoints, conditions, output) {
    if (output.header === 'layers') return resHeaderLines(cfg, nPoints);
    if (output.header === 'conditions') {
        return spectrumConditionLines({ ...conditions, decimalMark: output.decimalMark });
    }
    return [];
}

function tableContent(cfg, columns, conditions, output) {
    const x = cfg.spectrum.lambda;
    const factor = output.scale === 'fraction' ? 1 : 100;
    return tableToCsv({
        x,
        columns: columns.map(column => ({ name: column.name, values: Array.from(column.values, v => v * factor) })),
    }, {
        delimiter: output.delimiter,
        headerLines: tableHeaderLines(cfg, x.length, conditions, output),
        columnNames: output.header !== 'none',
        decimals: output.decimals,
        decimalMark: output.decimalMark,
    });
}
