import { RECORD_KW, openRecord, appendContinuationLine, warnIfReplicatedGroup } from './recordOpeners.js';

/**
 * Parse the text of a COATING.DAT file.
 * @param {string} text  raw file text (caller has already decoded UTF-16/UTF-8).
 * @returns {{
 *   materials: Array<{name:string, points:Array<[number,number,number]>}>,
 *   coatings:  Array<object>,   // see record `type` discriminator below
 *   tapers:    Array<{name:string, lines:string[]}>,
 *   warnings:  string[]
 * }}
 *   Coating record types:
 *     {type:'layers',    name, layers:[{material,thickness,isAbsolute,loopIndex,taper}]}
 *     {type:'idealI',    name, transmission}
 *     {type:'ideal',     name, T, R}
 *     {type:'ideal2',    name, values:number[9]}
 *     {type:'table',     name, lines:string[]}        // raw ANGL/WAVE lines
 *     {type:'encrypted', name}
 */
export function parseZemaxCoating(text) {
    const materials = [];
    const coatings = [];
    const tapers = [];
    const warnings = [];

    const rawLines = String(text == null ? '' : text).split(/\r\n|\r|\n/);
    let cur = null;        // current open record
    let lineNo = 0;

    for (let raw of rawLines) {
        lineNo++;
        const line = raw.trim();
        if (line === '' || line[0] === '!') continue;       // blank / comment

        const tok = line.split(/\s+/);
        const kw = tok[0].toUpperCase();

        if (RECORD_KW.has(kw)) {
            warnIfReplicatedGroup(cur, warnings);
            cur = openRecord(kw, tok, materials, coatings, tapers);
            continue;
        }

        // Continuation line — belongs to the current open record.
        if (!cur) {
            warnings.push(`Line ${lineNo}: data outside any record, ignored: "${line}"`);
            continue;
        }

        appendContinuationLine(cur, tok, kw, { line, lineNo, warnings });
    }
    warnIfReplicatedGroup(cur, warnings);

    // Drop the internal `type:'material'` tag detail but keep name/points.
    return {
        materials: materials.map(m => ({ name: m.name, points: m.points })),
        coatings,
        tapers: tapers.map(t => ({ name: t.name, lines: t.lines })),
        warnings,
    };
}
