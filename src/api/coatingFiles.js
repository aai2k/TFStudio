// What the Zemax and CODE V coating calls share: the file they read or write,
// and the layers an import puts on a design, with the file's materials carried
// in the design rather than written to a catalog.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import mainPaths from '../main/paths.js';
import { ensureLayerIds } from '../utils/io/newDesign.js';
import { getCatalogs } from '../utils/materials/catalogManager.js';
import { stripGetNK } from '../utils/materials/catalogManager/persistence.js';
import { isBoolean, refusal, requireValue } from './check.js';
import { withLayers } from './stack.js';

const { readTextAuto } = mainPaths;

/** The file's full path, after refusing a path that is not text. */
export function coatingFilePath(call, filePath) {
    requireValue(call, 'filePath', filePath, v => typeof v === 'string' && v.length > 0, 'the path of a file');
    return path.resolve(filePath);
}

/**
 * The full path an import takes the file by. The windows recognise a file
 * imported before by the full path their open dialog gave, kept in the
 * catalog the file made (prefix `zemax_` or `codev_`). Windows names a file
 * without regard to case, so there a path that differs from a kept one only in
 * case is that file, and the kept spelling is used.
 */
export function importFilePath(call, filePath, catalogPrefix) {
    const full = coatingFilePath(call, filePath);
    if (process.platform !== 'win32') return full;
    const kept = getCatalogs().filter(cat => cat.id.startsWith(catalogPrefix) && typeof cat.sourceFile === 'string')
        .map(cat => cat.sourceFile);
    if (kept.includes(full)) return full;
    return kept.find(file => file.toLowerCase() === full.toLowerCase()) ?? full;
}

/** The text of the file, read as the windows' open dialogs read it: UTF-8, or UTF-16 with its byte order mark. */
export function readCoatingText(call, filePath) {
    try {
        return readTextAuto(filePath);
    } catch (err) {
        throw new Error(`${call}: ${filePath}: ${err.message}`);
    }
}

/** Refuses an overwrite that is not true or false, and a file that is there without it. */
export function refuseExisting(call, filePath, overwrite) {
    requireValue(call, 'overwrite', overwrite, isBoolean, 'true or false');
    if (!overwrite && fs.existsSync(filePath)) {
        throw refusal('fileExists', { call, path: filePath }, `${filePath} exists; pass { overwrite: true } to write over it`);
    }
}

/** Writes `text` to the file as the windows' save dialogs write it, in UTF-8. */
export function writeCoatingText(filePath, text) {
    fs.writeFileSync(filePath, text, 'utf-8');
}

/**
 * `design` with `layers` in place of the layers of the side `key`, each
 * given an id, a symmetric design's back mirroring its front as the app keeps
 * it, and `records`, the definitions of the layers' materials by id, carried
 * in the design's materials. A catalog here that holds an id comes first, as
 * for every material a design carries; the record is what the design computes
 * with where no catalog does.
 */
export function withImportedLayers(design, key, layers, records) {
    const carried = Object.fromEntries(Object.entries(records).map(([id, record]) => [id, stripGetNK(record)]));
    return { ...withLayers(design, key, ensureLayerIds(layers)), materials: { ...(design.materials || {}), ...carried } };
}
