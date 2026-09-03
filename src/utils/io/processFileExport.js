/**
 * Process-file export (.res format) for in-chamber spectrophotometric
 * monitoring.
 *
 * For an N-layer active coating, one .res file is written per deposition
 * step (01.res, 02.res, ...). Each file is the spectrum the spectrophotometer
 * would see at that intermediate state: layers 1..k deposited at full thickness,
 * layers k+1..N still at zero. The non-active surface of the substrate is fixed
 * (either bare or fully coated) for the entire sequence.
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
 * File output is plain ASCII with CRLF line endings (matches reference files
 * produced for Windows 8.18n).
 */

import { evaluateDepositionSpectra, evaluateSpectrumTotal } from '../physics/thinFilmMath.js';
import { designMaterialLookup } from '../materials/designMaterials.js';
import { CHAMBER_MEDIUM_ID } from '../monitoring/chamberMedium.js';
import { chipsInRunOrder } from '../monitoring/monoSim.js';

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
    const {
        designName, controlLambda, aoi, polarization, quantity,
        lambdaStart, lambdaEnd, lambdaStep,
        allLayers, stepK,
        outputDir = '',
        appVersion = '',
        projectLabel = '',
    } = cfg;

    const N = allLayers.length;

    // Use spec.lambda as the authoritative wavelength array — building a
    // parallel local grid risks a length mismatch (multiplication vs the
    // engine's float-accumulation loop) that puts undefined in the last row.
    const spec = cfg.spectrum || stepSpectrum(cfg);
    const lambdas = spec.lambda;
    const nPoints = lambdas.length;

    const series = (quantity === 'R') ? spec.R
                 : (quantity === 'A') ? spec.A
                 :                       spec.T;

    // ── Assemble file ───────────────────────────────────────────────────────
    const lines = [];
    const CRLF = '\r\n';

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
    lines.push(` Wavelength      ${tagForQuantity(quantity)}    `);

    for (let i = 0; i < lambdas.length; i++) {
        const val_pct = series[i] * 100;
        lines.push(`${fmtFixed(lambdas[i], 10, 4)}    ${val_pct.toFixed(5)}`);
    }

    return lines.join(CRLF) + CRLF;
}

