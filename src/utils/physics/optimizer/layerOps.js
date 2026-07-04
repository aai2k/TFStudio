/**
 * Layer-geometry operations — pure design-array transforms.
 *
 * PURE: no
 * TMM / eval / merit dependencies — just mirror a stack and insert/split/merge
 * layers. Used by the eval core (symmetric back-stack), DLS, and the scanners.
 */

// Mirror a front stack into its physically-symmetric back stack.
// Storage convention: front is air→substrate (front[0]=air, front[last]=sub);
// back is substrate→exit (back[0]=sub, back[last]=exit). A mirror-symmetric
// coating has the SAME physical layer sequence outward from the substrate on
// both sides, so the back stack is the REVERSE of the front stack — not a
// plain copy. `idPrefix` keeps back-layer ids distinct from their front twins.
export function mirrorLayers(front, idPrefix = 'b-') {
    return [...(front || [])].reverse().map(l => ({ ...l, id: `${idPrefix}${l.id}` }));
}

// ── Layer utilities ───────────────────────────────────────────────────────────

export function insertNeedle(design, pos, materialId, deltaNm, side = 'front') {
    const key    = side === 'back' ? 'backLayers' : 'frontLayers';
    const layers = design[key] || [];
    const needle = {
        id:        `n${Math.random().toString(36).slice(2, 10)}`,
        material:  materialId,
        thickness: deltaNm,
        locked:    false,
    };
    const newLayers = [...layers.slice(0, pos), needle, ...layers.slice(pos)];
    const out = { ...design, [key]: newLayers };
    // In symmetric mode the back stack is a mirror of the front (Macleod §2.6.4
    // identical coating on both substrate faces). Keep the design consistent
    // even between optimizer passes that would rebuild it.
    if ((design?.surfaceMode === 'symmetric') && side === 'front') {
        out.backLayers = mirrorLayers(newLayers);
    }
    return out;
}

export function cleanupLayers(layers, pruneNm = 5.0) {
    // Iterate merge + prune to a fixpoint. A single pass merged-then-pruned, but
    // pruning a thin layer can make its two same-material neighbours adjacent
    // (e.g. [H 100, L 3, H 100] → prune L → [H 100, H 100]) — those must then be
    // merged. Loop until a pass changes nothing (matching designCleaner's fixpoint).
    let cur = layers.map(l => ({ ...l }));
    for (let iter = 0; iter < 100; iter++) {
        const before = cur.length;
        const merged = [];
        for (const layer of cur) {
            const prev = merged[merged.length - 1];
            if (prev && !prev.locked && !layer.locked && prev.material === layer.material) {
                merged[merged.length - 1] = { ...prev, thickness: prev.thickness + layer.thickness };
            } else {
                merged.push({ ...layer });
            }
        }
        cur = merged.filter(l => l.locked || l.thickness >= pruneNm);
        if (cur.length === before) break;   // no merge and no prune this pass → stable
    }
    return cur;
}

export function bestNeedlePerPosition(candidates) {
    const map = new Map();
    for (const c of candidates) {
        if (!map.has(c.pos) || c.dMF < map.get(c.pos).dMF) map.set(c.pos, c);
    }
    return Array.from(map.values()).sort((a, b) => a.pos - b.pos);
}

// ── Intra-layer needle insertion ──────────────────────────────────────────────

export function insertNeedleIntra(design, layerK, frac, materialId, deltaNm, side = 'front') {
    const key    = side === 'back' ? 'backLayers' : 'frontLayers';
    const layers = design[key] || [];
    const host   = layers[layerK];
    if (!host) return design;
    const dk = host.thickness || 0;
    // M2: floor the split halves of the host at the same 1e-3 nm minimum that the
    // scan oracle _perturbCtxIntra (scanners.js) uses — NOT at deltaNm. Callers
    // pass deltaNm = dOpt (the optimized needle thickness, up to ~60 nm); flooring
    // the host halves at dOpt injected phantom bulk (a 20 nm host split @0.5 became
    // 60+needle+60 instead of 10+needle+10), so the inserted geometry no longer
    // matched the one golden-section optimized. The needle layer itself keeps
    // thickness = deltaNm below. (Matches Python needle_step's max(frac·d_k, D_MIN).)
    const d1 = Math.max(frac * dk, 1e-3);
    const d2 = Math.max((1 - frac) * dk, 1e-3);
    const mkId = () => `n${Math.random().toString(36).slice(2, 10)}`;
    const part1  = { ...host, id: mkId(), thickness: d1 };
    const needle = { id: mkId(), material: materialId, thickness: deltaNm, locked: false };
    const part2  = { ...host, id: mkId(), thickness: d2 };
    const newLayers = [...layers.slice(0, layerK), part1, needle, part2, ...layers.slice(layerK + 1)];
    const out = { ...design, [key]: newLayers };
    if ((design?.surfaceMode === 'symmetric') && side === 'front') {
        out.backLayers = mirrorLayers(newLayers);
    }
    return out;
}
