export const EMPTY_TABLE_ROWS = [[0, 0], [0, 0]];

const FIXED_DIRECTIONS = {
    Enter: 'down',
    ArrowDown: 'down',
    ArrowUp: 'up',
};

export function cloneTableRows(table) {
    const source = table?.length ? table : EMPTY_TABLE_ROWS;
    return source.map(row => [...row]);
}

export function updateTableCell(rows, rowIndex, columnIndex, rawValue) {
    const value = parseFloat(rawValue);
    const next = rows.map(row => [...row]);
    next[rowIndex][columnIndex] = Number.isFinite(value) ? value : rawValue;
    return next;
}

export function appendTableRow(rows) {
    const last = rows[rows.length - 1] || [0, 0];
    const wavelength = Number.isFinite(last[0]) ? last[0] + 10 : 0;
    return [...rows, [wavelength, 0]];
}

export function deleteTableRow(rows, rowIndex) {
    return rows.length <= 1 ? rows : rows.filter((_, index) => index !== rowIndex);
}

export function pasteTableRows(rows, startRow, parsedRows) {
    const next = rows.map(row => [...row]);
    for (let offset = 0; offset < parsedRows.length; offset++) {
        const index = startRow + offset;
        if (index < next.length) next[index] = parsedRows[offset];
        else next.push(parsedRows[offset]);
    }
    return next;
}

export function cleanTableRows(rows) {
    return rows
        .map(row => [parseFloat(row[0]), parseFloat(row[1])])
        .filter(row => Number.isFinite(row[0]) && Number.isFinite(row[1]))
        .sort((a, b) => a[0] - b[0]);
}

export function tableRowsTsv(rows) {
    return rows.map(row => `${row[0]}\t${row[1]}`).join('\n');
}

export function tableRowsCsv(rows) {
    return '# λ_nm, value\n' + rows
        .filter(row => Number.isFinite(row[0]) && Number.isFinite(row[1]))
        .map(row => `${row[0]}, ${row[1]}`).join('\n') + '\n';
}

export function tableKeyAction(event) {
    let action = FIXED_DIRECTIONS[event.key]
        ? { kind: 'navigate', direction: FIXED_DIRECTIONS[event.key] }
        : null;
    if (event.key === 'Tab') {
        action = { kind: 'navigate', direction: event.shiftKey ? 'left' : 'right' };
    } else if (event.key === 'ArrowRight' && (event.target.selectionStart ?? 0) === (event.target.value?.length ?? 0)) {
        action = { kind: 'navigate', direction: 'right' };
    } else if (event.key === 'ArrowLeft' && (event.target.selectionStart ?? 0) === 0) {
        action = { kind: 'navigate', direction: 'left' };
    } else if (event.ctrlKey && event.key === 'Delete') {
        action = { kind: 'deleteRow' };
    } else if (event.ctrlKey && event.key === 'c') {
        action = { kind: 'copyRows' };
    }
    return action;
}

export function navigateTableCell(rowIndex, columnIndex, direction, rowCount) {
    let result = null;
    if (direction === 'down' || direction === 'up') {
        const nextRow = rowIndex + (direction === 'down' ? 1 : -1);
        if (nextRow >= 0 && nextRow < rowCount) result = { focus: [nextRow, columnIndex] };
        else if (direction === 'down') result = { append: true };
    } else {
        const delta = direction === 'right' ? 1 : -1;
        const nextColumn = columnIndex + delta;
        const nextRow = rowIndex + delta;
        if (nextColumn >= 0 && nextColumn < 2) result = { focus: [rowIndex, nextColumn] };
        else if (nextRow >= 0 && nextRow < rowCount) result = { focus: [nextRow, delta > 0 ? 0 : 1] };
    }
    return result;
}
