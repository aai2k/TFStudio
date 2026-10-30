// Tools for the coating files of Zemax OpticStudio and CODE V: a design's side
// written as the Zemax Coatings and CODE V Coatings windows' Export tabs write
// it, a file read as the windows list it, and a file's layers put on a design
// as their imports put them.

import { designView } from './designStore.js';
import { spectrumPath } from './analysisTools.js';
import { object, num, str, bool, list, oneOf, DESIGN_ID } from './schemaParts.js';

const SIDE = oneOf(['front', 'back'], 'The coated side. Default: the front, or the back of a back_only design');
const OVERWRITE = bool('Write over a file that is already there. Default false');
const FROM = num('First wavelength of the file\'s tables, nm. Default 400');
const TO = num('Last wavelength of the file\'s tables, nm, above from. Default 800');
const IMPORT_TEXT = "The side's layers are replaced; the design keeps its media and substrate. Each layer's material takes the id an import in the app gives it, in the catalog named after the file, and the design carries its definition, so it computes and saves with it; nothing is written to a catalog. A file the app never imported draws a new random part of the catalog id on each import.";

// A list's span, or nulls for an empty one.
const span = values => (values.length ? { from: Math.min(...values), to: Math.max(...values) } : { from: null, to: null });

// A Zemax file as the reader answers without values: each MATE record's names
// and its point count, each COAT's name, type and layer count.
function zemaxSummary(read) {
    return {
        fileName: read.fileName,
        materials: read.materials.map(({ wavelength, n: _n, k: _k, ...material }) => ({ ...material, points: wavelength.length, ...span(wavelength) })),
        coatings: read.coatings.map(({ layers, ...coating }) => ({ ...coating, layerCount: layers ? layers.length : null })),
    };
}

// A CODE V file as the reader answers without values: its wavelengths and layers counted.
function codevSummary({ wavelengths, layers, ...read }) {
    return { ...read, wavelengthCount: wavelengths.length, ...span(wavelengths), layerCount: layers.length };
}

