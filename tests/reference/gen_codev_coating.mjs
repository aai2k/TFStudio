/**
 * Freeze CODE V 11.2 results into codev/: the .seq files TFStudio wrote and
 * CODE V ran, the .mul files CODE V saved from them, and codev_11_2.json with
 * the numbers CODE V printed for them.
 *
 * The source is runs of CODE V 11.2 (CODE V PC, 07-Oct-26) on the owner's
 * work PC, each a command file and the listing it wrote with OUT T:
 *
 *   run_checks.seq   codev_checks.lis    five TFStudio exports, SAV, RES, MPR, MAN
 *   run_checks2.seq  codev_checks2.lis   a TFStudio export with 41 wavelengths in
 *                                        two WL commands, MPR and MAN; the same
 *                                        stack with WLG, MPR; a 3-point MIC
 *                                        table narrower than WL, MPR and MAN
 *   run_checks4.seq  codev_checks4.lis   MIC probe tables of 2 to 5 points, MPR
 *   run_checks5.seq  codev_checks5.lis   MIC probe tables that differ in k, and
 *                                        the Ta2O5 table of tfs_ar4, MPR
 *   run_checks6.seq  codev_checks6.lis   MIC probe tables that differ in k and n
 *                                        about the switch to the spline, MPR
 *
 * Written to codev/:
 *   <name>.seq        the MUL ... MEX block of the command file, as CODE V ran it
 *   <name>.mul        the .mul CODE V 11.2 saved from each TFStudio export
 *                     (format 6), copied as it is; tfs_cr41.seq and
 *                     tfs_cr41g.seq are written for their .mul files only
 *   codev_11_2.json   man:  MAN per .seq, rows [angle°, λ nm, Rs, Rp, Ts, Tp]
 *                     mic:  per MIC material, the table [λ nm, n, k] and the n
 *                           and k MPR printed at the analysis wavelengths
 *
 * Run (maintainer only; needs the listings, which are not in the repo):
 *   node tests/reference/gen_codev_coating.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listingRun, manRows, mprSection } from './codevListing.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LISTINGS = 'X:/TFStudio Dev/reference/code v/listings';
const OUT = path.join(HERE, 'codev');

const read = (file) => fs.readFileSync(path.join(LISTINGS, file), 'utf8');

// Each fixture: the command file, the comment line that heads its block there,
// the listing, and the line that starts its MAN run in the listing.
const FIXTURES = [
    ['tfs_ar4', 'run_checks.seq', '! ---- tfs_ar4', 'codev_checks.lis', 'MUL> RES tfs_ar4'],
    ['tfs_agmir', 'run_checks.seq', '! ---- tfs_agmir', 'codev_checks.lis', 'MUL> RES tfs_agmir'],
    ['tfs_hr45', 'run_checks.seq', '! ---- tfs_hr45', 'codev_checks.lis', 'MUL> RES tfs_hr45'],
    ['tfs_const', 'run_checks.seq', '! ---- tfs_const', 'codev_checks.lis', 'MUL> RES tfs_const'],
    ['tfs_cr41w', 'run_checks2.seq', '! ---- 41 wavelengths written as two WL commands of 21 and 20',
        'codev_checks2.lis', 'MUL> RES tfs_cr41w'],
    ['mic_narrow', 'run_checks2.seq', '! ---- a MIC table narrower than the analysis wavelengths (may stop the run, so it is last)',
        'codev_checks2.lis', "MDA> TIT 'MIC narrower than WL'"],
];

// TFStudio exports whose .mul is checked but whose MAN is not: tfs_cr41 is
// tfs_cr41w with all 41 wavelengths in one WL command, of which CODE V kept
// 21, and tfs_cr41g the same stack with WLG.
const SEQ_ONLY = [
    ['tfs_cr41', 'run_checks.seq', '! ---- tfs_cr41'],
    ['tfs_cr41g', 'run_checks2.seq', '! ---- the same stack with WLG'],
];
// The .mul files CODE V 11.2 saved, in the listings folder.
const SAVED_MUL = ['tfs_ar4', 'tfs_agmir', 'tfs_hr45', 'tfs_const', 'tfs_cr41', 'tfs_cr41w', 'tfs_cr41g'];

// The probe runs of a command file: the first word of each title names one.
const probeRuns = (seqFile, listing) => read(seqFile).split(/\r?\n/).filter(line => line.startsWith('TIT '))
    .map(line => [line.slice(5, line.indexOf(' ', 5)), listing, `MDA> ${line.trimEnd()}`]);

// MPR runs whose MIC materials go into `mic`, by listing and the line that starts the run.
const MPR_RUNS = [
    ['tfs_cr41w', 'codev_checks2.lis', 'MUL> RES tfs_cr41w'],
    ['mic_narrow', 'codev_checks2.lis', "MDA> TIT 'MIC narrower than WL'"],
    ...probeRuns('run_checks4.seq', 'codev_checks4.lis'),
    ...probeRuns('run_checks5.seq', 'codev_checks5.lis'),
    ...probeRuns('run_checks6.seq', 'codev_checks6.lis'),
];

// The lines after `marker` up to and including the first MEX.
function seqBlock(text, marker) {
    const lines = text.split(/\r?\n/);
    const from = lines.findIndex(line => line.trimEnd() === marker);
    if (from < 0) throw new Error(`no "${marker}"`);
    const to = lines.findIndex((line, i) => i > from && line.trim() === 'MEX');
    return lines.slice(from + 1, to + 1).join('\r\n') + '\r\n';
}

function micEntries(run, lines) {
    const n = mprSection(lines, 'REFRACTIVE INDICES - DISPERSIVE MATERIALS');
    const k = mprSection(lines, 'EXTINCTION COEFFICIENTS - DISPERSIVE MATERIALS');
    const tableN = mprSection(lines, 'MULTILAYER CATALOG: INDEX DATA');
    const tableK = mprSection(lines, 'MULTILAYER CATALOG: EXTINCTION COEFFICIENTS');
    return Object.keys(tableN).map(label => ({
        run,
        label,
        table: tableN[label].wl.map((lam, i) => [lam, tableN[label].values[i], tableK[label]?.values[i] ?? 0]),
        wavelengthsNm: n[label].wl,
        n: n[label].values,
        k: k[label]?.values ?? n[label].wl.map(() => 0),
    }));
}

fs.mkdirSync(OUT, { recursive: true });
const man = {};
for (const [name, seqFile, marker, listing, start] of FIXTURES) {
    fs.writeFileSync(path.join(OUT, `${name}.seq`), seqBlock(read(seqFile), marker), 'utf8');
    man[name] = manRows(listingRun(read(listing), start));
}
for (const [name, seqFile, marker] of SEQ_ONLY) {
    fs.writeFileSync(path.join(OUT, `${name}.seq`), seqBlock(read(seqFile), marker), 'utf8');
}
for (const name of SAVED_MUL) fs.copyFileSync(path.join(LISTINGS, `${name}.mul`), path.join(OUT, `${name}.mul`));
const mic = MPR_RUNS.flatMap(([run, listing, start]) => micEntries(run, listingRun(read(listing), start)));

fs.writeFileSync(path.join(OUT, 'codev_11_2.json'), JSON.stringify({
    source: 'CODE V PC 11.2, listings of 07-Oct-26 (codev_checks.lis, codev_checks2.lis, codev_checks4.lis to codev_checks6.lis)',
    man: 'MAN transmission table of codev/<name>.seq: [angle deg, wavelength nm, Rs, Rp, Ts, Tp], 6 decimals as printed',
    mic: 'MIC material: table [wavelength nm, n, k] as entered, and the n and k MPR printed at the analysis wavelengths',
    data: { man, mic },
}, null, 1) + '\n', 'utf8');

console.log(`wrote ${OUT}: ${FIXTURES.length + SEQ_ONLY.length} .seq files, ${SAVED_MUL.length} .mul files, `
    + `${Object.values(man).flat().length} MAN rows, ${mic.length} MIC materials`);
