import { getCurrentLocale, getLocale } from '../../constants/locales/index.js';

// The built-in catalog is named in the UI language; every other catalog by its
// own name.
export function catalogLabel(cat) {
    return cat.id === 'builtin' ? getLocale(getCurrentLocale()).pool.builtinCatalog : cat.name;
}
