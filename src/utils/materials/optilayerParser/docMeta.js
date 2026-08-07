/** Derive display metadata + the analytic λ validity range from an OptiLayer document. */
export function resolveDocMeta(d, opts) {
    const name = (d.name && String(d.name).trim()) || opts.fallbackName || 'material';
    const meta = d.metadata || {};
    // rtti 12 = substrate-class, 13 = layer-class in the shipped catalogs.
    const group = opts.group || (meta.rtti === 12 ? 'Substrate' : 'Imported');
    const comment = (d.comment ? String(d.comment).replace(/\s+/g, ' ').trim() : '');

    // λ range (µm). Prefer the sampled grid; fall back to a broad visible–NIR
    // span. rangeDeclared marks which of the two happened, so a placeholder
    // span is never mistaken for a stated validity range.
    const wl = Array.isArray(d.wavelength) ? d.wavelength : null;
    const rangeDeclared = !!(wl && wl.length >= 1);
    let lambdaMin = 0.3, lambdaMax = 2.5;
    if (rangeDeclared) {
        lambdaMin = Math.min(...wl) / 1000;
        lambdaMax = Math.max(...wl) / 1000;
    }
    return { name, group, comment, lambdaMin, lambdaMax, rangeDeclared };
}
