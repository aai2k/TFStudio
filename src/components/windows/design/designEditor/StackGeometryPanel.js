import { DebouncedInput } from '../../../ui/DebouncedInput.js';
import { parseNumberStrict } from '../../../../utils/misc/numberParsing.js';
import { usePersistentBool } from '../../../ui/usePersistentState.js';
import { materialHasNoK, rescaleLayersPreserveQWOT } from './units.js';
import { Sep, MediaCol } from './ui.js';
import { ConeAngleControl } from './ConeAngleControl.js';
import { StackDiagram } from './StackDiagram.js';
import { EnvironmentRow, FieldTag } from './EnvironmentRow.js';
import { hasEnvironments } from '../../../../utils/environments/environments.js';
import { fieldEdit, fieldValue } from '../environments/environmentFields.js';

const { createElement: h } = React;

// A media or substrate field of the current environment: the value it shows,
// the change an edit makes (environmentFields.js), and in environment 2 or
// later the tag that says whether the environment sets it.
function settingsField({ design, current, updateDesign, c, t }, key) {
    const field = { key };
    const { value, own } = fieldValue(design, current.id, field);
    const set = next => updateDesign(fieldEdit(design, current.id, field, next));
    const tag = current.index > 0 && h(FieldTag, { own, number: current.number, onReset: () => set(null), c, t });
    return { value, set, tag };
}

/**
 * Media (incident / substrate / exit), substrate thickness, reference λ₀ and
 * cone-angle averaging: the collapsible content beneath the always-visible
 * stack diagram. The media and the substrate are the current environment's
 * (`current`, useCurrentEnvironment's); λ₀ and the cone are the design's own
 * in every environment.
 */
export function StackSettingsFields(props) {
    const { design, media, current, updateDesign, refLambda, c, t } = props;
    const de = t.designEditor;
    const incident = settingsField(props, 'incidentMedium');
    const substrate = settingsField(props, 'substrateMaterial');
    const thickness = settingsField(props, 'substrateThickness');
    const exit = settingsField(props, 'exitMedium');
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
        hasEnvironments(design) && h(EnvironmentRow, { design, current, c, t }),
        // Three media on one row: Incident · Substrate · Exit.
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'flex-end', padding: '2px 0' } },
            h(MediaCol, { label: de.incidentMedium, tag: incident.tag, materialId: incident.value, onChange: incident.set, c, t }),
            h(MediaCol, { label: de.substrate, tag: substrate.tag, materialId: substrate.value, onChange: substrate.set, c, t }),
            h(MediaCol, { label: de.exitMedium, tag: exit.tag, materialId: exit.value, onChange: exit.set, c, t }),
        ),
        materialHasNoK(media.substrate.material, design.materials) && h('div', {
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
            thickness.tag,
            h(DebouncedInput, {
                value: thickness.value ?? 1.0,
                onChange: (s) => { const v = parseNumberStrict(s); if (!isNaN(v) && v >= 0) thickness.set(v); },
                style: numStyle,
            }),
            unit(de.unitMm || 'mm'),
            h('div', { style: { width: 1, height: 18, background: c.border, margin: '0 6px' } }),
            fldLabel(de.refLambdaShort || de.refLambda, de.refLambdaTip),
            h(DebouncedInput, {
                value: refLambda,
                title: de.refLambdaTip,
                onChange: (s) => {
                    const v = parseNumberStrict(s);
                    if (isNaN(v) || v <= 0) return;
                    // Preserve QWOT: a design specified in quarter-waves must keep
                    // its QW counts when λ₀ moves — rescale every layer's physical
                    // thickness (d/OT/FW change, QW stays); both stacks, symmetric
                    // mirror preserved.
                    const old = refLambda;
                    updateDesign({
                        referenceWavelength: v,
                        frontLayers: rescaleLayersPreserveQWOT(design.frontLayers || [], old, v, design.materials),
                        backLayers:  rescaleLayersPreserveQWOT(design.backLayers  || [], old, v, design.materials),
                    });
                },
                style: numStyle,
            }),
            unit(de.unitNm || 'nm'),
        ),
        h(Sep, { c }),
        // Cone-angle averaging (convergent/divergent beam)
        h(ConeAngleControl, { design, updateDesign, c, t })
    );
}

/**
 * The stack diagram and the Settings under it. `media` is the design with the
 * current environment's media and substrate (environmentMedia), which the
 * diagram draws.
 */
export function StackGeometryPanel({ design, media, current, updateDesign, refLambda, c, t }) {
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
        h(StackDiagram, { design: media, c, t }),
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
        settingsOpen && h(StackSettingsFields, { design, media, current, updateDesign, refLambda, c, t })
    );
}
