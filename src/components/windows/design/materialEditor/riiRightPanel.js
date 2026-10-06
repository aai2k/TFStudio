/**
 * RIIBrowser right panel: selected-material details, the formula a formula
 * page is computed from, the samples as a plot or a table with n and k at a
 * typed wavelength, and the add-to-catalog action bar (including the
 * destination-catalog picker).
 */

import {
    leftOutRanges, riiCatalogFormula, riiToMaterialEntry, sampleMaterial, sampledRangeNm,
} from '../../../../utils/materials/riiDatabase.js';
import { FORMULA_NAMES, coefficientNames, formulaLatex } from '../../../../utils/materials/dispersionFormulas.js';
import { makeGetNK } from '../../../../utils/materials/catalogManager/dispersion.js';
import { materialRangeNm } from '../../../../utils/materials/materialRange.js';
import { ActionButton, FieldLabel, SelectField } from '../../analysis/chrome/controls.js';
import { TabBtn } from '../../../ui/tabBtn.js';
import { KaTeXSpan, NkProbe, coefficientChips, formatCoeffFull } from './materialEditorUI.js';
import { readOnlyNkTable } from './materialEditorReadOnly.js';
import { RiiChart } from './riiChart.js';

const { createElement: h } = React;

// The span that will be plotted beside this line and stored if the material is
// added, not the range the database record declares: a table often declares a
// wider range than its rows cover. Below 100 nm whole nanometres are too coarse,
// so a page starting at 27.5 nm does not read as 28.
const nmText = value => (value >= 100 ? Math.round(value) : Number(value.toPrecision(3)));

export function wlRange(mat) {
    const range = sampledRangeNm(mat);
    if (!range) return '—';
    return `${nmText(range[0])}–${nmText(range[1])} nm`;
}

// What the page's n,k come from: its table where it has one, otherwise its
// formula, by the number and name the database gives it. A separate k table
// beside an n table or a formula counts: its k is in every sample.
export function typeLabel(mat, rii) {
    if (mat.tableNK) return mat.type === 'tabulated_n' && !mat.tableK?.length ? rii.typeTabulatedN : rii.typeTabulatedNk;
    if (mat.riiFormulaNum) {
        const name = FORMULA_NAMES[riiCatalogFormula(mat.riiFormulaNum)] || '';
        return mat.tableK?.length
            ? rii.typeFormulaTabulatedK(mat.riiFormulaNum, name)
            : rii.typeFormula(mat.riiFormulaNum, name);
    }
    return mat.type;
}

const rangeText = ([from, to]) => (from === to ? `${nmText(from)} nm` : `${nmText(from)}–${nmText(to)} nm`);

/**
 * Why a page cannot be sampled, in the user's language where the sampler
 * says which case it is, otherwise the error's own message.
 */
export function sampleErrorText(err, rii) {
    if (err?.riiNoRealN) return rii.noRealN(err.riiFormula, nmText(err.riiNoRealN[0]), nmText(err.riiNoRealN[1]));
    if (err?.riiFormula) return rii.unknownFormula(err.riiFormula);
    return err?.message ?? String(err);
}

// The samples, the formula grid points left out because the formula gives no
// real n there, and why the page cannot be sampled at all, or null when it can.
// A page the importer cannot evaluate stays an error inside the browser
// instead of taking down the window.
function sampleState(mat, rii) {
    try {
        return { rows: sampleMaterial(mat), leftOut: leftOutRanges(mat), error: null };
    } catch (err) {
        return { rows: [], leftOut: [], error: sampleErrorText(err, rii) };
    }
}

// The page as it is stored once added to a catalog, read the way the catalog
// reads it: the n and k a design computes with, inside the range and beyond
// it, and the range a design is warned outside of, which a k table shorter
// than the formula narrows.
const storedOf = new WeakMap();
function storedMaterial(mat) {
    if (!storedOf.has(mat)) {
        const entry = riiToMaterialEntry(mat, '', '');
        const getNK = entry && makeGetNK(entry);
        storedOf.set(mat, { getNK, rangeNm: getNK ? materialRangeNm({ ...entry, getNK }) : null });
    }
    return storedOf.get(mat);
}