// The spectrum of one step evaluated from its own partial stack: layers 1..k
// at full thickness, the rest at zero, over the whole system. A back-side run
// takes this path for every step; a front-side run and a witness chip are
// evaluated in one pass instead (see processFileSteps).
function stepSpectrum(cfg) {
    const {
        aoi, polarization, lambdaStart, lambdaEnd, lambdaStep,
        allLayers, stepK, substrateMat, substrateThk,
        incidentMat, exitMat, otherSideLayers, activeSide,
    } = cfg;

    // ── 1. Build partial-deposition state in DEPOSITION ORDER ────────────────
    const activeStateDep = allLayers.map((l, i) => ({
        materialId: l.materialId,
        matObj:     l.matObj,
        thickness:  (i + 1) <= stepK ? l.thickness : 0,
    }));

    // ── 2. Convert to TFStudio storage order for evaluateSpectrumTotal ───────
    // frontLayers storage: top→substrate (substrate-side LAST)
    // backLayers  storage: substrate→exit (substrate-side FIRST)
    // Our deposition-order array has substrate-side at index 0.
    let frontStored, backStored;
    if (activeSide === 'front') {
        // active = front: deposition order → reverse for frontLayers storage
        frontStored = [...activeStateDep].reverse();
        // other side = back: otherSideLayers is in deposition order (sub-side first),
        // which already matches backLayers storage convention.
        backStored  = otherSideLayers.slice();
    } else {
        // active = back: deposition order is sub-side first → matches backLayers
        backStored  = activeStateDep.slice();
        // other side = front: otherSideLayers in deposition order → reverse for storage
        frontStored = [...otherSideLayers].reverse();
    }

    // ── 3. Spectrum (engine builds the lambda grid internally) ──────────────
    return evaluateSpectrumTotal(
        { lambdaStart, lambdaEnd, lambdaStep, theta: aoi, polarization },
        incidentMat, substrateMat, exitMat,
        frontStored.map(l => ({ material: l.matObj, thickness: l.thickness })),
        backStored .map(l => ({ material: l.matObj, thickness: l.thickness })),
        substrateThk,
    );
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
//
// Returns [{ filename, content }]: one entry per deposition step, with a
// `subdir` per chip on a witness-chip run.

export function buildAllProcessFiles(design, opts) {
    return Array.from(processFileSteps(design, opts), step => step.file);
}

/**
 * The files of one save, one per step, produced in order as
 * `{ file, index, total }` so a caller can write them, or hand the window a
 * turn, between steps.
 *
 * A front-side run is one growing stack on a fixed back, and a witness chip
 * is one on bare glass, so their spectra come from one pass over the run
 * before the first file: the work then grows with the layer count, not with
 * its square. A back-side run grows behind the substrate, where there is no
 * growing kernel, so each of its steps is evaluated as its file is built.
 */
export function* processFileSteps(design, opts) {
    const {
        activeSide, secondSurface, quantity, aoi, polarization,
        lambdaStart, lambdaEnd, lambdaStep,
        outputDir = '',
        appVersion = '',
        projectLabel = '',
        chips = null,
    } = opts;

    const resolveMaterial = designMaterialLookup(design);
    const controlLambda = design.referenceWavelength || 550;
    // The part or the chip sits in the chamber: air on both sides of it,
    // whatever media the design is embedded in. The header's match medium of
    // 1.0 tells the monitoring software the same.
    const air          = resolveMaterial(CHAMBER_MEDIUM_ID);
    const substrateMat = resolveMaterial((chips && chips.chipMaterial) || design.substrate?.material);
    const substrateThk = design.substrate?.thickness || 1.0;

    // Deposition order, substrate side first, over every layer of the side so
    // a chip plan indexed by step still applies once the empty layers are
    // dropped. frontLayers storage is substrate-side last, backLayers storage
    // substrate-side first.
    const frontStored = design.frontLayers || [];
    const backStored  = design.backLayers || [];
    const activeAll   = activeSide === 'front' ? [...frontStored].reverse() : backStored.slice();
    const otherDep    = (activeSide === 'front' ? backStored.slice() : [...frontStored].reverse())
        .filter(l => l && l.thickness > 0);

    const ratio = chips ? (chips.witnessRatio || 1) : 1;
    const allLayers = activeAll
        .map((l, step) => ({ l, chip: chips ? (chips.chipByStep?.[step] ?? 1) : null }))
        .filter(({ l }) => l && l.thickness > 0)
        .map(({ l, chip }) => ({
            materialId: l.material,
            thickness:  l.thickness * ratio,
            matObj:     resolveMaterial(l.material),
            chip,
        }));

    const N = allLayers.length;
    if (N === 0) return;

    const common = {
        designName: design.name, controlLambda, aoi, polarization, quantity,
        lambdaStart, lambdaEnd, lambdaStep, substrateMat, substrateThk,
        incidentMat: air, exitMat: air, appVersion, projectLabel,
    };
    const params = { lambdaStart, lambdaEnd, lambdaStep, theta: aoi, polarization };
    const asDeposition = l => ({ material: l.matObj, thickness: l.thickness });
    const padK = (k) => k < 10 ? '0' + k : String(k);

    if (chips) {
        // Each chip is its own short run from bare glass, grown like a front
        // coating whichever side of the part the run deposits, back face bare.
        // Its files go in a folder of their own, numbered from 01 on the chip,
        // and each one names the design layer it belongs to.
        let index = 0;
        for (const { chip, steps } of chipsInRunOrder(allLayers.map(l => l.chip))) {
            const subdir = `chip-${chip}`;
            const chipLayers = steps.map(i => allLayers[i]);
            const spectra = evaluateDepositionSpectra(
                params, air, substrateMat, air, chipLayers.map(asDeposition), [], substrateThk);
            for (let k = 1; k <= chipLayers.length; k++) {
                const content = buildResFileContent({
                    ...common, allLayers: chipLayers, stepK: k, spectrum: spectra[k - 1],
                    otherSideLayers: [], activeSide: 'front',
                    outputDir: outputDir ? `${outputDir.replace(/[\\/]+$/, '')}\\${subdir}` : subdir,
                    comment: `Witness chip ${chip}, layer ${k} of ${chipLayers.length} on the chip: `
                        + `design layer ${steps[k - 1] + 1} of ${N}`,
                });
                index += 1;
                yield { file: { subdir, filename: `${padK(k)}.res`, content }, index, total: N };
            }
        }
        return;
    }

    const otherSideLayers = (secondSurface === 'coated')
        ? otherDep.map(l => ({
            materialId: l.material,
            thickness:  l.thickness,
            matObj:     resolveMaterial(l.material),
        }))
        : [];

    // The other side of a front-side run is the back coating, whose deposition
    // order is its storage order.
    const spectra = activeSide === 'front'
        ? evaluateDepositionSpectra(params, air, substrateMat, air,
            allLayers.map(asDeposition), otherSideLayers.map(asDeposition), substrateThk)
        : null;

    for (let k = 1; k <= N; k++) {
        const content = buildResFileContent({
            ...common, allLayers, stepK: k, otherSideLayers, activeSide, outputDir,
            spectrum: spectra ? spectra[k - 1] : null,
        });
        yield { file: { filename: `${padK(k)}.res`, content }, index: k, total: N };
    }
}
