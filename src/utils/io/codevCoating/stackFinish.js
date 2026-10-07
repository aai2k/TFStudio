import { CodevParseError } from './parseError.js';
import { micTables } from './micCommands.js';
import { micIndexAt, outsideMic } from './micIndex.js';
import { findLabel } from './seqValues.js';

// The MIC key a label resolves to, so every reference names the table by the
// text it was entered with.
function resolveIndex(index, mic) {
    if (!('label' in index)) return { n: index.n, k: index.k };
    const key = findLabel(mic, index.label);
    if (key === undefined) throw new CodevParseError('unknownMaterial', { label: index.label });
    return { label: key };
}

/**
 * REF as the MDA page gives it: the one entered, else the central analysis
 * wavelength, the one left of centre for an even count.
 */
function referenceNm(stack) {
    if (stack.ref !== null) return stack.ref;
    return stack.wavelengths[Math.floor((stack.wavelengths.length - 1) / 2)];
}

/**
 * Physical thickness in nm of a layer entered under PHT N. Its thickness T is
 * an optical thickness in waves of REF, "thickness * index / vacuum
 * wavelength" in the PHT entry of the MDA page, so d = T · REF / n(REF), with
 * n the real index of the layer at REF.
 */
function physicalNm(layer, index, refNm, mic, noteOutside) {
    const rows = 'label' in index ? mic[index.label] : null;
    if (rows && outsideMic(rows, refNm)) noteOutside(index.label);
    const n = rows ? micIndexAt(rows, refNm) : index.n;
    if (!(n > 0)) throw new CodevParseError('badNumber', { line: layer.line, text: String(n) });
    return layer.thickness * refNm / n;
}

function outsideNoter(warnings) {
    const noted = new Set();
    return (label) => {
        if (noted.has(label)) return;
        noted.add(label);
        warnings.push({ kind: 'refOutsideTable', label });
    };
}

/**
 * The CodevStack of a parsed MDA entry: labels resolved, REF filled in, and
 * every thickness physical, in nm.
 */
export function finishStack(stack, warnings) {
    if (!stack.layers.length) throw new CodevParseError('noStack');
    if (!stack.substrate) throw new CodevParseError('missingCommand', { command: 'SUB' });
    if (!stack.wavelengths.length) throw new CodevParseError('missingCommand', { command: 'WL' });
    const mic = micTables(stack);
    const refNm = referenceNm(stack);
    const noteOutside = outsideNoter(warnings);
    const layers = stack.layers.map((layer) => {
        const index = resolveIndex(layer.index, mic);
        const thicknessNm = stack.physical ? layer.thickness : physicalNm(layer, index, refNm, mic, noteOutside);
        return { thicknessNm, code: layer.code, index };
    });
    return {
        title: stack.title,
        refNm,
        wavelengthsNm: stack.wavelengths.slice(),
        anglesDeg: stack.angles?.length ? stack.angles : [0],
        incident: resolveIndex(stack.incident, mic),
        substrate: resolveIndex(stack.substrate, mic),
        layers,
        mic,
        warnings,
    };
}
