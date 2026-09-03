/**
 * Coating library entry: a reusable layer stack with the conditions it was
 * designed for.
 *
 * An entry is one coating, not a design. It carries the stack, the incident
 * medium and substrate it was designed against, the wavelength bands, angle of
 * incidence and polarization it is specified for, and the specification the
 * stack is claimed to meet. A built-in entry also records where the design
 * came from.
 *
 * Layer order
 * -----------
 * `layers[0]` sits on the substrate and the last layer faces the incident
 * medium: deposition order, which is how a recipe reads and how the Design
 * Editor numbers its rows. A design stores its front coating the other way
 * round (`frontLayers[0]` touches the incident medium), so every conversion
 * between an entry and a design side goes through `entryDesign`,
 * `entryFromDesign` or `applyCoating.js`, never through a bare copy.
 *
 * Bands
 * -----
 * `bands` is a list of `[from, to]` nm ranges, one per design band. A visible
 * AR has one; a three-band AR has three. They are sorted by start wavelength
 * when the entry is made, and a claim's `band: i` counts in that sorted order,
 * not in the order they were written. `band` is the envelope from the first
 * start to the last end, used for the preview and for anything that needs a
 * single range. Headline numbers are computed per band.
 *
 * Classification
 * --------------
 * `type` is the family the entry belongs to (one of COATING_TYPES). `tags`
 * are keys from COATING_TAGS: spectral region, band structure, what it is
 * for, how it is built, the geometry and the substrate. The window filters on
 * type, tags, substrate, a wavelength inside a band, layer count and text.
 *
 * Materials
 * ---------
 * Layers, substrate and medium are material ids. Built-in ids resolve on every
 * installation. Any other id has to travel with its definition in `materials`,
 * in the same shape as the `materials` block of a .tfs file, and resolution goes
 * through `designMaterials.js` so an entry and a design cannot disagree about
 * what an id means.
 *
 * Specification
 * -------------
 * `spec` is a list of qualifier overrides (see synthesis/qualifiers.js). Angle
 * and polarization default to the entry's own; the wavelength range defaults
 * to the first band, and a claim about another band names it with `band: i`
 * or sets `lambdaStart`/`lambdaEnd` itself. A typical claim is
 * `{ kind: 'R_AVG', channel: 'R', cmp: 'le', target: 0.005 }`. Any qualifier
 * field may be set on a claim, for example `edgeSide: 'right'` on an
 * `EDGE_LAMBDA` claim whose window brackets two crossings. The claims are
 * evaluated with the same operands the Specification window and the merit
 * function use, so a number shown here is the number the optimizer would see.
 *
 * Whether an entry is sound at all (ids, thicknesses, bands, materials) is the
 * question `validateEntry.js` answers.
 */
import {
    designMaterialIds, designMaterialLookup, isBuiltinId, resolveDesignMaterial,
} from '../materials/designMaterials.js';
import { stripGetNK } from '../materials/catalogManager/persistence.js';
import { designRangeCoverage } from '../materials/materialRange.js';
import { evaluateSpectrum } from '../physics/thinFilmMath.js';
import { buildEvalContext, evaluateOperands, makeOperand } from '../physics/optimizer.js';
import { aggregateVerdict, evaluateQualifiers, makeQualifier } from '../synthesis/qualifiers.js';

/** The families. The type filter in the library window is built on this list. */
export const COATING_TYPES = [
    'ar', 'mirror', 'edge', 'bandpass', 'notch', 'beamsplitter', 'dichroic',
    'polarizer', 'lowE', 'chirped', 'nd', 'other',
];

/**
 * Tag vocabulary, grouped by what kind of thing a tag says: key to what the
 * key means. A tag is a fixed key so the filter groups entries that mean the
 * same thing; the meaning is shown as a tooltip and the group decides the
 * chip's color. Add a key here before using it in a built-in entry, with its
 * meaning, so a misspelt tag cannot quietly split the filter in two.
 */
