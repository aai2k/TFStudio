/**
 * A stack read from a CODE V file: its numbers as the window shows them, its
 * conversion to TFStudio materials and layers, and the coating Save to Coating
 * Library takes from it.
 */

import { CodevParseError, codevStackToDesign } from '../../../../utils/io/codevCoatingFile.js';
import { shortestNear } from '../../../../utils/io/codevCoating/mulReader.js';
import { codevRegistration } from './catalogImport.js';
import { parseErrorText } from './messages.js';

// CODE V holds a wavelength as a float32 in µm: WLG adds its step in single
// precision and a .mul stores every value so. A float32 carries 24 significant
// bits, the .mul reader reads a stored value back within 2^-23 of it, and a
// value is shown the same way: WLG 400 800 10 shows 400, not 400.0000059604645.
const FLOAT32_TOLERANCE = 2 ** -23;

/** A wavelength of the file, nm, as shown: the shortest decimal a float32 of it allows. */
export const fileNumber = (value) => shortestNear(value, FLOAT32_TOLERANCE);

/**
 * codevStackToDesign of the stack, or `{ error }` with the text of the reader
 * error that stopped it.
 */
export function convertStack(z, stack, fileName) {
    try {
        return codevStackToDesign(stack, { sourceName: fileName });
    } catch (err) {
        if (!(err instanceof CodevParseError)) throw err;
        return { error: parseErrorText(z, err) };
    }
}

const AIR = 'builtin:Air';
const baseName = (fileName) => String(fileName || 'coating').replace(/\.[^.]*$/, '');

// CODE V's default incident medium, n 1 with no k, is vacuum. TFStudio's
// built-in Air has that index at every wavelength, so an inline index of
// exactly n 1, k 0 is saved as Air rather than as a material of its own.
const isAir = (index) => !('label' in index) && index.n === 1 && index.k === 0;

/**
 * The stack as the coating the Save Coating dialog takes.
 *
 * The layers are the ones the import puts on the front coating: incident side
 * first, thickness in nm, each material under the id the import gives it in
 * the catalog of the file, carrying the record the import holds there, edits
 * included for a file imported before. The incident medium and the substrate
 * are the file's INC and SUB, built and named the same way, except that an
 * inline n 1, k 0 is built-in Air. Nothing is written to a catalog, so the
 * saved coating computes with the records it carries on a computer that never
 * imported the file.
 *
 * The dialog opens with the band of the file's analysis wavelengths, shortest
 * to longest, and the angle of its first ANG. A file with one analysis
 * wavelength has no band, and the dialog opens with its own.
 *
 * @returns {{ coating: object } | { error: string }}
 */
export function libraryCoating({ z, stack, fileName, filePath }) {
    const converted = convertStack(z, stack, fileName);
    if (converted.error) return converted;
    const media = [[stack.incident, converted.incidentKey], [stack.substrate, converted.substrateKey]];
    const keys = new Set([
        ...converted.layers.map(layer => layer.materialKey),
        ...media.filter(([index]) => !isAir(index)).map(([, key]) => key),
    ]);
    const { cat, idOf } = codevRegistration(converted.materials.filter(({ key }) => keys.has(key)), fileName, filePath);
    const materials = Object.fromEntries([...keys].map(key => [idOf[key], cat.materials[idOf[key].slice(cat.id.length + 1)]]));
    const [incidentMedium, substrate] = media.map(([index, key]) => (isAir(index) ? AIR : idOf[key]));
    const wavelengths = stack.wavelengthsNm.map(fileNumber);
    const band = [Math.min(...wavelengths), Math.max(...wavelengths)];
    return {
        coating: {
            name: stack.title.trim() || baseName(fileName),
            source: z.librarySource(fileName),
            layers: converted.layers.map(({ materialKey, thickness }) => ({ material: idOf[materialKey], thickness })),
            materials, incidentMedium, substrate,
            referenceWavelength: fileNumber(stack.refNm),
            ...(band[1] > band[0] ? { band } : {}),
            aoi: stack.anglesDeg[0] ?? 0,
        },
    };
}
