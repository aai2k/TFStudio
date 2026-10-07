/** A Multilayer Index Catalog label holds at most 6 characters. */
export const LABEL_LENGTH = 6;

/**
 * Hand out labels of up to 6 letters and digits made from material names, each
 * one once. A part of the name in brackets is left out ("SiO2 (Fused Silica)"
 * is SiO2). Labels are compared without case. A clash keeps the start of the
 * name and ends in a number: SiO2, SiO22, SiO23.
 */
export function makeLabeler() {
    const used = new Set();
    return (name) => {
        const plain = String(name || '').replace(/\([^)]*\)/g, '');
        const base = plain.replace(/[^A-Za-z0-9]/g, '').slice(0, LABEL_LENGTH) || 'M';
        let label = base;
        for (let k = 2; used.has(label.toUpperCase()); k++) {
            const suffix = String(k);
            label = base.slice(0, LABEL_LENGTH - suffix.length) + suffix;
        }
        used.add(label.toUpperCase());
        return label;
    };
}
