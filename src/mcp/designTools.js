// Tools that open, create, save, show and edit the session's designs, set
// their merit functions and look up materials.

import { isAbsolute } from 'node:path';
import { designView } from './designStore.js';
import { object, num, int, str, bool, list, oneOf, DESIGN_ID, SIDE, INDEX } from './schemaParts.js';

const SURFACE_MODES = ['front_only', 'back_only', 'both_independent', 'symmetric'];

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
            description: 'A design in full: media, substrate, surface mode, the layers of each side (thickness in nm; the front listed from the incident medium inward, the back from the substrate outward) and its merit rows.',
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
            description: "Changes a layer's material, thickness or lock.",
            inputSchema: object({
                designId: DESIGN_ID, side: SIDE, index: INDEX,
                material: str('New material id'), thickness: num('New physical thickness in nm'), locked: bool('Keep the layer out of refinement'),
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
