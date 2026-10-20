/**
 * Incident/exit medium contract — D1 regression.
 *
 * `design.incidentMedium` and `design.exitMedium` are STRINGS (material ids,
 * e.g. 'Air', 'builtin:Air'), as newDesign.js, sampleDesigns.js and
 * wdmDesigner.js write them. `design.substrate` is an OBJECT ({material, thickness}), so
 * `substrate.material` is correct, but accessing `.material` on the medium
 * strings yields `undefined` → silently resolves to Air.
 *
 * This bug shipped in 5 analysis windows (Admittance, E-Field, GD/GDD,
 * RI-Profiler, Ellipsometry): they read `design.incidentMedium?.material`, so a
 * non-Air ambient / immersion design was computed as if the incident (and back
 * exit) medium were vacuum — invisible by default because the default IS Air.
 *
 * Guard: no window component may access `.material` on incidentMedium/exitMedium.
 * Also pins the schema invariant that the defaults are strings.
 *
 * Run: node tests/incident_medium_contract.mjs
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const WIN_DIR = join(ROOT, 'src', 'components', 'windows');

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };

// ── 1) No window accesses `.material` on a medium string ─────────────────────
// Matches incidentMedium.material, incidentMedium?.material, exitMedium.material,
// exitMedium?.material (any whitespace).
const ANTIPATTERN = /\b(incidentMedium|exitMedium)\s*\??\s*\.\s*material\b/;
function listJsFiles(dir) {
    const files = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) files.push(...listJsFiles(path));
        else if (entry.name.endsWith('.js')) files.push(path);
    }
    return files;
}

const files = listJsFiles(WIN_DIR);
let scanned = 0;
for (const file of files) {
    const src = readFileSync(file, 'utf8');
    scanned++;
    src.split('\n').forEach((line, i) => {
        // A defensive `typeof ... === 'string' ? medium : medium?.material` is
        // CORRECT (it prefers the string) — only flag an UNGUARDED .material.
        const guarded = /===\s*['"]string['"]/.test(line);
        if (ANTIPATTERN.test(line) && !guarded) {
            ok(false, `${file}:${i + 1} accesses .material on a medium string — incidentMedium/exitMedium are strings, use resolveMaterial(design.incidentMedium). Line: ${line.trim()}`);
        }
    });
}
console.log(`Scanned ${scanned} window component(s) for the medium-.material anti-pattern.`);

// ── 2) Schema invariant: the defaults are strings, not objects ───────────────
const { makeDefaultDesign } = await import('../src/utils/io/newDesign.js');
const { buildSampleDesigns } = await import('../src/utils/samples/sampleDesigns.js');
const checkStringMedia = (design, label) => {
    ok(typeof design.incidentMedium === 'string', `${label}: incidentMedium should be a material id string, not ${typeof design.incidentMedium}`);
    ok(typeof design.exitMedium === 'string', `${label}: exitMedium should be a material id string, not ${typeof design.exitMedium}`);
};
checkStringMedia(makeDefaultDesign(), 'newDesign');
const samples = buildSampleDesigns();
ok(samples.length > 0, 'the sample designs are there to check');
for (const sample of samples) checkStringMedia(sample.build(), `sample ${sample.key}`);

if (fails === 0) { console.log('PASS — incident/exit medium contract holds across all windows.'); process.exit(0); }
else { console.error(`\n${fails} contract violation(s).`); process.exit(1); }
