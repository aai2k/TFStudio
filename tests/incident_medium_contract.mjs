/**
 * Incident/exit medium contract — D1 regression.
 *
 * `design.incidentMedium` and `design.exitMedium` are STRINGS (material ids,
 * e.g. 'Air', 'builtin:Air') — see DesignContext.js, sampleDesigns.js,
 * wdmDesigner.js. `design.substrate` is an OBJECT ({material, thickness}), so
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
const checkStringDefault = (relPath, label) => {
    const src = readFileSync(join(ROOT, relPath), 'utf8');
    // incidentMedium: 'Air'  (a string literal, not `{`)
    const m = src.match(/incidentMedium:\s*(['"`{])/);
    ok(m && m[1] !== '{', `${label}: incidentMedium default should be a string literal, not an object`);
};
checkStringDefault('src/state/DesignContext.js', 'DesignContext');
checkStringDefault('src/utils/samples/sampleDesigns.js', 'sampleDesigns');

if (fails === 0) { console.log('PASS — incident/exit medium contract holds across all windows.'); process.exit(0); }
else { console.error(`\n${fails} contract violation(s).`); process.exit(1); }
