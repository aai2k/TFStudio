/**
 * coating-library-check.mjs: evaluate the built-in coating library.
 *
 * For every entry prints its headline numbers over the design band, each
 * specification claim with its PASS/FAIL verdict, and any structural problem
 * (unresolvable material, band outside a material's data, bad thickness).
 * Exit 1 when any entry has a problem or a failing claim.
 *
 * Usage:
 *   node tools/coating-library-check.mjs            # every entry
 *   node tools/coating-library-check.mjs --id=bbar  # entries whose id contains "bbar"
 */
import { BUILTIN_COATINGS } from '../src/utils/coatingLibrary/builtin/index.js';
import { COATING_TAGS, bandsText, entrySpecResults } from '../src/utils/coatingLibrary/entryModel.js';
import { entryMetrics } from '../src/utils/coatingLibrary/entryProperties.js';
import { validateEntry } from '../src/utils/coatingLibrary/validateEntry.js';
import { initWasmForTest } from '../tests/_wasmInit.mjs';

await initWasmForTest();

const idFilter = (process.argv.find(arg => arg.startsWith('--id=')) || '').slice(5);
const entries = BUILTIN_COATINGS.filter(entry => !idFilter || entry.id.includes(idFilter));

const pct = value => Number.isFinite(value) ? `${(value * 100).toFixed(3)}%` : '?';
let failures = 0;

for (const entry of entries) {
    const problems = validateEntry(entry);
    console.log(`\n${entry.id}  [${entry.type}]  ${entry.name}`);
    console.log(`  ${entry.layers.length} layers, ${entry.substrate}, ${bandsText(entry)}, `
        + `AOI ${entry.aoi}°, ${entry.polarization}`);
    console.log(`  tags: ${entry.tags.join(', ') || '(none)'}`);
    for (const tag of entry.tags) if (!COATING_TAGS[tag]) problems.push(`tag "${tag}" is not in COATING_TAGS`);
    if (entry.tags.length === 0) problems.push('no tags');
    for (const problem of problems) console.log(`  PROBLEM  ${problem}`);
    if (problems.length > 0) { failures++; continue; }

    const m = entryMetrics(entry);
    const label = row => `${row.channel}${row.pol === 's' || row.pol === 'p' ? row.pol : ''} ${row.stat}`;
    m.bands.forEach((band, b) => {
        console.log(`  ${band[0]}-${band[1]} nm:  ${m.rows.map(row => `${label(row)} ${pct(row.values[b])}`).join('  ')}`);
    });
    for (const row of m.shape) {
        const text = row.unit === 'ratio' ? `${row.value?.toFixed(1)} : 1` : `${row.value?.toFixed(2)} nm`;
        console.log(`  ${label(row)} ${row.value == null ? '?' : text}`);
    }
    console.log(`  total ${m.totalThickness.toFixed(1)} nm`);

    const { qualifiers, results, verdict } = entrySpecResults(entry);
    if (qualifiers.length === 0) { console.log('  PROBLEM  no specification claims'); failures++; }
    results.forEach((result, i) => {
        const q = qualifiers[i];
        const what = q.label || `${q.kind}${q.channel ? ' ' + q.channel : ''}`;
        console.log(`  ${result.pass ? 'PASS' : 'FAIL'}  ${what}: ${result.summary}`);
    });
    if (verdict.anyFail) failures++;
}

console.log(`\n${entries.length} entries, ${failures} with problems or failing claims`);
process.exit(failures > 0 ? 1 : 0);
