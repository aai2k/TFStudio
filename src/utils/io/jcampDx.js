/**
 * JCAMP-DX import / export.
 *
 * JCAMP-DX is the IUPAC standard text format for spectral data exchange
 * (McDonald & Wilks, Appl. Spectrosc. 42, 151 (1988); spec at jcamp-dx.org).
 * It is an open interchange format, so TFStudio both reads and writes it.
 *
 * Supported on IMPORT:
 *   - Labelled-Data-Records (`##LABEL= value`), `$$` comments, `##END=`.
 *   - `##XYDATA= (X++(Y..Y))` (uniform abscissa) with ASDF ordinate compression:
 *     AFFN, PAC, SQZ, DIF, DUP — incl. the DIF line-leading Y check-value.
 *   - `##XYPOINTS= (XY..XY)` (explicit x,y pairs, any spacing).
 *   - Compound LINK files: every XYDATA/XYPOINTS record becomes one spectrum.
 * Supported on EXPORT:
 *   - AFFN `##XYDATA= (X++(Y..Y))` for a uniform grid (design spectra always are),
 *     else AFFN `##XYPOINTS= (XY..XY)`. Single block, or a `LINK` of N blocks.
 *
 * X is carried in the file's XUNITS (nm / cm⁻¹ / µm); the caller converts to nm
 * via makeMeasuredCurve. Pure module (no DOM/Node) — unit-tested in
 * tests/jcamp_dx.mjs.
 *
 * Implementation is split across src/utils/io/jcampDx/: asdf.js (ASDF ordinate
 * tokenizing/decoding), ldr.js (LDR parsing + block context), reader.js
 * (XYDATA/XYPOINTS decoding + spectrum assembly), writer.js (block serialization).
 */

import { parseRecords, CTX_SETTERS } from './jcampDx/ldr.js';
import { decodeXYDATA, decodeXYPOINTS, buildSpectrum } from './jcampDx/reader.js';
import { buildBlock } from './jcampDx/writer.js';

/**
 * Parse JCAMP-DX text into one or more spectra.
 * @returns {{ ok:boolean, error?:string, spectra: Array<{
 *   title:string, dataType:string, xUnit:string,
 *   quantity:(string|null), isAbsorbance:boolean, isPercent:boolean,
 *   x:number[], y:number[]
 * }> }}
 */
export function parseJcampDx(text) {
    if (typeof text !== 'string' || !/##\s*(TITLE|JCAMP)/i.test(text)) {
        return { ok: false, error: 'Not a JCAMP-DX file', spectra: [] };
    }
    const rawLines = text.replace(/\r\n?/g, '\n').split('\n');
    const records = parseRecords(rawLines);

    const spectra = [];
    const ctx = {};   // running LDR context (child blocks inherit parent units/factors)

    for (const r of records) {
        const setter = CTX_SETTERS[r.label];
        if (setter) { setter(ctx, r.value); continue; }
        if (r.label === 'XYDATA') {
            spectra.push(buildSpectrum(decodeXYDATA(r.body, ctx), ctx));
        } else if (r.label === 'XYPOINTS' || r.label === 'PEAKTABLE') {
            spectra.push(buildSpectrum(decodeXYPOINTS(r.body, ctx), ctx));
        }
    }

    const valid = spectra.filter(s => s && s.x.length);
    if (!valid.length) return { ok: false, error: 'No XYDATA/XYPOINTS found', spectra: [] };
    return { ok: true, spectra: valid };
}

/**
 * Serialize one or more spectra to JCAMP-DX text.
 * Single spectrum → one block. Multiple → a compound `LINK` file.
 * @param specs Array<{ title, x (nm), y, quantity, isAbsorbance, xUnit? }>
 * @param opts  { title?, dataType? }
 */
export function buildJcampDx(specs, opts = {}) {
    const list = (specs || []).filter(s => s && s.x && s.x.length);
    if (!list.length) return '';
    const dataType = opts.dataType || 'UV/VIS SPECTRUM';

    if (list.length === 1) {
        return buildBlock(list[0], { dataType }) + '\r\n##END=\r\n';
    }
    // LINK wrapper.
    const out = [];
    out.push(`##TITLE=${opts.title || 'TFStudio spectra'}`);
    out.push(`##JCAMP-DX=4.24`);
    out.push(`##DATA TYPE=LINK`);
    out.push(`##BLOCKS=${list.length}`);
    for (const s of list) out.push(buildBlock(s, { dataType }) + '\r\n##END=');
    out.push(`##END=`);
    return out.join('\r\n') + '\r\n';
}