function renderInfoGrid(s, leftOut) {
    const { c, rii, selected, mat } = s;
    return h('div', {
        style: {
            padding: '10px 14px 6px', flexShrink: 0,
            display: 'grid', gridTemplateColumns: 'auto 1fr',
            gap: '3px 14px', fontSize: 12,
        },
    },
        h('span', { style: { color: c.textDim } }, rii.book),
        h('span', { style: { color: c.text, fontWeight: 600 } }, selected.bookName),
        h('span', { style: { color: c.textDim } }, rii.page),
        h('span', { style: { color: c.text } }, selected.pageName),
        h('span', { style: { color: c.textDim } }, rii.type),
        h('span', { style: { color: c.text } }, typeLabel(mat, rii)),
        h('span', { style: { color: c.textDim } }, rii.wavelengthRange),
        h('span', { style: { color: c.text } }, wlRange(mat)),
        leftOut.length > 0 && h('span', { style: { gridColumn: '1 / -1', color: '#e6a23c', fontSize: 11 } },
            rii.leftOut(leftOut.map(rangeText).join(', '))),
    );
}

// The formula written out for as many coefficients as the page gives, as the
// Material Editor writes it, with every digit of each value. A page with a
// table is read from the table, so it shows no formula.
function renderFormulaBlock(s) {
    const { c, rii, mat } = s;
    if (mat.tableNK || !mat.formulaCoeffs) return null;
    const formulaNum = riiCatalogFormula(mat.riiFormulaNum);
    const latex = formulaLatex(formulaNum, mat.formulaCoeffs.length);
    if (!latex) return null;
    const names = coefficientNames(formulaNum, mat.formulaCoeffs.length);
    return h('div', {
        style: {
            margin: '0 14px 8px', padding: '6px 8px',
            backgroundColor: c.panel, border: `1px solid ${c.border}`, borderRadius: 4,
        },
    },
        h('div', { style: { fontSize: 11, color: c.textDim, marginBottom: 2 } },
            `${rii.typeFormula(mat.riiFormulaNum, FORMULA_NAMES[formulaNum])} · ${rii.formulaUnits}`),
        h('div', { style: { fontSize: 13, color: c.text, overflowX: 'auto', overflowY: 'hidden', marginBottom: 4 } },
            h(KaTeXSpan, { latex, displayMode: true })),
        coefficientChips(names, mat.formulaCoeffs, c, formatCoeffFull)
    );
}

function renderSampleTabs(s, rows) {
    const { c, rii, me, mat, sampleTab, setSampleTab, wavelengthLabel } = s;
    const tab = sampleTab === 'table' ? 'table' : 'plot';
    return [
        h('div', {
            key: 'strip',
            style: {
                display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0, padding: '0 8px',
                borderTop: `1px solid ${c.border}`, borderBottom: `1px solid ${c.border}`, backgroundColor: c.panel,
            },
        },
            h(TabBtn, { c, active: tab === 'plot', onClick: () => setSampleTab('plot') }, rii.plotTab),
            h(TabBtn, { c, active: tab === 'table', onClick: () => setSampleTab('table') }, me.nkTable)),
        tab === 'plot'
            ? h(RiiChart, { key: 'plot', material: mat, c, xLabel: wavelengthLabel })
            : h('div', { key: 'table', style: { flex: 1, minHeight: 160, display: 'flex', flexDirection: 'column' } },
                readOnlyNkTable(`${mat.tableNK ? me.nkTable : me.nkTableSampled} (${rows.length})`, rows, c,
                    { borderTop: 'none', padding: '6px 14px 4px' }, true)),
        h('div', { key: 'probe', style: { padding: '6px 14px', flexShrink: 0, borderTop: `1px solid ${c.border}` } },
            h(NkProbe, { key: mat.dataPath, ...storedMaterial(mat), c, me })),
    ];
}

