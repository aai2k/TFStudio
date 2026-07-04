/**
 * resolveEvalMode() keystone test (surface/eval-mode unification, 2026-05-30).
 *
 * resolveEvalMode(design) is the SINGLE source of truth for "which spectrum is
 * the physical answer", derived purely from design.surfaceMode + design.mfEvalMode.
 * Every viewer / analysis / spec / tolerance window now reads it (instead of an
 * independently-toggled local front/back/total state), so what you see, what
 * specs score, and what tolerances perturb can never disagree.
 *
 * Mapping under test (must match the DesignEditor Surface dropdown + Ignore-other
 * checkbox, and stay consistent with isFullSystemEval):
 *   front_only + side  → 'front'
 *   front_only + total → 'total'
 *   back_only  + side  → 'back'
 *   back_only  + total → 'total'
 *   both_independent   → 'total'  (mfEvalMode irrelevant)
 *   symmetric          → 'total'  (mfEvalMode irrelevant)
 *   missing mfEvalMode → treated as 'side' (existing-design safety)
 *
 * Run: node tests/resolve_eval_mode.mjs
 */

import { resolveEvalMode, isFullSystemEval } from '../src/utils/physics/optimizer.js';

let fails = 0;
const eq = (got, want, msg) => {
    if (got !== want) { console.error(`FAIL: ${msg} — got ${got}, want ${want}`); fails++; }
    else console.log(`  ok  ${msg} → ${got}`);
};

// ── 1. All six UI combinations ──────────────────────────────────────────────
eq(resolveEvalMode({ surfaceMode: 'front_only', mfEvalMode: 'side'  }), 'front', 'front + ignore');
eq(resolveEvalMode({ surfaceMode: 'front_only', mfEvalMode: 'total' }), 'total', 'front + total');
eq(resolveEvalMode({ surfaceMode: 'back_only',  mfEvalMode: 'side'  }), 'back',  'back + ignore');
eq(resolveEvalMode({ surfaceMode: 'back_only',  mfEvalMode: 'total' }), 'total', 'back + total');
eq(resolveEvalMode({ surfaceMode: 'both_independent', mfEvalMode: 'side'  }), 'total', 'both (ignore irrelevant)');
eq(resolveEvalMode({ surfaceMode: 'both_independent', mfEvalMode: 'total' }), 'total', 'both + total');
eq(resolveEvalMode({ surfaceMode: 'symmetric', mfEvalMode: 'side'  }), 'total', 'symmetric (ignore irrelevant)');
eq(resolveEvalMode({ surfaceMode: 'symmetric', mfEvalMode: 'total' }), 'total', 'symmetric + total');

// ── 2. Existing-design / default safety ─────────────────────────────────────
eq(resolveEvalMode({}),                          'front', 'empty design defaults front+side');
eq(resolveEvalMode({ surfaceMode: 'front_only' }), 'front', 'no mfEvalMode == side');
eq(resolveEvalMode({ surfaceMode: 'back_only'  }), 'back',  'back, no mfEvalMode == side');
eq(resolveEvalMode(null),                        'front', 'null design is safe');
eq(resolveEvalMode(undefined),                   'front', 'undefined design is safe');

// ── 3. Consistency with isFullSystemEval (the engine's own predicate) ───────
// resolveEvalMode === 'total'  iff  isFullSystemEval(surfaceMode, mfEvalMode).
for (const sm of ['front_only', 'back_only', 'both_independent', 'symmetric']) {
    for (const me of ['side', 'total']) {
        const full = isFullSystemEval(sm, me);
        const ev   = resolveEvalMode({ surfaceMode: sm, mfEvalMode: me });
        eq(ev === 'total', full, `consistency ${sm}+${me} (total⇔fullSystem)`);
    }
}

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURE(S)`);
process.exit(fails ? 1 : 0);
