/**
 * Material Editor: import dialog for material files from other coating
 * programs (TFCalc .mat, Essential Macleod .tfx / .mtx, OptiLayer .lm / .sub).
 *
 * The picked files are parsed here, under the wavelength-unit settings shown
 * in the footer, so changing a unit re-reads the whole batch; more files can
 * be added to the batch from the header. The left side lists every material
 * with its program and data type, plus the files that could not be read; the
 * right side previews the highlighted material (formula or table rows, n/k
 * chart). Ticked materials go to the chosen catalog, or to a new one named in
 * the footer, on Import. The dialog closes only through Cancel or Import.
 */

import { parseMaterialFiles } from '../../../../utils/materials/materialFileImport.js';
import { makeGetNK } from '../../../../utils/materials/catalogManager/dispersion.js';
import { FORMULA_NAMES } from '../../../../utils/materials/dispersionFormulas.js';
import { TFCALC_N_FORMULAS, TFCALC_K_FORMULAS } from '../../../../utils/materials/tfcalcParser.js';
import { MACLEOD_N_MODELS } from '../../../../utils/materials/macleodParser.js';
import { sampleReadOnlyChart, readOnlyFormulaBlock, readOnlyNkTable } from './materialEditorReadOnly.js';
import { clearMaterialChart } from './materialChart.js';
import { smallBtn, catTabStyle, formatNm } from './materialEditorUI.js';

const { createElement: h, useState, useMemo, useEffect, useRef } = React;

const fieldStyle = (c) => ({
    height: 24, boxSizing: 'border-box', backgroundColor: c.bg, color: c.text,
    border: `1px solid ${c.border}`, borderRadius: 3, fontSize: 12, padding: '0 6px',
    outline: 'none', fontFamily: 'inherit', maxWidth: 220,
});

// Data-type label in the source program's own terms, so a TFCalc "Sellmeier 3"
// is not listed under the Zemax formula name it maps onto.
function typeLabel(item, me) {
    const e = item.entry;
    const sampledFrom = e.tfcalc?.sampledFrom;
    if (e.formulaNum === -1) {
        return sampledFrom ? me.importTypeSampled(e.tabData.length, sampledFrom) : me.importTypeTable(e.tabData.length);
    }
    if (e.tfcalc) {
        let label = TFCALC_N_FORMULAS[e.tfcalc.nCode] || FORMULA_NAMES[e.formulaNum];
        if (e.tfcalc.kCode > 1) label += ', ' + me.importTypeK(TFCALC_K_FORMULAS[e.tfcalc.kCode]);
        return label;
    }
    if (e.macleod) {
        return me.importTypeTerms(MACLEOD_N_MODELS[e.macleod.nType] || FORMULA_NAMES[e.formulaNum], e.macleod.terms);
    }
    return FORMULA_NAMES[e.formulaNum] || String(e.formulaNum);
}

function cell(content, extra) {
    return h('td', { style: { padding: '3px 8px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', ...extra } }, content);
}

function headCell(label, c, extra) {
    return h('th', {
        style: { textAlign: 'left', padding: '4px 8px', color: c.textDim, fontWeight: 600, fontSize: 11,
                 borderBottom: `1px solid ${c.border}`, position: 'sticky', top: 0, backgroundColor: c.panel, ...extra }
    }, label);
}

function renderList({ items, errors, currentItem, excluded, toggle, setCurrent, me, c }) {
    return h('div', { style: { flex: '1 1 55%', minWidth: 0, overflow: 'auto', borderRight: `1px solid ${c.border}` } },
        h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 12, tableLayout: 'fixed' } },
            h('thead', null, h('tr', null,
                headCell('', c, { width: 26 }),
                headCell(me.importColMaterial, c),
                headCell(me.importColProgram, c, { width: 120 }),
                headCell(me.importColType, c),
                headCell(me.importColGroup, c, { width: 78 })
            )),
            h('tbody', null, items.map(item => {
                const off = excluded.has(item.fileIndex);
                return h('tr', {
                    key: item.fileIndex,
                    onClick: () => setCurrent(item.fileIndex),
                    style: { cursor: 'pointer', backgroundColor: currentItem === item ? c.accent + '22' : 'transparent', color: off ? c.textDim : c.text },
                },
                    cell(h('input', {
                        type: 'checkbox', checked: !off,
                        onClick: e => e.stopPropagation(),
                        onChange: () => toggle(item.fileIndex),
                    })),
                    cell(item.entry.name, { title: item.file }),
                    cell(me.importProgramName[item.program]),
                    cell(typeLabel(item, me)),
                    cell(item.entry.group)
                );
            }))
        ),
        errors.length > 0 && h('div', { style: { padding: '8px 8px 4px', fontSize: 11 } },
            h('div', { style: { color: c.textDim, textTransform: 'uppercase', letterSpacing: 1, fontSize: 10, marginBottom: 4 } }, me.importFailedFiles),
            errors.map(err => h('div', { key: err.fileIndex, style: { color: '#e74c3c', marginBottom: 2, wordBreak: 'break-word' } },
                `${err.file}: ${err.code === 'unsupported-type' ? me.importUnsupportedFile : err.error}`))
        )
    );
}

