/**
 * Sharing a coating with the project: the prefilled issue URL names the
 * contribution form and its field ids, the email carries the same text, and
 * the packed file is the entry as a .tfsc record.
 *
 * Run: node tests/coating_library_share.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { makeCoatingEntry } = await import('../src/utils/coatingLibrary/entryModel.js');
const {
    CONTRIBUTE_EMAIL, CONTRIBUTE_TEMPLATE, REPO_URL, conditionsText, issueUrl, layerTable, mailUrl,
    packFileName, packText, shareFields,
} = await import('../src/utils/coatingLibrary/share.js');

const entry = makeCoatingEntry({
    name: 'Test V-coat 633', type: 'ar', use: 'HeNe windows', limitations: 'Narrow', source: 'Own design',
    substrate: 'builtin:BK7', band: [620, 650], aoi: 0, polarization: 'avg', referenceWavelength: 633,
    layers: [{ material: 'Al2O3', thickness: 96.512 }, { material: 'MgF2', thickness: 114.7 }],
});

// The form exists and has every field the URL fills.
const form = readFileSync(new URL(`../.github/ISSUE_TEMPLATE/${CONTRIBUTE_TEMPLATE}`, import.meta.url), 'utf8');
for (const id of Object.keys(shareFields(entry))) {
    assert.ok(form.includes(`id: ${id}\n`), `the issue form has a field with id ${id}`);
}

// Text.
const table = layerTable(entry);
assert.ok(table.startsWith('Layer 1 on the substrate'), 'the table says which end layer 1 is');
assert.ok(table.includes('1  Al2O3  96.51') && table.includes('2  MgF2  114.70'), 'layers in deposition order, nm to 0.01');
const conditions = conditionsText(entry);
for (const text of ['Substrate: BK7', 'Incident medium: Air', '620-650 nm', '0°', 'avg', '633 nm']) {
    assert.ok(conditions.includes(text), `conditions mention ${text}`);
}
const purpose = shareFields(entry).purpose;
assert.ok(purpose.includes('HeNe') && purpose.includes('Limitations: Narrow'));

// Links.
const empty = new URL(issueUrl(null));
assert.equal(`${empty.origin}${empty.pathname}`, `${REPO_URL}/issues/new`);
assert.equal(empty.searchParams.get('template'), CONTRIBUTE_TEMPLATE);
assert.equal(empty.searchParams.get('coating'), null, 'nothing prefilled without an entry');

const filled = new URL(issueUrl(entry));
assert.equal(filled.searchParams.get('template'), CONTRIBUTE_TEMPLATE);
assert.equal(filled.searchParams.get('title'), 'Coating: Test V-coat 633');
assert.equal(filled.searchParams.get('coating'), entry.name);
assert.equal(filled.searchParams.get('design'), table);
assert.equal(filled.searchParams.get('conditions'), conditions);
assert.equal(filled.searchParams.get('source'), 'Own design');

// A stack too long for a URL keeps everything but the table.
const long = makeCoatingEntry({
    ...entry,
    layers: Array.from({ length: 400 }, (_, i) => ({ material: i % 2 ? 'SiO2' : 'TiO2', thickness: 100 + i })),
});
const trimmed = new URL(issueUrl(long));
assert.ok(issueUrl(long).length <= 7000, 'a prefilled URL stays under the limit');
assert.equal(trimmed.searchParams.get('design'), null, 'the table is dropped from an over-long URL');
assert.equal(trimmed.searchParams.get('coating'), long.name);

assert.ok(mailUrl(null).startsWith(`mailto:${CONTRIBUTE_EMAIL}?subject=`) && !mailUrl(null).includes('&body='));
const mail = mailUrl(entry);
assert.ok(mail.includes(encodeURIComponent('Coating for TFStudio: Test V-coat 633')));
assert.ok(decodeURIComponent(mail).includes('1  Al2O3  96.51'), 'the email body carries the table');
assert.ok(mail.includes('%0D%0A'), 'mail body line breaks are CRLF');

// Packed file.
assert.equal(packFileName(entry), 'test-v-coat-633.tfsc.json');
const packed = JSON.parse(packText(entry));
assert.equal(packed.name, entry.name);
assert.deepEqual(packed.layers, entry.layers);
assert.ok(!('materials' in packed), 'null fields are left out');
assert.deepEqual(makeCoatingEntry(packed).bands, entry.bands, 'the packed record reads back as the same entry');

console.log('coating_library_share: all checks passed');
