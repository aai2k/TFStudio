/**
 * One builder per fixture: the steps a user of the writer release takes,
 * carried out with that release's own modules.
 *
 * A builder gets `kit` (see generate.mjs): `mod(rel)` imports a renderer module
 * of the release and `has(rel)` says whether it has one, `main` reaches its
 * main-process handlers, `snapshotCatalogs(variant)` keeps its Materials folder
 * as a catalog variant, `install(label, release)` starts another installation
 * (another computer) and `release(tag)` upgrades the current one. A design is
 * saved through writeDesign below, the way the release's File > Save does.
 *
 * Where a step lives inside a React component (a dialog's apply button, an
 * editor's field handler), the builder repeats what that handler does and
 * names the lines it follows, `file:line` at the writer's tag.
 */
import fs from 'node:fs';
import path from 'node:path';

const STACK_FORMULA_BUILD = 'components/windows/design/stackFormula/designBuild.js';
const MATERIAL_DRAFT = 'components/windows/design/materialEditor/materialDraft.js';

// A release's catalog writes go out through window.electronAPI without being
// awaited; let them land before the Materials folder is copied.
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

/**
 * A new design from the Stack Formula dialog's "New design" button, opened on
 * a default design, whose media the dialog offers (bare 'Air' and 'BK7').
 * From 1.4.1 the button calls designBuild.js buildNewDesignFromFormula with the
 * open design's resolvers and materials (useStackFormula.js:13-21, :107-110).
 * 1.0.0 does the same inline: StackFormulaDialog.js:242-258.
 */
async function stackFormulaDesign(kit, {
    name, text, symbolMap, refLambda = 550, side = 'front',
    incident = 'Air', substrate = 'BK7', exit = 'Air',
}) {
    const { makeDefaultDesign } = await kit.mod('state/DesignContext.js');
    const sf = await kit.mod('utils/synthesis/stackFormula.js');
    const open = makeDefaultDesign();
    if (kit.has(STACK_FORMULA_BUILD)) {
        const { buildNewDesignFromFormula } = await kit.mod(STACK_FORMULA_BUILD);
        const resolvers = sf.stackFormulaResolvers(open);
        const probe = sf.buildStackFromFormula({ text, symbolMap, refLambda, startFromSubstrate: false, resolvers });
        if (!probe.ok) throw new Error(`stack formula: ${probe.error}`);
        return buildNewDesignFromFormula({
            newName: name, refLambda, incidentMat: incident, substrateMat: substrate, exitMat: exit,
            effSide: side, text, symbolMap, startFromSubstrate: false, resolvers, sourceMaterials: open.materials,
        });
    }
    const { mirrorLayers } = await kit.mod('utils/physics/optimizer.js');
    const base = makeDefaultDesign(name);
    const seed = base.id;
    const rb = sf.buildStackFromFormula({ text, symbolMap, refLambda, startFromSubstrate: false, idSeed: seed });
    if (!rb.ok) throw new Error(`stack formula: ${rb.error}`);
    const f = rb.layers;
    const b = mirrorLayers(rb.layers, `b-${seed}-`);
    let frontLayers = [], backLayers = [], surfaceMode = 'front_only';
    if (side === 'front') { frontLayers = f; surfaceMode = 'front_only'; }
    else if (side === 'back') { backLayers = b; surfaceMode = 'back_only'; }
    else { frontLayers = f; backLayers = b; surfaceMode = 'both_independent'; }
    return {
        ...base, name, referenceWavelength: refLambda,
        incidentMedium: incident, exitMedium: exit,
        substrate: { ...base.substrate, material: substrate },
        surfaceMode, frontLayers, backLayers, stackFormula: text,
        notes: `Generated from stack formula (${side}):\n${text}\nλ₀ = ${refLambda} nm`,
    };
}

/**
 * File > Save in the writer release. From 1.8.1 it is designFiles.js
 * writeDesignFile; 1.4.1 to 1.7.2 keep the same function in renderer.js
 * (1.4.1 :228-230, 1.6.3 :202-204, 1.7.2 :227-229): embed the material
 * definitions, then save-design. 1.0.0 embeds nothing.
 */
async function writeDesign(kit, design) {
    if (kit.has('utils/io/designFiles.js')) {
        const { writeDesignFile } = await kit.mod('utils/io/designFiles.js');
        const result = await writeDesignFile('Corpus', design);
        if (!result?.success) throw new Error(`save failed: ${JSON.stringify(result)}`);
        kit.collect();
        return;
    }
    if (kit.has('utils/materials/designMaterials.js')) {
        const { embedDesignMaterials } = await kit.mod('utils/materials/designMaterials.js');
        await kit.save(embedDesignMaterials(design));
        return;
    }
    await kit.save(design);
}

/**
 * The release's catalog startup. From 1.8.1 it is catalogStartup.js
 * loadCatalogsFromDisk; before that renderer.js does the same (1.4.1 :184-196
 * and :702-723, 1.6.3 :158-170 and :700-721, 1.7.2 :183-195 and :717-738): the
 * catalog files, then a catalog for each .agf file that has none, id from its
 * file name.
 */
