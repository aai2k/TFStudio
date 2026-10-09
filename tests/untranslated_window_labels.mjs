/**
 * Windows speak the UI language, and name a material by its name rather than
 * by its catalog id.
 *
 * One block per window that showed English words or raw ids in Russian and
 * Chinese:
 *   1. Merit Function Editor: the header row the wizard writes, and what an
 *      empty header row reads.
 *   2. Filter Design Wizard: the step counter.
 *   3. Integral Values: the built-in weightings.
 *   4. Systematic Deviations: the per-material headers with their roles, the
 *      sweep parameters, and the name the heat map gives the swept parameter.
 *   5. Layer Sensitivity: the Material column.
 *   6. Inhomogeneities: the interface names, a medium the design does not
 *      name, and the Profile choices.
 *   7. Synthesis material pools: the built-in catalog.
 *
 * Every block runs, and the failures are listed together.
 *
 * Run: node tests/untranslated_window_labels.mjs
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
const { getLocale } = await loadApp();
const { initCatalogs } = await import('../src/utils/materials/catalogManager.js');
initCatalogs({});

const h = React.createElement;
const c = makeTheme();
const en = getLocale('en');
const ru = getLocale('ru');
const zh = getLocale('zh');
const it = getLocale('it');
const html = element => renderToStaticMarkup(element);

const failures = [];
let passed = 0;
async function check(name, fn) {
    try { await fn(); passed++; } catch (error) { failures.push(`${name}: ${error.message}`); }
}
function expect(condition, message) {
    if (!condition) throw new Error(message);
}

// A design with built-in materials, whose ids carry the `builtin:` prefix.
const design = {
    id: 'labels', name: 'Labels', incidentMedium: 'builtin:Air', exitMedium: 'builtin:Air',
    substrate: { material: 'builtin:SiO2', thickness: 1 }, referenceWavelength: 550,
    frontLayers: [
        { id: 'a', material: 'builtin:TiO2', thickness: 60 },
        { id: 'b', material: 'builtin:SiO2', thickness: 94 },
    ],
    backLayers: [],
};
const TIO2 = 'TiO2 (anatase)';
const SIO2 = 'SiO2 (Fused Silica)';

// ── 1. Merit Function Editor ─────────────────────────────────────────────────
{
    const { buildWizardBlock } = await import(
        '../src/components/windows/optimization/meritFunctionEditor/meritOperandModel.js');
    const { defaultFilterParams } = await import('../src/utils/physics/optimizer.js');
    const header = (t, typeId, extra = {}) => buildWizardBlock({
        tw: t.meritFunctionEditor.wizard, typeId, params: defaultFilterParams(typeId),
        aoi: 0, aoiEnd: 0, aoiSteps: 3, pol: 'avg', targetMode: 'continuous', stepNm: 1,
        minEnabled: false, maxEnabled: false, totalEnabled: false, ...extra,
    })[0].comment;

    await check('MF wizard header, English', () => {
        expect(header(en, 'BBAR') === 'Broadband AR, λ 400–700 nm, AOI 0°, avg pol, continuous target',
            `reads "${header(en, 'BBAR')}"`);
        const swept = header(en, 'BBAR', { aoiEnd: 20, targetMode: 'discrete', stepNm: 2 });
        expect(swept === 'Broadband AR, λ 400–700 nm, AOI 0–20° (3 steps), avg pol, discrete @2 nm',
            `reads "${swept}"`);
        expect(header(en, 'LONGPASS').includes('stop 400–600 nm, pass 700–1000 nm'), header(en, 'LONGPASS'));
    });
    for (const [code, t] of [['ru', ru], ['zh', zh], ['it', it]]) {
        await check(`MF wizard header, ${code}`, () => {
            const plain = header(t, 'BBAR');
            const swept = header(t, 'BBAR', { aoiEnd: 20, targetMode: 'discrete', stepNm: 2 });
            const edge = header(t, 'LONGPASS');
            for (const english of ['avg pol', 'continuous target', 'discrete @', ' steps)', 'stop ', 'pass ']) {
                expect(![plain, swept, edge].some(text => text.includes(english)),
                    `"${english.trim()}" is English in ${code}: "${swept}", "${edge}"`);
            }
            const words = t.meritFunctionEditor.wizard.header;
            expect(plain.includes(words.pol('avg')) && plain.includes(words.continuous),
                `the polarization and target mode are not in ${code}: "${plain}"`);
            expect(swept.includes(`${words.aoi} 0–20° (${words.steps(3)})`) && swept.includes(words.discrete(2)),
                `the angle range and discrete step are not in ${code}: "${swept}"`);
            expect(edge.includes(`${words.stop} 400–600 nm, ${words.pass} 700–1000 nm`),
                `the bands are not in ${code}: "${edge}"`);
        });
    }

    const { renderOperandRow } = await import(
        '../src/components/windows/optimization/meritFunctionEditor/mfTable/OperandRows.js');
    const emptyHeader = t => html(h('table', null, h('tbody', null, renderOperandRow({
        selIds: new Set(), c, t, onEdit() {}, selectRow() {}, beginDrag() {}, dragOver() {},
    }, { id: 'h', type: 'DMFS', comment: '', enabled: true }, 0))));
    await check('MF header row with no text', () => {
        for (const [code, t] of [['ru', ru], ['zh', zh], ['it', it]]) {
            const row = emptyHeader(t);
            expect(!row.includes('Default merit function'), `${code} reads "Default merit function"`);
            expect(row.includes(t.meritFunctionEditor.defaultDmfs), `${code} does not read its own text`);
        }
        expect(emptyHeader(en).includes(en.meritFunctionEditor.defaultDmfs), 'English names the default');
    });
}

// ── 2. Filter Design Wizard ──────────────────────────────────────────────────
{
    const { StepHeader } = await import(
        '../src/components/windows/optimization/filterDesignWizard/ui.js');
    await check('Filter Design step counter', () => {
        for (const [code, t] of [['ru', ru], ['zh', zh], ['it', it], ['en', en]]) {
            const T = t.filterDesign;
            const out = html(h(StepHeader, { step: 5, title: T.step5.title, c, T }));
            if (code !== 'en') expect(!out.includes('Step 5 of 6'), `${code} reads "Step 5 of 6"`);
            expect(out.includes(T.stepOf(5, 6)), `${code} does not count steps in its own words: ${out}`);
        }
    });
}

// ── 3. Integral Values ───────────────────────────────────────────────────────
await check('Integral Values weightings', () => {
    for (const [code, t] of [['ru', ru], ['zh', zh], ['it', it]]) {
        for (const [key, english] of Object.entries(en.integralValues.weightings)) {
            expect(t.integralValues.weightings[key] !== english, `${code} ${key} is the English "${english}"`);
        }
    }
});

// ── 4. Systematic Deviations ─────────────────────────────────────────────────
{
    const { enumerateUniqueMaterials } = await import('../src/utils/physics/systematicDeviations.js');
    const { emptyDeviation } = await import('../src/utils/physics/systematicDeviations.js');
    const { SystematicEditor } = await import(
        '../src/components/windows/analysis/systematicDeviations/SystematicControls.js');
    const model = await import('../src/components/windows/analysis/systematicDeviations/model.js');
    const uniqueMats = enumerateUniqueMaterials(design);
    const state = mode => ({
        mode, design, dev: emptyDeviation(), uniqueMats,
        sweep: { param: 'globalThicknessScale', from: 0.95, to: 1.05, steps: 5, offsetUnit: 'nm' },
        setSweep() {}, updateGlobal() {}, updateMat() {},
    });

    await check('Systematic Deviations per-material headers', () => {
        for (const [code, t] of [['en', en], ['ru', ru], ['zh', zh]]) {
            const sd = t.systematicDeviations;
            const out = html(h(SystematicEditor, { c, sd, state: state('single') }));
            expect(!out.includes('builtin:'), `${code} shows a catalog id`);
            expect(out.includes(TIO2), `${code} does not name TiO2`);
            expect(out.includes(`(${sd.roles.incident}, ${sd.roles.exit})`),
                `${code} does not give Air its roles in its own words`);
            if (code !== 'en') expect(!out.includes('(front)'), `${code} reads "(front)"`);
        }
    });
    await check('Systematic Deviations sweep parameters', () => {
        for (const [code, t] of [['ru', ru], ['zh', zh]]) {
            const sd = t.systematicDeviations;
            const out = html(h(SystematicEditor, { c, sd, state: state('sweep') }));
            // What the selector shows, without the option values, which are ids.
            const shown = out.replace(/<[^>]*>/g, '\n');
            expect(!shown.includes('builtin:') && !shown.includes('d-scale') && !shown.includes('d-offset'),
                `${code} lists a raw id or an English parameter`);
            expect(out.includes(sd.optMatScale(TIO2)), `${code} does not offer TiO2's thickness scale by name`);
        }
    });
    await check('Systematic Deviations heat map parameter', () => {
        for (const [code, t] of [['en', en], ['ru', ru], ['zh', zh]]) {
            const sd = t.systematicDeviations;
            const name = param => model.sweepParamName({ param, offsetUnit: 'nm' }, uniqueMats, sd, design);
            expect(name('globalThicknessScale') === sd.optThkScale,
                `${code} names a global d-scale sweep "${name('globalThicknessScale')}", the selector "${sd.optThkScale}"`);
            expect(name('mat:builtin:TiO2:dScale') === sd.optMatScale(TIO2),
                `${code} names a TiO2 sweep "${name('mat:builtin:TiO2:dScale')}"`);
        }
    });
    await check('Systematic Deviations heat map parameter of an older result', () => {
        const sd = en.systematicDeviations;
        // Swept on TiO2, which the design has since replaced with Ta2O5.
        const replaced = {
            ...design, frontLayers: [{ id: 'a', material: 'builtin:Ta2O5', thickness: 60 }, design.frontLayers[1]],
        };
        const gone = model.sweepParamName({ param: 'mat:builtin:TiO2:dScale', offsetUnit: 'nm' },
            enumerateUniqueMaterials(replaced), sd, replaced);
        expect(gone === sd.optMatScale(TIO2), `a sweep on a material the design no longer has reads "${gone}"`);
        // A result saved by 1.8.5 carries the name it was given then and no parameter.
        const saved = model.sweepParamName({ paramName: 'builtin:TiO2 d-offset (nm)' }, uniqueMats, sd, design);
        expect(saved === 'builtin:TiO2 d-offset (nm)', `a result with only a stored name reads "${saved}"`);
    });
}

// ── 5. Layer Sensitivity ─────────────────────────────────────────────────────
{
    const { sensitivityRows } = await import(
        '../src/components/windows/analysis/layerSensitivity/tableModel.js');
    await check('Layer Sensitivity material column', () => {
        const rows = sensitivityRows([
            { side: 'front', layerIndex: 0, materialId: 'builtin:TiO2', thickness: 60, deltaNm: 1, deltaMFAbs: 2, sensitivity: 100 },
            { side: 'front', layerIndex: 1, materialId: 'builtin:SiO2', thickness: 94, deltaNm: 1, deltaMFAbs: 1, sensitivity: 50 },
        ], 2, design);
        expect(rows.map(row => row.material).join() === `${TIO2},${SIO2}`,
            `the column reads ${rows.map(row => row.material).join(', ')}`);
    });
}

// ── 6. Inhomogeneities ───────────────────────────────────────────────────────
{
    const { designInterfaces } = await import(
        '../src/components/windows/analysis/inhomogeneities/model.js');
    const { InhomogeneityEditor } = await import(
        '../src/components/windows/analysis/inhomogeneities/InhomogeneityControls.js');
    await check('Inhomogeneities interface names', () => {
        // Front layers are stored air side first; the Design Editor calls the
        // one on the substrate L1.
        for (const [code, t] of [['en', en], ['ru', ru]]) {
            const labels = designInterfaces(design, t.inhomogeneities).front.map(iface => iface.label);
            expect(labels.join() === `Air → L2,L2 → L1,L1 → ${SIO2}`,
                `${code} reads ${labels.join(', ')}`);
        }
        const unnamed = { ...design, incidentMedium: '', substrate: { thickness: 1 } };
        for (const [code, t] of [['ru', ru], ['zh', zh], ['it', it]]) {
            const ih = t.inhomogeneities;
            const labels = designInterfaces(unnamed, ih).front.map(iface => iface.label);
            expect(labels[0] === `${ih.mediumIncident} → L2` && labels[2] === `L1 → ${ih.mediumSubstrate}`,
                `${code} reads ${labels.join(', ')}`);
            expect(ih.mediumIncident !== 'Inc' && ih.mediumSubstrate !== 'Sub' && ih.mediumExit !== 'Exit',
                `${code} keeps the English stand-ins`);
        }
    });
    // Evaluation still accepts a medium stored as { material: id }.
    await check('Inhomogeneities medium given as { material }', () => {
        const objectMedia = {
            ...design, incidentMedium: { material: 'builtin:Air' }, exitMedium: { material: 'builtin:Air' },
        };
        const labels = designInterfaces(objectMedia, en.inhomogeneities).front.map(iface => iface.label);
        expect(labels[0] === 'Air → L2', `reads ${labels.join(', ')}`);
    });
    await check('Inhomogeneities profile choices', () => {
        for (const [code, t] of [['en', en], ['ru', ru], ['zh', zh]]) {
            const ih = t.inhomogeneities;
            const out = html(h(InhomogeneityEditor, {
                c, ih, state: {
                    activeSides: ['front'], hasBack: false, inh: {},
                    interfaces: designInterfaces(design, ih),
                    findInterlayer: () => null, upsertInterlayer() {}, removeInterlayer() {},
                },
            }));
            expect(!out.includes('>linear<') && !out.includes('>invParabolic<'), `${code} lists a profile id`);
            expect(out.includes(`>${ih.profiles.invParabolic}<`), `${code} does not name the profiles`);
        }
    });
}

// ── 7. Synthesis material pools ──────────────────────────────────────────────
{
    const { catalogLabel } = await import(
        '../src/components/windows/optimization/synthesisShared/MaterialPoolPanel.js');
    const { setCurrentLocale } = await import('../src/constants/locales/index.js');
    await check('Material pool built-in catalog', () => {
        for (const [code, t] of [['ru', ru], ['zh', zh], ['it', it]]) {
            setCurrentLocale(code);
            const name = catalogLabel({ id: 'builtin', name: 'Built-in' });
            expect(name === t.pool.builtinCatalog && name !== 'Built-in', `${code} names it "${name}"`);
            expect(catalogLabel({ id: 'user-1', name: 'My coatings' }) === 'My coatings',
                `${code} does not keep a user catalog's own name`);
        }
        setCurrentLocale('en');
    });
}

if (failures.length) {
    console.error(`untranslated_window_labels: ${failures.length} failed, ${passed} passed`);
    for (const failure of failures) console.error(`  FAIL ${failure}`);
    process.exit(1);
}
console.log(`untranslated_window_labels: ${passed} passed`);
