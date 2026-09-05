/**
 * Sending a coating to the project. The built-in library grows from what
 * users send in, so a saved coating can be posted as a GitHub discussion
 * with the contribution form prefilled, an email with the same text, or one
 * file to attach to either. The post and the email carry the layer table and
 * the design conditions; the file carries the whole entry, embedded material
 * data included.
 */
import { materialLabel } from '../materials/catalogManager.js';
import { bandsText, slugify } from './entryModel.js';

export const REPO_URL = 'https://github.com/aai2k/TFStudio';
/** Discussions category whose form (.github/DISCUSSION_TEMPLATE/<category>.yml) the query fields below fill. */
export const CONTRIBUTE_CATEGORY = 'coatings';
export const CONTRIBUTE_EMAIL = 'achapovskyai@gmail.com';

// Longest URL handed to the browser for a prefilled form. Past this the
// layer table is left out of the URL and the attached file carries it.
const URL_LIMIT = 7000;

/** The stack as text, one layer per line, layer 1 on the substrate. */
export function layerTable(entry) {
    const lines = entry.layers.map((layer, i) =>
        `${i + 1}  ${materialLabel(layer.material)}  ${Number(layer.thickness).toFixed(2)}`);
    return ['Layer 1 on the substrate, thicknesses in nm', ...lines].join('\n');
}

/** Substrate, medium, band, angle, polarization and reference wavelength as text. */
export function conditionsText(entry) {
    return [
        `Substrate: ${materialLabel(entry.substrate)}`,
        `Incident medium: ${materialLabel(entry.incidentMedium)}`,
        `Design band: ${bandsText(entry)}`,
        `Angle of incidence: ${entry.aoi}°`,
        `Polarization: ${entry.polarization}`,
        `Reference wavelength: ${entry.referenceWavelength} nm`,
    ].join('\n');
}

/** The contribution form's fields, keyed by field id, filled from an entry. */
export function shareFields(entry) {
    const purpose = [entry.use, entry.limitations && `Limitations: ${entry.limitations}`].filter(Boolean).join('\n');
    return {
        coating: entry.name,
        design: layerTable(entry),
        conditions: conditionsText(entry),
        purpose,
        source: entry.source,
    };
}

function withQuery(base, params) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
    return `${base}?${query.toString()}`;
}

/** The new-discussion page in the contribution category, its form prefilled when an entry is given. */
export function discussionUrl(entry) {
    const base = `${REPO_URL}/discussions/new`;
    if (!entry) return withQuery(base, { category: CONTRIBUTE_CATEGORY });
    const fields = shareFields(entry);
    const full = withQuery(base, { category: CONTRIBUTE_CATEGORY, title: `Coating: ${entry.name}`, ...fields });
    if (full.length <= URL_LIMIT) return full;
    return withQuery(base, { category: CONTRIBUTE_CATEGORY, title: `Coating: ${entry.name}`, ...fields, design: '' });
}

/** A mailto link to the maintainer, with the same text in the body when an entry is given. */
export function mailUrl(entry) {
    const subject = entry ? `Coating for TFStudio: ${entry.name}` : 'Coating for TFStudio';
    const body = entry
        ? `${layerTable(entry)}\n\n${conditionsText(entry)}\n\n${shareFields(entry).purpose}\n\n${entry.source}`.trim()
        : '';
    const encode = text => encodeURIComponent(text).replace(/%0A/g, '%0D%0A');
    return `mailto:${CONTRIBUTE_EMAIL}?subject=${encode(subject)}${body ? `&body=${encode(body)}` : ''}`;
}

/** The entry as the JSON a .tfsc file holds, ready to be written for sending. */
export function packText(entry) {
    const record = Object.fromEntries(Object.entries(entry).filter(([, value]) => value != null));
    return JSON.stringify(record, null, 2);
}

/** File name for the packed entry; .json so GitHub and mail clients accept it as an attachment. */
export function packFileName(entry) {
    return `${slugify(entry.name) || 'coating'}.tfsc.json`;
}

/** Write the packed entry through a save dialog. Unavailable outside the desktop app. */
export async function packCoating(entry) {
    const api = window.electronAPI;
    if (!api?.packCoating) return { success: false, error: 'not available here' };
    return api.packCoating(packText(entry), packFileName(entry));
}
