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

/**
 * The clipboard's text, '' when it holds none, or null when it cannot be read:
 * a browser can refuse a page the read, and the in-app copy stands in then.
 */
export async function readClipboardText() {
    try {
        const text = await navigator.clipboard?.readText?.();
        return typeof text === 'string' ? text : null;
    } catch (_) {
        return null;
    }
}

export function writeClipboardText(text) {
    try { navigator.clipboard?.writeText?.(text)?.catch?.(() => {}); } catch (_) {}
}

export async function readLayerClipboard(fallback = []) {
    const parsed = parseLayers(await readClipboardText());
    return parsed.length ? parsed : fallback;
}

export function writeLayerClipboard(layers) {
    writeClipboardText(serializeLayers(layers));
    return (layers || []).map(({ material, thickness, locked }) => ({ material, thickness, locked }));
}

/** Spreadsheet-oriented export: deliberately not accepted by parseLayers(). */
export function serializeStackTable(layers, materialName = id => id, columns) {
    const rows = (layers || []).map(layer => [
        String(materialName(layer.material) || layer.material || '').replace(/[\t\r\n]/g, ' '),
        Number(layer.thickness),
    ].join('\t'));
    return [`${columns.material}\t${columns.thickness}`, ...rows].join('\n');
}

export async function writeStackTableClipboard(layers, materialName, columns) {
    const text = serializeStackTable(layers, materialName, columns);
    try {
        if (typeof navigator.clipboard?.writeText !== 'function') return false;
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        return false;
    }
}
