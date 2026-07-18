/**
 * MaterialPicker — custom material selector dropdown with catalog browser and search.
 *
 * Replaces the native <select> MaterialSelect. Supports both legacy builtin IDs
 * (e.g. 'BK7') and compound catalog IDs (e.g. 'schott:N-BK7'). The dropdown
 * shell (trigger, overlay, search, catalog tabs) is the shared PickerDropdown;
 * this module supplies the material-specific search, labels, and colours.
 */

import { getCatalogs, getMaterialById, searchMaterials, materialLabel, resolveColor } from '../../utils/materials/catalogManager.js';
import { PickerDropdown } from './PickerDropdown.js';

const { createElement: h } = React;

/**
 * @param {string}   value       current material ID (legacy or compound)
 * @param {function} onChange    called with new compound material ID
 * @param {object}   c           color palette
 * @param {object}   t           locale
 * @param {boolean}  [compact]   true = narrow trigger (layer rows), false = full-width (media rows)
 */
export function MaterialPicker({ value, onChange, c, t, compact }) {
    const mp = t.materialPicker;

    const resolvedId = value || 'builtin:Air';
    const mat = getMaterialById(resolvedId) || getMaterialById('builtin:Air');
    const dotColor = mat ? resolveColor(mat) : '#888';
    const label = mat ? (mat.name || materialLabel(resolvedId)) : materialLabel(resolvedId);

    // Catalog filter tabs, resolved fresh so newly-scanned catalogs appear.
    const groups = getCatalogs().map(cat => ({ id: cat.id, label: cat.name }));

    const isActiveMaterial = (item) =>
        resolvedId === item.id ||
        (resolvedId === `builtin:${item.matId}` && item.catalogId === 'builtin') ||
        (value === item.matId && item.catalogId === 'builtin');

    const search = (query, groupId) =>
        searchMaterials(query, groupId).map(({ catalogId, catalogName, material }) => ({
            id: `${catalogId}:${material.id}`,
            matId: material.id,
            catalogId,
            group: catalogId,
            label: material.name || material.id,
            color: resolveColor(material),
            badge: catalogId !== 'builtin' ? catalogName : null,
        }));

    return h(PickerDropdown, {
        value: resolvedId, onChange, c, compact,
        triggerLabel: label, triggerColor: dotColor,
        groups, search, isActive: isActiveMaterial,
        searchPlaceholder: mp.searchPlaceholder,
        allLabel: mp.allCatalogs,
        emptyText: 'No materials found',
    });
}
