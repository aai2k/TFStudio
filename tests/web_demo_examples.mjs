import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const examplesSource = readFileSync(new URL('../web/demo-examples.js', import.meta.url), 'utf8');
const shimSource = readFileSync(new URL('../web/demo-shim.js', import.meta.url), 'utf8');

const window = { open() {} };
const context = vm.createContext({
    window, console, setTimeout, clearTimeout, fetch: async () => ({ ok: false }),
    Blob, URL, TextDecoder, Uint8Array,
});
vm.runInContext(examplesSource, context);

const exampleNames = window.DEMO_EXAMPLES.map(example => example.name);
assert.equal(new Set(exampleNames).size, exampleNames.length, 'demo example names must be unique');
assert(!exampleNames.includes('Single-layer AR (MgF2)'), 'legacy ASCII MgF2 example must not be seeded');
assert(exampleNames.every(name => !name.includes('—')), 'demo example names must not contain em dashes');

let seedVersion = 1;
const folders = [{ name: 'Examples', expanded: true }];
let designs = [{
    key: 'Examples\0Single-layer AR (MgF2)', folder: 'Examples',
    name: 'Single-layer AR (MgF2)',
    design: { id: 'legacy-mgf2', name: 'Single-layer AR (MgF2)' }, mtime: 1,
}, {
    key: 'Examples\0Broadband AR — 4 layer (Ta₂O₅/SiO₂/MgF₂)', folder: 'Examples',
    name: 'Broadband AR — 4 layer (Ta₂O₅/SiO₂/MgF₂)',
    design: { id: 'demo-bbar-4', name: 'Broadband AR — 4 layer (Ta₂O₅/SiO₂/MgF₂)' }, mtime: 1,
}];
window.DemoStorage = {
    persistent: () => true,
    getMeta: async key => key === 'seedVersion' ? seedVersion : undefined,
    setMeta: async (key, value) => { if (key === 'seedVersion') seedVersion = value; },
    listFolders: async () => folders,
    createFolder: async name => {
        if (!folders.some(folder => folder.name === name)) folders.push({ name, expanded: true });
    },
    listDesigns: async () => designs,
    deleteDesign: async (folder, name) => {
        designs = designs.filter(entry => entry.folder !== folder || entry.name !== name);
    },
    renameDesign: async (folder, oldName, newName) => {
        const entry = designs.find(item => item.folder === folder && item.name === oldName);
        if (!entry) return 'File not found';
        entry.name = newName;
        entry.key = `${folder}\0${newName}`;
        entry.design = { ...entry.design, name: newName };
        return null;
    },
    putDesign: async (folder, design) => {
        designs = designs.filter(entry => entry.folder !== folder || entry.name !== design.name);
        designs.push({ key: `${folder}\0${design.name}`, folder, name: design.name, design, mtime: 2 });
        return null;
    },
    listPresets: async () => [], getPreset: async () => undefined,
    putPreset: async () => {}, deletePreset: async () => {},
    listCatalogs: async () => [], putCatalog: async () => {}, deleteCatalog: async () => {},
};

vm.runInContext(shimSource, context);
const result = await window.electronAPI.loadFolders();
assert.equal(result.success, true);
const seededNames = result.folders.find(folder => folder.name === 'Examples').items.map(item => item.name);
assert(!seededNames.includes('Single-layer AR (MgF2)'), 'v1 legacy example should be migrated away');
assert.equal(seededNames.filter(name => name.startsWith('Single-layer AR')).length, 1,
    'upgraded demo should contain one single-layer AR example');
assert(seededNames.every(name => !name.includes('—')), 'upgraded names should not contain em dashes');
assert.equal(seedVersion, 3);

console.log('Web demo examples are canonical and duplicate-free.');
