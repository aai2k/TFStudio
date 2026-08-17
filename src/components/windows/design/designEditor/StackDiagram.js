import { resolveColor } from '../../../../utils/materials/catalogManager.js';
import { resolveEvalMode } from '../../../../utils/physics/optimizer.js';
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
// transparent, substrate = tinted substrate colour, layer = material colour,
// elided = an empty dashed gap so it cannot be mistaken for a layer);
// `i`/`count` round the outer end caps.
function stackBlockStyle(b, i, count, subMat, c) {
    const elided = b.role === 'elided';
    return {
        flex: b.role === 'substrate' ? 4 : elided ? 2 : 1,
        minWidth: b.role === 'layer' ? 0 : elided ? 28 : 24,
        maxWidth: b.role === 'layer' ? 20 : elided ? 46 : undefined,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backgroundColor: b.role === 'ambient' || elided ? 'transparent'
            : b.role === 'substrate' ? addAlpha(subMat ? resolveColor(subMat) : c.border, 0.2)
            : (b.mat ? resolveColor(b.mat) : c.border),
        border: elided ? `1px dashed ${c.border}` : `1px solid ${c.border}`,
        borderRadius: i === 0 ? '3px 0 0 3px' : i === count - 1 ? '0 3px 3px 0' : 0,
        fontSize: 9, color: c.textDim, overflow: 'hidden', cursor: 'default',
    };
}
// Truncated cell label. Layer blocks are too narrow for text; an elided block
// carries its hidden count, which is the only thing it has to say.
function stackBlockLabel(b) {
    if (b.role === 'layer') return '';
    if (b.role === 'elided') return b.label;
    return b.label.length > 6 ? b.label.slice(0, 5) + '…' : b.label;
}

// Past this many layers a coating is drawn as its first and last ELIDED_ENDS
// layers with one block standing in for everything between. Below it every
// layer is drawn. The threshold is set so eliding always hides enough blocks to
// be worth the substitution.
const ELIDE_ABOVE = 20;
const ELIDED_ENDS = 8;

// One coating's blocks, with the middle replaced by a single marker when the
// coating is long. Without this a 99-layer coating draws 99 hairlines: the
// blocks shrink until neither their width nor their material colour reads, so
// the diagram stops carrying information exactly when the stack is complex
// enough to need it. Eliding leaves the survivors wide enough to see.
function coatingBlocks(layers, de) {
    const block = layer => ({ label: layer.material, role: 'layer', mat: resolveMaterial(layer.material) });
    if (layers.length <= ELIDE_ABOVE) return layers.map(block);

    const hidden = layers.slice(ELIDED_ENDS, layers.length - ELIDED_ENDS);
    const names = [...new Set(hidden.map(layer => matDisplayName(layer.material)).filter(Boolean))];
    return [
        ...layers.slice(0, ELIDED_ENDS).map(block),
        {
            role: 'elided',
            label: de.elidedLayers(hidden.length),
            fullId: de.elidedTooltip(hidden.length, names.join(', ')),
        },
        ...layers.slice(layers.length - ELIDED_ENDS).map(block),
    ];
}

// Which end of the drawn stack the light enters, taken from the same
// resolveEvalMode() every analysis window reads. Blocks run incident medium →
// front layers → substrate → back layers → exit medium, so only a back coating
// evaluated on its own is entered from the right; a front coating and the full
// system are both entered from the incident side on the left.
function lightDirection(design, de) {
    const mode = resolveEvalMode(design);
    if (mode === 'back')  return { fromExit: true,  glyph: '←', title: de.lightFromExit };
    if (mode === 'total') return { fromExit: false, glyph: '→', title: de.lightThroughStack };
    return { fromExit: false, glyph: '→', title: de.lightFromIncident };
}

export const StackDiagram = React.memo(function StackDiagram({ design, c, t }) {
    const de = t.designEditor;
    const subMat = resolveMaterial(design.substrate.material);
    const front = design.frontLayers || [];
    const back  = design.backLayers  || [];

    // Each coating elides independently: the substrate sits between them, so a
    // 99 + 99 stack draws as ambient, 8 front, +83, 8 front, substrate, 8 back,
    // +83, 8 back, ambient. That caps the row at a width every block survives.
    const blocks = [
        { label: matDisplayName(design.incidentMedium), fullId: design.incidentMedium, role: 'ambient' },
        ...coatingBlocks(front, de),
        { label: matDisplayName(design.substrate.material), fullId: design.substrate.material, role: 'substrate' },
        ...coatingBlocks(back, de),
        { label: matDisplayName(design.exitMedium), fullId: design.exitMedium, role: 'ambient' }
    ];

    const totalFront = front.reduce((s, l) => s + (l.thickness || 0), 0);
    const totalBack  = back.reduce((s, l) => s + (l.thickness || 0), 0);

    const light = lightDirection(design, de);
    const arrow = h('div', {
        title: light.title,
        style: {
            display: 'flex', alignItems: 'center', fontSize: 12, color: c.accent, flexShrink: 0,
            marginRight: light.fromExit ? 0 : 4, marginLeft: light.fromExit ? 4 : 0,
        },
    }, light.glyph);

    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
        h('div', { style: { display: 'flex', alignItems: 'stretch', gap: 1, height: 26, width: '100%', overflow: 'hidden' } },
            !light.fromExit && arrow,
            blocks.map((b, i) =>
                h('div', { key: i, title: b.fullId || b.label,
                    style: stackBlockStyle(b, i, blocks.length, subMat, c) },
                    stackBlockLabel(b))
            ),
            light.fromExit && arrow
        ),
        h('div', { style: { fontSize: 10, color: c.textDim, display: 'flex', gap: 16, flexWrap: 'wrap' } },
            h('span', null, de.frontSummary(front.length, totalFront.toFixed(1))),
            h('span', null, de.backSummary(back.length, totalBack.toFixed(1)))
        )
    );
});