export const COATING_TAG_GROUPS = {
    region: {
        uv: 'Ultraviolet, below 400 nm',
        visible: 'Visible, 400-700 nm',
        nir: 'Near infrared, 700-1400 nm',
        swir: 'Short-wave infrared, 1.4-3 um',
        mwir: 'Mid-wave infrared, 3-8 um',
        lwir: 'Long-wave infrared, 8-15 um',
    },
    band: {
        'single-wavelength': 'Specified at one wavelength',
        narrowband: 'A passband or stopband a few nm to some tens of nm wide',
        broadband: 'Specified over a wide band',
        'dual-band': 'Two separate design bands',
        'multi-band': 'Three or more design bands',
    },
    purpose: {
        laser: 'Laser lines and laser optics',
        telecom: 'Fibre telecom bands',
        cwdm: 'ITU-T G.694.2 CWDM grid',
        dwdm: 'ITU-T G.694.1 DWDM grid',
        imaging: 'Camera and imaging optics',
        display: 'Displays and the windows in front of them',
        solar: 'Solar spectrum, photovoltaics, solar control',
        glazing: 'Architectural glass',
        fluorescence: 'Fluorescence excitation and emission filters',
        raman: 'Raman spectroscopy',
        lidar: 'Lidar and rangefinders',
        'thermal-imaging': 'Thermal imaging optics',
        astronomy: 'Astronomical instruments',
    },
    function: {
        'short-pass': 'Passes short wavelengths, blocks long',
        'long-pass': 'Passes long wavelengths, blocks short',
        'high-reflector': 'Reflectance close to 100%',
        'partial-reflector': 'A set reflectance well below 100%',
        'output-coupler': 'Laser cavity output coupler',
        'non-polarizing': 'Same performance for s and p at oblique incidence',
        polarizing: 'Separates s and p',
        neutral: 'Flat across the band',
        'cold-mirror': 'Reflects visible, transmits infrared',
        'hot-mirror': 'Transmits visible, reflects near infrared',
        'heat-mirror': 'Transmits visible, reflects thermal infrared',
        'induced-transmission': 'Metal layer made transparent by matching dielectrics',
    },
    structure: {
        'single-layer': 'One layer',
        'quarter-wave': 'Quarter-wave stack at the reference wavelength',
        'v-coat': 'Two-layer V-shaped AR',
        'all-dielectric': 'Dielectric layers only',
        'metal-dielectric': 'Metal and dielectric layers',
        metal: 'Metal reflector',
        'protected-metal': 'Metal mirror with a protective dielectric overcoat',
        'enhanced-metal': 'Metal mirror with dielectric layers raising its reflectance',
        'fabry-perot': 'Single-cavity Fabry-Perot filter',
        'multi-cavity': 'Two or more coupled cavities',
        'tio2-sio2': 'TiO2 / SiO2 pair',
        'ta2o5-sio2': 'Ta2O5 / SiO2 pair',
        'hfo2-sio2': 'HfO2 / SiO2 pair',
        'nb2o5-sio2': 'Nb2O5 / SiO2 pair',
        'zns-mgf2': 'ZnS / MgF2 pair',
        'ge-zns': 'Ge / ZnS pair',
        silver: 'Silver layer',
        aluminium: 'Aluminium layer',
        gold: 'Gold layer',
    },
    geometry: {
        'normal-incidence': 'Specified at 0 degrees',
        oblique: 'Specified at an oblique angle',
        '45-degree': 'Specified at 45 degrees',
        'wide-angle': 'Holds over a range of angles',
    },
    substrate: {
        glass: 'Optical glass substrate',
        'fused-silica': 'Fused silica substrate',
        silicon: 'Silicon substrate',
        germanium: 'Germanium substrate',
        sapphire: 'Sapphire substrate',
        znse: 'Zinc selenide substrate',
    },
    context: {
        'laser-damage': 'Chosen with the laser damage threshold in mind',
        'low-loss': 'Low absorption and scatter',
        'uv-grade': 'Materials chosen for ultraviolet use',
        textbook: 'Design from a book or paper',
        synthesized: 'Designed in TFStudio against a stated specification',
    },
};

/** The whole vocabulary flat: tag key to its meaning. */
export const COATING_TAGS = Object.fromEntries(
    Object.values(COATING_TAG_GROUPS).flatMap(group => Object.entries(group)));

const TAG_GROUP_OF = Object.fromEntries(Object.entries(COATING_TAG_GROUPS)
    .flatMap(([group, tags]) => Object.keys(tags).map(tag => [tag, group])));

/** The group a tag belongs to (a key of COATING_TAG_GROUPS), or null for an unknown tag. */
export function tagGroupOf(tag) {
    return TAG_GROUP_OF[tag] || null;
}

export const POLARIZATIONS = ['avg', 's', 'p'];

/** Sample count of the preview spectrum: fine enough for a narrow bandpass, cheap enough to draw on every selection. */
export const PREVIEW_POINTS = 401;

// A preview reaches this far past each end of the band envelope, so the plot
// shows how the coating leaves its bands and not only how it behaves inside.
const PREVIEW_MARGIN = 0.3;

