/** Build kTable [{lam_um, k}] from a sampled k array, only if it carries absorption. */
export function buildKTable(wl, kArr) {
    if (!wl || !kArr || kArr.length !== wl.length) return [];
    let maxk = 0;
    for (const k of kArr) if (k > maxk) maxk = k;
    if (maxk <= 0) return [];
    return wl.map((w, i) => ({ lam_um: w / 1000, k: kArr[i] || 0 }));
}
