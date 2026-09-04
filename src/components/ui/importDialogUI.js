/**
 * Table cells and the text field style shared by the file import dialogs
 * (material files in the Material Editor, design files from the Project
 * group). Both dialogs list what was read on the left and preview one item
 * on the right in the same compact table layout.
 */

const { createElement: h } = React;

export const fieldStyle = (c) => ({
    height: 24, boxSizing: 'border-box', backgroundColor: c.bg, color: c.text,
    border: `1px solid ${c.border}`, borderRadius: 3, fontSize: 12, padding: '0 6px',
    outline: 'none', fontFamily: 'inherit', maxWidth: 220,
});

// A body cell: single line, clipped with an ellipsis unless `extra` says otherwise.
export function cell(content, extra) {
    return h('td', { style: { padding: '3px 8px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', ...extra } }, content);
}

// A header cell that stays put while the table scrolls.
export function headCell(label, c, extra) {
    return h('th', {
        style: { textAlign: 'left', padding: '4px 8px', color: c.textDim, fontWeight: 600, fontSize: 11,
                 borderBottom: `1px solid ${c.border}`, position: 'sticky', top: 0, backgroundColor: c.panel, ...extra }
    }, label);
}
