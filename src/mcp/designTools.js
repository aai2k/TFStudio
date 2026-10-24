// Tools that open, create, save, show and edit the session's designs, set
// their merit functions and specifications, and look up materials.

import { isAbsolute } from 'node:path';
import { resolveEvalMode } from '../utils/physics/optimizer.js';
import { DEFAULT_REFINE_METHOD } from '../utils/optimizers/index.js';
import { DESIGN_CLEANER_DEFAULTS } from '../components/windows/optimization/designCleaner/sessionState.js';
import { MAX_DECIMALS, PERTURB_DEFAULT_PERCENT, QUANTIZE_DEFAULTS } from '../components/windows/design/designEditor/layerTools.js';
import { designView } from './designStore.js';
import { object, num, int, str, bool, list, oneOf, DESIGN_ID, SIDE, INDEX } from './schemaParts.js';

const SURFACE_MODES = ['front_only', 'back_only', 'both_independent', 'symmetric'];
const QUANTIZE_MODES = Object.keys(QUANTIZE_DEFAULTS.value);
const EDITED_SIDE = oneOf(['front', 'back'], "The coating changed: 'front' faces the incident medium, 'back' the exit medium. Default: the front, or the back of a back_only design. A side the Design Editor does not let you edit is refused, as in insertLayer");

// designDifferences in short: its verdict and setup, and how many layers
// differ on each side with the largest thickness change among them.
function differenceSummary({ same, setup, layers }) {
    const count = side => layers.filter(layer => layer.side === side).length;
    const changed = layers.filter(layer => layer.change !== null);
    const largest = changed.reduce((best, layer) => (best && Math.abs(best.change) >= Math.abs(layer.change) ? best : layer), null);
    return {
        same, setup, layersDiffering: { front: count('front'), back: count('back') },
        largestChange: largest && { side: largest.side, number: largest.number, change: largest.change },
    };
}

// The search the edgeFilter and applyEdgeFilter tools share, the Edge Filter window's inputs.
const EDGE_SEARCH = {
    pass: oneOf(['short', 'long'], "A shortwave or a longwave pass. Default 'short'"),
    edge: num("Edge wavelength in nm. Default: the design's reference wavelength"),
    angle: num('Angle of incidence in degrees in the incident medium, 0 <= angle < 90. Default 0'),
    a: str('Material A, by id. Default: the lowest index of the front layers, or SiO2 when the front has fewer than two materials'),
    b: str('Material B, by id. Default: the highest index of the front layers, or TiO2'),
    incident: str("The medium the light arrives from, by id. Default: the design's incident medium"),
    lower: num('The first a searched, quarter waves, from 0. Default 0.1'),
    upper: num('The last a searched, quarter waves, above lower and up to 2. Default 1'),
    step: num('The step of a, 0.0001 or more; at an angle above 0 the finest step over the widest range takes minutes. Default 0.05'),
    periods: int('The number of periods the formula repeats. Default 10'),
};

// The fields an edit tool passes on to the API: its arguments without designId.
const editArgs = args => Object.fromEntries(Object.entries(args).filter(([key]) => key !== 'designId'));

// A file path the tools take. It must be absolute: the folder the server runs
// in depends on how the client started it, so a relative path could name a
// file anywhere.
function tfsPath(path) {
    if (!isAbsolute(path)) throw new Error(`path is an absolute path, not '${path}'`);
    if (!/\.tfs$/i.test(path)) throw new Error('path names a .tfs file');
    return path;
}

