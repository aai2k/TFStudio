import { useSpectrumTableEditor } from './useSpectrumTableEditor.js';

const { createElement: h } = React;

function tableEditorStyles(c) {
    return {
        overlay: {
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
        },
        modal: {
            background: c.panel, color: c.text, border: `1px solid ${c.border}`,
            borderRadius: 6, width: 520, maxHeight: '85vh',
            display: 'flex', flexDirection: 'column',
            fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: 12,
            boxShadow: '0 12px 36px rgba(0,0,0,0.5)',
        },
        header: {
            padding: '8px 12px', borderBottom: `1px solid ${c.border}`,
            background: c.bg, fontWeight: 600,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        },
        body: { padding: '8px 12px', overflow: 'auto', flex: 1 },
        footer: {
            padding: '8px 12px', borderTop: `1px solid ${c.border}`, background: c.bg,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
        },
        btn: {
            padding: '4px 12px', fontSize: 12, cursor: 'pointer',
            border: `1px solid ${c.border}`, borderRadius: 3,
            background: 'transparent', color: c.text, outline: 'none',
        },
        btnPrimary: {
            padding: '4px 14px', fontSize: 12, cursor: 'pointer',
            border: `1px solid ${c.accent}`, borderRadius: 3,
            background: c.accent + '33', color: c.text, outline: 'none', fontWeight: 600,
        },
        cellInput: {
            backgroundColor: 'transparent', color: c.text, border: 'none',
            fontSize: 12, padding: '2px 4px', fontFamily: 'system-ui, -apple-system, sans-serif',
            outline: 'none', width: '100%', boxSizing: 'border-box',
            fontVariantNumeric: 'tabular-nums', textAlign: 'right',
        },
        th: {
            padding: '3px 6px', textAlign: 'left', fontSize: 11,
            color: c.textDim, fontWeight: 600, letterSpacing: '0.03em',
            borderBottom: `1px solid ${c.border}`, userSelect: 'none',
            position: 'sticky', top: 0, background: c.panel, zIndex: 1,
        },
    };
}

function tableCellStyle(model, c, rowIndex, columnIndex) {
    const focused = model.focusCell?.ri === rowIndex && model.focusCell?.ci === columnIndex;
    return {
        padding: 0,
        border: `1px solid ${focused ? c.accent : c.border}`,
        background: focused ? c.accent + '14'
            : (rowIndex % 2 === 0 ? 'transparent' : c.panel + 'aa'),
        outline: focused ? `1px solid ${c.accent}` : 'none',
        outlineOffset: -1,
    };
}

function SpectrumTableGrid(props) {
    const { model, styles, c, iv } = props;
    return h('div', { style: { border: `1px solid ${c.border}`, borderRadius: 3, overflow: 'hidden' } },
        h('table', { style: { width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: 12 } },
            h('colgroup', null,
                h('col', { style: { width: '47%' } }),
                h('col', { style: { width: '47%' } }),
                h('col', { style: { width: '6%' } }),
            ),
            h('thead', null,
                h('tr', null,
                    h('th', { style: styles.th }, iv.tableColLam),
                    h('th', { style: styles.th }, iv.tableColValue),
                    h('th', { style: styles.th }, ''),
                ),
            ),
            h('tbody', null,
                model.rows.map((row, rowIndex) =>
                    h('tr', { key: rowIndex },
                        [0, 1].map(columnIndex => h('td', {
                            key: columnIndex,
                            style: tableCellStyle(model, c, rowIndex, columnIndex),
                        },
                            h('input', {
                                ref: element => {
                                    const key = model.refKey(rowIndex, columnIndex);
                                    if (element) model.inputRefs.current[key] = element;
                                    else delete model.inputRefs.current[key];
                                },
                                type: 'number', step: 'any', value: row[columnIndex],
                                onChange: event => model.updateCell(rowIndex, columnIndex, event.target.value),
                                onFocus: () => model.setFocusCell({ ri: rowIndex, ci: columnIndex }),
                                onKeyDown: event => model.keyDown(rowIndex, columnIndex, event),
                                onPaste: event => model.paste(rowIndex, event),
                                style: styles.cellInput,
                            }),
                        )),
                        h('td', { style: { ...tableCellStyle(model, c, rowIndex, 2), textAlign: 'center' } },
                            h('button', {
                                onClick: () => model.deleteRow(rowIndex), tabIndex: -1, title: iv.tableDelRow,
                                style: { background: 'none', border: 'none', color: c.textDim, cursor: 'pointer', fontSize: 14, padding: '0 4px', lineHeight: 1 },
                            }, '×'),
                        ),
                    ),
                ),
            ),
        ),
    );
}

function EditorActions(props) {
    const { model, styles, iv } = props;
    return h('div', { style: { marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' } },
        h('button', { onClick: model.addRow, style: styles.btn }, iv.tableAddRow),
        h('button', { onClick: model.clear, style: styles.btn }, iv.tableClear),
        h('button', { onClick: () => model.fileRef.current?.click(), style: styles.btn }, iv.tableImport),
        h('button', { onClick: model.exportCsv, style: styles.btn }, iv.tableExport),
        h('input', {
            ref: model.fileRef, type: 'file', accept: '.csv,.txt,.tsv',
            onChange: model.importCsv, style: { display: 'none' },
        }),
    );
}

function EditorFooter(props) {
    const { model, styles, c, iv, onCancel } = props;
    return h('div', { style: styles.footer },
        h('span', { style: { color: c.textDim, fontSize: 10 } },
            `${model.rows.length} ${model.rows.length === 1 ? 'row' : 'rows'}  ·  Enter/↓ next  ·  Tab → next col  ·  paste CSV/TSV anywhere`),
        h('div', null,
            h('button', { onClick: onCancel, style: { ...styles.btn, marginRight: 6 } }, iv.tableCancel),
            h('button', { onClick: model.apply, style: styles.btnPrimary }, iv.tableApply),
        ),
    );
}

export function SpectrumTableEditor(props) {
    const { open, label, onCancel, c, t } = props;
    const iv = t.integralValues;
    const model = useSpectrumTableEditor(props);
    const styles = tableEditorStyles(c);
    if (!open) return null;

    return h('div', { style: styles.overlay, onClick: event => { if (event.target === event.currentTarget) onCancel(); } },
        h('div', { style: styles.modal },
            h('div', { style: styles.header },
                h('span', null, `${iv.tableEditorTitle}${label ? ` — ${label}` : ''}`),
                h('button', { onClick: onCancel, style: { ...styles.btn, padding: '2px 8px' } }, '×'),
            ),
            h('div', { style: styles.body },
                h('div', { style: { color: c.textDim, fontSize: 11, marginBottom: 6 } }, iv.tableEditorHint),
                h('div', { style: { color: c.textDim, fontSize: 10, marginBottom: 8 } }, iv.tablePasteHint),
                h(SpectrumTableGrid, { model, styles, c, iv }),
                h(EditorActions, { model, styles, iv }),
                model.err && h('div', { style: { marginTop: 6, color: '#ef5350', fontSize: 11 } }, model.err),
            ),
            h(EditorFooter, { model, styles, c, iv, onCancel }),
        ),
    );
}
