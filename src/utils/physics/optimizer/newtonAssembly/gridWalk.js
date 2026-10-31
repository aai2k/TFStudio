/**
 * The walk that reads the curvature terms' samples one wavelength at a time.
 *
 * A term (curvature.js) has its sample wavelengths `lams`, its `pol`, `char`
 * and `aoi`, reads its sample s through `reads(s)` and `add(s, d2, H)`, and
 * `addsEachSample` when it adds each sample to H as it is read rather than a
 * sum at its turn. `shareGrids` joins terms at one angle that read common
 * wavelengths into one grid; `walk` reads all of a grid's samples, computing
 * each wavelength's kernel packages once for every term there and dropping
 * them before the next.
 */

// Join into one grid the terms at one angle that read a common wavelength, in
// the order given, each grid's terms in that order. A term joins the grids it
// reads a common wavelength with, which joins them through it, except where a
// grid's first term adds each sample as it is read and reads no wavelength in
// common with an earlier term of the other: walking it with that term would put
// its samples ahead of a row it shares nothing with. A grid is walked in
// ascending wavelength and every term must read its samples in its own order,
// so a term whose wavelengths do not ascend keeps a grid of its own.
export function shareGrids(terms) {
    const grids = [];
    terms.forEach((term, index) => {
        term.index = index;
        term.ascending = term.lams.every((lam, s) => Number.isFinite(lam) && (s === 0 || lam >= term.lams[s - 1]));
        let grid = null;
        for (const other of grids.filter(g => g.terms.some(t => _shareWavelength(t, term)))) {
            if (!grid) grid = other;
            else if (_mayJoin(grid, other)) {
                grid.terms = [...grid.terms, ...other.terms].sort((a, b) => a.index - b.index);
                grids.splice(grids.indexOf(other), 1);
            }
        }
        if (!grid) {
            grid = { aoi: term.aoi, terms: [], walked: false };
            grids.push(grid);
        }
        grid.terms.push(term);
    });
    for (const grid of grids) for (const term of grid.terms) term.grid = grid;
}

// Whether `later`, a grid whose first term comes after the first of `grid`,
// may be walked with it.
function _mayJoin(grid, later) {
    const first = later.terms[0];
    return !first.addsEachSample || grid.terms.some(t => t.index < first.index && _shareWavelength(t, first));
}

// Whether two terms at one angle read a common wavelength.
function _shareWavelength(a, b) {
    if (String(a.aoi) !== String(b.aoi) || !a.ascending || !b.ascending) return false;
    for (let i = 0, j = 0; i < a.lams.length && j < b.lams.length;) {
        if (!a.reads(i)) i++;
        else if (!b.reads(j)) j++;
        else if (a.lams[i] === b.lams[j]) return true;
        else if (a.lams[i] < b.lams[j]) i++;
        else j++;
    }
    return false;
}

// Read every sample of a grid's terms, one wavelength at a time: the term with
// the shortest unread wavelength leads, and every term reads its samples at
// that wavelength from the one set of kernel packages. `at(λ, aoi)(pol, ch)`
// is the sampler of makeHessianSampler.
export function walk(grid, H, at) {
    grid.walked = true;
    const { terms } = grid;
    const next = terms.map(() => 0);
    for (let lead = _lead(terms, next); lead >= 0; lead = _lead(terms, next)) {
        const lam = terms[lead].lams[next[lead]];
        const sampleAt = at(lam, grid.aoi);
        for (let i = 0; i < terms.length; i++) {
            const term = terms[i];
            let s = next[i];
            if (i === lead) _read(term, s++, sampleAt, H);
            while (s < term.lams.length && term.lams[s] === lam) _read(term, s++, sampleAt, H);
            next[i] = s;
        }
    }
}

// The term whose next unread wavelength is the shortest, the first of a tie,
// or -1 once every sample is read.
function _lead(terms, next) {
    let lead = -1;
    for (let i = 0; i < terms.length; i++) {
        if (next[i] >= terms[i].lams.length) continue;
        if (lead < 0 || terms[i].lams[next[i]] < terms[lead].lams[next[lead]]) lead = i;
    }
    return lead;
}

function _read(term, s, sampleAt, H) {
    if (term.reads(s)) term.add(s, sampleAt(term.pol, term.char).d2, H);
}
