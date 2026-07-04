// ── Built-in sample designs (first-run welcome) ────────────────────────────────
//
// A small library of textbook starter designs the welcome screen can drop into
// the project tree so a brand-new user has something to explore immediately.
//
// These are NOT claimed-optimal or validated reference designs — they are
// classic nominal-quarter-wave starting points (Macleod, Thin-Film Optical
// Filters, 5th ed., Ch. 3 single-layer AR / Ch. 6 quarter-wave stacks) that the
// user then refines with the optimizer. Each layer thickness is the geometric
// quarter-wave optical thickness (QWOT) at the reference wavelength λ0:
//
//        d = λ0 / (4 · n(λ0))
//
// using the nominal index n0 noted per material below. Because the materials in
// the catalog are dispersive, n0 is approximate at λ0 = 550 nm; the resulting
// design is a faithful *nominal* QW construction, explicitly a starting point.

// Nominal refractive indices at λ0 = 550 nm for the QWOT computation.
// (Approximate catalog values; used only to seed geometric thicknesses.)
const N0 = {
    MgF2: 1.385,   // Dodge 1984
    SiO2: 1.460,   // Malitson (fused silica)
    TiO2: 2.400,   // anatase, nominal
};

// Quarter-wave geometric thickness (nm) for material `mat` at λ0 (nm).
const qwot = (mat, lam0) => lam0 / (4 * N0[mat]);

let _uid = 0;
const layer = (material, thickness) => ({
    id: `sl-${Date.now()}-${_uid++}`,
    material,
    thickness: Math.round(thickness * 10) / 10,   // 0.1 nm precision
    locked: false,
});

// Shared base — a BK7 substrate in air, identical conventions to makeDefaultDesign.
function baseDesign(name, frontLayers, lam0 = 550) {
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    return {
        id: `design-sample-${ts}`,
        name,
        incidentMedium: 'Air',
        substrate: { material: 'BK7', thickness: 1.0 },   // mm
        exitMedium: 'Air',
        surfaceMode: 'front_only',
        mfEvalMode: 'side',
        frontLayers,
        backLayers: [],
        referenceWavelength: lam0,
        notes: '',
    };
}

// ── The samples ────────────────────────────────────────────────────────────────
//
// Each entry: { key, name, description, build() -> design }.  `name` /
// `description` are English fallbacks; the welcome screen localizes display text
// via t.welcome.samples[key] when present.

export function buildSampleDesigns() {
    return [
        {
            key: 'singleAR',
            name: 'Single-layer AR (MgF₂ on BK7)',
            description: 'Classic quarter-wave MgF₂ antireflection layer on a BK7 substrate — the textbook single-layer AR (Macleod Ch. 3).',
            build: () => baseDesign('Single-layer AR (MgF2)', [
                layer('MgF2', qwot('MgF2', 550)),
            ]),
        },
        {
            key: 'qwStack',
            name: 'QW high reflector (TiO₂/SiO₂)¹¹',
            description: 'Eleven-layer quarter-wave stack (TiO₂ high / SiO₂ low) on BK7 — a textbook dielectric mirror centred at 550 nm (Macleod Ch. 6).',
            build: () => {
                // (H L)×5 H, starting with H (TiO2) adjacent to the substrate.
                const layers = [];
                for (let i = 0; i < 5; i++) {
                    layers.push(layer('TiO2', qwot('TiO2', 550)));
                    layers.push(layer('SiO2', qwot('SiO2', 550)));
                }
                layers.push(layer('TiO2', qwot('TiO2', 550)));
                return baseDesign('QW high reflector', layers);
            },
        },
    ];
}
