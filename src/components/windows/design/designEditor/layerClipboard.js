const HEADER = 'TFStudio Layers v1';
const COLUMNS = 'Material\tThickness (nm)\tLocked';

/** Stable, human-readable clipboard format that is also safe to parse. */
export function serializeLayers(layers) {
    const rows = (layers || []).map(layer => [
        String(layer.material || '').replace(/[\t\r\n]/g, ' '),
        Number(layer.thickness),
        layer.locked ? '1' : '0',
    ].join('\t'));
    return [HEADER, COLUMNS, ...rows].join('\n');
}

export function parseLayers(text) {
    if (typeof text !== 'string') return [];
    const lines = text.replace(/\r/g, '').split('\n');
    if (lines[0] !== HEADER || lines[1] !== COLUMNS) return [];
    return lines.slice(2).filter(Boolean).map(line => {
        const [material, thicknessText, lockedText] = line.split('\t');
        const thickness = Number(thicknessText);
        if (!material || !Number.isFinite(thickness) || thickness < 0) return null;
        return { material, thickness, locked: lockedText === '1' };
    }).filter(Boolean);
}

export async function readLayerClipboard(fallback = []) {
    try {
        const parsed = parseLayers(await navigator.clipboard?.readText?.());
        if (parsed.length) return parsed;
    } catch (_) {
        // Desktop/browser permissions can block reads; the in-app copy buffer
        // remains available for the same editing session.
    }
    return fallback;
}

export function writeLayerClipboard(layers) {
    const text = serializeLayers(layers);
    try { navigator.clipboard?.writeText?.(text)?.catch?.(() => {}); } catch (_) {}
    return (layers || []).map(({ material, thickness, locked }) => ({ material, thickness, locked }));
}
