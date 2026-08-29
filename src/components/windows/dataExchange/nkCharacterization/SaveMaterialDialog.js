/**
 * Naming the material, choosing where it goes, and seeing it first.
 *
 * The preview beside the fields is the record the save writes: its own n and k
 * curve and the table behind it. A dispersion model can be a good fit to a
 * measurement and still be a poor material outside the wavelengths that decided
 * it, and the table is where that shows.
 */

import { ResultsGrid } from '../../../ui/ResultsSection.js';
import { drawChart, useChartTeardown } from '../../../ui/plotSurface.js';
import { ActionButton, FieldLabel, SelectField } from '../../analysis/chrome/controls.js';
import { paletteFrom } from './charts.js';
import {
    buildPreviewOption, previewColumns, previewMaterial, previewRows,
} from './materialPreview.js';
import { DEFAULT_CATALOG_NAME, NEW_CATALOG_ID } from './saveMaterial.js';

const { createElement: h, useEffect, useMemo, useRef } = React;

const textFieldStyle = c => ({
    height: 28, width: '100%', boxSizing: 'border-box',
    background: c.field, color: c.text, border: `1px solid ${c.border}`,
    borderRadius: 4, padding: '0 7px', outline: 'none', fontSize: 12,
});

/** A first dialog state, for the caller to hold. */
export function newSaveDialogState(name, catalogs) {
    return {
        name,
        catalogId: catalogs[0]?.id || NEW_CATALOG_ID,
        catalogName: DEFAULT_CATALOG_NAME,
        error: '',
    };
}

export function saveDialogIncomplete(dialog) {
    return !dialog.name.trim()
        || (dialog.catalogId === NEW_CATALOG_ID && !dialog.catalogName.trim());
}

function PreviewChart({ material, c }) {
    const divRef = useRef(null);
    const chartRef = useRef(null);
    useEffect(() => {
        drawChart(divRef.current, chartRef, buildPreviewOption(material, paletteFrom(c)));
    });
    useChartTeardown(divRef, chartRef);
    return h('div', { ref: divRef, style: { width: '100%', height: 160, flexShrink: 0 } });
}

function LabelledField({ c, label, children }) {
    return h('label', { style: { display: 'flex', flexDirection: 'column', gap: 5 } },
        h(FieldLabel, { c }, label),
        children,
    );
}

function Preview({ c, nk, material }) {
    const rows = useMemo(() => previewRows(material), [material]);
    const [low, high] = material.dispersionFit.rangeNm;
    return h('div', {
        style: { flex: '1 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 },
    },
        h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8 } },
            h('div', { style: { fontSize: 12, fontWeight: 600 } }, nk.previewTitle),
            h('div', { style: { fontSize: 11, color: c.textDim } },
                nk.previewSampled(Math.round(low), Math.round(high), rows.length)),
        ),
        h(PreviewChart, { material, c }),
        h('div', { style: { border: `1px solid ${c.border}`, borderRadius: 4, overflow: 'hidden' } },
            h(ResultsGrid, { columns: previewColumns({ lambda: nk.previewLambda }), rows, c, height: 150 })),
    );
}

/**
 * @param dialog      state from `newSaveDialogState`
 * @param onChange    patch => void
 * @param onSave      (openDesign:boolean) => void
 * @param canOpenDesign  false when there is no project folder to create one in
 */
export function SaveMaterialDialog({
    c, nk, result, catalogs, dialog, onChange, onSave, onCancel, canOpenDesign,
}) {
    // Built from the result alone: the name and the destination decide where the
    // record goes, not what is in it, so typing a name does not resample it.
    const material = useMemo(() => previewMaterial(result), [result]);
    const catalogOptions = [
        ...catalogs.map(catalog => ({ id: catalog.id, label: catalog.name })),
        { id: NEW_CATALOG_ID, label: nk.newCatalog },
    ];
    const incomplete = saveDialogIncomplete(dialog);

    // The backdrop does not dismiss. This dialog holds typed-in text and a
    // preview worth reading, and a stray click beside it should not throw both
    // away; Cancel is the way out.
    return h('div', {
        style: {
            position: 'fixed', inset: 0, zIndex: 300,
            background: 'rgba(0,0,0,0.35)', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
        },
    }, h('form', {
        role: 'dialog', 'aria-modal': true, 'aria-label': nk.saveTitle,
        onSubmit: (event) => { event.preventDefault(); if (!incomplete) onSave(false); },
        style: {
            width: 680, maxWidth: 'calc(100vw - 32px)', maxHeight: 'calc(100vh - 32px)',
            overflowY: 'auto', padding: 16,
            background: c.panel, color: c.text,
            border: `1px solid ${c.border}`, borderRadius: 7,
            boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
            display: 'flex', flexDirection: 'column', gap: 12,
        },
    },
        h('div', { style: { fontSize: 13, fontWeight: 600 } }, nk.saveTitle),
        h('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap' } },
            h('div', {
                style: {
                    flex: '1 1 220px', minWidth: 200, maxWidth: 260,
                    display: 'flex', flexDirection: 'column', gap: 10,
                },
            },
                h(LabelledField, { c, label: nk.materialName },
                    h('input', {
                        autoFocus: true, type: 'text', value: dialog.name,
                        onChange: event => onChange({ name: event.target.value }),
                        style: textFieldStyle(c),
                    })),
                h(LabelledField, { c, label: nk.catalog },
                    h(SelectField, {
                        c, width: '100%', value: dialog.catalogId,
                        onChange: catalogId => onChange({ catalogId }),
                        options: catalogOptions,
                    })),
                dialog.catalogId === NEW_CATALOG_ID && h(LabelledField, { c, label: nk.catalogName },
                    h('input', {
                        type: 'text', value: dialog.catalogName,
                        onChange: event => onChange({ catalogName: event.target.value }),
                        style: textFieldStyle(c),
                    })),
                h('div', { style: { fontSize: 11, color: c.textDim, lineHeight: 1.45 } },
                    nk.openDesignHint),
                dialog.error && h('div', { style: { color: c.error, fontSize: 11 } }, dialog.error),
            ),
            h(Preview, { c, nk, material }),
        ),
        h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8 } },
            h(ActionButton, { c, label: nk.cancel, onClick: onCancel }),
            h(ActionButton, {
                c, label: nk.save, title: nk.saveHint,
                disabled: incomplete, onClick: () => onSave(false),
            }),
            h(ActionButton, {
                c, label: nk.saveAndOpen,
                title: canOpenDesign ? nk.openDesignHint : nk.openDesignNoFolder,
                disabled: incomplete || !canOpenDesign, onClick: () => onSave(true),
            }),
        ),
    ));
}
