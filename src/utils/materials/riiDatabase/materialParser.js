/**
 * Material YAML fetching and parsing (RII "DATA" block list → tables / formula).
 */

import { fetchYamlCached, RII_RAW_BASE } from './fetch.js';
import { cache } from './cache.js';
import { _stripHtml } from './htmlUtils.js';

/**
 * Fetch and parse one material YAML by its dataPath (relative to /database/data/).
 * Example dataPath: "main/Ag/nk/Johnson.yml"
 *
 * Returns:
 * {
 *   dataPath,
 *   references: string,
 *   comments:   string,
 *   type:       'tabulated_nk' | 'tabulated_n' | 'formula' | 'mixed',
 *   riiFormulaNum: number | null,   // refractiveindex.info formula number (1-9); NOT Zemax AGF formula numbers
 *   formulaCoeffs: number[] | null,
 *   wavelengthRange: [lmin_nm, lmax_nm] | null,
 *   tableNK:    [[lam_nm, n, k], ...] | null,   // from tabulated block
 *   tableK:     [[lam_nm, k], ...]    | null,   // from separate k block
 * }
 */
export async function fetchMaterial(dataPath) {
    if (cache.materials[dataPath]) return cache.materials[dataPath];

    const doc = await fetchYamlCached('data/' + dataPath, RII_RAW_BASE + '/data/' + dataPath);
    const mat = _parseMaterialDoc(doc, dataPath);
    cache.materials[dataPath] = mat;
    return mat;
}

function _parseTable2(text) {
    if (!text) return [];
    const rows = [];
    for (const line of text.trim().split('\n')) {
        const p = line.trim().split(/\s+/);
        if (p.length >= 2) {
            const lam_nm = parseFloat(p[0]) * 1000;
            rows.push([lam_nm, parseFloat(p[1]), p[2] !== undefined ? parseFloat(p[2]) : 0]);
        }
    }
    return rows;
}

function _applyFormulaBlock(block, btype, state) {
    const m = btype.match(/formula\s+(\d+)/);
    state.riiFormulaNum = m ? parseInt(m[1]) : null;
    state.formulaCoeffs = (block.coefficients || '').trim().split(/\s+/).map(Number);
    const wl = (block.wavelength_range || '').trim().split(/\s+/);
    state.wavelengthRange = wl.length === 2
        ? [parseFloat(wl[0]) * 1000, parseFloat(wl[1]) * 1000]
        : null;
    state.type = state.tableNK ? 'mixed' : 'formula';
}

function _applyBlock(block, state) {
    const btype = (block.type || '').toLowerCase();
    if (btype.includes('tabulated nk')) {
        state.tableNK = _parseTable2(block.data);
        state.type = 'tabulated_nk';
    } else if (btype.includes('tabulated n') && !btype.includes('nk')) {
        // only n, k=0
        state.tableNK = _parseTable2(block.data).map(([l,n]) => [l,n,0]);
        state.type = 'tabulated_n';
    } else if (btype.includes('tabulated k')) {
        state.tableK = _parseTable2(block.data);
    } else if (btype.startsWith('formula')) {
        _applyFormulaBlock(block, btype, state);
    }
}

function _parseMaterialDoc(doc, dataPath) {
    const refs    = _stripHtml((doc.REFERENCES || '').replace(/\s+/g, ' ').trim());
    const comment = _stripHtml((doc.COMMENTS   || '').replace(/\s+/g, ' ').trim());
    const blocks  = doc.DATA || [];

    const state = {
        tableNK: null, tableK: null,
        riiFormulaNum: null, formulaCoeffs: null, wavelengthRange: null,
        type: 'unknown',
    };
    for (const block of blocks) _applyBlock(block, state);

    return { dataPath, references: refs, comments: comment,
             type: state.type, riiFormulaNum: state.riiFormulaNum, formulaCoeffs: state.formulaCoeffs,
             wavelengthRange: state.wavelengthRange, tableNK: state.tableNK, tableK: state.tableK };
}
