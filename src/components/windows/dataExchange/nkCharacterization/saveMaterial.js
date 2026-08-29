/**
 * Storing a characterized film as a material.
 *
 * The point of the whole window: a film that was measured becomes a material the
 * rest of the application can design with, so a stack is optimized against the
 * index the coater actually deposits rather than the one a data sheet quotes.
 */

import {
    createUserCatalog, generateMaterialId, getCatalogs, saveUserMaterial,
} from '../../../../utils/materials/catalogManager.js';
import { characterizedMaterial } from './model.js';

export const DEFAULT_CATALOG_NAME = 'Characterized films';
export const NEW_CATALOG_ID = '__new__';

/** The user catalogs a characterized material can be written to. */
export function userCatalogs() {
    return getCatalogs().filter(catalog => catalog.source === 'user');
}

/**
 * Write the result into the user catalog the user selected.
 *
 * There is deliberately no "first user catalog" fallback. That made the
 * destination depend on catalog ordering and could put a measured material in
 * an unrelated catalog without saying so. When no user catalog exists yet, or
 * when the explicit "new catalog" choice is used, a named catalog is created.
 *
 * @returns {{ catalogId:string, materialId:string, name:string }}
 */
export function saveCharacterizedMaterial(result, {
    catalogId, catalogName = DEFAULT_CATALOG_NAME, name,
}) {
    const catalogs = userCatalogs();
    let target;
    if (catalogId === NEW_CATALOG_ID || (catalogs.length === 0 && !catalogId)) {
        target = createUserCatalog(catalogName.trim() || DEFAULT_CATALOG_NAME);
    } else {
        target = catalogs.find(catalog => catalog.id === catalogId);
        if (!target) throw new Error('A destination catalog must be selected.');
    }
    const materialId = generateMaterialId(target.id, name);
    const material = characterizedMaterial(result, { id: materialId, name });
    saveUserMaterial(target.id, material);
    return {
        catalogId: target.id, catalogName: target.name,
        materialId, name: material.name,
    };
}

/** A first name for the material, from the curves it was characterized from. */
export function suggestedMaterialName(design, chosen) {
    const source = chosen[0]?.name?.trim();
    if (source) return source.replace(/\s*\((T|R|A)\)\s*$/i, '');
    return `${design?.name || 'Film'} film`;
}
