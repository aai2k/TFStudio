/**
 * environment_options.mjs — Optical Evaluation Environment dropdown label.
 *
 * The Environment dropdown (EnvironmentSelector → environmentOptions) must show
 * only the multi-environment code (E1, E2, …), not the media detail
 * (`E1: air → cement`). Media detail is still available as a per-option
 * `title` tooltip on the <option>, but MUST NOT appear in the visible label.
 *
 * This pins that contract so a future refactor cannot silently reintroduce the
 * detail into the dropdown text.
 *
 * Run: node tests/environment_options.mjs
 */

import assert from 'node:assert';
import { environmentOptions, resolveEnvironment } from '../src/utils/physics/environment.js';

let failures = 0;
const check = (cond, msg) => {
    if (!cond) { failures++; console.error(`  ✗ ${msg}`); }
    else console.log(`  ✓ ${msg}`);
};

const design = {
    incidentMedium: 'Air',
    exitMedium: 'Glass',
    meritEnvironments: [
        { incidentMedium: 'air', exitMedium: 'cement', weight: 1 },
        { incidentMedium: 'water', exitMedium: 'glass', weight: 1 },
    ],
};

console.log('environment_options: checking dropdown labels contain only the code');

const opts = environmentOptions(design);

// ── 1) First entry is the design-level pseudo-option ──────────────────────────
check(
    opts[0] && opts[0].value === -1 && opts[0].label === 'designLevel',
    `first option is design-level pseudo-option (value=-1, label='designLevel'), got ${JSON.stringify(opts[0])}`,
);

// ── 2) Every environment entry is a bare code (E1, E2, …) ─────────────────────
check(opts.length === 3, `expected 3 options (design + 2 envs), got ${opts.length}`);

opts.slice(1).forEach((o, i) => {
    const expected = `E${i + 1}`;
    check(
        o.value === i && o.label === expected,
        `env option ${i} should be value=${i}, label='${expected}', got ${JSON.stringify(o)}`,
    );
    // The visible label must NOT leak media detail.
    check(
        !o.label.includes('→') && !o.label.includes(':') && o.label === expected,
        `env option ${i} label '${o.label}' must contain only the code, no media detail`,
    );
});

// ── 3) No option label anywhere may contain the media-detail marker ───────────
const leaked = opts.some((o) => typeof o.label === 'string' && o.label.includes('→'));
check(!leaked, 'no option label contains the media-detail arrow (→)');

// ── 4) Empty environments → only the design-level option ──────────────────────
const onlyDesign = environmentOptions({ meritEnvironments: [] });
check(
    onlyDesign.length === 1 && onlyDesign[0].value === -1 && onlyDesign[0].label === 'designLevel',
    'design with no environments yields only the design-level option',
);

// ── 5) resolveEnvironment still maps indices correctly (no behaviour change) ──
const r1 = resolveEnvironment(design, 0);
check(r1.environmentIndex === 0 && r1.incidentMedium === 'air' && r1.exitMedium === 'cement',
    'resolveEnvironment(0) resolves the first environment media');
const rAll = resolveEnvironment(design, -1);
check(rAll.environmentIndex === -1 && rAll.incidentMedium === 'Air',
    'resolveEnvironment(-1) resolves the design-level media');

if (failures > 0) {
    console.error(`\nenvironment_options: FAIL (${failures} problem(s))`);
    process.exit(1);
}
console.log('\nenvironment_options: PASS — dropdown labels are bare codes (E1, E2, …), media detail confined to title tooltip');
