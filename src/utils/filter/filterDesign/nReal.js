/** Real part of an index-function's return value at a wavelength (nm). */
export function nReal(fn, lam) { const v = fn(lam); return Array.isArray(v) ? v[0] : v; }
