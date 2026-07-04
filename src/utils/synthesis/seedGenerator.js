/**
 * Canonical antireflection SEED generator.
 *
 * Macleod (Thin-Film Optical Filters 5th ed., "Automatic Design") notes that
 * synthesis "most effectively works when the total number of layers is not
 * large", and that a design is often best reached "by … establishing a very
 * good starting design and then carrying out a minimum of refinement." Needle /
 * Gradual-Evolution synthesis-from-nothing struggles to discover compact
 * classic designs — in particular the 3-layer quarter–half–quarter (QHQ)
 * broadband AR, whose HALF-WAVE middle layer is *absentee* at λ0 and therefore
 * has near-zero needle-insertion sensitivity (the P-function ≈ 0 there), so the
 * needle scan never wants to grow it.
 *
 * This module emits the small, canonical family of QW/HW antireflection
 * starting designs built from the user's material pool (classified low / medium
 * / high by refractive index at λ0). The caller refines each candidate with the
 * production refiner and keeps the best — no knowledge of the answer required.
 *
 * Pure (no DOM / worker / engine imports): given resolved materials it returns
 * plain design candidates. Refinement + ranking is done by the caller (so it
 * can reuse the worker pool / makeEngine).
 *
 * Convention: frontLayers are stored AIR-FIRST (frontLayers[0] = the layer next
 * to the incident medium), matching the rest of TFStudio's design model. A
 * classic AR puts the LOW-index layer outermost (air side); higher-index layers
 * sit toward the substrate. Template role sequences below are written air→sub.
 *
 * Reference: Macleod ch.4 (antireflection coatings); the QHQ / "W-coating"
 * broadband AR (e.g. MgF2 ¼λ / high ½λ / medium ¼λ on glass).
 */

let _seedCounter = 0;
const seedLayerId = () => `seed${(_seedCounter++).toString(36)}${Math.round(performance?.now?.() ?? 0).toString(36)}`;

/**
 * Quarter-wave optical-thickness → physical thickness (nm) at λ0.
 * d = m · λ0 / (4 · n(λ0)), m = number of quarter waves (1 = QW, 2 = HW).
 */
function qwThickness(nAtLambda0, lambda0, quarterWaves) {
    if (!(nAtLambda0 > 0) || !(lambda0 > 0)) return 0;
    return quarterWaves * lambda0 / (4 * nAtLambda0);
}

/**
 * Classify a material pool into index roles at λ0.
 *
 * @param {Array}  pool        [{ id, name, mat }] — mat has getNK(λ_nm)→[n,k]
 * @param {number} lambda0     reference wavelength (nm)
 * @returns {{ low, med, high, byN }}  role → { id, name, n } (med null if <3 mats);
 *                                     byN = all pool entries sorted ascending n.
 */
export function classifyPoolByIndex(pool, lambda0) {
    const withN = (pool || [])
        .map(p => {
            const nk = p.mat?.getNK?.(lambda0);
            const n = Array.isArray(nk) ? nk[0] : (typeof nk === 'number' ? nk : NaN);
            return { id: p.id, name: p.name || p.id, n };
        })
        .filter(p => Number.isFinite(p.n) && p.n > 0)
        .sort((a, b) => a.n - b.n);
    if (withN.length === 0) return { low: null, med: null, high: null, byN: [] };
    const low = withN[0];
    const high = withN[withN.length - 1];
    // Middle role = the entry closest to the geometric mean of low/high (the
    // classic intermediate-index choice for a QHQ middle/quarter layer).
    let med = null;
    if (withN.length >= 3) {
        const target = Math.sqrt(low.n * high.n);
        med = withN.reduce((best, p) =>
            (best === null || Math.abs(p.n - target) < Math.abs(best.n - target)) ? p : best, null);
    }
    return { low, med, high, byN: withN };
}

// Canonical AR template family. Each template is a role sequence written
// AIR→SUBSTRATE; entry = [role, quarterWaves]. `needs` lists the roles the
// template requires (so it is skipped when the pool lacks that role).
//   • low / high are always present (pool sorted by n); med needs ≥3 materials.
const AR_TEMPLATES = [
    { key: 'L1',        name: '1-layer (L¼)',                roles: [['low', 1]],                       needs: ['low'] },
    { key: 'L1_H1',     name: '2-layer (L¼ H¼)',             roles: [['low', 1], ['high', 1]],          needs: ['low', 'high'] },
    { key: 'L1_M1',     name: '2-layer (L¼ M¼)',             roles: [['low', 1], ['med', 1]],           needs: ['low', 'med'] },
    { key: 'L1_H2_M1',  name: '3-layer QHQ (L¼ H½ M¼)',      roles: [['low', 1], ['high', 2], ['med', 1]], needs: ['low', 'med', 'high'] },
    { key: 'L1_M2_H1',  name: '3-layer QHQ (L¼ M½ H¼)',      roles: [['low', 1], ['med', 2], ['high', 1]], needs: ['low', 'med', 'high'] },
    { key: 'L1_M1_H1',  name: '3-layer QQQ (L¼ M¼ H¼)',      roles: [['low', 1], ['med', 1], ['high', 1]], needs: ['low', 'med', 'high'] },
    { key: 'L1_H2_L1',  name: '3-layer (L¼ H½ L¼)',          roles: [['low', 1], ['high', 2], ['low', 1]], needs: ['low', 'high'] },
    { key: 'L1_H1_L1_H1', name: '4-layer (L¼ H¼ L¼ H¼)',     roles: [['low', 1], ['high', 1], ['low', 1], ['high', 1]], needs: ['low', 'high'] },
    { key: 'L1_H2_M2_H1', name: '4-layer (L¼ H½ M½ H¼)',     roles: [['low', 1], ['high', 2], ['med', 2], ['high', 1]], needs: ['low', 'med', 'high'] },
];

