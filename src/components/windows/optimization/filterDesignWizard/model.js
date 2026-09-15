import { getMaterialById } from '../../../../utils/materials/catalogManager.js';
import {
    materialIndexFn, couplingOrder, coupledMirrors, qwThickness,
    structureLayerCount, structureThickness, buildFilterTarget, embeddedAngleDeg,
} from '../../../../utils/filter/filterDesign.js';

const idx = (id) => materialIndexFn(id, getMaterialById);

/**
 * The angle in the incident medium the filter is being designed for, degrees.
 * Zero unless step 1 turned oblique incidence on.
 */
export function workingAoi(p) {
    return p.oblique && p.aoi > 0 ? p.aoi : 0;
}

/**
 * Steepest angle of incidence the wizard will design or score at, degrees, the
 * bound the step-1 angle field already carries. Past 90° there is no angle of
 * incidence left, and sin folds back: 100° would be scored as 80° and 169° as
 * 11°, quietly shallower than the working angle it was measured from.
 */
const GRAZING = 89;

/**
 * The largest angle in the incident medium any design is scored at: the working
 * angle plus whatever the passband is asked to be held over, held to grazing. A
 * filter mounted at 45° and held over 10° has to survive 55°.
 */
export function heldAoi(p) {
    return Math.min(GRAZING, workingAoi(p) + Math.max(0, p.holdPassbandDeg || 0));
}

/**
 * An angle in the incident medium, as the angle inside the embedded design that
 * steps 1 to 5 evaluate in. The wizard's fields are angles at the finished
 * filter; everything the engine scores is embedded in the substrate.
 */
export function embeddedAoi(p, aoiDeg) {
    return embeddedAngleDeg({
        aoiDeg, nInc: idx(p.incidentMedium), nSub: idx(p.substrateMaterial), lambda0_nm: p.lambda0_nm,
    });
}

/** The target the step-5 search minimises, in the embedded frame. */
export function searchTargetParams(p) {
    const working = workingAoi(p), held = heldAoi(p);
    return {
        lambda0_nm: p.lambda0_nm, halfPass: p.passHalf_nm, halfStop: p.stopHalf_nm, passLevel: p.passLevel,
        aoi: embeddedAoi(p, working), pol: p.pol,
        holdAoi: held > working ? embeddedAoi(p, held) : 0,
    };
}

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
// the catalogs again and retyping the same specification and working angle. All
// of it is carried over from the last time the wizard was used.
//
// Each key says what a stored value has to look like to be used. A value that
// fails is dropped, so a deleted material or a corrupted store leaves the wizard
// on its default rather than on something unusable.
const REMEMBERED = {
    matH: 'material', matL: 'material', substrateMaterial: 'material', incidentMedium: 'material',
    lambda0_nm: 'positive', passHalf_nm: 'positive', stopHalf_nm: 'positive',
    passLevel: 'positive', stopLevel: 'positive',
    aoi: 'angle', holdPassbandDeg: 'angle',
    oblique: 'flag', pol: 'pol',
};

const VALID = {
    material: (v) => typeof v === 'string' && !!v,
    positive: (v) => Number.isFinite(v) && v > 0,
    angle: (v) => Number.isFinite(v) && v >= 0 && v < 90,
    flag: (v) => typeof v === 'boolean',
    pol: (v) => v === 's' || v === 'p' || v === 'avg',
};

const SETTINGS_KEY = 'filterDesign.settings';

function readStore() {
    try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        return (parsed && typeof parsed === 'object') ? parsed : {};
    } catch { return {}; }
}

/** The settings the wizard last used, ready to spread over the defaults. */
export function rememberedSettings(resolve = getMaterialById) {
    const stored = readStore();
    const out = {};
    for (const [key, kind] of Object.entries(REMEMBERED)) {
        if (!(key in stored) || !VALID[kind](stored[key])) continue;
        // A material id the catalogs no longer resolve is dropped, so a deleted
        // or renamed material leaves the wizard on its default rather than on a
        // broken picker.
        if (kind === 'material' && !resolve(stored[key])) continue;
        out[key] = stored[key];
    }
    return out;
}

/** Record a setting for the next time the wizard opens. */
export function rememberSetting(key, value) {
    const kind = REMEMBERED[key];
    if (!kind || !VALID[kind](value)) return;
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
    // Degrees of extra tilt, on top of the working angle, the passband is held
    // over: above zero every design is scored a second time at working + this,
    // so one that comes apart with angle loses. 0 scores the working angle only.
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
