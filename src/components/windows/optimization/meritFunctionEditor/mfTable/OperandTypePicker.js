import { GENERATED_ONLY_OPERAND_TYPES, OPERAND_TYPES } from '../../../../../utils/physics/optimizer.js';
import { PickerDropdown } from '../../../../ui/PickerDropdown.js';
import { triggerEl } from '../../../../ui/pickerTrigger.js';

const { createElement: h } = React;

// Category order for the operand type picker's tabs and section headers.
const TYPE_GROUP_ORDER = ['optical', 'range', 'rangetarget', 'integral', 'worst', 'log', 'phase', 'math', 'argwave', 'thick', 'misc'];

// Ordered [{ group, label, types[] }] built from the live locale so a new
// operand group appears automatically once its types carry that `group`.
function operandCategories(t) {
    const operandTypes  = t?.meritFunctionEditor?.operandTypes  || {};
    const operandGroups = t?.meritFunctionEditor?.operandGroups || {};
    const byGroup = new Map();
    for (const type of OPERAND_TYPES) {
        if (GENERATED_ONLY_OPERAND_TYPES.includes(type)) continue;
        const group = operandTypes[type]?.group || 'optical';
        if (!byGroup.has(group)) byGroup.set(group, []);
        byGroup.get(group).push(type);
    }
    const ordered = [...TYPE_GROUP_ORDER, ...[...byGroup.keys()].filter(g => !TYPE_GROUP_ORDER.includes(g))];
    return ordered
        .filter(group => byGroup.has(group))
        .map(group => ({ group, label: operandGroups[group] || group, types: byGroup.get(group) }));
}

// Searchable, grouped replacement for the operand type <select>, mirroring the
// Design Editor's material picker: a search box, category tabs, and category
// section headers (grouped by operand category instead of material catalog).
// It is the Type cell while that cell is edited, so its trigger is drawn bare:
// the cell's own code in the cell's own font, with the chevron beside it,
// exactly as closedOperandType draws the cell the rest of the time.
export function OperandTypePicker({ value, onChange, c, t, autoOpen = false, initialQuery = '', onClose }) {
    const operandTypes = t?.meritFunctionEditor?.operandTypes || {};
    const mp = t?.materialPicker || {};
    const categories = operandCategories(t);
    const groups = categories.map(cat => ({ id: cat.group, label: cat.label }));

    const labelOf = (type) => operandTypes[type]?.label || type;

    const search = (query, groupId) => {
        const q = (query || '').toLowerCase().trim();
        const rows = [];
        for (const cat of categories) {
            if (groupId && cat.group !== groupId) continue;
            for (const type of cat.types) {
                const label = labelOf(type);
                if (q && !type.toLowerCase().includes(q) && !label.toLowerCase().includes(q)) continue;
                rows.push({ id: type, label, group: cat.group, title: label });
            }
        }
        return rows;
    };

    // The category holding the current operand gets its tab marked, the way
    // the material picker marks the catalog its material comes from.
    const currentCategory = categories.find(cat => cat.types.includes(value));

    return h(PickerDropdown, {
        value, onChange, c, compact: true,
        triggerLabel: value, triggerColor: null,
        groups, search, sections: true, minDropWidth: 380,
        currentGroup: currentCategory ? currentCategory.group : null,
        autoOpen, initialQuery, onClose, bare: true, openOnDoubleClick: true,
        searchPlaceholder: mp.searchPlaceholder || 'Search…',
        allLabel: mp.allCatalogs || 'All',
        emptyText: t.meritFunctionEditor.noOperandsFound,
    });
}

/**
 * A Type cell not being edited, drawn as the closed operand picker, chevron and
 * all, so it reads as a cell that picks from a list. A table runs to thousands
 * of rows, so no picker stands behind it: `open` puts one in the cell, on a
 * click on the chevron or a double-click.
 */
export function closedOperandType(type, open) {
    return triggerEl({
        compact: true, bare: true, open: false, openOnDoubleClick: true, triggerLabel: type, onTrigger: open,
    });
}
