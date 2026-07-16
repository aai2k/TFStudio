import { DebouncedInput } from '../../../ui/DebouncedInput.js';
import { usePersistentBool } from '../../../ui/usePersistentState.js';
import { materialHasNoK, rescaleLayersPreserveQWOT } from './units.js';
import { Sep, MediaCol } from './ui.js';
import { ConeAngleControl } from './ConeAngleControl.js';
import { StackDiagram } from './StackDiagram.js';

const { createElement: h } = React;

// Media (incident / substrate / exit), substrate thickness, reference λ₀ and
// cone-angle averaging — the collapsible content beneath the always-visible
// stack diagram.
function StackSettingsFields({ design, updateDesign, refLambda, c, t }) {
    const de = t.designEditor;
    // Compact numeric input shared by thickness + λ₀.
    const numStyle = {
        width: 58, height: 22, backgroundColor: c.bg, color: c.text,
        border: `1px solid ${c.border}`, borderRadius: 3, fontSize: 12,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        padding: '0 4px', outline: 'none', textAlign: 'right',
    };
    const unit = (txt) => h('span', { style: { fontSize: 11, color: c.textDim } }, txt);
    const fldLabel = (txt, title) => h('span', {
        title, style: { fontSize: 11, color: c.textDim, whiteSpace: 'nowrap' },
    }, txt);
    return h('div', { style: { maxHeight: 260, overflowY: 'auto', paddingTop: 6 } },
        // Three media on one row: Incident · Substrate · Exit.
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'flex-end', padding: '2px 0' } },
            h(MediaCol, { label: de.incidentMedium, materialId: design.incidentMedium,
                onChange: (m) => updateDesign({ incidentMedium: m }), c, t }),
            h(MediaCol, { label: de.substrate, materialId: design.substrate.material,
                onChange: (m) => updateDesign({ substrate: { ...design.substrate, material: m } }), c, t }),
            h(MediaCol, { label: de.exitMedium, materialId: design.exitMedium,
                onChange: (m) => updateDesign({ exitMedium: m }), c, t }),
        ),
        materialHasNoK(design.substrate.material) && h('div', {
            title: de.substrateNoK,
            style: { display: 'flex', alignItems: 'center', gap: 5, padding: '2px 0', fontSize: 10, color: c.warning || '#ef9800' },
        },
            h('span', null, '⚠'),
            h('span', null, de.substrateNoK)
        ),
        // Substrate thickness and reference λ₀ on one row — separated by a
        // vertical divider + distinct units (mm vs nm) to make clear they
        // are unrelated quantities that merely share the line.
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', flexWrap: 'wrap' } },
            fldLabel(de.substrateThick, 'Substrate physical thickness'),
            h(DebouncedInput, {
                value: design.substrate.thickness ?? 1.0,
                onChange: (s) => { const v = parseFloat(s); if (!isNaN(v) && v >= 0) updateDesign({ substrate: { ...design.substrate, thickness: v } }); },
                style: numStyle,
            }),
            unit('mm'),
            h('div', { style: { width: 1, height: 18, background: c.border, margin: '0 6px' } }),
            fldLabel(de.refLambdaShort || de.refLambda, 'Reference wavelength λ₀ used for QWOT / FWOT thickness display'),
            h(DebouncedInput, {
                value: refLambda,
                title: 'Reference wavelength λ₀ used for QWOT / FWOT thickness display',
                onChange: (s) => {
                    const v = parseFloat(s);
                    if (isNaN(v) || v <= 0) return;
                    // Preserve QWOT: a design specified in quarter-waves must keep
                    // its QW counts when λ₀ moves — rescale every layer's physical
                    // thickness (d/OT/FW change, QW stays); both stacks, symmetric
                    // mirror preserved.
                    const old = refLambda;
                    updateDesign({
                        referenceWavelength: v,
                        frontLayers: rescaleLayersPreserveQWOT(design.frontLayers || [], old, v),
                        backLayers:  rescaleLayersPreserveQWOT(design.backLayers  || [], old, v),
                    });
                },
                style: numStyle,
            }),
            unit('nm'),
        ),
        h(Sep, { c }),
        // Cone-angle averaging (convergent/divergent beam)
        h(ConeAngleControl, { design, updateDesign, c, t })
    );
}

export function StackGeometryPanel({ design, updateDesign, refLambda, c, t }) {
    const de = t.designEditor;
    // Stack-geometry diagram is always visible; the media / λ₀ / cone settings
    // collapse so the layer list keeps its vertical space (persisted).
    const [settingsOpen, setSettingsOpen] = usePersistentBool('de.settingsOpen', true);

    return h('div', {
        style: {
            borderTop: `1px solid ${c.border}`, backgroundColor: c.panel,
            padding: '8px 10px', flexShrink: 0
        }
    },
        h('div', { style: { fontSize: 10, fontWeight: 600, color: c.textDim, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 } },
            de.stackGeometry),
        h(StackDiagram, { design, c, t }),
        // Collapsible settings header (StackDiagram above stays always visible).
        h('div', {
            onClick: () => setSettingsOpen(!settingsOpen),
            title: de.settingsToggleTip,
            style: {
                display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                marginTop: 8, paddingTop: 6, borderTop: `1px solid ${c.border}`,
                fontSize: 10, fontWeight: 600, color: c.textDim,
                textTransform: 'uppercase', letterSpacing: 1, userSelect: 'none',
            },
        },
            h('span', { style: { fontSize: 9 } }, settingsOpen ? '▼' : '▶'),
            h('span', null, de.settingsSection || 'Settings'),
        ),
        settingsOpen && h(StackSettingsFields, { design, updateDesign, refLambda, c, t })
    );
}