async function startCatalogs(kit) {
    if (kit.has('utils/materials/catalogStartup.js')) {
        const { loadCatalogsFromDisk } = await kit.mod('utils/materials/catalogStartup.js');
        await loadCatalogsFromDisk();
        await settle();
        return;
    }
    const cm = await kit.mod('utils/materials/catalogManager.js');
    const { parseAGF } = await kit.mod('utils/materials/agfParser.js');
    const loaded = await globalThis.electronAPI.loadCatalogs();
    const persisted = loaded.success ? loaded.catalogs : {};
    cm.initCatalogs(persisted);
    const agf = await globalThis.electronAPI.scanAgfDir();
    for (const { name, text } of agf.success ? agf.files : []) {
        const catId = name.toLowerCase().replace(/[^a-z0-9]/g, '_');
        if (!persisted[catId]) cm.addCatalog(parseAGF(text, catId));
    }
    await settle();
}

/**
 * Edit a user-catalog material in the Material Editor and save it:
 * materialDraft.js materialToDraft, the edit, draftToMaterial, then
 * catalogManager saveUserMaterial (the editor's Save button).
 */
async function editMaterial(kit, catalogId, materialId, edit) {
    const cm = await kit.mod('utils/materials/catalogManager.js');
    const { materialToDraft, draftToMaterial } = await kit.mod(MATERIAL_DRAFT);
    const draft = materialToDraft(catalogId, cm.getCatalog(catalogId).materials[materialId]);
    const saved = cm.saveUserMaterial(catalogId, draftToMaterial(edit(draft)));
    await settle();
    return saved;
}

// Rows pasted into the editor's table, as its paste handler stores them:
// strings for wavelength (nm), n and k.
function pastedRows(table) {
    return table.map(([lam, n, k], index) => ({ _key: index, lam: String(lam), n: String(n), k: String(k ?? 0) }));
}

/** The refractiveindex.info page at `dataPath`, through the release's parser. */
async function riiPage(kit, dataPath) {
    kit.main.mountRiiMirror();
    const rii = await kit.mod('utils/materials/riiDatabase.js');
    return rii.fetchMaterial(dataPath);
}

/**
 * The RII browser's "Add to catalog" for the page at `dataPath`
 * (materialEditor/riiActions.js addRiiMaterial): the page found in the catalog
 * tree as the browser lists it, converted by riiToMaterialEntry and saved into
 * user catalog `catalogId`.
 */
async function addRiiPage(kit, catalogId, dataPath) {
    const rii = await kit.mod('utils/materials/riiDatabase.js');
    const mat = await riiPage(kit, dataPath);
    const tree = await rii.loadCatalog();
    const book = dataPath.split('/')[1];
    const selected = rii.searchCatalog(tree, book).find(r => r.dataPath === dataPath);
    if (!selected) throw new Error(`${dataPath} is not listed under ${book}`);
    const { addRiiMaterial } = await kit.mod('components/windows/design/materialEditor/riiActions.js');
    let added = null;
    let failure = null;
    addRiiMaterial(catalogId, {
        mat, selected,
        rii: { noNkData: 'no n,k data', addSuccess: name => name, addError: text => text },
        onAdded: (id, name) => { added = { id, name }; },
        setPhase: () => {}, setAddMsg: message => { failure = message; },
    });
    if (!added) throw new Error(`${dataPath}: ${failure}`);
    await settle();
    const entry = Object.values((await kit.mod('utils/materials/catalogManager.js')).getCatalog(catalogId).materials)
        .find(m => m.dataPath === dataPath);
    return `${catalogId}:${entry.id}`;
}

// The AGF records of the glasses `names` from the release's bundled Schott
// catalog, with the lines before the first record: a small vendor catalog of
// real glasses.
function agfSubset(kit, names) {
    const text = fs.readFileSync(path.join(kit.tagDir, 'build', 'seed', 'agf', 'schott2025.AGF'), 'utf8');
    const lines = text.split(/\r?\n/);
    const first = lines.findIndex(line => line.startsWith('NM '));
    const out = lines.slice(0, first);
    let keep = false;
    for (const line of lines.slice(first)) {
        if (line.startsWith('NM ')) keep = names.includes(line.split(/\s+/)[1]);
        if (keep) out.push(line);
    }
    return out.join('\r\n') + '\r\n';
}

