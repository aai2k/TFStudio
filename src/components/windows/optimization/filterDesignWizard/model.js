import { getMaterialById } from '../../../../utils/materials/catalogManager.js';
import {
    materialIndexFn, couplingOrder, coupledMirrors, qwThickness,
    structureLayerCount, structureThickness, buildFilterTarget,
} from '../../../../utils/filter/filterDesign.js';

const idx = (id) => materialIndexFn(id, getMaterialById);

// Thelen coupling order δ (Eq. 10) from the chosen materials.
export function couplingD(p) {
    const nH = idx(p.matH)(p.lambda0_nm)[0];
    const nL = idx(p.matL)(p.lambda0_nm)[0];
    const nS = idx(p.substrateMaterial)(p.lambda0_nm)[0];
    return couplingOrder(nH, nL, nS);
}

/**
 * The step-4 prototype expressed as a selectable candidate: the design Finish
 * builds when the user never runs the integer search. The same shape the search
 * returns, so steps 5 and 6 need no special case for it.
 */
export function prototypeCandidate(p, N, m, k) {
    const mirrors = coupledMirrors(N, m, couplingD(p));
    const spacers = new Array(N).fill(Math.max(1, Math.round(k)));
    const dH = qwThickness(idx(p.matH), p.lambda0_nm);
    const dL = qwThickness(idx(p.matL), p.lambda0_nm);
    return {
        mirrors, spacers, isSeed: true,
        layers: structureLayerCount(mirrors, spacers),
        thicknessNm: structureThickness(mirrors, spacers, dH, dL),
    };
}

/**
 * The points the merit scores, drawn over the step-4 and step-5 previews so the
 * user can see what the search is being asked for. Null on invalid input, which
 * a preview treats as nothing to draw.
 */
export function targetPointsOf(p) {
    return safeCall(() => buildFilterTarget({
        lambda0_nm: p.lambda0_nm, halfPass: p.passHalf_nm,
        halfStop: p.stopHalf_nm, passLevel: p.passLevel,
    }).points, null);
}

// ── Step-5 candidate history ───────────────────────────────────

/** Identity of a candidate: the structure, which is what the user is choosing between. */
export function candidateKey(c) {
    return `${c.mirrors.join(',')}|${c.spacers.join(',')}`;
}

/**
 * Merge a run's candidates into the history kept across runs, dropping
 * structures already in it and keeping the whole list sorted by merit. This is
 * what lets a user try a seed, try another, and compare the two.
 */
export function mergeCandidates(history, incoming) {
    const seen = new Set(history.map(candidateKey));
    const merged = history.slice();
    for (const c of incoming || []) {
        const key = candidateKey(c);
        if (seen.has(key)) continue;
        seen.add(key); merged.push(c);
    }
    merged.sort((a, b) => a.mf - b.mf);
    return merged;
}

// ── Remembered settings ─────────────────────────────────────
// Reopening the wizard on its defaults means finding the same four materials in
// the catalogs again and retyping the same specification. Both are carried over
// from the last time it was used.
const REMEMBERED_MATERIALS = ['matH', 'matL', 'substrateMaterial', 'incidentMedium'];
const REMEMBERED_NUMBERS = ['lambda0_nm', 'passHalf_nm', 'stopHalf_nm', 'passLevel', 'stopLevel'];
const SETTINGS_KEY = 'filterDesign.settings';

function readStore() {
    try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        return (parsed && typeof parsed === 'object') ? parsed : {};
    } catch { return {}; }
}

/**
 * The settings the wizard last used, ready to spread over the defaults. A
 * material id the catalogs no longer resolve is dropped, so a deleted or
 * renamed material leaves the wizard on its default rather than on a broken
 * picker; a number that did not survive the round trip is dropped the same way.
 */
export function rememberedSettings(resolve = getMaterialById) {
    const stored = readStore();
    const out = {};
    for (const key of REMEMBERED_MATERIALS) {
        const id = stored[key];
        if (typeof id === 'string' && id && resolve(id)) out[key] = id;
    }
    for (const key of REMEMBERED_NUMBERS) {
        const v = stored[key];
        if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[key] = v;
    }
    return out;
}

/** Record a setting for the next time the wizard opens. */
export function rememberSetting(key, value) {
    const isMaterial = REMEMBERED_MATERIALS.includes(key) && typeof value === 'string';
    const isNumber = REMEMBERED_NUMBERS.includes(key) && Number.isFinite(value);
    if (!isMaterial && !isNumber) return;
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...readStore(), [key]: value }));
    } catch { /* no localStorage: the setting simply is not remembered */ }
}

// ── Defaults ──────────────────────────────────────────────────────────────────
export const DEFAULTS = {
    matH: 'builtin:Nb2O5', matL: 'builtin:SiO2',
    substrateMaterial: 'builtin:BK7', substrateThicknessMm: 1.0,
    incidentMedium: 'builtin:Air', exitMedium: 'builtin:Air',
    lambda0_nm: 600,
    passHalf_nm: 1.5,          // Δλ @ passLevel
    stopHalf_nm: 4.5,          // Δλ @ stopLevel
    passLevel: 89.13,          // % (0.5 dB)
    stopLevel: 0.1,            // % (30 dB)
    cavities: null,            // null → auto
    // Step-4 row filter. The spacer material follows from m's parity, so this
    // picks which rows of the one table are offered: all, the even m (H
    // spacers) or the odd m (L spacers).
    spacerFilter: 'any',
    aoi: 0, pol: 'avg', oblique: false,
    // prototype selection (step 4)
    seedMirror: null, seedSpacer: null,
    // integer-search options (step 5)
    symMirrors: false, symCavities: false, restarts: 14,
    clearHistoryOnStart: true,
    // Angle in air, degrees, the passband is held to: above zero every design
    // is also scored tilted to it. 0 scores at normal incidence only.
    holdPassbandDeg: 0,
    // view setting, shared by every plot in the wizard
    logAxis: false,
    // Step-5 candidate history, the filter signature it was collected for, and
    // the run counter. They live in the wizard state, not in the step, because
    // step 5 unmounts whenever the user navigates away and the list is meant to
    // outlive that; the signature is what tells a remount whether the history
    // still belongs to the filter now being designed.
    candidateHistory: [], historyKey: null, searchRun: 0,
    // chosen candidate + AR (step 5/6)
    selected: null,            // { mirrors, spacers, mf, layers, thicknessNm }
    arMode: 'vcoat',
    name: 'Filter Design',
};

export function shapeFactor(p) { return p.passHalf_nm > 0 ? p.stopHalf_nm / p.passHalf_nm : 0; }

// Runs fn(), falling back to `fallback` on any thrown error — used by preview
// computations that must never crash the wizard on transient invalid input.
export function safeCall(fn, fallback) {
    try { return fn(); } catch { return fallback; }
}
