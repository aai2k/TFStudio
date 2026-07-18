import { OPERAND_TYPES } from '../../../../../utils/physics/optimizer.js';
import { PickerDropdown } from '../../../../ui/PickerDropdown.js';

const { createElement: h } = React;

// Category order for the operand type picker's tabs and section headers.
const TYPE_GROUP_ORDER = ['optical', 'range', 'rangetarget', 'integral', 'worst', 'phase', 'math', 'argwave', 'thick', 'misc'];

// Ordered [{ group, label, types[] }] built from the live locale so a new
// operand group appears automatically once its types carry that `group`.
function operandCategories(t) {
    const operandTypes  = t?.meritFunctionEditor?.operandTypes  || {};
    const operandGroups = t?.meritFunctionEditor?.operandGroups || {};
    const byGroup = new Map();
    for (const type of OPERAND_TYPES) {
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
export function OperandTypePicker({ value, onChange, c, t }) {
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

    return h(PickerDropdown, {
        value, onChange, c, compact: true,
        triggerLabel: value, triggerColor: null,
        groups, search, sections: true, minDropWidth: 380,
        searchPlaceholder: mp.searchPlaceholder || 'Search…',
        allLabel: mp.allCatalogs || 'All',
        emptyText: 'No operands found',
    });
}