function renderCatalogPicker(s) {
    const { c, rii, userCatalogs, targetCatId, setTargetCatId, doAdd, setPhase } = s;
    const options = [
        ...userCatalogs.map(cat => ({ id: cat.id, label: cat.name })),
        { id: '__new__', label: rii.newCatalogOption },
    ];
    return [
        h(FieldLabel, { key: 'lbl', c }, rii.catalogLabel),
        h('div', { key: 'sel', style: { flex: 1, minWidth: 0 } },
            h(SelectField, { c, width: '100%', value: targetCatId, onChange: setTargetCatId, options })),
        h(ActionButton, { key: 'add', c, label: rii.addButton, onClick: () => doAdd(targetCatId) }),
        h(ActionButton, { key: 'cancel', c, label: rii.cancel, onClick: () => setPhase('idle') }),
    ];
}

// The target catalog already holds this page in another form, or another
// material under its id: the add waits for the user's answer.
function renderConflictChoice(s) {
    const { c, rii, addMsg, conflict, doAdd, setPhase } = s;
    return [
        h('span', { key: 'msg', style: { flex: 1, minWidth: 0, fontSize: 12, color: '#e6a23c' } }, addMsg),
        h(ActionButton, { key: 'replace', c, label: rii.replace, onClick: () => doAdd(conflict.catId, 'replace') }),
        h(ActionButton, { key: 'keep', c, label: rii.keepBoth, onClick: () => doAdd(conflict.catId, 'keep') }),
        h(ActionButton, { key: 'cancel', c, label: rii.cancel, onClick: () => setPhase('idle') }),
    ];
}

function renderActionBar(s) {
    const { c, rii, phase, addMsg, handleAddClick } = s;
    return h('div', {
        style: {
            padding: '8px 14px', borderTop: `1px solid ${c.border}`,
            flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8,
        },
    },
        phase === 'ok'    && h('span', { style: { fontSize: 12, color: '#58d68d' } }, addMsg),
        phase === 'error' && h('span', { style: { fontSize: 12, color: '#ec7063' } }, addMsg),
        phase === 'picking' && renderCatalogPicker(s),
        phase === 'conflict' && renderConflictChoice(s),
        (phase === 'idle' || phase === 'ok') && h('div', { style: { marginLeft: 'auto' } },
            h(ActionButton, { c, label: rii.addToCatalog, onClick: handleAddClick }))
    );
}

// The details, the reference and the formula scroll as one block when they need
// more height than the dialog leaves beside the tabs and the action bar, so a
// formula with many coefficients cannot push Add to Catalog out of the window.
function renderMaterialDetails(s) {
    const { c, rii, mat } = s;
    const { rows, leftOut, error } = sampleState(mat, rii);
    return h('div', { style: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' } },
        h('div', { style: { flex: '0 1 auto', minHeight: 0, overflowY: 'auto' } },
            renderInfoGrid(s, leftOut),
            mat.references && h('div', {
                style: {
                    padding: '0 14px 6px',
                    fontSize: 11, color: c.textDim, lineHeight: 1.5,
                    maxHeight: 52, overflow: 'hidden',
                },
            }, mat.references.length > 280 ? mat.references.slice(0, 280) + '…' : mat.references),
            renderFormulaBlock(s)),
        error
            ? h('div', { style: { flex: 1, minHeight: 160, padding: '8px 14px', color: '#ec7063', fontSize: 12 } },
                rii.cannotPlot(error))
            : renderSampleTabs(s, rows),
        renderActionBar(s)
    );
}

export function renderRiiRightPanel(s) {
    const { c, rii, selected, matLoading, matErr, mat } = s;
    const centered = { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' };
    return h('div', { style: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' } },
        !selected && h('div', { style: { ...centered, color: c.textDim, fontSize: 13, fontStyle: 'italic' } }, rii.selectMaterial),
        selected && matLoading && h('div', { style: { ...centered, color: c.textDim, fontSize: 13 } }, rii.loadingMaterial),
        selected && matErr && h('div', { style: { flex: 1, padding: 16, color: '#ec7063', fontSize: 12 } }, matErr),
        selected && mat && !matLoading && renderMaterialDetails(s)
    );
}
