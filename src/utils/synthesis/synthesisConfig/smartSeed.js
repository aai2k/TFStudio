// ── Smart starting design ("seed") ──────────────────────────────────────────────
// When ON, a synthesis run first generates the canonical QW/HW antireflection
// starting designs from the material pool, refines each OFF-THREAD on the worker
// pool (so the UI never blocks), and begins synthesis from whichever scores best.
// The CURRENT design is always included as a candidate, so enabling the seed can
// only match or improve the starting point — it never replaces a better design
// with a worse generated one. Default OFF (opt-in; an explicit user choice).
// Per-window setting (scope = 'needle' | 'ge' | 'structural'). Defaults differ by
// window: GE and Structural GROW a stack, so a smart QW/HW AR seed is a good head
// start → default ON. Needle CARVES from a (often thick) seed, where replacing the
// start with a generated AR design is usually NOT wanted → default OFF. An explicit
// user toggle (stored '1'/'0') always wins over the default. A bare key (no scope)
// keeps the legacy global behaviour, default OFF.
const SMART_SEED_KEY = 'tfstudio-synth-smart-seed';
const SMART_SEED_DEFAULTS = { needle: false, ge: true, structural: true };
export function getSynthesisSmartSeed(scope = '') {
    const key = SMART_SEED_KEY + (scope ? `-${scope}` : '');
    try {
        const v = localStorage.getItem(key);
        if (v === '1' || v === 'true')  return true;
        if (v === '0' || v === 'false') return false;   // explicit user choice wins
    } catch (_) { /* no localStorage → fall through to default */ }
    return SMART_SEED_DEFAULTS[scope] ?? false;
}
export function setSynthesisSmartSeed(on, scope = '') {
    const key = SMART_SEED_KEY + (scope ? `-${scope}` : '');
    try { localStorage.setItem(key, on ? '1' : '0'); } catch (_) {}
}