export function designTools({ api, store }) {
    const view = (id, options) => designView(id, store.get(id), options);
    const edit = (id, change) => {
        store.set(id, change(store.get(id)));
        return view(id);
    };

    return [
        {
            name: 'openDesign', title: 'Open a design file',
            description: 'Opens a TFStudio design file (.tfs) as File > Open does and adds it to the session. Answers with the design: its id, media, substrate, surface mode and layers.',
            inputSchema: object({ path: str('Absolute path of the .tfs file') }, ['path']),
            run: ({ path }) => view(store.add(api.openDesign(tfsPath(path)))),
        },
        {
            name: 'newDesign', title: 'Create a design',
            description: 'Creates a design as File > New does, a bare BK7 substrate 1 mm thick in air with no layers, with any of the given settings changed, and adds it to the session.',
            inputSchema: object({
                name: str('The design name'),
                incidentMedium: str('Material id of the incident medium, default Air'),
                exitMedium: str('Material id of the exit medium, default Air'),
                substrate: str('Material id of the substrate, default BK7'),
                substrateThicknessMm: num('Substrate thickness in mm, default 1'),
                surfaceMode: oneOf(SURFACE_MODES, "Which coatings the design has: 'front_only' (default), 'back_only', 'both_independent', or 'symmetric' (the back mirrors the front)"),
                referenceWavelength: num('Reference wavelength in nm, default 550'),
            }),
            run: args => view(store.add(api.newDesign(args))),
        },
        {
            name: 'setDesignSetup', title: 'Change the setup',
            description: "Changes a design's name, media, substrate and its thickness, which sides it has, how a one-sided design is scored or its reference wavelength, as the Design Editor's fields do. Making it symmetric gives it the mirror of its front as its back. A new referenceWavelength rescales every layer to keep its quarter-wave count, as the Design Editor's λ0 field does. Answers with the design.",
            inputSchema: object({
                designId: DESIGN_ID, name: str('The design name'),
                incidentMedium: str('Material id of the incident medium'), exitMedium: str('Material id of the exit medium'),
                substrate: str('Material id of the substrate'), substrateThicknessMm: num('Substrate thickness in mm'),
                surfaceMode: oneOf(SURFACE_MODES, "'front_only', 'back_only', 'both_independent' or 'symmetric'"),
                mfEvalMode: oneOf(['side', 'total'], "How a one-sided design is scored: 'side' on its coated side alone, 'total' as the whole part with the substrate and the bare side"),
                referenceWavelength: num('Reference wavelength in nm'),
            }, ['designId']),
            run: args => edit(args.designId, d => api.setDesignSetup(d, editArgs(args))),
        },
        {
            name: 'saveDesign', title: 'Save a design file',
            description: 'Writes a design to a .tfs file as File > Save does, with the materials it uses embedded, so the app opens it. An existing file is written over only with overwrite true.',
            inputSchema: object({ designId: DESIGN_ID, path: str('Absolute path of the .tfs file to write'), overwrite: bool('Write over an existing file. Default false') }, ['designId', 'path']),
            run: ({ designId, path, overwrite = false }) => {
                api.saveDesign(store.get(designId), tfsPath(path), { overwrite });
                return { saved: path, designId };
            },
        },
        {
            name: 'showDesign', title: 'Show a design',
            description: 'A design in full: media, substrate, surface mode, the layers of each side (thickness in nm; the front listed from the incident medium inward, the back from the substrate outward), its merit rows, and its specification, the checks as the design holds them, each with its id.',
            inputSchema: object({ designId: DESIGN_ID }, ['designId']),
            run: ({ designId }) => view(designId, { rows: true }),
        },
        {
            name: 'listDesigns', title: 'List the designs',
            description: 'The designs in this session, with their ids, names and layer counts.',
            inputSchema: object({}),
            run: () => ({
                designs: store.entries().map(([designId, d]) => ({
                    designId, name: d.name ?? null, frontLayers: d.frontLayers.length, backLayers: d.backLayers.length,
                })),
            }),
        },
        {
            name: 'copyDesign', title: 'Copy a design',
            description: 'Adds a copy of a design to the session under a new id, to try a change while keeping the original.',
            inputSchema: object({ designId: DESIGN_ID }, ['designId']),
            run: ({ designId }) => view(store.add(JSON.parse(JSON.stringify(store.get(designId))))),
        },
        {
            name: 'insertLayer', title: 'Insert a layer',
            description: 'Inserts a layer into a design. In symmetric mode edit the front; the back follows it. A side the design does not evaluate (the back of a front_only design scored on its side alone, the front of a back_only one) is refused, as in the Design Editor.',
            inputSchema: object({
                designId: DESIGN_ID, side: SIDE,
                index: int('Where the layer goes, counted as the design stores the side (see showDesign). Default: the end, next to the substrate on the front, outermost on the back'),
                material: str('Material id, as findMaterials lists it'),
                thickness: num('Physical thickness in nm'),
                locked: bool('Keep this layer out of refinement. Default false'),
            }, ['designId', 'material', 'thickness']),
            run: args => edit(args.designId, d => api.insertLayer(d, editArgs(args))),
        },
        {
            name: 'deleteLayer', title: 'Delete a layer',
            description: 'Deletes a layer from a design.',
            inputSchema: object({ designId: DESIGN_ID, side: SIDE, index: INDEX }, ['designId', 'index']),
            run: args => edit(args.designId, d => api.deleteLayer(d, editArgs(args))),
        },
        {
            name: 'setLayer', title: 'Change a layer',
            description: "Changes a layer's material, thickness or lock. The thickness can be given as qwot instead, in quarter waves, as the Design Editor's QW column takes it; a layer whose material resolves to nothing or has n of 0 or less at the reference wavelength has no quarter wave and is refused.",
            inputSchema: object({
                designId: DESIGN_ID, side: SIDE, index: INDEX,
                material: str('New material id'), thickness: num('New physical thickness in nm'),
                qwot: num("New thickness as a quarter-wave optical thickness, 4nd/λ0 with n the layer's material's index at the design's reference wavelength λ0 (the new material's, with material); not with thickness"),
                locked: bool('Keep the layer out of refinement'),
            }, ['designId', 'index']),
            run: args => edit(args.designId, d => api.setLayer(d, editArgs(args))),
        },
        {
            name: 'stackFromFormula', title: 'Build a stack from a formula',
            description: "Replaces one side's layers with a stack formula, as the Stack Formula dialog builds it: letters are quarter waves at the reference wavelength, so '(HL)^5 H' is an 11-layer quarter-wave mirror and '2L' a half wave. The formula is read from the substrate outward, the first letter being the layer on the substrate, as the dialog reads it by default. 'Air | ... | BK7' also sets the outer medium (the incident medium on the front, the exit medium on the back) and the substrate. Filling the side a one-sided design does not evaluate makes it two-sided, as the dialog does. Adjacent letters of one material stay separate layers, as the dialog builds them, so write '0.5L (HL)^13 H 0.5L' rather than '(0.5L H 0.5L)^14'.",
            inputSchema: object({
                designId: DESIGN_ID, side: SIDE, formula: str("The stack formula, such as '(HL)^5 H' or 'Air | 0.5L H 0.5L | BK7'"),
                symbols: { type: 'object', additionalProperties: { type: 'string' }, description: 'Material id of each letter, such as {"H": "Ta2O5", "L": "SiO2"}. H is TiO2 and L is SiO2 unless given' },
                referenceWavelength: num("Wavelength in nm at which a letter is a quarter wave. Default: the design's reference wavelength, which the formula then records"),
                startFromSubstrate: bool('Read the formula from the substrate outward. Default true; false reads it from the outer medium inward'),
            }, ['designId', 'formula']),
            run: args => edit(args.designId, d => api.stackFromFormula(d, editArgs(args))),
        },
        {
            name: 'cleanDesign', title: 'Clean a design',
            description: `Cleans a design's stack as the Design Cleaner window does: adjacent layers of one material merged into one, and layers thinner than minThickness taken out, in passes, since taking a layer out can leave two layers of one material touching. Locked layers are never merged or taken out, and a symmetric design's front is cleaned and its back made its mirror. Answers with removed and merged, the counts; operations, in the order made, the front's first, each { side, kind ('remove' or 'merge'), number, material, thickness (nm; for a layer taken out its thickness then, counting any layer merged into it before; for a merge what it adds to the layer it is merged into), mergedInto (for a merge the number of that layer, otherwise null) }, number counting a side's layers from 1 next to the substrate in the design before the cleanup, unlike the index showDesign and the layer tools take; and layersBefore and layersAfter, { front, back }, the layer count of each side. The merit usually worsens a little. To do what the window's Re-optimize does, add an MNT row with target minThickness to the design's rows through setMerit and refine with method ${DEFAULT_REFINE_METHOD} and maxIter ${DESIGN_CLEANER_DEFAULTS.reoptIters}; the layers then end on the thicknesses the window's pass gives. The window's pass keeps each layer at minThickness or more, and sqp keeps each layer inside the MNT row, while without that row refine keeps layers at 1 nm or more. A design with no layers is refused.`,
            inputSchema: object({
                designId: DESIGN_ID,
                minThickness: num(`The thinnest layer kept, nm; a thinner one is taken out, and 0 takes none out. Default ${DESIGN_CLEANER_DEFAULTS.dMin}`),
                mergeAdjacent: bool(`Merge adjacent layers of one material. Default ${DESIGN_CLEANER_DEFAULTS.mergeAdjacent}`),
                cleanBack: bool(`Clean the back too, also on a design scored on its front alone, whose back the layer tools refuse to change; false cleans the front alone, also on a design coated on the back alone. A symmetric design's back follows its front either way. Default ${DESIGN_CLEANER_DEFAULTS.cleanBack}`),
            }, ['designId']),
            run: ({ designId, ...options }) => {
                const { design, ...report } = api.cleanDesign(store.get(designId), options);
                store.set(designId, design);
                return { designId, ...report };
            },
        },
        {
            name: 'scaleThicknesses', title: 'Scale the thicknesses',
            description: "Multiplies the thickness of every unlocked layer of one side by factor. Locked layers stay as they are, and a symmetric design's back follows its front. Answers with the design.",
            inputSchema: object({
                designId: DESIGN_ID, factor: num('What each thickness is multiplied by, above 0: 1.02 makes every unlocked layer 2% thicker'), side: EDITED_SIDE,
            }, ['designId', 'factor']),
            run: args => edit(args.designId, d => api.scaleThicknesses(d, editArgs(args))),
        },
        {
            name: 'quantize', title: 'Round the thicknesses',
            description: `Rounds the unlocked layers of one side as the Design Editor's Round / quantize dialog does: to a number of decimal places of a nm, to the nearest whole number of controller steps, or to the nearest whole number of a QWOT increment at the design's reference wavelength. Locked layers stay as they are, and a symmetric design's back follows its front. A layer thinner than half a step rounds to 0 nm, as in the dialog; in qwot mode a layer whose material has no quarter wave stays as it is. Answers with the design.`,
            inputSchema: object({
                designId: DESIGN_ID,
                mode: oneOf(QUANTIZE_MODES, `'decimals', 'step' (a controller step in nm) or 'qwot' (a QWOT increment). Default '${QUANTIZE_DEFAULTS.mode}'`),
                value: num(`The decimal places (a whole number from 0 to ${MAX_DECIMALS}), the step in nm, or the QWOT increment, as the mode takes. Default ${QUANTIZE_MODES.map(mode => `${QUANTIZE_DEFAULTS.value[mode]} for ${mode}`).join(', ')}`),
                side: EDITED_SIDE,
            }, ['designId']),
            run: args => edit(args.designId, d => api.quantize(d, editArgs(args))),
        },
        {
            name: 'perturb', title: 'Perturb the thicknesses',
            description: "Gives the unlocked layers of one side random thickness errors, as the Design Editor's Perturb dialog does: each thickness is multiplied by 1 + k * percent / 100, with k drawn for each layer uniformly from -1 to 1. Locked layers stay as they are, and a symmetric design's back follows its front. The same seed, design and percent give the same errors. Answers with the design and the seed the draws started from.",
            inputSchema: object({
                designId: DESIGN_ID,
                percent: num(`The largest error, plus or minus % of each thickness, above 0 and up to 100. Default ${PERTURB_DEFAULT_PERCENT}`),
                side: EDITED_SIDE,
                seed: int('The number the draws start from, a whole number from 1 to 2^32 - 1. Default: a fresh one'),
            }, ['designId']),
            run: ({ designId, ...options }) => {
                const { design, seed } = api.perturb(store.get(designId), options);
                store.set(designId, design);
                return { ...view(designId), seed };
            },
        },
        {
            name: 'flipLayers', title: 'Flip a side',
            description: "Reverses the layer order of one side on the substrate, as the Design Editor's Invert button does: the layer next to the substrate becomes the outermost. A symmetric design's back follows its front. Answers with the design.",
            inputSchema: object({ designId: DESIGN_ID, side: EDITED_SIDE }, ['designId']),
            run: args => edit(args.designId, d => api.flipLayers(d, editArgs(args))),
        },
        {
            name: 'copySide', title: 'Copy one side to the other',
            description: "Copies the layers of one side onto the other, as the Design Editor's Copy to back and Copy to front do: the other side gets the same stack outward from the substrate, and its own layers are replaced. The surface mode stays as it was, so make the design both_independent with setDesignSetup to coat both. Copying from a side the Design Editor does not let you edit is refused. Answers with the design.",
            inputSchema: object({ designId: DESIGN_ID, from: oneOf(['front', 'back'], 'The side copied') }, ['designId', 'from']),
            run: args => edit(args.designId, d => api.copySide(d, editArgs(args))),
        },
        {
            name: 'designDifferences', title: 'Compare two designs',
            description: "What differs between two designs of the session: their setup as setDesignSetup sets it, but the name, and their layers, compared side by side by number from 1 next to the substrate, so a layer added near the substrate shows every layer outside it as changed. Values are compared exactly; merit rows, specification checks, the cone and carried materials are not compared. Answers with same, true when nothing compared differs; setup, each setting that differs as { setting, before, after }, before in designId and after in otherId; and the count of layers that differ on each side, with the largest thickness change. With values true, also layers: each layer that differs as { side, number, before, after, change }, before and after { material, thickness, locked } or null where that design has no such layer, change the thickness after less before in nm, or null.",
            inputSchema: object({
                designId: DESIGN_ID, otherId: str('The id of the design compared with it'),
                values: bool('Answer with every layer that differs too. Default false'),
            }, ['designId', 'otherId']),
            run: ({ designId, otherId, values = false }) => {
                const found = api.designDifferences(store.get(designId), store.get(otherId));
                return values ? { designId, otherId, ...found } : { designId, otherId, ...differenceSummary(found) };
            },
        },
        {
            name: 'edgeFilter', title: 'Search an edge filter',
            description: "The periods of a non-polarizing edge filter, as the Edge Filter window searches them: the five-layer period (aA bB cA bB aA) or (aB bA cB bA aB) whose s and p zone edges meet at the edge wavelength at the angle of incidence, a, b and c in quarter waves at the edge wavelength, ranked by the rejection band (the narrower of the s and p zones), then the pass region. At 0 degrees it gives the quarter-wave period both ways round, c null. A and B are taken as lossless at their real indices at the edge wavelength. Answers with pass, edge, angle, materials and indices ({ a, b, incident }: the ids searched and their real indices at the edge), absorbing (the ids of A and B with k above 0 there), periods, count (how many periods were found) and best, the first: { outer ('A' or 'B', the material of the outer and centre layers), a, b, c, sigma (N11 at the edge, +1 or -1), zoneS, zoneP and passWidth (nm; passWidth null where the pass region does not end), formula (the filter in Stack Formula's syntax, H the higher index of A and B) }, or null; with values true, also solutions, every period in that shape, best first. applyEdgeFilter puts one in.",
            inputSchema: object({ designId: DESIGN_ID, ...EDGE_SEARCH, values: bool('Answer with every period too. Default false') }, ['designId']),
            run: ({ designId, values = false, ...options }) => {
                const { solutions, ...found } = api.edgeFilter(store.get(designId), options);
                return { designId, ...found, count: solutions.length, ...(values ? { solutions } : { best: solutions[0] ?? null }) };
            },
        },
        {
            name: 'applyEdgeFilter', title: 'Put an edge filter in',
            description: "Puts an edge filter in a design, as the Edge Filter window's Replace or Append puts a period it lists in: the search is edgeFilter's with the same arguments, and the solution chosen is built through Stack Formula with each pair of touching outer layers joined. Replace puts the filter in place of the side's layers, makes the edge wavelength the reference wavelength, and makes the medium searched the incident medium of a front filter or the exit medium of a back one; append adds the layers outside the side's own. Filling the side a one-sided design does not coat makes it both_independent when its other side has layers, and front_only or back_only, the filled side, when it has none, as the window does. Answers with the design.",
            inputSchema: object({
                designId: DESIGN_ID, ...EDGE_SEARCH,
                solution: int("Which period, its place in edgeFilter's list from 0, the best. Default 0"),
                side: oneOf(['front', 'back'], "The side it goes on. Default: the front, or the back of a back_only design; a symmetric design takes the front"),
                mode: oneOf(['replace', 'append'], "Default 'replace'"),
            }, ['designId']),
            run: args => edit(args.designId, d => api.applyEdgeFilter(d, editArgs(args))),
        },
        {
            name: 'setMerit', title: 'Set the merit function',
            description: "Replaces a design's merit function with the given rows and answers with its value, as the Merit Function Editor shows it. Each row takes the editor's columns: type (the operand code: TAV, RAV, AAV band averages, T, R, A at one wavelength, TMN, TMX, RMN, RMX worst case over a band, TGT, RGT spectral targets, MNT, MXT layer thickness bounds in nm, TT total thickness and more; https://docs.tfstudio.xyz/design/operands/ lists them all), lambdaStart and lambdaEnd in nm, aoi in degrees, pol ('avg', 's' or 'p'), target, weight and enabled. Targets for T, R and A are fractions of 1, where the editor shows percent. MNT and MXT take lambdaStart and lambdaEnd as the layers they bound, counted from the substrate (default 1 to 1000), and a target in nm; TT and STR take cmp: 'eq' (the default), 'le' or 'ge'. In refine TT and STR are penalties, and so are MNT and MXT with every method but sqp, which keeps each layer inside them; with a penalty a layer can end past its bound; ge, structural and deep keep their layers at or above the strictest MNT unless given dMin. A band average is taken over a grid spaced from the design's fringes, so it can differ slightly from the mean of a spectrum over the same band; a feature narrower than the grid's step, such as a cavity's pass band, falls between its points and the average can be off by a large factor, so give such a band a flag, 1 to 4 for a grid no coarser than 1, 0.1, 0.01 or 0.001 nm, or score it with a worst-case row. The same flag on TMX, RMN, AMX and MXW* rows sets the step they search for a peak at, 1 nm when absent. A field no operand has, or a value a field cannot take, is refused. showDesign on an opened design shows the rows it holds.",
            inputSchema: object({ designId: DESIGN_ID, rows: list({ type: 'object' }, 'The merit rows, each with at least a type') }, ['designId', 'rows']),
            run: ({ designId, rows }) => {
                const rated = api.setMerit(store.get(designId), rows);
                const value = api.merit(rated);
                store.set(designId, rated);
                return { designId, ...value };
            },
        },
        {
            name: 'setSpecification', title: 'Set the specification',
            description: "Replaces a design's specification, the pass or fail checks of the Specification window, with the given checks, and answers with the verdict checkSpecification gives; an empty list clears it. Each check takes the window's fields: kind (T_AT, R_AT, A_AT at the wavelength lambda; T_AVG, R_AVG, A_AVG band averages; MIN_MAX the lowest or highest value over a band; INTEGRAL a weighted average such as Tvis; CENTRAL_LAMBDA the wavelength of a peak or dip; FWHM the width of the peak at level; EDGE_LAMBDA where the curve crosses level of the peak; THICKNESS_BUDGET the total thickness in nm and LAYER_COUNT the number of layers of side, 'front', 'back' or 'both', by default the side the design coats; PPEF the peak-to-peak error in dB against the measured curve curveId), lambdaStart and lambdaEnd in nm, aoi in degrees, pol ('avg', 's' or 'p'), channel ('T', 'R' or 'A') and direction ('max' or 'min') for the kinds that read them, cmp ('ge' or 'le' with target, 'eq' within target plus or minus tol, 'between' lo to hi), label and enabled. T, R and A are fractions of 1, where the window shows percent. level, 0 to 1, is the fraction of the band's highest value the curve crosses, or with direction 'min' the fraction of the way from its lowest value up to 1. INTEGRAL takes presetKey, one of Tvis, Rvis, Avis, Tsol, Rsol, Asol, TUV, RUV, TNIR, RNIR, which sets its channel, band, source and detector, or source and detector of its own. flag is the window's Step: 1 to 4 on a band average or INTEGRAL for a grid no coarser than 1, 0.1, 0.01 or 0.001 nm, the default being spaced from the design's fringes; 2 to 4 on FWHM, EDGE_LAMBDA, and MIN_MAX or CENTRAL_LAMBDA of the highest T or A or the lowest R, for a search at 0.1, 0.01 or 0.001 nm, the default being 1 nm; the other checks, MIN_MAX or CENTRAL_LAMBDA of the lowest T or A or the highest R among them, have no Step and take none. A check given without an id is a new one: a field it leaves out takes the value a check added in the window starts with, and a field no check has, or a value a field cannot take, is refused, the design staying as it was. A check given with an id, as showDesign lists the checks a design holds, is kept as it is given, so to change one check of a design, give the others as showDesign lists them and the changed one without its id; a thickness budget or layer count saved without a side still adds up both sides, as the window reads it, and keeps that when changed only if given side 'both'. An empty list answers with no rows, passed false and total 0.",
            inputSchema: object({ designId: DESIGN_ID, checks: list({ type: 'object' }, 'The checks, each with at least a kind') }, ['designId', 'checks']),
            run: ({ designId, checks }) => {
                const specified = api.setSpecification(store.get(designId), checks);
                const verdict = checks.length ? api.checkSpecification(specified)
                    : { passed: false, passing: 0, total: 0, mode: resolveEvalMode(specified), rows: [] };
                store.set(designId, specified);
                return { designId, ...verdict };
            },
        },
        {
            name: 'findMaterials', title: 'Find materials',
            description: "Catalog materials whose id or name holds the query, any case: the built-in catalog and, when the server runs on a data folder, the user's catalogs. The id is what a layer or a medium names.",
            inputSchema: object({ query: str('Part of a material id or name, such as "TiO2" or "fused"') }, ['query']),
            run: ({ query }) => ({ materials: api.findMaterials(query) }),
        },
        {
            name: 'materialNK', title: 'Optical constants',
            description: "n and k of a material at each wavelength, the range in nm the material's data cover (rangeNm, null when it declares none), and which wavelengths fall outside it, where n and k are held at the edge value or extrapolated. With designId, a material the design carries resolves as it does in that design.",
            inputSchema: object({ material: str('Material id'), wavelengths: list({ type: 'number' }, 'Wavelengths in nm'), designId: DESIGN_ID }, ['material', 'wavelengths']),
            run: ({ material, wavelengths, designId }) => api.materialNK(material, wavelengths, designId ? store.get(designId) : null),
        },
    ];
}
