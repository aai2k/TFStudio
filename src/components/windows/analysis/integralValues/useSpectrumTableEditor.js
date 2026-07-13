import { parseSpectrumCSV } from '../../../../utils/physics/spectralWeightings.js';
import {
    appendTableRow,
    cleanTableRows,
    cloneTableRows,
    deleteTableRow,
    navigateTableCell,
    pasteTableRows,
    tableKeyAction,
    tableRowsCsv,
    tableRowsTsv,
    updateTableCell,
} from './tableModel.js';

const { useState, useEffect, useRef, useCallback } = React;

function focusKey(rowIndex, columnIndex) {
    return `${rowIndex}_${columnIndex}`;
}

function copyRows(context) {
    const selection = window.getSelection?.()?.toString();
    if (!selection) {
        context.event.preventDefault();
        navigator.clipboard?.writeText(tableRowsTsv(context.rows)).catch(() => {});
    }
}

const KEY_HANDLERS = {
    navigate(context, action) {
        context.event.preventDefault();
        context.navigate(context.rowIndex, context.columnIndex, action.direction);
    },
    deleteRow(context) {
        context.event.preventDefault();
        context.deleteRow(context.rowIndex);
    },
    copyRows,
};

function handleTableKey(context) {
    const action = tableKeyAction(context.event);
    if (action) KEY_HANDLERS[action.kind](context, action);
}

function readCsvFile(event, context) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        try {
            const parsed = parseSpectrumCSV(String(reader.result || ''));
            if (parsed.length < 2) {
                context.setError(context.iv.tableNeedTwoRows);
            } else {
                context.setRows(parsed);
                context.setError(null);
            }
        } catch (error) {
            context.setError(error.message || String(error));
        }
    };
    reader.onerror = () => context.setError(context.iv.csvErrorRead);
    reader.readAsText(file);
    event.target.value = '';
}

function downloadCsv(rows, label) {
    const blob = new Blob([tableRowsCsv(rows)], { type: 'text/csv' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = (label || 'spectrum') + '.csv';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
}

export function useSpectrumTableEditor(props) {
    const { open, initialTable, label, onApply, t } = props;
    const iv = t.integralValues;
    const [rows, setRows] = useState(() => cloneTableRows(initialTable));
    const [err, setErr] = useState(null);
    const [focusCell, setFocusCell] = useState(null);
    const inputRefs = useRef({});
    const fileRef = useRef(null);

    useEffect(() => {
        if (open) {
            setRows(cloneTableRows(initialTable));
            setErr(null);
            setFocusCell(null);
            inputRefs.current = {};
        }
    }, [open, initialTable]);

    const focusInput = useCallback((rowIndex, columnIndex) => {
        const input = inputRefs.current[focusKey(rowIndex, columnIndex)];
        if (input) {
            input.focus();
            input.select();
        }
        setFocusCell({ ri: rowIndex, ci: columnIndex });
    }, []);

    const addRow = () => {
        setRows(current => appendTableRow(current));
        const newIndex = rows.length;
        setTimeout(() => focusInput(newIndex, 0), 0);
    };
    const deleteRow = (rowIndex) => {
        if (rows.length <= 1) return;
        setRows(current => deleteTableRow(current, rowIndex));
        const targetRow = Math.max(0, Math.min(rowIndex, rows.length - 2));
        setTimeout(() => focusInput(targetRow, focusCell?.ci ?? 0), 0);
    };
    const navigate = (rowIndex, columnIndex, direction) => {
        const movement = navigateTableCell(rowIndex, columnIndex, direction, rows.length);
        if (movement?.focus) focusInput(...movement.focus);
        else if (movement?.append) addRow();
    };
    const paste = (rowIndex, event) => {
        const text = event.clipboardData?.getData('text') || '';
        if (!/[\n;,\t]/.test(text)) return;
        const parsed = parseSpectrumCSV(text);
        if (parsed.length === 0) return;
        event.preventDefault();
        setRows(current => pasteTableRows(current, rowIndex, parsed));
    };
    const apply = () => {
        const clean = cleanTableRows(rows);
        if (clean.length < 2) {
            setErr(iv.tableNeedTwoRows);
        } else {
            onApply(clean);
        }
    };
    const keyDown = (rowIndex, columnIndex, event) => handleTableKey({
        event, rowIndex, columnIndex, rows, navigate, deleteRow,
    });

    return {
        rows,
        err,
        focusCell,
        inputRefs,
        fileRef,
        refKey: focusKey,
        setFocusCell,
        updateCell: (rowIndex, columnIndex, raw) => setRows(
            current => updateTableCell(current, rowIndex, columnIndex, raw),
        ),
        addRow,
        deleteRow,
        clear: () => { setRows(cloneTableRows()); setFocusCell(null); },
        paste,
        importCsv: event => readCsvFile(event, { setRows, setError: setErr, iv }),
        exportCsv: () => downloadCsv(rows, label),
        apply,
        keyDown,
    };
}
