/**
 * Network/offline-mirror access for refractiveindex.info-database YAML files.
 */

export const RII_RAW_BASE = 'https://raw.githubusercontent.com/polyanskiy/refractiveindex.info-database/main/database';
export const CATALOG_URL  = RII_RAW_BASE + '/catalog-nk.yml';

/**
 * Fetch a YAML document, preferring the offline mirror, then the network.
 * On a successful network fetch the raw text is written back into the mirror so
 * the same material is available offline next time.
 *
 * @param {string} localRel  path inside the mirror, e.g. 'catalog-nk.yml' or 'data/main/Ag/nk/Johnson.yml'
 * @param {string} url       network fallback URL
 */
export async function fetchYamlCached(localRel, url) {
    const api = window.electronAPI;
    // 1. Offline mirror (bundled snapshot or a previously cached fetch).
    if (api?.riiReadLocal) {
        try {
            const local = await api.riiReadLocal(localRel);
            if (local?.success) return local.data;
        } catch (_) { /* fall through to network */ }
    }
    // 2. Network.
    const result = await api.riiFetchYaml(url);
    if (!result.success) throw new Error('RII fetch failed (' + localRel + '): ' + result.error);
    // 3. Best-effort cache for future offline use.
    if (api?.riiWriteLocal && typeof result.text === 'string') {
        try { await api.riiWriteLocal(localRel, result.text); } catch (_) {}
    }
    return result.data;
}