function renderPreview({ currentItem, sampled, chartRef, me, c }) {
    const entry = currentItem?.entry;
    const details = !entry
        ? h('div', { style: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: c.textDim, fontStyle: 'italic', fontSize: 12 } }, me.importPreviewEmpty)
        : h('div', { style: { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' } },
            h('div', { style: { padding: '8px 12px', flexShrink: 0 } },
                h('div', { style: { fontSize: 14, fontWeight: 600 } }, entry.name),
                h('div', { style: { fontSize: 11, color: c.textDim, marginTop: 2 } },
                    `${me.importProgramName[currentItem.program]} · ${typeLabel(currentItem, me)} · ${me.importSourceFile}: ${currentItem.file}`),
                entry.lambdaMin && h('div', { style: { fontSize: 11, color: c.textDim, marginTop: 2 } },
                    `${me.lambdaRange}: ${formatNm(entry.lambdaMin * 1000)} – ${formatNm(entry.lambdaMax * 1000)} nm`),
                entry.macleod?.internalTransmittance && h('div', { style: { fontSize: 11, color: '#e6a23c', marginTop: 4 } }, me.importInternalTransmittance),
                entry.comment && h('div', { style: { fontSize: 11, color: c.textDim, marginTop: 4 } }, entry.comment)
            ),
            readOnlyFormulaBlock(entry, me, c),
            entry.formulaNum === -1
                ? readOnlyNkTable(`${me.nkTable} (${entry.tabData.length})`, entry.tabData, c)
                : sampled.length > 0 && readOnlyNkTable(`${me.nkTableSampled} (${sampled.length})`, sampled, c)
        );
    return h('div', { style: { flex: '1 1 45%', minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' } },
        details,
        h('div', { style: { height: 190, flexShrink: 0, borderTop: `1px solid ${c.border}`, padding: '4px 4px 0' } },
            h('div', { ref: chartRef, style: { height: 182 } })
        )
    );
}

export function MaterialImportDialog({ fileImport, setFileImport, catalogs, onCommit, me, c }) {
    const { files, units } = fileImport;
    const parsed = useMemo(() => parseMaterialFiles(files, units), [files, units]);
    const [excluded, setExcluded] = useState(() => new Set());
    const [current, setCurrent] = useState(null);
    // Imports land in a user catalog unless the user points them elsewhere.
    const [target, setTarget] = useState(() => catalogs.find(cat => cat.source === 'user')?.id || '__new__');
    const [newName, setNewName] = useState(me.importedCatalogDefault);
    const [pickError, setPickError] = useState(null);
    const [sampled, setSampled] = useState([]);
    const chartRef = useRef(null);

    const { items, errors } = parsed;
    const currentItem = items.find(item => item.fileIndex === current) || items[0] || null;
    const selectedEntries = items.filter(item => !excluded.has(item.fileIndex)).map(item => item.entry);
    const programs = new Set([...items.map(item => item.program), ...errors.map(err => err.program).filter(Boolean)]);

    useEffect(() => {
        const el = chartRef.current;
        if (!el) return undefined;
        if (!currentItem) { clearMaterialChart(el); setSampled([]); return undefined; }
        const mat = { ...currentItem.entry, getNK: makeGetNK(currentItem.entry) };
        setSampled(sampleReadOnlyChart(el, mat, c, me));
        return () => clearMaterialChart(el);
    }, [currentItem, c]);

    const toggle = (fileIndex) => setExcluded(prev => {
        const next = new Set(prev);
        if (next.has(fileIndex)) next.delete(fileIndex); else next.add(fileIndex);
        return next;
    });
    const setUnit = (program, value) => setFileImport({ ...fileImport, units: { ...units, [program]: value } });

    // Append another pick to the batch; indices of the files already listed
    // stay put, so ticks and the highlighted row survive.
    const addFiles = async () => {
        try {
            const result = await window.electronAPI.importMaterialFiles();
            if (result.canceled) return;
            if (!result.success) { setPickError(result.error || me.unknownError); return; }
            setPickError(null);
            setFileImport({ ...fileImport, files: [...files, ...result.files] });
        } catch (err) {
            setPickError(err.message);
        }
    };

    const unitSwitch = (program, label, options) => h('div', { style: { display: 'flex', alignItems: 'center', gap: 4 } },
        h('span', { style: { fontSize: 11, color: c.textDim, marginRight: 2 } }, label),
        options.map(([value, text]) => h('button', {
            key: value, onClick: () => setUnit(program, value), style: catTabStyle(units[program] === value, c),
        }, text))
    );

    const header = h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderBottom: `1px solid ${c.border}`, flexShrink: 0 } },
        h('span', { style: { fontSize: 14, fontWeight: 600 } }, me.importDialogTitle),
        h('span', { style: { fontSize: 11, color: c.textDim } }, me.importDialogSummary(items.length, errors.length)),
        pickError && h('span', { style: { fontSize: 11, color: '#e74c3c' } }, me.importError(pickError)),
        h('div', { style: { marginLeft: 'auto', display: 'flex', gap: 6 } },
            h('button', { onClick: addFiles, style: smallBtn(c) }, me.importAddFiles),
            h('button', { onClick: () => setExcluded(new Set()), style: smallBtn(c) }, me.importSelectAll),
            h('button', { onClick: () => setExcluded(new Set(items.map(item => item.fileIndex))), style: smallBtn(c) }, me.importSelectNone)
        )
    );

    const footer = h('div', { style: { display: 'flex', alignItems: 'center', gap: 14, padding: '8px 12px', borderTop: `1px solid ${c.border}`, flexWrap: 'wrap', flexShrink: 0 } },
        programs.has('tfcalc') && unitSwitch('tfcalc', me.importUnitTfcalc, [['nm', 'nm'], ['um', 'µm']]),
        programs.has('macleod') && unitSwitch('macleod', me.importUnitMacleod, [['auto', me.importUnitAuto], ['nm', 'nm'], ['um', 'µm']]),
        h('div', { style: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 } },
            h('span', { style: { fontSize: 11, color: c.textDim } }, me.importInto),
            h('select', { value: target, onChange: e => setTarget(e.target.value), style: fieldStyle(c) },
                catalogs.filter(cat => cat.id !== 'builtin').map(cat => h('option', { key: cat.id, value: cat.id }, cat.name)),
                h('option', { value: '__new__' }, me.importTargetNew)
            ),
            target === '__new__' && h('input', {
                value: newName,
                onChange: e => setNewName(e.target.value),
                placeholder: me.importNewCatalogName,
                title: me.importNewCatalogName,
                style: { ...fieldStyle(c), width: 180 },
            }),
            h('button', { onClick: () => setFileImport(null), style: smallBtn(c) }, me.importCancel),
            h('button', {
                onClick: () => onCommit(target, selectedEntries, newName.trim() || me.importedCatalogDefault),
                disabled: selectedEntries.length === 0,
                style: smallBtn(c, { backgroundColor: c.accent, color: '#fff', borderColor: c.accent, opacity: selectedEntries.length ? 1 : 0.5 }),
            }, me.importButton(selectedEntries.length))
        )
    );

    return h('div', {
        style: { position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' }
    },
        h('div', {
            style: { width: 'min(940px, 94vw)', height: 'min(620px, 90vh)', display: 'flex', flexDirection: 'column',
                     background: c.panel, border: `1px solid ${c.border}`, borderRadius: 6, boxShadow: '0 6px 24px rgba(0,0,0,0.4)',
                     color: c.text, fontSize: 12, overflow: 'hidden' }
        },
            header,
            h('div', { style: { flex: 1, display: 'flex', minHeight: 0 } },
                renderList({ items, errors, currentItem, excluded, toggle, setCurrent, me, c }),
                renderPreview({ currentItem, sampled, chartRef, me, c })
            ),
            footer
        )
    );
}
