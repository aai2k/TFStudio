/** Build an ascending nm grid [start..end] with `step` nm spacing (inclusive). */
export function buildGrid(startNm, endNm, stepNm) {
    const a = Math.min(startNm, endNm), b = Math.max(startNm, endNm);
    const s = stepNm > 0 ? stepNm : 10;
    const g = [];
    for (let x = a; x <= b + 1e-6; x += s) g.push(Math.round(x * 1e6) / 1e6);
    if (g.length === 0) g.push(a);
    return g;
}
