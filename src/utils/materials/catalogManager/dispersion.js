import { evalN } from '../dispersionFormulas.js';

/** Linear-interpolate k from a [{lam_um, k}, …] table (lam_um ascending). */
export function interpK(kTable, lambda_um) {
    if (!kTable || kTable.length === 0) return 0;
    if (lambda_um <= kTable[0].lam_um) return kTable[0].k;
    if (lambda_um >= kTable[kTable.length - 1].lam_um) return kTable[kTable.length - 1].k;
    let lo = 0, hi = kTable.length - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (kTable[mid].lam_um <= lambda_um) lo = mid; else hi = mid;
    }
    const t = (lambda_um - kTable[lo].lam_um) / (kTable[hi].lam_um - kTable[lo].lam_um);
    return kTable[lo].k + t * (kTable[hi].k - kTable[lo].k);
}

/** Build a getNK(lambda_nm) function for a catalog material entry. */
export function makeGetNK(mat) {
    if (mat.getNK) return mat.getNK;
    // formulaNum === -1 → user tabular: tabData = [[lam_nm, n, k], ...]
    if (mat.formulaNum === -1) {
        const data = (mat.tabData || []).slice().sort((a, b) => a[0] - b[0]);
        if (data.length === 0) return () => [1.5, 0];
        if (data.length === 1) return () => [data[0][1], data[0][2] || 0];
        return (lambda_nm) => {
            if (lambda_nm <= data[0][0]) return [data[0][1], data[0][2] || 0];
            const last = data[data.length - 1];
            if (lambda_nm >= last[0]) return [last[1], last[2] || 0];
            let lo = 0, hi = data.length - 1;
            while (hi - lo > 1) {
                const mid = (lo + hi) >> 1;
                if (data[mid][0] <= lambda_nm) lo = mid; else hi = mid;
            }
            const frac = (lambda_nm - data[lo][0]) / (data[hi][0] - data[lo][0]);
            return [
                data[lo][1] + frac * (data[hi][1] - data[lo][1]),
                (data[lo][2] || 0) + frac * ((data[hi][2] || 0) - (data[lo][2] || 0))
            ];
        };
    }
    return (lambda_nm) => {
        const lum = lambda_nm / 1000;
        const n = evalN(mat.formulaNum, mat.coefficients, lum);
        const k = interpK(mat.kTable, lum);
        return [n, k];
    };
}