export const BUILDERS = {
    // ── 1.0.0 ───────────────────────────────────────────────────────────────

    // The welcome screen's quarter-wave mirror sample.
    'builtin-bare-ids-qw-mirror': async (kit) => {
        const { buildSampleDesigns } = await kit.mod('utils/samples/sampleDesigns.js');
        await writeDesign(kit, buildSampleDesigns().find(s => s.key === 'qwStack').build());
    },

    // A user catalog made in the Material Editor holding a copy of the built-in
    // Ta2O5 ("Copy to catalog"), and a mirror made of it with the Stack Formula
    // dialog. 1.0 files carry no material definitions.
    'user-catalog-no-copy': async (kit) => {
        const cm = await kit.mod('utils/materials/catalogManager.js');
        const lab = cm.createUserCatalog('Lab');
        const ta2o5 = cm.copyMaterialToCatalog(cm.getMaterialById('builtin:Ta2O5'), lab.id);
        await settle();
        kit.snapshotCatalogs('catalog-present');
        await writeDesign(kit, await stackFormulaDesign(kit, {
            name: 'Lab Ta2O5 mirror', text: '(H L)^4 H',
            symbolMap: { H: `${lab.id}:${ta2o5.id}`, L: 'builtin:SiO2' },
        }));
    },

    // The welcome screen's single-layer AR with the Design Editor's cone
    // control set to a user-defined intensity profile, and one RAV row.
    // 1.0.0 DesignEditor.js:147 (CONE_DEFAULT), :157-158 (each edit patches
    // design.cone over the defaults), :181 (enable), :191 (half-angle), :204-210
    // (switching to 'user' seeds two rows), :230-234 (a cell edit, a new row).
    'cone-user-distribution': async (kit) => {
        const { buildSampleDesigns } = await kit.mod('utils/samples/sampleDesigns.js');
        const { makeOperand } = await kit.mod('utils/physics/optimizer.js');
        let design = buildSampleDesigns().find(s => s.key === 'singleAR').build();
        const CONE_DEFAULT = { enabled: false, halfAngleDeg: 7.5, distribution: 'uniform', gridPoints: 15, userTable: null };
        let rowSeq = 0;
        const coneRowId = () => `cr-${Date.now()}-${(rowSeq++).toString(36)}`;
        const patch = (p) => { design = { ...design, cone: { ...CONE_DEFAULT, ...(design.cone || {}), ...p } }; };
        patch({ enabled: true });
        patch({ halfAngleDeg: 12 });
        const th = design.cone.halfAngleDeg;
        patch({ distribution: 'user', userTable: [{ _id: coneRowId(), theta: 0, intensity: 100 }, { _id: coneRowId(), theta: th || 10, intensity: 100 }] });
        const setRow = (i, key, v) => patch({ userTable: design.cone.userTable.map((r, j) => (j === i ? { ...r, [key]: v } : r)) });
        setRow(1, 'intensity', 40);
        patch({ userTable: [...design.cone.userTable, { _id: coneRowId(), theta: th || 10, intensity: 100 }] });
        setRow(2, 'theta', 6);
        setRow(2, 'intensity', 80);
        design = { ...design, meritOperands: [makeOperand({ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, target: 0, weight: 1 })] };
        await writeDesign(kit, design);
    },

    // ── 1.4.1 ───────────────────────────────────────────────────────────────

    // A user material copied from the built-in Ta2O5 and used in a mirror; the
    // file carries a copy with no catalog stamp. Afterwards the material is
    // edited in the Material Editor: its table replaced by a measurement of
    // another Ta2O5 film pasted in (refractiveindex.info, Ta2O5/Gao).
    'unstamped-catalog-copy': async (kit) => {
        const cm = await kit.mod('utils/materials/catalogManager.js');
        await startCatalogs(kit);
        const lab = cm.createUserCatalog('Lab');
        const ta2o5 = cm.copyMaterialToCatalog(cm.getMaterialById('builtin:Ta2O5'), lab.id);
        await settle();
        kit.snapshotCatalogs('catalog-same');
        await writeDesign(kit, await stackFormulaDesign(kit, {
            name: 'Lab Ta2O5 mirror', text: '(H L)^4 H',
            symbolMap: { H: `${lab.id}:${ta2o5.id}`, L: 'builtin:SiO2' },
        }));
        const page = await riiPage(kit, 'main/Ta2O5/nk/Gao.yml');
        await editMaterial(kit, lab.id, ta2o5.id, draft => ({ ...draft, rows: pastedRows(page.tableNK) }));
        kit.snapshotCatalogs('catalog-edited', [`user${path.sep}${lab.id}.catalog.json`]);
    },

    // The bundled Schott catalog as every installation seeds it, its N-SF6
    // (Sellmeier formula 2 with a k table from the AGF IT lines) as substrate
    // under a two-layer AR of built-in Sellmeier materials.
    'agf-glass-copy-with-k-table': async (kit) => {
        kit.main.seed();
        await startCatalogs(kit);
        await writeDesign(kit, await stackFormulaDesign(kit, {
            name: 'N-SF6 two-layer AR', text: 'L 2M',
            symbolMap: { M: 'builtin:Al2O3', L: 'builtin:MgF2' },
            substrate: 'schott2025:N-SF6',
        }));
    },

    // ── 1.6.3 ───────────────────────────────────────────────────────────────

    // A user material copied from the built-in HfO2 and given a smooth
    // dispersion fit in the Material Editor (userMaterialForm.js:443-457, the
    // Fit button with its default model and the material's range), used in a
    // mirror.
    'dispersion-fit-active': async (kit) => {
        const cm = await kit.mod('utils/materials/catalogManager.js');
        const { fitTabulatedMaterial } = await kit.mod('utils/materials/dispersionFits.js');
        const { effectiveFitModel } = await kit.mod(MATERIAL_DRAFT);
        const { parseNumber, parseNumberStrict } = await kit.mod('utils/misc/numberParsing.js');
        await startCatalogs(kit);
        const lab = cm.createUserCatalog('Lab');
        const hfo2 = cm.copyMaterialToCatalog(cm.getMaterialById('builtin:HfO2'), lab.id);
        await editMaterial(kit, lab.id, hfo2.id, (draft) => {
            const rows = draft.rows
                .map(row => [parseNumberStrict(row.lam), parseNumberStrict(row.n), parseNumber(row.k)])
                .filter(row => row.every(Number.isFinite));
            const dispersionFit = fitTabulatedMaterial(rows, {
                nModel: effectiveFitModel(draft),
                rangeNm: [parseNumber(draft.lambdaMinNm), parseNumber(draft.lambdaMaxNm)],
            });
            return { ...draft, dispersionFit };
        });
        kit.snapshotCatalogs('catalog-present');
        await writeDesign(kit, await stackFormulaDesign(kit, {
            name: 'Lab HfO2 mirror', text: '(H L)^4 H',
            symbolMap: { H: `${lab.id}:${hfo2.id}`, L: 'builtin:SiO2' },
        }));
    },

    // A symmetric 0.5L 0.5H 0.5L period collapsed into its Herpin equivalent layer
    // with the Design Editor's Herpin tool (LayerToolDialogs.js:185-215, Apply
    // writes the preview's design). The equivalent material lives only in the
    // design, and 1.6.3 to 1.8.4 do not save it.
    'herpin-layer-no-material': async (kit) => {
        const { herpinCollapsePreview } = await kit.mod('components/windows/design/designEditor/layerTools.js');
        const design = await stackFormulaDesign(kit, {
            name: 'Herpin period', text: '0.5L 0.5H 0.5L 2L',
            symbolMap: { H: 'builtin:Al2O3', L: 'builtin:MgF2' },
        });
        const ids = design.frontLayers.slice(0, 3).map(layer => layer.id);
        await writeDesign(kit, herpinCollapsePreview(design, 'front', ids, design.referenceWavelength).design);
    },

    // The bundled library catalogs as every installation seeds them: a glass
    // of the substrate library (OptiLayer Schott series with a k table) as
    // substrate, cemented to B 270 (general Sellmeier with a k table) as exit
    // medium, under coating-library films: a Cauchy TiO2, a Sellmeier Al2O3 and
    // a Cauchy MgF2. Evaluated through the whole part.
    'library-substrate-and-coatings': async (kit) => {
        kit.main.seed();
        await startCatalogs(kit);
        const design = await stackFormulaDesign(kit, {
            name: 'Library AR on BAC4', text: 'L H M',
            symbolMap: {
                H: 'library_coatings:TiO2_Cauchy_300-700nm',
                M: 'library_coatings:Al2O3_Sellmeier_o-ray',
                L: 'library_coatings:MgF2_Cauchy_300-700nm',
            },
            substrate: 'library_substrates:BAC4', exit: 'library_substrates:B_270',
        });
        await writeDesign(kit, { ...design, mfEvalMode: 'total' });
    },

    // ── 1.7.2 ───────────────────────────────────────────────────────────────

    // A user material copied from the built-in Nb2O5 and switched to linear
    // interpolation in the Material Editor, used in a mirror.
    'linear-interp-table': async (kit) => {
        const cm = await kit.mod('utils/materials/catalogManager.js');
        await startCatalogs(kit);
        const lab = cm.createUserCatalog('Lab');
        const nb2o5 = cm.copyMaterialToCatalog(cm.getMaterialById('builtin:Nb2O5'), lab.id);
        await editMaterial(kit, lab.id, nb2o5.id, draft => ({ ...draft, interp: 'linear' }));
        kit.snapshotCatalogs('catalog-present');
        await writeDesign(kit, await stackFormulaDesign(kit, {
            name: 'Lab Nb2O5 mirror', text: '(H L)^4 H',
            symbolMap: { H: `${lab.id}:${nb2o5.id}`, L: 'builtin:SiO2' },
        }));
    },

    // A SiO2 film on silicon whose own calculated Psi and Delta at 70 degrees,
    // exported by the Measured Ellipsometry window, are imported back as
    // measured curves (useMeasuredEllipsometry.js:56-85: parse, type the
    // columns, makeMeasuredCurve, Add all), with PSI and DEL rows at 633 nm.
    'measured-ellipsometry-psi-delta': async (kit) => {
        const model = await kit.mod('components/windows/dataExchange/measuredEllipsometry/model.js');
        const table = await kit.mod('utils/io/spectrumTable.js');
        const { makeOperand } = await kit.mod('utils/physics/optimizer.js');
        let design = await stackFormulaDesign(kit, {
            name: 'SiO2 on Si witness', text: '2L', symbolMap: { L: 'builtin:SiO2' }, substrate: 'builtin:Si',
        });
        const exported = model.calculatedDocument(design, {
            lambdaStart: 400, lambdaEnd: 1000, lambdaStep: 20, thetaDeg: 70,
            side: 'front', deltaConvention: 'nulling', xUnit: table.X_UNITS.NM,
        });
        const parsed = table.parseSpectrumTable(exported.text);
        const quantities = model.typeColumns(parsed.columns);
        const fileName = exported.fileName;
        const curves = table.withUniqueCurveIds(parsed.columns.map((col, index) => table.makeMeasuredCurve({
            name: `${fileName.replace(/\.[^.]+$/, '')}: ${col.name}`,
            x: col.x || parsed.x, xUnit: parsed.xUnit, y: col.values, quantity: quantities[index] || 'PSI',
            aoi: Number.isFinite(col.aoi) ? col.aoi : (parsed.aoi ?? 70), pol: 'avg',
            side: parsed.side || 'front', deltaConvention: 'nulling', source: fileName,
        })).map(curve => ({ ...curve, id: table.measuredCurveId() })));
        design = {
            ...design, measuredEllipsometry: curves,
            meritOperands: [
                makeOperand({ type: 'PSI', lambdaStart: 633, lambdaEnd: 633, aoi: 70, target: 30, weight: 1 }),
                makeOperand({ type: 'DEL', lambdaStart: 633, lambdaEnd: 633, aoi: 70, target: 120, weight: 1 }),
            ],
        };
        await writeDesign(kit, design);
    },

    // ── 1.8.1 ───────────────────────────────────────────────────────────────

    // A Ta2O5 copy given film constants in the Material Editor's mechanical tab
    // (the worked example of the Essential Macleod manual, pp. 231-234, as
    // stress/filmStress.js quotes it), a mirror of it on the seeded Schott
    // N-BK7, whose AGF carries the glass's own constants, and the Stress
    // Analysis window's fields: temperatures and diameter
    // (useStressAnalysis.js:35-44). One STR row holds the bending force at zero.
    'stress-mechanical-diameter': async (kit) => {
        const cm = await kit.mod('utils/materials/catalogManager.js');
        const { makeOperand } = await kit.mod('utils/physics/optimizer.js');
        kit.main.seed();
        await startCatalogs(kit);
        const lab = cm.createUserCatalog('Lab');
        const ta2o5 = cm.copyMaterialToCatalog(cm.getMaterialById('builtin:Ta2O5'), lab.id);
        await editMaterial(kit, lab.id, ta2o5.id, draft => ({
            ...draft,
            mechanical: {
                ...draft.mechanical,
                youngsModulusGPa: '200', poissonsRatio: '0.3', linearExpansionPerK: '10',
                intrinsicStressMPa: '-180', referenceTemperatureC: '250',
            },
        }));
        let design = await stackFormulaDesign(kit, {
            name: 'Stressed Ta2O5 mirror', text: '(H L)^4 H',
            symbolMap: { H: `${lab.id}:${ta2o5.id}`, L: 'builtin:SiO2' }, substrate: 'schott2025:N-BK7',
        });
        const setTemperature = (key, value) => {
            const next = { ...(design.stress || {}), [key]: value };
            for (const field of Object.keys(next)) if (next[field] == null) delete next[field];
            design = { ...design, stress: Object.keys(next).length ? next : undefined };
        };
        setTemperature('temperatureC', 20);
        setTemperature('depositionTemperatureC', 250);
        design = { ...design, substrate: { ...design.substrate, diameterMm: 25.4 } };
        design = { ...design, meritOperands: [makeOperand({ type: 'STR', target: 0, weight: 1 })] };
        kit.snapshotCatalogs('catalog-present', [`user${path.sep}${lab.id}.catalog.json`]);
        await writeDesign(kit, design);
    },

    // ── 1.8.2 ───────────────────────────────────────────────────────────────

    // The merit function wizard's two worst-case types on an AR, as 1.8.2
    // writes them: bandPoints 21 and pNorm 50 on each row.
    'wizard-worst-case-rows': async (kit) => {
        const fc = await kit.mod('utils/physics/optimizer/filterCatalog.js');
        const design = await stackFormulaDesign(kit, {
            name: 'AR with worst-case rows', text: 'L 2H 0.5M',
            symbolMap: { H: 'builtin:Ta2O5', M: 'builtin:Al2O3', L: 'builtin:MgF2' },
        });
        const rows = [
            ...fc.generateFilterOperands('WORST_T_MIN', fc.defaultFilterParams('WORST_T_MIN'), { pol: 'avg' }),
            ...fc.generateFilterOperands('WORST_R_MAX', fc.defaultFilterParams('WORST_R_MAX'), { pol: 'avg' }),
        ];
        await writeDesign(kit, { ...design, meritOperands: rows });
    },

    // A layer of the built-in Custom material, which 1.8.3 removed, beside
    // bare and prefixed built-in ids.
    'builtin-custom-layer': async (kit) => {
        await writeDesign(kit, await stackFormulaDesign(kit, {
            name: 'Custom layer AR', text: 'L C', symbolMap: { C: 'builtin:Custom', L: 'builtin:MgF2' },
        }));
    },

    // ── 1.8.3 ───────────────────────────────────────────────────────────────

    // refractiveindex.info formula pages added through the RII browser, which
    // from 1.8.3 keeps a formula page as its formula (catalog 200 + N), with a
    // gas page as the incident medium.
    'rii-formula-materials': async (kit) => {
        await startCatalogs(kit);
        const cm = await kit.mod('utils/materials/catalogManager.js');
        const rii = cm.createUserCatalog('RefractiveIndex.info');
        const ids = {};
        for (const [symbol, dataPath] of Object.entries({
            S: 'main/Al2O3/nk/Malitson.yml',            // formula 1
            Z: 'main/ZnS/nk/Amotchkina.yml',             // formula 2, k table
            T: 'main/TiO2/nk/Devore-o.yml',              // formula 4
            H: 'main/HfO2/nk/Al-Kuhaili.yml',            // formula 5
            Y: 'main/YbF3/nk/Amotchkina.yml',            // formula 5, k table
            A: 'main/Ar/nk/Peck-15C.yml',                // formula 6
        })) {
            ids[symbol] = await addRiiPage(kit, rii.id, dataPath);
        }
        kit.snapshotCatalogs('catalog-present', [`user${path.sep}${rii.id}.catalog.json`]);
        await writeDesign(kit, await stackFormulaDesign(kit, {
            name: 'RII formula stack', text: 'Y H T Z',
            symbolMap: { Y: ids.Y, H: ids.H, T: ids.T, Z: ids.Z },
            incident: ids.A, substrate: ids.S,
        }));
    },

    // A measured transmittance curve on the design, made by makeMeasuredCurve
    // from the design's own spectrum (integralValues/spectrum.js), and the
    // merit function wizard's gain flattening type taking it as its target
    // (curveWizardModel.js:115-128): a dB block with its level free, a PPEF
    // row naming the block by id, and a TDBMN row.
    'measured-curve-ppef': async (kit) => {
        const table = await kit.mod('utils/io/spectrumTable.js');
        const { computeSpectrumForMode } = await kit.mod('components/windows/analysis/integralValues/spectrum.js');
        const fc = await kit.mod('utils/physics/optimizer/filterCatalog.js');
        const { curveWizardRows } = await kit.mod('components/windows/optimization/meritFunctionEditor/curveWizardModel.js');
        let design = await stackFormulaDesign(kit, {
            name: 'Gain flattening start', text: '(H L)^3 H 2L (H L)^3 H',
            symbolMap: { H: 'builtin:Ta2O5', L: 'builtin:SiO2' }, refLambda: 1550,
        });
        const spectrum = computeSpectrumForMode(design, { lambdaStart: 1500, lambdaEnd: 1600, lambdaStep: 2, theta: 0 }, 'front');
        const curve = { ...table.makeMeasuredCurve({
            name: 'Gain flattening target', x: Array.from(spectrum.lambda), xUnit: table.X_UNITS.NM,
            y: Array.from(spectrum.T), quantity: 'T', aoi: 0, pol: 'avg', source: 'Gain flattening target.csv',
        }), id: table.measuredCurveId() };
        design = { ...design, measuredCurves: [curve] };
        const params = { ...fc.defaultFilterParams('GAIN_FLATTENING'), input: 'target', curveId: curve.id };
        const result = curveWizardRows({ typeId: 'GAIN_FLATTENING', params, design });
        if (result.error) throw new Error(`gain flattening: ${result.error}`);
        await writeDesign(kit, { ...design, meritOperands: result.rows, measuredCurves: [...design.measuredCurves, ...result.curves] });
    },

    // ── 1.8.4 ───────────────────────────────────────────────────────────────

    // An AGF file with a Cyrillic name dropped into Materials\agf. 1.8.4 names
    // its catalog by the file name with every other character an underscore,
    // so the id is all underscores; the design uses its N-BK7 as substrate.
    'agf-non-ascii-file-name': async (kit) => {
        fs.writeFileSync(path.join(kit.materialsDir, 'agf', 'Стекло.agf'), agfSubset(kit, ['N-BK7', 'N-SF6']));
        await startCatalogs(kit);
        const cm = await kit.mod('utils/materials/catalogManager.js');
        const catalog = cm.getCatalogs().find(cat => cat.source === 'agf');
        kit.snapshotCatalogs('upgraded-install', [`agf${path.sep}Стекло.agf`, `agf${path.sep}${catalog.id}.catalog.json`]);
        kit.snapshotCatalogs('agf-file-only', [`agf${path.sep}Стекло.agf`]);
        await writeDesign(kit, await stackFormulaDesign(kit, {
            name: 'AR on Стекло N-BK7', text: 'L 2M',
            symbolMap: { M: 'builtin:Al2O3', L: 'builtin:MgF2' }, substrate: `${catalog.id}:N-BK7`,
        }));
    },

    // ── 1.8.5 ───────────────────────────────────────────────────────────────

    // The same Herpin collapse as herpin-layer-no-material, saved by 1.8.5,
    // which writes the equivalent material into the file.
    'herpin-layer-with-material': async (kit) => {
        const { herpinCollapsePreview } = await kit.mod('components/windows/design/designEditor/layerTools.js');
        const design = await stackFormulaDesign(kit, {
            name: 'Herpin period', text: '0.5L 0.5H 0.5L 2L',
            symbolMap: { H: 'builtin:Al2O3', L: 'builtin:MgF2' },
        });
        const ids = design.frontLayers.slice(0, 3).map(layer => layer.id);
        await writeDesign(kit, herpinCollapsePreview(design, 'front', ids, design.referenceWavelength).design);
    },

    // Two computers each made a catalog "Lab" in 1.8.4, which named it
    // user_lab on both, with a copy of the built-in Ta2O5. Both upgraded to
    // 1.8.5, whose first start stamps each catalog with a stamp of its own. The
    // first saves a mirror of its Ta2O5, stamped. On the second the same id
    // holds either the same n,k, or a table pasted from another film.
    'copy-from-another-catalog': async (kit) => {
        const labWithTa2o5 = async () => {
            const cm = await kit.mod('utils/materials/catalogManager.js');
            await startCatalogs(kit);
            const lab = cm.createUserCatalog('Lab');
            const ta2o5 = cm.copyMaterialToCatalog(cm.getMaterialById('builtin:Ta2O5'), lab.id);
            await settle();
            return { catalogId: lab.id, id: `${lab.id}:${ta2o5.id}`, materialId: ta2o5.id };
        };
        kit.install('first-computer', '1.8.4');
        const ours = await labWithTa2o5();
        kit.release('1.8.5');
        await startCatalogs(kit);
        kit.snapshotCatalogs('own-catalog', [`user${path.sep}${ours.catalogId}.catalog.json`]);
        await writeDesign(kit, await stackFormulaDesign(kit, {
            name: 'Lab Ta2O5 mirror', text: '(H L)^4 H', symbolMap: { H: ours.id, L: 'builtin:SiO2' },
        }));
        kit.install('second-computer', '1.8.4');
        const theirs = await labWithTa2o5();
        if (theirs.id !== ours.id) throw new Error('the second catalog took another id');
        kit.release('1.8.5');
        await startCatalogs(kit);
        kit.snapshotCatalogs('other-catalog-same-nk', [`user${path.sep}${theirs.catalogId}.catalog.json`]);
        const page = await riiPage(kit, 'main/Ta2O5/nk/Gao.yml');
        await editMaterial(kit, theirs.catalogId, theirs.materialId, draft => ({ ...draft, rows: pastedRows(page.tableNK) }));
        kit.snapshotCatalogs('other-catalog-other-nk', [`user${path.sep}${theirs.catalogId}.catalog.json`]);
    },

    // A Coating Library entry applied to a default design
    // (coatingLibrary/applyCoating.js applyCoatingPatch, as the library's Apply
    // button calls it): its rii: materials travel inside the design, and no
    // catalog anywhere holds them.
    'coating-library-applied': async (kit) => {
        const { makeDefaultDesign } = await kit.mod('state/DesignContext.js');
        const { BUILTIN_COATINGS } = await kit.mod('utils/coatingLibrary/builtin/index.js');
        const { applyCoatingPatch } = await kit.mod('utils/coatingLibrary/applyCoating.js');
        const entry = BUILTIN_COATINGS.find(e => e.id === 'ar-bbar-400-700-ta2o5-mgf2-4l');
        const design = makeDefaultDesign('Library BBAR 400-700');
        const { patch } = applyCoatingPatch(design, entry, { side: 'front', mode: 'replace' });
        await writeDesign(kit, { ...design, ...patch });
    },

    // A silicon plate coated on both sides, evaluated through the whole part
    // near the band edge, where the substrate absorbs part of the light.
    'absorbing-substrate-both-sides-total': async (kit) => {
        await writeDesign(kit, await stackFormulaDesign(kit, {
            name: 'Si plate both sides', text: 'L H L', side: 'both', refLambda: 1000,
            symbolMap: { H: 'builtin:Ta2O5', L: 'builtin:SiO2' }, substrate: 'builtin:Si',
        }));
    },

    // A coating on the back face only.
    'back-only-side': async (kit) => {
        await writeDesign(kit, await stackFormulaDesign(kit, {
            name: 'Back face AR', text: 'L 2H', side: 'back',
            symbolMap: { H: 'builtin:Al2O3', L: 'builtin:MgF2' },
        }));
    },

    // Both faces coated, the front optimized and scored through the whole part
    // (the Surface Mode bar's front-only mode with the full-system score).
    'front-only-total-mode': async (kit) => {
        const design = await stackFormulaDesign(kit, {
            name: 'Front scored through part', text: 'L 2H', side: 'both',
            symbolMap: { H: 'builtin:Al2O3', L: 'builtin:MgF2' },
        });
        await writeDesign(kit, { ...design, surfaceMode: 'front_only', mfEvalMode: 'total' });
    },

    // The Specification window's visible broadband AR preset with the merit
    // function generated from it (useSpecificationState.js generateMFFrom),
    // and below it one row of every other operand family, each made by
    // makeOperand, the factory the merit table's Add row uses, with its fields
    // set.
    'operand-families': async (kit) => {
        const { applyPreset } = await kit.mod('utils/synthesis/qualifierPresets.js');
        const { qualifiersToMFOperands } = await kit.mod('utils/synthesis/qualifiers.js');
        const { makeOperand, makeConstraintOperand } = await kit.mod('utils/physics/optimizer.js');
        let design = await stackFormulaDesign(kit, {
            name: 'Operand families', text: 'L 2H 0.5M H',
            symbolMap: { H: 'builtin:Ta2O5', M: 'builtin:Al2O3', L: 'builtin:MgF2' },
        });
        const qualifiers = applyPreset('BBAR_VIS');
        design = { ...design, qualifiers };
        const fromSpec = qualifiersToMFOperands(qualifiers, { design });
        const rav = makeOperand({ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, target: 0.005, weight: 1 });
        const r550 = makeOperand({ type: 'R', lambdaStart: 550, lambdaEnd: 550, target: 0, weight: 1 });
        const rows = [
            ...fromSpec,
            rav, r550,
            makeOperand({ type: 'T', lambdaStart: 600, lambdaEnd: 600, aoi: 45, pol: 's', target: 0.99, weight: 1 }),
            makeOperand({ type: 'AAV', lambdaStart: 400, lambdaEnd: 700, target: 0, weight: 1 }),
            makeOperand({ type: 'TGT', lambdaStart: 450, lambdaEnd: 650, target: 0.99, targetEnd: 0.98, weight: 1 }),
            makeOperand({ type: 'TIW', lambdaStart: 380, lambdaEnd: 780, target: 0.99, weight: 1 }),
            makeOperand({ type: 'RMX', lambdaStart: 450, lambdaEnd: 650, target: 0.01, weight: 1 }),
            makeOperand({ type: 'TMN', lambdaStart: 450, lambdaEnd: 650, aoi: 30, target: 0.98, weight: 1 }),
            makeOperand({ type: 'MNWR', lambdaStart: 450, lambdaEnd: 700, weight: 1 }),
            makeOperand({ type: 'OPLT', refId: rav.id, target: 0.01, weight: 1 }),
            makeOperand({ type: 'DIFF', refId1: rav.id, refId2: r550.id, target: 0, weight: 1 }),
            makeOperand({ type: 'TT', target: 400, weight: 1 }),
            makeConstraintOperand({ type: 'MNT', lambdaStart: 1, lambdaEnd: 4, target: 10 }),
            makeOperand({ type: 'PSI', lambdaStart: 633, lambdaEnd: 633, aoi: 70, target: 40, weight: 1 }),
            makeOperand({ type: 'PR', lambdaStart: 550, lambdaEnd: 550, target: 0, weight: 1 }),
            makeOperand({ type: 'GD', lambdaStart: 550, lambdaEnd: 550, target: 0, weight: 1 }),
            makeOperand({ type: 'GDD', lambdaStart: 550, lambdaEnd: 550, target: 0, weight: 1 }),
            makeOperand({ type: 'EFMX', lambdaStart: 550, lambdaEnd: 550, target: 1, weight: 1 }),
            makeOperand({ type: 'TDB', lambdaStart: 550, lambdaEnd: 550, target: 0, weight: 1 }),
            makeOperand({ type: 'ODMN', lambdaStart: 450, lambdaEnd: 650, target: 0, weight: 1 }),
            makeOperand({ type: 'BLNK', comment: 'Operand families' }),
        ];
        await writeDesign(kit, { ...design, meritOperands: rows });
    },

    // A pulse spectrum applied in the Pulse Analysis window
    // (usePulseAnalysis.js:75-82: the curve editor reads a two-column table,
    // Apply keeps it on the design), on a chirped mirror start, with a GDD row.
    'pulse-spectrum': async (kit) => {
        const { emptyTable } = await kit.mod('components/windows/dataExchange/curveEditor/curveTable.js');
        const { tableFromText } = await kit.mod('components/windows/dataExchange/curveEditor/tableText.js');
        const { pulseSpectrumFromTable } = await kit.mod('components/windows/dataExchange/curveEditor/curveApply.js');
        const { makeOperand } = await kit.mod('utils/physics/optimizer.js');
        let design = await stackFormulaDesign(kit, {
            name: 'Chirped mirror start', text: '(H L)^8', refLambda: 800,
            symbolMap: { H: 'builtin:Ta2O5', L: 'builtin:SiO2' },
        });
        // A Gaussian spectrum, 800 nm centre and 40 nm FWHM in wavelength, as a
        // spectrometer export lists it.
        const lines = ['Wavelength (nm)\tIntensity'];
        for (let lam = 720; lam <= 880; lam += 4) {
            lines.push(`${lam}\t${Math.exp(-4 * Math.LN2 * ((lam - 800) / 40) ** 2).toFixed(6)}`);
        }
        const read = tableFromText(lines.join('\n'), emptyTable('pulse'), 'ti-sapphire spectrum.txt');
        if (read.error) throw new Error(`pulse table: ${read.error}`);
        design = {
            ...design, pulseSpectrum: pulseSpectrumFromTable(read.table),
            meritOperands: [makeOperand({ type: 'GDD', lambdaStart: 760, lambdaEnd: 840, target: -50, weight: 1 })],
        };
        await writeDesign(kit, design);
    },

    // ── Written by a short script on purpose ───────────────────────────────

    // A design file saved by another program: Notepad's UTF-8 with a byte
    // order mark, under a file name that is not the name inside it.
    'foreign-utf8-bom-renamed': async (kit) => {
        const design = await stackFormulaDesign(kit, {
            name: 'MgF2 single layer', text: 'L', symbolMap: { L: 'builtin:MgF2' },
        });
        const text = JSON.stringify({ tfs_version: '1.2', ...design }, null, 2).replace(/\n/g, '\r\n');
        kit.writeRaw('MgF2 single layer (edited).tfs', Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(text, 'utf8')]));
    },

    // A design file written by PowerShell 5.1's Set-Content -Encoding Unicode:
    // UTF-16 LE with a byte order mark, and no id, as a hand-made file has none.
    'foreign-utf16-no-id': async (kit) => {
        const design = await stackFormulaDesign(kit, {
            name: 'Two-layer V-coat', text: 'L 0.5H', symbolMap: { H: 'builtin:Al2O3', L: 'builtin:MgF2' },
        });
        // eslint-disable-next-line no-unused-vars
        const { id, ...withoutId } = design;
        const text = JSON.stringify({ tfs_version: '1.2', ...withoutId }, null, 2).replace(/\n/g, '\r\n');
        kit.writeRaw('Two-layer V-coat.tfs', Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(text, 'utf16le')]));
    },

    // A file as a newer release might write it: format 1.3, with fields this
    // release does not know at the top level, on the substrate, on layers of
    // both sides and on an operand, and on the embedded copy of a material.
    'newer-release-unknown-fields': async (kit) => {
        const { makeOperand } = await kit.mod('utils/physics/optimizer.js');
        const { embedDesignMaterials } = await kit.mod('utils/materials/designMaterials.js');
        const cm = await kit.mod('utils/materials/catalogManager.js');
        await startCatalogs(kit);
        const lab = cm.createUserCatalog('Lab');
        const ta2o5 = cm.copyMaterialToCatalog(cm.getMaterialById('builtin:Ta2O5'), lab.id);
        let design = await stackFormulaDesign(kit, {
            name: 'Newer release AR', text: 'L H', side: 'both',
            symbolMap: { H: `${lab.id}:${ta2o5.id}`, L: 'builtin:MgF2' },
        });
        design = embedDesignMaterials({
            ...design,
            meritOperands: [makeOperand({ type: 'RAV', lambdaStart: 500, lambdaEnd: 600, target: 0, weight: 1 })],
        });
        const id = `${lab.id}:${ta2o5.id}`;
        const future = {
            tfs_version: '1.3',
            ...design,
            substrate: { ...design.substrate, wedgeArcmin: 2, futureSubstrate: { coating: 'none' } },
            frontLayers: design.frontLayers.map((layer, i) => (i === 0 ? { ...layer, gradedProfile: { kind: 'linear', steps: 8 } } : layer)),
            backLayers: design.backLayers.map((layer, i) => (i === 0 ? { ...layer, futureLayerNote: 'back' } : layer)),
            meritOperands: design.meritOperands.map(op => ({ ...op, futureOperandField: 7, futureOperandObject: { k: 'v' } })),
            materials: { [id]: { ...design.materials[id], futureMaterialField: 'kept' } },
            futureTopLevel: { mode: 'x', list: [1, 2, 3] },
            futureNull: null,
        };
        kit.writeRaw('Newer release AR.tfs', JSON.stringify(future, null, 2));
    },
};