/** A single-word id: lower-case letters, digits and hyphens. */
export function slugify(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function finitePositive(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

// `bands` when given, else the single `band`, else the visible band.
function normalizeBands(raw) {
    const given = Array.isArray(raw.bands) && raw.bands.length > 0 ? raw.bands
        : Array.isArray(raw.band) ? [raw.band] : [];
    const bands = given
        .filter(pair => Array.isArray(pair) && pair.length === 2)
        .map(pair => [Number(pair[0]), Number(pair[1])])
        .sort((a, b) => a[0] - b[0]);
    return bands.length > 0 ? bands : [[400, 700]];
}

/**
 * Fill in defaults and normalize types, so an entry from a module, a file or a
 * dialog has the same shape everywhere else.
 */
export function makeCoatingEntry(raw = {}) {
    const layers = (raw.layers || []).map(layer => ({
        material: String(layer.material || ''),
        thickness: Number(layer.thickness),
    }));
    const bands = normalizeBands(raw);
    const band = [bands[0][0], Math.max(...bands.map(pair => pair[1]))];
    const preview = Array.isArray(raw.preview) && raw.preview.length === 2
        ? [Number(raw.preview[0]), Number(raw.preview[1])]
        : null;
    return {
        id: raw.id || slugify(raw.name),
        name: String(raw.name || ''),
        type: COATING_TYPES.includes(raw.type) ? raw.type : 'other',
        tags: Array.isArray(raw.tags) ? [...new Set(raw.tags.map(tag => String(tag)))] : [],
        use: String(raw.use || ''),
        limitations: String(raw.limitations || ''),
        source: String(raw.source || ''),
        incidentMedium: String(raw.incidentMedium || 'builtin:Air'),
        substrate: String(raw.substrate || 'builtin:BK7'),
        referenceWavelength: finitePositive(raw.referenceWavelength, (band[0] + band[1]) / 2),
        bands,
        band,
        aoi: Number.isFinite(Number(raw.aoi)) ? Number(raw.aoi) : 0,
        polarization: POLARIZATIONS.includes(raw.polarization) ? raw.polarization : 'avg',
        preview,
        layers,
        materials: raw.materials && typeof raw.materials === 'object' ? raw.materials : null,
        spec: Array.isArray(raw.spec) ? raw.spec : [],
        created: raw.created || null,
    };
}

/** The bands as one string: "400-700, 900-1700 nm". */
export function bandsText(entry) {
    return `${entry.bands.map(([from, to]) => `${from}-${to}`).join(', ')} nm`;
}

/**
 * Wavelength range the preview spectrum covers, in nm: the band envelope
 * widened by a margin, then pulled back to where every material of the entry
 * has data, so the plot never shows an extrapolation as if it were measured.
 */
export function previewRange(entry) {
    if (entry.preview) return entry.preview;
    const [from, to] = entry.band;
    const margin = (to - from) * PREVIEW_MARGIN;
    const widened = [Math.max(1, from - margin), to + margin];
    const { covered } = designRangeCoverage(entryDesign(entry), widened);
    if (!covered) return widened;
    const clamped = [Math.max(widened[0], covered[0]), Math.min(widened[1], covered[1])];
    return clamped[1] > clamped[0] ? clamped : widened;
}

// One design per entry object. Entries are immutable once built, so the design
// (and its material lookup cache) can be reused by every evaluation of it.
const designCache = new WeakMap();

/**
 * The entry as a single-surface design: its coating on its substrate, seen from
 * its incident medium. This is what every evaluation of an entry runs on.
 */
export function entryDesign(entry) {
    let design = designCache.get(entry);
    if (!design) {
        design = {
            id: `coating-${entry.id}`,
            name: entry.name,
            incidentMedium: entry.incidentMedium,
            exitMedium: 'builtin:Air',
            substrate: { material: entry.substrate, thickness: 1.0 },
            surfaceMode: 'front_only',
            mfEvalMode: 'side',
            referenceWavelength: entry.referenceWavelength,
            frontLayers: [...entry.layers].reverse().map((layer, i) => ({
                id: `e${i}`, material: layer.material, thickness: layer.thickness, locked: false,
            })),
            backLayers: [],
            ...(entry.materials ? { materials: entry.materials } : {}),
        };
        designCache.set(entry, design);
    }
    return design;
}

/** Every material id the entry references: medium, substrate and layers. */
export function entryMaterialIds(entry) {
    return designMaterialIds(entryDesign(entry));
}

/** Physical thickness of the stack, nm. */
export function totalThickness(entry) {
    return entry.layers.reduce((sum, layer) => sum + (Number(layer.thickness) || 0), 0);
}

/**
 * T, R and A of the coating over the preview range, as fractions.
 * Returns `{ error }` when a material cannot be resolved.
 */
export function entrySpectrum(entry, points = PREVIEW_POINTS) {
    const design = entryDesign(entry);
    try {
        const resolve = designMaterialLookup(design);
        const [lambdaStart, lambdaEnd] = previewRange(entry);
        const spectrum = evaluateSpectrum(
            {
                lambdaStart, lambdaEnd, lambdaStep: (lambdaEnd - lambdaStart) / (points - 1),
                theta: entry.aoi, polarization: entry.polarization,
            },
            resolve(design.incidentMedium),
            resolve(design.substrate.material),
            design.frontLayers.map(layer => ({ material: resolve(layer.material), thickness: layer.thickness })),
        );
        return { lambda: spectrum.lambda, T: spectrum.T, R: spectrum.R, A: spectrum.A };
    } catch (err) {
        return { error: err.message };
    }
}

// Metric name → operand type. Averages and band extremes, through the same
// operands the merit function evaluates.
const METRIC_OPERANDS = [
    ['rAvg', 'RAV'], ['tAvg', 'TAV'], ['aAvg', 'AAV'],
    ['rMax', 'RMX'], ['rMin', 'RMN'], ['tMax', 'TMX'], ['tMin', 'TMN'],
];

/** The metric keys `entryMetrics` reports for each band, in display order. */
export const METRIC_KEYS = METRIC_OPERANDS.map(([key]) => key);

/**
 * Headline numbers for judging an entry without opening it: for each design
 * band the averages and extremes of T, R and A (fractions), plus layer count
 * and total thickness (nm). Returns `{ error }` when a material cannot be
 * resolved.
 */
export function entryMetrics(entry) {
    const design = entryDesign(entry);
    try {
        const ctx = buildEvalContext(design, designMaterialLookup(design));
        const operands = entry.bands.flatMap(([lambdaStart, lambdaEnd]) => METRIC_OPERANDS.map(([, type]) =>
            makeOperand({
                type, lambdaStart, lambdaEnd, aoi: entry.aoi, pol: entry.polarization, target: 0, weight: 1,
            })));
        const values = evaluateOperands(operands, ctx);
        const bands = entry.bands.map((range, b) => {
            const metrics = { range };
            METRIC_OPERANDS.forEach(([key], i) => { metrics[key] = values[b * METRIC_OPERANDS.length + i]; });
            return metrics;
        });
        return { layerCount: entry.layers.length, totalThickness: totalThickness(entry), bands };
    } catch (err) {
        return { error: err.message };
    }
}

/**
 * The entry's claims as full qualifiers: angle and polarization from the
 * entry, the wavelength range from the band the claim names (the first band
 * when it names none) unless the claim sets its own.
 */
export function entryQualifiers(entry) {
    return entry.spec.map((claim, i) => {
        const { band: bandIndex, ...overrides } = claim;
        const which = Math.min(Math.max(Number(bandIndex) || 0, 0), entry.bands.length - 1);
        const [lambdaStart, lambdaEnd] = entry.bands[which];
        return makeQualifier({
            lambdaStart, lambdaEnd, aoi: entry.aoi, pol: entry.polarization,
            ...overrides,
            id: `${entry.id}-spec-${i}`,
            enabled: true,
        });
    });
}

/**
 * Evaluate the entry's specification. Each result is what the Specification
 * window shows for a qualifier; `verdict` aggregates them.
 */
export function entrySpecResults(entry) {
    const design = entryDesign(entry);
    const qualifiers = entryQualifiers(entry);
    try {
        const results = evaluateQualifiers(qualifiers, design, designMaterialLookup(design));
        return { qualifiers, results, verdict: aggregateVerdict(results) };
    } catch (err) {
        return { qualifiers, results: [], verdict: aggregateVerdict([]), error: err.message };
    }
}

/**
 * An entry built from one side of a design.
 *
 * The coating is stored as seen from its own incident medium: the front stack
 * reversed into deposition order, the back stack as stored (substrate first),
 * with the exit medium as the medium it faces. Non-built-in materials are
 * embedded from the design so the entry resolves on any installation.
 *
 * @param {object} design
 * @param {'front'|'back'} side
 * @param {object} meta   name, type, tags, use, limitations, band or bands, aoi, polarization, spec
 */
export function entryFromDesign(design, side, meta = {}) {
    const back = side === 'back';
    const stored = back ? (design.backLayers || []) : [...(design.frontLayers || [])].reverse();
    const layers = stored.map(({ material, thickness }) => ({ material, thickness: Number(thickness) }));
    const incidentMedium = back ? (design.exitMedium || 'Air') : (design.incidentMedium || 'Air');
    const substrate = design.substrate?.material || 'BK7';

    const materials = {};
    for (const id of new Set([incidentMedium, substrate, ...layers.map(layer => layer.material)])) {
        if (!id || isBuiltinId(id)) continue;
        const { material, status } = resolveDesignMaterial(design, id);
        if (status !== 'missing') materials[id] = stripGetNK(material);
    }

    return makeCoatingEntry({
        ...meta,
        id: meta.id || slugify(meta.name),
        source: meta.source || `Saved from design "${design.name}", ${side} coating`,
        incidentMedium, substrate,
        referenceWavelength: design.referenceWavelength,
        layers,
        materials: Object.keys(materials).length > 0 ? materials : null,
        created: meta.created || new Date().toISOString(),
    });
}
