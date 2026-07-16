import { resolveColor } from '../../../../utils/materials/catalogManager.js';
import { resolveMaterial } from './units.js';

const { createElement: h } = React;

// ── Stack cross-section diagram ───────────────────────────────────────────────

// Add CSS alpha to any color string (hex or hsl).
function addAlpha(color, alpha01) {
    if (!color) return 'transparent';
    const a = Math.round(alpha01 * 255).toString(16).padStart(2, '0');
    if (color.startsWith('#')) return color + a;
    if (color.startsWith('hsl(') && color.endsWith(')'))
        return 'hsla(' + color.slice(4, -1) + ', ' + alpha01.toFixed(2) + ')';
    return color;
}

function matDisplayName(id) {
    if (!id) return '';
    const i = id.indexOf(':');
    return i >= 0 ? id.slice(i + 1) : id;
}

// Per-cell style for the stack-diagram row. Role selects the fill (ambient =
// transparent, substrate = tinted substrate colour, layer = material colour);
// `i`/`count` round the outer end caps.
function stackBlockStyle(b, i, count, subMat, c) {
    return {
        flex: b.role === 'substrate' ? 4 : 1,
        minWidth: b.role === 'layer' ? 0 : 24,
        maxWidth: b.role === 'layer' ? 20 : undefined,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backgroundColor: b.role === 'ambient' ? 'transparent'
            : b.role === 'substrate' ? addAlpha(subMat ? resolveColor(subMat) : c.border, 0.2)
            : (b.mat ? resolveColor(b.mat) : c.border),
        border: `1px solid ${c.border}`,
        borderRadius: i === 0 ? '3px 0 0 3px' : i === count - 1 ? '0 3px 3px 0' : 0,
        fontSize: 9, color: c.textDim, overflow: 'hidden', cursor: 'default',
    };
}
// Truncated cell label — only ambient/substrate blocks show text.
function stackBlockLabel(b) {
    if (b.role === 'layer') return '';
    return b.label.length > 6 ? b.label.slice(0, 5) + '…' : b.label;
}

export const StackDiagram = React.memo(function StackDiagram({ design, c, t }) {
    const de = t.designEditor;
    const subMat = resolveMaterial(design.substrate.material);
    const front = design.frontLayers || [];
    const back  = design.backLayers  || [];

    // With hundreds of layers the diagram would overflow horizontally; collapse the
    // inter-block gap and let layer blocks shrink to 0 so the row always fits.
    const layerCount = front.length + back.length;
    const dense = layerCount > 60;

    const blocks = [
        { label: matDisplayName(design.incidentMedium), fullId: design.incidentMedium, role: 'ambient' },
        ...front.map(l => ({ label: l.material, role: 'layer', mat: resolveMaterial(l.material) })),
        { label: matDisplayName(design.substrate.material), fullId: design.substrate.material, role: 'substrate' },
        ...back.map(l => ({ label: l.material, role: 'layer', mat: resolveMaterial(l.material) })),
        { label: matDisplayName(design.exitMedium), fullId: design.exitMedium, role: 'ambient' }
    ];

    const totalFront = front.reduce((s, l) => s + (l.thickness || 0), 0);
    const totalBack  = back.reduce((s, l) => s + (l.thickness || 0), 0);

    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
        h('div', { style: { display: 'flex', alignItems: 'stretch', gap: dense ? 0 : 1, height: 26, width: '100%', overflow: 'hidden' } },
            h('div', { style: { display: 'flex', alignItems: 'center', fontSize: 12, color: c.accent, marginRight: 4, flexShrink: 0 } }, '→'),
            blocks.map((b, i) =>
                h('div', { key: i, title: b.fullId || b.label,
                    style: stackBlockStyle(b, i, blocks.length, subMat, c) },
                    stackBlockLabel(b))
            )
        ),
        h('div', { style: { fontSize: 10, color: c.textDim, display: 'flex', gap: 16, flexWrap: 'wrap' } },
            h('span', null, de.frontSummary(front.length, totalFront.toFixed(1))),
            h('span', null, de.backSummary(back.length, totalBack.toFixed(1)))
        )
    );
});
