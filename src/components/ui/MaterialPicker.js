/**
 * MaterialPicker — custom material selector dropdown with catalog browser and search.
 *
 * Replaces the native <select> MaterialSelect. Supports both legacy builtin IDs
 * (e.g. 'BK7') and compound catalog IDs (e.g. 'schott:N-BK7'). The dropdown
 * shell (trigger, overlay, search, catalog tabs) is the shared PickerDropdown;
 * this module supplies the material-specific search, labels, and colours.
 */

import { getCatalogs, getMaterialById, searchMaterials, materialLabel, resolveColor } from '../../utils/materials/catalogManager.js';
import { DESIGN_CATALOG_ID } from '../../utils/materials/designCatalog.js';
import { designMaterialIds, resolveDesignMaterial } from '../../utils/materials/designMaterials.js';
import { DesignContext } from '../../state/DesignContext.js';
import { PickerDropdown } from './PickerDropdown.js';

const { createElement: h, useContext } = React;

/**
 * The materials the active design already uses, listed under their own reference
 * ids so picking one writes the id the design resolves.
 *
 * They come first because a design's own materials are the likely choice for its
 * next layer, and because a material embedded in a travelling .tfs has no local
 * catalog to be found in. Ids are matched against the design's `materials` block
 * before the catalogs, so an embedded definition wins over a local material of
 * the same name — the same precedence the spectrum is computed with.
 */
export function designEntries(design, query) {
    if (!design) return [];
    const q = (query || '').toLowerCase().trim();
    return designMaterialIds(design)
        .map(id => ({ id, ...resolveDesignMaterial(design, id) }))
        .filter(entry => entry.status !== 'missing')
        .filter(({ id, material }) => !q
            || id.toLowerCase().includes(q)
            || (material.name || '').toLowerCase().includes(q));
}

/**
 * Dot colour and name for the closed trigger.
 *
 * An id that resolves nowhere keeps its own name: showing Air would make a
 * broken design look repaired even though its stored reference is intact.
 */
function triggerAppearance(design, id) {
    const resolved = design ? resolveDesignMaterial(design, id) : null;
    const material = resolved && resolved.status !== 'missing'
        ? resolved.material
        : getMaterialById(id);
    return {
        dotColor: material ? resolveColor(material) : '#888',
        label: material ? (material.name || materialLabel(id)) : materialLabel(id),
    };
}

function designRows(design, query, designLabel) {
    return designEntries(design, query).map(({ id, material, status }) => ({
        id, matId: id, catalogId: DESIGN_CATALOG_ID, group: DESIGN_CATALOG_ID,
        label: material.name || id,
        color: resolveColor(material),
        badge: status === 'embedded' ? designLabel : null,
    }));
}

function catalogRows(query, groupId) {
    return searchMaterials(query, groupId).map(({ catalogId, catalogName, material }) => ({
        id: `${catalogId}:${material.id}`,
        matId: material.id,
        catalogId,
        group: catalogId,
        label: material.name || material.id,
        color: resolveColor(material),
        badge: catalogId !== 'builtin' ? catalogName : null,
    }));
}

/**
 * Whether a row carries the current value.
 *
 * A material the design already uses is listed twice, in the design group and in
 * the catalog it came from. The catalog row takes the mark, so the picker opens
 * on where the material actually comes from; the design group keeps it only for a
 * definition that travelled inside the file and has no catalog on this machine.
 */
export function rowIsCurrent(item, { value, resolvedId, inCatalog }) {
    const matches = resolvedId === item.id
        || (resolvedId === `builtin:${item.matId}` && item.catalogId === 'builtin')
        || (value === item.matId && item.catalogId === 'builtin');
    if (!matches) return false;
    return item.group !== DESIGN_CATALOG_ID || !inCatalog;
}

/**
 * The catalog tab the picker opens on: the one holding the current material, or
 * the design group when only the design carries its definition. `all` when the id
 * resolves nowhere, which leaves the list showing everything there is to pick.
 */
export function currentGroupOf(design, resolvedId) {
    if (getMaterialById(resolvedId)) {
        return resolvedId.includes(':') ? resolvedId.slice(0, resolvedId.indexOf(':')) : 'builtin';
    }
    return resolveDesignMaterial(design, resolvedId).status === 'embedded' ? DESIGN_CATALOG_ID : 'all';
}

/**
 * @param {string}   value       current material ID (legacy or compound)
 * @param {function} onChange    called with new compound material ID
 * @param {object}   c           color palette
 * @param {object}   t           locale
 * @param {boolean}  [compact]   true = narrow trigger (layer rows), false = full-width (media rows)
 * @param {boolean}  [catalogsOnly] hide the open design's own materials, for
 *                   callers that build a stack outside it and resolve ids
 *                   against the catalogs alone
 */
export function MaterialPicker({ value, onChange, c, t, compact, catalogsOnly }) {
    const mp = t.materialPicker;
    // Read directly rather than through useDesign(): the picker is also mounted
    // by windows that do not sit under a design provider.
    const context = useContext(DesignContext);
    const design = catalogsOnly ? null : (context?.design || null);

    const resolvedId = value || 'builtin:Air';
    const { dotColor, label } = triggerAppearance(design, resolvedId);
    const inCatalog = getMaterialById(resolvedId) != null;
    const designIds = new Set(designMaterialIds(design));
    // Catalog filter tabs, resolved fresh so newly-scanned catalogs appear.
    const groups = [
        ...(designIds.size > 0 ? [{ id: DESIGN_CATALOG_ID, label: mp.designCatalog }] : []),
        ...getCatalogs().map(cat => ({ id: cat.id, label: cat.name })),
    ];

    const search = (query, groupId) => [
        ...(groupId && groupId !== DESIGN_CATALOG_ID
            ? [] : designRows(design, query, mp.designCatalog)),
        ...(groupId === DESIGN_CATALOG_ID ? [] : catalogRows(query, groupId)),
    ];

    return h(PickerDropdown, {
        value: resolvedId, onChange, c, compact,
        triggerLabel: label, triggerColor: dotColor,
        groups, search, sections: true,
        openGroup: currentGroupOf(design, resolvedId),
        isActive: item => rowIsCurrent(item, { value, resolvedId, inCatalog }),
        searchPlaceholder: mp.searchPlaceholder,
        allLabel: mp.allCatalogs,
        emptyText: 'No materials found',
    });
}
