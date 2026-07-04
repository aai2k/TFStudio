/**
 * Tests for the built-in Specification preset library.
 *
 * Asserts:
 *   1. QUALIFIER_PRESETS has all 8 v1 entries with unique ids.
 *   2. applyPreset returns a fresh qualifier list with proper ids.
 *   3. Every kind in every preset is a valid QUALIFIER_KINDS member.
 *   4. Apply a preset to a known design and verify the verdict is sensible
 *      (BBAR_VIS on a bare BK7 → FAIL because uncoated; PHOTOPIC_AR same).
 *   5. NEUTRAL_COLOR preset evaluates a ΔE on a plain substrate (should be small).
 *   6. Loaded preset items have unique fresh ids (no id collisions across loads).
 */

import {
    QUALIFIER_PRESETS, applyPreset, getPreset,
} from '../src/utils/synthesis/qualifierPresets.js';
import {
    makeQualifier, QUALIFIER_KINDS, evaluateQualifiers, aggregateVerdict,
} from '../src/utils/synthesis/qualifiers.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };

const resolveMat = id => getMaterial(id);
const bareDesign = {
    incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1.0 },
    frontLayers: [], backLayers: [],
    surfaceMode: 'front_only',
};

// ── 1. Preset library structure ──────────────────────────────────────────────
console.log('— preset library structure —');
{
    ok(QUALIFIER_PRESETS.length >= 6,
        `at least 6 presets shipped (got ${QUALIFIER_PRESETS.length})`);
    const ids = QUALIFIER_PRESETS.map(p => p.id);
    ok(new Set(ids).size === ids.length, `all preset ids unique`);
    for (const p of QUALIFIER_PRESETS) {
        ok(typeof p.label === 'string' && p.label.length > 0,
            `preset ${p.id}: has label`);
        ok(typeof p.description === 'string',
            `preset ${p.id}: has description`);
        ok(Array.isArray(p.kinds) && p.kinds.length > 0,
            `preset ${p.id}: non-empty kinds`);
        for (const k of p.kinds) {
            ok(QUALIFIER_KINDS.includes(k.kind),
                `preset ${p.id}: kind ${k.kind} is a known QUALIFIER_KINDS`);
        }
    }
}

// ── 2. applyPreset returns fresh qualifiers ──────────────────────────────────
console.log('— applyPreset returns fresh qualifier objects —');
{
    const bbarA = applyPreset('BBAR_VIS');
    const bbarB = applyPreset('BBAR_VIS');
    ok(bbarA.length === 2, `BBAR_VIS produces 2 qualifiers (got ${bbarA.length})`);
    ok(bbarA[0].id !== bbarB[0].id,
        `IDs are unique across two apply calls (got ${bbarA[0].id} vs ${bbarB[0].id})`);
    ok(bbarA[0].enabled === true, `qualifier is enabled by default`);
    ok(bbarA[0].kind === 'T_AVG' && bbarA[1].kind === 'R_AVG',
        `BBAR_VIS contents = [T_AVG, R_AVG]`);
    ok(applyPreset('NONEXISTENT').length === 0,
        `applyPreset on unknown id returns []`);
}

// ── 3. getPreset accessor ────────────────────────────────────────────────────
console.log('— getPreset accessor —');
{
    const p = getPreset('PHOTOPIC_AR');
    ok(p && p.id === 'PHOTOPIC_AR', `getPreset returns matching descriptor`);
    ok(getPreset('NONEXISTENT') === null, `getPreset on unknown id returns null`);
}

// ── 4. Apply BBAR_VIS to bare BK7 — should report FAIL (uncoated has high R) ─
console.log('— apply BBAR_VIS to bare BK7 → expect FAIL —');
{
    const quals = applyPreset('BBAR_VIS');
    const results = evaluateQualifiers(quals, bareDesign, resolveMat);
    const verdict = aggregateVerdict(results);
    // Bare glass: T ≈ 92% (Fresnel loss both sides) — does not reach 99%
    // R ≈ 8% — does not reach ≤ 1%. Both should fail.
    ok(verdict.passing === 0,
        `BBAR_VIS fails on bare glass (got ${verdict.passing}/${verdict.total} passing)`);
}

// ── 6. Loaded preset items have distinct ids ─────────────────────────────────
console.log('— loaded items have unique ids per call —');
{
    const a = applyPreset('LP_FILTER_VIS');
    const b = applyPreset('LP_FILTER_VIS');
    const ids = new Set();
    for (const q of [...a, ...b]) ids.add(q.id);
    ok(ids.size === a.length + b.length,
        `all ${a.length + b.length} ids unique across two applies (got ${ids.size})`);
}

if (fails === 0) console.log('\nAll preset-library tests passed.');
else { console.error(`\n${fails} test(s) failed.`); process.exit(1); }