/**
 * Generate canonical AR seed designs from a material pool.
 *
 * @param {Object} opts
 * @param {Array}  opts.pool      [{ id, name, mat }]
 * @param {number} opts.lambda0   reference wavelength (nm)
 * @param {Object} opts.baseDesign design to clone media from (substrate, media, surfaceMode)
 * @param {number} [opts.maxLayers] drop templates with more layers than this
 * @param {number} [opts.perRole]   how many material candidates to try per role
 *                                  (default 2) — enumerating combinations makes a
 *                                  LARGER pool only ADD options, never shift the
 *                                  single low/med/high pick to a worse trio.
 * @returns {Array<{ key, name, roleDesc, frontLayers, design }>}  candidate seeds
 */
export function generateARSeeds({ pool, lambda0 = 550, baseDesign = {}, maxLayers = Infinity, perRole = 2 }) {
    const roles = classifyPoolByIndex(pool, lambda0);
    const byN = roles.byN;
    if (!byN.length) return [];

    // Candidate materials per role (capped). low = the perRole lowest-index
    // materials; high = the perRole highest; med = the perRole closest to the
    // geometric mean of the extremes. Combinations of these are enumerated below,
    // so a bigger pool can only EXPAND the set of trios tried — it can never push
    // the generator onto a worse fixed trio (the "adding materials made it worse"
    // bug). rankSeeds() then refines all and keeps the best.
    const lowCands  = byN.slice(0, perRole);
    const highCands = byN.slice(-perRole).reverse();
    let medCands = [];
    if (byN.length >= 3) {
        const target = Math.sqrt(byN[0].n * byN[byN.length - 1].n);
        medCands = byN.slice().sort((a, b) => Math.abs(a.n - target) - Math.abs(b.n - target)).slice(0, perRole);
    }
    const roleCands = { low: lowCands, med: medCands, high: highCands };

    const seeds = [];
    const seen = new Set();   // dedupe identical material+thickness sequences

    for (const tpl of AR_TEMPLATES) {
        if (tpl.needs.some(r => !roleCands[r] || !roleCands[r].length)) continue;  // pool lacks a role
        if (tpl.roles.length > maxLayers) continue;

        // Cartesian product of material choices over the DISTINCT roles this
        // template uses (each role capped at perRole → bounded combo count).
        const usedRoles = [...new Set(tpl.roles.map(([r]) => r))];
        let combos = [{}];
        for (const r of usedRoles) {
            const next = [];
            for (const c of combos) for (const m of roleCands[r]) next.push({ ...c, [r]: m });
            combos = next;
        }

        for (const assign of combos) {
            const frontLayers = [];
            let valid = true;
            for (const [role, qw] of tpl.roles) {
                const m = assign[role];
                if (!m) { valid = false; break; }
                const thickness = qwThickness(m.n, lambda0, qw);
                if (!(thickness > 0)) { valid = false; break; }
                frontLayers.push({ id: seedLayerId(), material: m.id, thickness, locked: false });
            }
            if (!valid) continue;

            // collapse adjacent same-material entries (e.g. a role repeat or a combo
            // that assigned the same material to two roles) → no mergeable neighbours
            const collapsed = [];
            for (const L of frontLayers) {
                const prev = collapsed[collapsed.length - 1];
                if (prev && prev.material === L.material) prev.thickness += L.thickness;
                else collapsed.push({ ...L });
            }

            const sig = collapsed.map(L => `${L.material}:${L.thickness.toFixed(2)}`).join('|');
            if (seen.has(sig)) continue;
            seen.add(sig);

            const roleDesc = tpl.roles.map(([r, qw]) => `${assign[r]?.name}${qw === 2 ? '½' : '¼'}`).join(' ');
            seeds.push({
                key: tpl.key,
                name: `${collapsed.length}L · ${roleDesc}`,   // structure + actual materials
                roleDesc,
                frontLayers: collapsed,
                // Canonical AR seeds are front-stack designs; start the back stack
                // empty. Media (substrate, incident/exit, surfaceMode) from baseDesign.
                design: { ...baseDesign, frontLayers: collapsed, backLayers: [] },
            });
        }
    }
    return seeds;
}

/**
 * Pick the best seed by refining each candidate and comparing merit.
 *
 * @param {Array}    seeds      from generateARSeeds()
 * @param {Function} refineFn   (design) → { mf, design }  (caller supplies the
 *                              production refiner — worker seedDls or makeEngine)
 * @returns {{ best, ranked }}  best = lowest-MF refined seed; ranked = all,
 *                              ascending MF, each { ...seed, mf, refinedDesign }.
 */
export function rankSeeds(seeds, refineFn) {
    const ranked = (seeds || []).map(seed => {
        const r = refineFn(seed.design);
        return { ...seed, mf: r.mf, refinedDesign: r.design };
    }).sort((a, b) => a.mf - b.mf);
    return { best: ranked[0] || null, ranked };
}