export function coatingTools({ api, store }) {
    return [
        {
            name: 'saveZemaxCoating', title: 'Write a Zemax COATING.DAT',
            description: "Writes one side of a design to a Zemax OpticStudio COATING.DAT file as the Zemax Coatings window's Export tab writes it: a MATE record for each material, n and k sampled every step nm from from to to, wavelengths in um and the imaginary index as -k, then one COAT record of the side's layers, incident medium side first. The back is written from the exit medium to the substrate, so on either face the file means air to glass. A file that is there is refused unless overwrite is true. Answers with path.",
            inputSchema: object({
                designId: DESIGN_ID,
                path: str('Absolute path of the file to write'),
                name: str("The COAT record's name, written in capitals, every character but letters, digits, _ and . as _, and cut to 32 characters. Default 'TFSTUDIO_DESIGN'"),
                thickness: oneOf(['absolute', 'relative'], "'absolute', physical thickness in um, or 'relative', optical thickness in waves of wavelength. Default 'absolute'"),
                wavelength: num('Reference wavelength for relative thicknesses, nm. Default 550'),
                from: FROM, to: TO,
                step: num('Step of the MATE tables, nm. Default 25'),
                scope: oneOf(['used', 'all'], "'used', the materials the design uses, media and substrate included, or 'all', every material of the catalogs as well. Default 'used'"),
                side: SIDE, overwrite: OVERWRITE,
            }, ['designId', 'path']),
            run: ({ designId, path, ...options }) => {
                api.saveZemaxCoating(store.get(designId), spectrumPath(path), options);
                return { designId, path };
            },
        },
        {
            name: 'readZemaxCoating', title: 'Read a Zemax COATING.DAT',
            description: "Reads a Zemax OpticStudio COATING.DAT file as the Zemax Coatings window's Materials and Coatings tabs list it, writing nothing. Answers with fileName; materials, each MATE record { name, repeat (for a name the file defines more than once, { index, count } from 1; else null), importedAs (the name an import gives it), points, from, to (nm) }; and coatings, each COAT { name, type ('stack', the only kind that imports; 'ideal', 'table' or 'encrypted'), layerCount (null for a COAT that holds no layers) }. With values true, each material has wavelength (nm), n and k (the file's imaginary index with its sign turned, a positive one read as 0) in place of its count and span, and each coating its layers, incident medium side first, { material, thickness (nm; a relative one converted at wavelength, null when the file gives no index for it), fileThickness (um or waves), mode ('absolute' or 'relative') }.",
            inputSchema: object({
                path: str('Absolute path of the file'),
                wavelength: num('Wavelength at which a thickness the file gives in waves is converted to nm. Default 550'),
                values: bool("Also answer with every material's rows and every coating's layers. Default false"),
            }, ['path']),
            run: ({ path, values = false, ...options }) => {
                const read = api.readZemaxCoating(spectrumPath(path), options);
                return values ? read : zemaxSummary(read);
            },
        },
        {
            name: 'importZemaxCoating', title: 'Import a Zemax coating',
            description: `Puts the layers of a COAT record of a Zemax OpticStudio COATING.DAT file on the front of a design, as the Zemax Coatings window's Import to front coating does: in the file's order, incident medium side first, a relative thickness converted at wavelength with the index the file gives. ${IMPORT_TEXT} A design coated on the back alone and scored on that side is refused. Answers with the design and warnings, the layers left out and why.`,
            inputSchema: object({
                designId: DESIGN_ID,
                path: str('Absolute path of the file'),
                coating: { type: ['string', 'integer'], description: "The COAT record, by its name or its place among the file's coatings from 0. Default: the first stack of layers" },
                wavelength: num('Wavelength at which a thickness the file gives in waves is converted to nm. Default 550'),
            }, ['designId', 'path']),
            run: ({ designId, path, ...options }) => {
                const { design, warnings } = api.importZemaxCoating(store.get(designId), spectrumPath(path), options);
                store.set(designId, design);
                return { ...designView(designId, design), warnings };
            },
        },
        {
            name: 'saveCodevCoating', title: 'Write a CODE V coating',
            description: "Writes one side of a design to a CODE V .seq command file as the CODE V Coatings window's Export tab writes it: the MULTILAYER option's commands that enter the stack (thickness in nm, incident medium side first, layers of zero thickness left out), a MIC table of each material's n and k at up to 21 of the analysis wavelengths, and SAV, which has CODE V save it as a .mul. The back is written from the exit medium to the substrate. CODE V takes 100 analysis wavelengths, 5 angles and 1000 layers at most; past that the file is refused. A file that is there is refused unless overwrite is true. Answers with path and warnings, what the writer noted.",
            inputSchema: object({
                designId: DESIGN_ID,
                path: str('Absolute path of the .seq file to write'),
                title: str("TIT, the stack's title, cut to 80 characters, single quotes left out. Default: the design's name"),
                saveName: str("The name SAV saves the .mul under, each run of characters but letters, digits, _ and - written as one _. Default: the design's name"),
                from: FROM, to: TO,
                step: num('Step of the analysis wavelengths, nm. Default 10'),
                angles: list({ type: 'number' }, 'ANG, angles of incidence in degrees, 0 <= angle < 90, at most 5. Default [0]'),
                wavelength: num("REF, the reference wavelength, nm. Default: the design's reference wavelength"),
                side: SIDE, overwrite: OVERWRITE,
            }, ['designId', 'path']),
            run: ({ designId, path, ...options }) => ({ designId, path, warnings: api.saveCodevCoating(store.get(designId), spectrumPath(path), options) }),
        },
        {
            name: 'readCodevCoating', title: 'Read a CODE V coating',
            description: "Reads a CODE V coating file, a .seq command file or a .mul CODE V saved (by its extension), as the CODE V Coatings window's Import tab shows it, writing nothing. Answers with fileName, title, reference (REF, nm), angles (degrees), incident and substrate, each { label (a MIC material's label, else null), n, k (a constant index, else null) }, wavelengthCount, from and to (nm), layerCount, and warnings, what the reader noted. With values true, it answers with wavelengths (nm) and layers, incident medium side first, { index, thickness (nm), code (100 frozen, 0 free, 1 to 99 coupled), locked } in place of the counts and span.",
            inputSchema: object({
                path: str('Absolute path of the .seq or .mul file'),
                values: bool('Also answer with every wavelength and every layer. Default false'),
            }, ['path']),
            run: ({ path, values = false }) => {
                const read = api.readCodevCoating(spectrumPath(path));
                return values ? read : codevSummary(read);
            },
        },
        {
            name: 'importCodevCoating', title: 'Import a CODE V coating',
            description: `Puts the layers of a CODE V coating file, a .seq or a .mul, on one side of a design, as the CODE V Coatings window's Import to front coating and Import to back coating do: physical thickness in nm, a layer of code 100 locked; the file lists its layers from the incident medium, so on the back they go in reversed. The file's INC and SUB are not taken. ${IMPORT_TEXT} A side the Design Editor does not let you edit is refused. Answers with the design and warnings, what the reader and the conversion noted.`,
            inputSchema: object({
                designId: DESIGN_ID,
                path: str('Absolute path of the .seq or .mul file'),
                side: SIDE,
            }, ['designId', 'path']),
            run: ({ designId, path, ...options }) => {
                const { design, warnings } = api.importCodevCoating(store.get(designId), spectrumPath(path), options);
                store.set(designId, design);
                return { ...designView(designId, design), warnings };
            },
        },
    ];
}
