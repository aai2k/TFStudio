/**
 * Design import dialog render.
 *
 * Renders the dialog over a small batch and checks what the user reads:
 * the status of a name nobody assigned, a catalog match saying it matched
 * on the name with the file's own index beside the picked material's, the
 * reader's notes and the build warnings worded through the locale, the
 * folder-definition status with its way back, the unit switch with its
 * from-the-file setting, and that React has no key complaints about the
 * table fragments.
 *
 * Run: node tests/design_import_dialog.mjs
 */
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const { initCatalogs, getMaterialById } = await import('../src/utils/materials/catalogManager.js');
const { makeGetNK } = await import('../src/utils/materials/catalogManager/dispersion.js');
const { DesignImportDialog } = await import('../src/components/dialogs/designImport/DesignImportDialog.js');

initCatalogs({});

const c = makeTheme();
const t = makeLocale();
const di = t.designImport;

const tfd = 'VERSION*1*\nENVIRON*400*700*10*550*0*AIR*GLASS*\nENVIRON3*1*AIR*WHITE*IDEAL*1*\nLAYERS*1*\nLAYER*1*MGF2*1.0*99.63768*0*1*Y*N*0*N*N*\nLAYERS2*0*\nENVIRNS*2*\nEOF*';
const dds = '<EssentialMacleodDesign><Parameters><ReferenceWavelength> 550</ReferenceWavelength><ThicknessType>O</ThicknessType></Parameters><Medium>Air</Medium><Substrate>Glass</Substrate><Layers><Layer LayerNumber="1"><Material>MgF2</Material><Thickness> .25</Thickness></Layer></Layers></EssentialMacleodDesign>';
const dsg = JSON.stringify({ VERSION: 1, name: 'QW', comment: '', controlW: 550, matchAngle: 45, matchMedium: 1, layers: [{ abbr: 'L', qwot_thickness: 1, status: 'A', zn_re: 1.38, zn_im: 0 }] });
const folder = {
    projectText: '[LoadedData]\nIncidentMedium=Air\nExitMedium=Air\n',
    siblings: [
        { name: 'MgF2 const', ext: 'lm', text: JSON.stringify({ nType: 0, kType: 0, wavelength: null, n: [1.38], k: [0], name: 'MgF2 const' }) },
        { name: 'Air', ext: 'sub', text: JSON.stringify({ nType: 0, kType: 0, wavelength: null, n: [1], k: [0], name: 'Air' }) },
        { name: 'Glass', ext: 'sub', text: JSON.stringify({ nType: 0, kType: 0, wavelength: null, n: [1.52], k: [0], name: 'Glass' }) },
    ],
};

const errors = [];
const originalError = console.error;
console.error = (...args) => { errors.push(args.map(String).join(' ')); };

// Text as React writes it into static markup.
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const has = (html, text) => html.includes(esc(text));

function render(files) {
    return renderToStaticMarkup(React.createElement(DesignImportDialog, {
        fileImport: { files, units: { tfcalc: 'auto' } },
        setFileImport() {}, onCommit() {},
        folders: [{ id: 'f1', name: 'My Designs' }], defaultFolderId: 'f1', t, c,
    }));
}

try {
    // The TFCalc design is highlighted first: nothing assigned yet.
    const html = render([
        { name: 'ar', ext: 'tfd', dir: 'tf', text: tfd },
        { name: 'One Layer AR', ext: 'dds', dir: 'ml', text: dds },
        { name: 'QW', ext: 'dsg', dir: 'ol', text: dsg, ...folder },
        { name: 'gone', ext: 'tfd', dir: 'tf', text: null, error: 'EACCES: permission denied' },
    ]);
    assert.ok(has(html, di.statusMissing), 'an unassigned name says what to do');
    assert.ok(has(html, di.exitBothSurfaces('AIR')), 'a TFCalc air exit medium says both surfaces are evaluated');
    assert.ok(has(html, di.noteEnvironments(2)), 'reader notes are worded through the locale');
    assert.ok(has(html, di.unitAuto) && has(html, di.unitTfcalc), 'the TFCalc unit switch offers the from-the-file setting');
    assert.ok(has(html, 'EACCES: permission denied'), 'an unreadable file is listed with its reason');
    assert.ok(has(html, di.materialsMissing(1)), 'the list counts the names still to assign');

    // A name the catalogs matched says so, and shows the file's own index next
    // to the one it would be built with. The .tfd layer is n = 1.38 and the
    // built-in MgF2 is not, which is the case this table exists to make visible.
    const mgf2 = makeGetNK(getMaterialById('builtin:MgF2'))(550)[0].toFixed(4);
    assert.ok(has(html, di.statusNameMatch), 'a catalog match says it matched on the name');
    assert.ok(has(html, di.indexPair('1.3800', mgf2)) && mgf2 !== '1.3800', `the file's index is shown beside the picked material's (${mgf2})`);
    assert.ok(has(html, di.nameMatchHint), 'and the table says what a name match is worth');

    // The OptiLayer design alone: its names come from the folder and stay so.
    const ol = render([{ name: 'QW', ext: 'dsg', dir: 'ol', text: dsg, ...folder }]);
    assert.ok(has(ol, di.statusFolderFile) && !has(ol, di.statusMissing), 'folder definitions count as assigned');
    assert.ok(has(ol, di.materialsOk), 'and the list says all found');
    assert.ok(!has(ol, di.nameMatchHint), 'a design with no name match is not warned about one');
    assert.ok(has(ol, di.matchAngle) && has(ol, di.exitSemiInfinite('Air')), 'the match angle is shown and the substrate stays semi-infinite');

    // The Macleod design alone, with a layer material no catalog has: an
    // optical layer with no material gets a worded warning.
    const ml = render([{ name: 'One Layer AR', ext: 'dds', dir: 'ml', text: dds.replace('MgF2', 'MgF2 lab') }]);
    assert.ok(has(ml, di.warnNoIndex(di.sideFront, 1, 'MgF2 lab', 550)), 'the build warning is shown');
    assert.ok(has(ml, di.noSourceIndexHint(di.programName.macleod)), 'a Macleod design says its name matches cannot be checked');
    assert.ok(has(ml, di.thicknessFollowsMaterialHint), 'and that the material picked sets the thicknesses');
    assert.ok(!has(html, di.noSourceIndexHint(di.programName.tfcalc)), 'a TFCalc design has an index to check against');

    const keyComplaints = errors.filter(e => /unique "key" prop|Each child in a list/.test(e));
    assert.equal(keyComplaints.length, 0, `React key warnings: ${keyComplaints.join(' | ')}`);
} finally {
    console.error = originalError;
}

console.log('PASS: design_import_dialog');
