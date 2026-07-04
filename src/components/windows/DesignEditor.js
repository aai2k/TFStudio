import { useDesign } from '../../state/DesignContext.js';
import { getMaterial } from '../../utils/materials/materialDatabase.js';
import { getMaterialById, normalizeId, resolveColor } from '../../utils/materials/catalogManager.js';
import { mirrorLayers } from '../../utils/physics/optimizer.js';
import { SurfaceModeControl } from '../SurfaceModeBar.js';
import { MaterialPicker } from '../ui/MaterialPicker.js';
import { DebouncedInput } from '../ui/DebouncedInput.js';
import { LockIcon } from '../ui/LockIcon.js';
import { usePersistentBool } from '../ui/usePersistentState.js';
import { useTableShortcuts } from '../../hooks/useTableShortcuts.js';

// Resolve a material by legacy or compound ID, returning a material object with getNK.
function resolveMaterial(id) {
    if (!id) return getMaterial('Air');
    return getMaterialById(id) || getMaterial(id) || getMaterial('Air');
}

// Returns true if the material has no extinction-coefficient data (k = 0 at all
// sampled wavelengths). Sellmeier-only materials like BK7 always return k = 0,
// which means substrate absorption is silently omitted from total-T calculations.
function materialHasNoK(materialId) {
    const mat = resolveMaterial(materialId);
    if (!mat) return false;
    const testLambdas = [350, 400, 500, 600, 700, 800];
    return testLambdas.every(lam => mat.getNK(lam)[1] === 0);
}

const { createElement: h, useState, useRef, useEffect, useCallback, useMemo } = React;

// ── Thickness unit conversions ────────────────────────────────────────────────
//
// Units:
//   'nm'   — physical thickness in nm                           d
//   'OT'   — optical thickness in nm                           n·d
//   'QWOT' — quarter-wave optical thickness (dimensionless)    4·n·d / λ₀
//   'FWOT' — full-wave optical thickness (dimensionless)       n·d / λ₀
//
// References:
//   Macleod, Thin-Film Optical Filters (2010), §3.1
//   Field Guide to Optical Thin Films (2006), Glossary p.xi, §Fundamentals p.5
//   QWOT = λ₀/4 = n·d  (one quarter-wave layer at λ₀)

export function nmToUnit(d_nm, materialId, refLambda, unit) {
    if (unit === 'nm') return d_nm;
    const mat = resolveMaterial(materialId);
    const n = mat ? mat.getNK(refLambda)[0] : 1.0;
    if (unit === 'OT')   return n * d_nm;
    if (unit === 'QWOT') return (4 * n * d_nm) / refLambda;
    if (unit === 'FWOT') return (n * d_nm) / refLambda;
    return d_nm;
}

export function unitToNm(value, materialId, refLambda, unit) {
    if (unit === 'nm') return value;
    const mat = resolveMaterial(materialId);
    const n = mat ? mat.getNK(refLambda)[0] : 1.0;
    if (n <= 0) return value;
    if (unit === 'OT')   return value / n;
    if (unit === 'QWOT') return (value * refLambda) / (4 * n);
    if (unit === 'FWOT') return (value * refLambda) / n;
    return value;
}

// Rescale every layer's physical thickness so its QWOT (4·n·d/λ₀) is
// invariant under a change of reference wavelength λ₀. Designs are specified
// in quarter-waves, so a QW layer must stay a QW layer when λ₀ moves; only
// the physical thickness d (and hence OT/FW) changes.
//
//   QWOT = 4·n(λ₀)·d / λ₀   (held constant)
//   ⇒  d_new = QWOT · λ_new / (4·n(λ_new))
//            = d_old · [n(λ_old)/n(λ_new)] · [λ_new/λ_old]
//
// n is dispersive, so it is re-evaluated at each λ₀ (not just a λ ratio).
export function rescaleLayersPreserveQWOT(layers, oldLambda, newLambda) {
    if (!layers || !(oldLambda > 0) || !(newLambda > 0)) return layers || [];
    return layers.map(l => {
        const mat   = resolveMaterial(l.material);
        const nOld  = mat ? mat.getNK(oldLambda)[0] : 1.0;
        const nNew  = mat ? mat.getNK(newLambda)[0] : 1.0;
        if (!(nOld > 0) || !(nNew > 0)) return l;
        const qwot  = (4 * nOld * (l.thickness || 0)) / oldLambda;
        const dNew  = (qwot * newLambda) / (4 * nNew);
        return { ...l, thickness: dNew };
    });
}

export const THICKNESS_UNITS = [
    { value: 'nm',   label: 'nm',   title: 'Physical thickness (nm)' },
    { value: 'OT',   label: 'OT',   title: 'Optical thickness n·d (nm)' },
    { value: 'QWOT', label: 'QW',   title: 'Quarter-wave optical thickness  4·n·d/λ₀' },
    { value: 'FWOT', label: 'FW',   title: 'Full-wave optical thickness  n·d/λ₀' },
];

// ── Small UI helpers ──────────────────────────────────────────────────────────

function Btn({ onClick, title, disabled, children, c, style = {} }) {
    const [hov, setHov] = useState(false);
    return h('button', {
        onClick, title, disabled,
        onMouseEnter: () => setHov(true),
        onMouseLeave: () => setHov(false),
        style: {
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            padding: '3px 9px', border: `1px solid ${c.border}`, borderRadius: 3,
            backgroundColor: disabled ? 'transparent' : hov ? c.hover : c.panel,
            color: disabled ? c.textDim : c.text, cursor: disabled ? 'default' : 'pointer',
            fontSize: 12, fontFamily: 'system-ui, -apple-system, sans-serif',
            outline: 'none', gap: 4, flexShrink: 0,
            opacity: disabled ? 0.45 : 1,
            ...style
        }
    }, children);
}

function IconBtn({ onClick, title, disabled, children, c }) {
    const [hov, setHov] = useState(false);
    return h('button', {
        onClick, title, disabled,
        onMouseEnter: () => setHov(true),
        onMouseLeave: () => setHov(false),
        style: {
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 24, height: 24, border: 'none', borderRadius: 3, padding: 0,
            backgroundColor: hov && !disabled ? c.hover : 'transparent',
            color: disabled ? c.textDim : c.text, cursor: disabled ? 'default' : 'pointer',
            fontSize: 14, outline: 'none', opacity: disabled ? 0.4 : 1, flexShrink: 0
        }
    }, children);
}

function Label({ text, c, width }) {
    return h('div', {
        style: { fontSize: 11, color: c.textDim, whiteSpace: 'nowrap', width: width || 'auto', flexShrink: 0 }
    }, text);
}

function Sep({ c }) {
    return h('div', { style: { height: 1, background: c.border, margin: '6px 0' } });
}

// ── Cone-angle (convergent/divergent beam) control ────────────────────────────
// Edits design.cone = { enabled, halfAngleDeg, distribution,
// gridPoints, userTable }. The engine (optimizer/coneAngle.js) averages R/T/A
// over a cone of incidence angles around each operand's AOI; this panel is just
// the spec editor. Conversions are inline (NA = sin Θ, f/# = 1/(2·NA)) to avoid
// pulling the optimizer barrel into the design editor.
const CONE_DEFAULT = { enabled: false, halfAngleDeg: 7.5, distribution: 'uniform', gridPoints: 15, userTable: null };

// Stable per-row id for the user cone-angle table, so the rows can be keyed by
// identity rather than array index — otherwise deleting a row mid-edit makes a
// DebouncedInput's local edit state commit to the wrong (shifted) row.
let _coneRowSeq = 0;
const coneRowId = () => `cr-${Date.now()}-${(_coneRowSeq++).toString(36)}`;

function ConeAngleControl({ design, updateDesign, c, t }) {
    const cc = (t.designEditor && t.designEditor.cone) || {};
    const cone = { ...CONE_DEFAULT, ...(design.cone || {}) };
    const patch = (p) => updateDesign({ cone: { ...cone, ...p } });

    const inStyle = {
        width: 62, height: 22, backgroundColor: c.bg, color: c.text,
        border: `1px solid ${c.border}`, borderRadius: 3, fontSize: 12,
        fontFamily: 'system-ui, -apple-system, sans-serif', padding: '0 4px',
        outline: 'none', textAlign: 'right',
    };
    const dim = { fontSize: 11, color: c.textDim };

    const Th    = Math.max(0, cone.halfAngleDeg || 0);
    const na    = Math.sin(Th * Math.PI / 180);
    const fnum  = na > 1e-9 ? 1 / (2 * na) : Infinity;
    const fnumS = Number.isFinite(fnum) ? fnum.toFixed(2) : '∞';

    const rows = [];

    // Enable checkbox
    rows.push(h('label', {
        key: 'en',
        style: { display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', padding: '3px 0' },
        title: cc.enableTip,
    },
        h('input', { type: 'checkbox', checked: !!cone.enabled, onChange: (e) => patch({ enabled: e.target.checked }) }),
        h('span', { style: { fontSize: 11, color: c.text } }, cc.enable || 'Average over illumination cone'),
    ));

    if (cone.enabled) {
        // Half-angle + NA/f# + full-angle readout
        rows.push(h('div', { key: 'ha', style: { display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', flexWrap: 'wrap' } },
            h('div', { style: { ...dim, width: 110, flexShrink: 0 }, title: cc.halfAngleTip }, cc.halfAngle || 'Half-angle Θ'),
            h(DebouncedInput, {
                value: cone.halfAngleDeg, title: cc.halfAngleTip,
                onChange: (s) => { const v = parseFloat(s); if (!isNaN(v) && v >= 0 && v < 90) patch({ halfAngleDeg: v }); },
                style: inStyle,
            }),
            h('span', dim, '°'),
            h('span', { style: { ...dim, marginLeft: 6 } },
                `${cc.na || 'NA'} ${na.toFixed(3)} · ${cc.fnum || 'f/#'} ${fnumS} · ${(cc.fullAngle ? cc.fullAngle((Th * 2).toFixed(1)) : `2Θ = ${(Th * 2).toFixed(1)}°`)}`),
        ));

        // Distribution + grid points
        rows.push(h('div', { key: 'di', style: { display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', flexWrap: 'wrap' } },
            h('div', { style: { ...dim, width: 110, flexShrink: 0 } }, cc.distribution || 'Distribution'),
            h('select', {
                value: cone.distribution,
                onChange: (e) => {
                    const d = e.target.value;
                    const next = { distribution: d };
                    if (d === 'user' && (!cone.userTable || !cone.userTable.length)) {
                        next.userTable = [{ _id: coneRowId(), theta: 0, intensity: 100 }, { _id: coneRowId(), theta: Th || 10, intensity: 100 }];
                    }
                    patch(next);
                },
                style: { ...inStyle, width: 130, textAlign: 'left' },
            },
                h('option', { value: 'uniform' },    cc.uniform    || 'Uniform'),
                h('option', { value: 'lambertian' }, cc.lambertian || 'Lambertian'),
                h('option', { value: 'user' },       cc.user       || 'User-defined'),
            ),
            h('div', { style: { ...dim, marginLeft: 6 }, title: cc.gridPointsTip }, cc.gridPoints || 'Grid points'),
            h(DebouncedInput, {
                value: cone.gridPoints, title: cc.gridPointsTip,
                onChange: (s) => { const v = parseInt(s, 10); if (!isNaN(v) && v >= 2) patch({ gridPoints: Math.min(200, v) }); },
                style: { ...inStyle, width: 48 },
            }),
        ));

        // User-defined intensity table
        if (cone.distribution === 'user') {
            const table = Array.isArray(cone.userTable) && cone.userTable.length
                ? cone.userTable : [{ theta: 0, intensity: 100 }];
            const setRow = (i, key, v) => {
                const nt = table.map((r, j) => j === i ? { ...r, [key]: v } : r);
                patch({ userTable: nt });
            };
            const addRow = () => patch({ userTable: [...table, { _id: coneRowId(), theta: Th || 10, intensity: 100 }] });
            const delRow = (i) => patch({ userTable: table.length > 1 ? table.filter((_, j) => j !== i) : table });
            const normalize = () => {
                const mx = Math.max(...table.map(r => r.intensity || 0));
                if (mx > 0) patch({ userTable: table.map(r => ({ ...r, intensity: +(r.intensity / mx * 100).toFixed(3) })) });
            };
            const cellStyle = { ...inStyle, width: 56 };
            rows.push(h('div', { key: 'ut', style: { padding: '2px 0 2px 6px' } },
                h('div', { style: { display: 'flex', gap: 8, ...dim, marginBottom: 2 } },
                    h('div', { style: { width: 56, textAlign: 'right' } }, cc.theta || 'θ (°)'),
                    h('div', { style: { width: 56, textAlign: 'right' } }, cc.intensity || 'Intensity'),
                ),
                table.map((r, i) => h('div', { key: r._id ?? i, style: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 2 } },
                    h(DebouncedInput, { value: r.theta,
                        onChange: (s) => setRow(i, 'theta', parseFloat(s) || 0), style: cellStyle }),
                    h(DebouncedInput, { value: r.intensity,
                        onChange: (s) => setRow(i, 'intensity', parseFloat(s) || 0), style: cellStyle }),
                    h('button', {
                        onClick: () => delRow(i),
                        style: { width: 22, height: 22, cursor: 'pointer', background: 'transparent', color: c.textDim, border: `1px solid ${c.border}`, borderRadius: 3 },
                    }, '×'),
                )),
                h('div', { style: { display: 'flex', gap: 6, marginTop: 2 } },
                    h('button', { onClick: addRow,
                        style: { fontSize: 11, cursor: 'pointer', background: 'transparent', color: c.accent, border: `1px solid ${c.border}`, borderRadius: 3, padding: '2px 8px' } },
                        cc.addRow || '+ Row'),
                    h('button', { onClick: normalize, title: cc.normalizeTip,
                        style: { fontSize: 11, cursor: 'pointer', background: 'transparent', color: c.textDim, border: `1px solid ${c.border}`, borderRadius: 3, padding: '2px 8px' } },
                        cc.normalize || 'Normalize'),
                ),
            ));
        }
    }

    return h('div', null,
        h('div', { style: { fontSize: 10, fontWeight: 600, color: c.textDim, margin: '2px 0 4px', textTransform: 'uppercase', letterSpacing: 1 } },
            cc.title || 'Cone angle'),
        ...rows,
    );
}

// MaterialSelect is replaced by MaterialPicker (imported above).

// ── Thickness cell ────────────────────────────────────────────────────────────
// Edits one of {nm, OT, QWOT, FWOT}. value_nm is the source of truth; the cell
// converts in/out via nmToUnit/unitToNm so all four cells in a row stay in
// sync. Editing the QW cell, for example, recomputes the nm value (and every
// other cell rerenders from the new value_nm next paint).
//
// `primary` = true → emphasized styling for the editable "main" representation;
// the others render slightly dimmed but are equally editable.

// Upper clamp on a single layer's physical thickness. 1 mm (1e6 nm) is far
// beyond any real thin-film layer (thick spacers top out at tens of microns) —
// it exists purely to stop a stray entry like 9999999999 nm from corrupting the
// merit/TMM and blowing out the table layout. Not a physics bound; a UI guard.
const MAX_THICKNESS_NM = 1e6;

function ThicknessCell({ value_nm, onChange, locked, c, materialId, refLambda, unit, primary }) {
    const [editing, setEditing] = useState(false);
    const [hover, setHover]     = useState(false);
    const [raw, setRaw]         = useState('');
    const inputRef = useRef(null);

    const displayed = nmToUnit(value_nm, materialId, refLambda, unit);
    const decimals  = (unit === 'QWOT' || unit === 'FWOT') ? 4 : 2;

    const startEdit = () => {
        if (locked) return;
        setRaw(displayed.toFixed(decimals));
        setEditing(true);
        setTimeout(() => inputRef.current?.select(), 0);
    };

    const commit = () => {
        const parsed = parseFloat(raw);
        if (!isNaN(parsed) && parsed >= 0) {
            const nm = unitToNm(parsed, materialId, refLambda, unit);
            if (nm >= 0) onChange(Math.min(nm, MAX_THICKNESS_NM));
        }
        setEditing(false);
    };

    const titleText = unit === 'nm'   ? 'Physical thickness (nm)'
                    : unit === 'OT'   ? 'Optical thickness n·d (nm)'
                    : unit === 'QWOT' ? 'Quarter-wave optical thickness 4·n·d/λ₀'
                    : 'Full-wave optical thickness n·d/λ₀';

    if (editing) {
        return h('input', {
            ref: inputRef, value: raw,
            onChange: (e) => setRaw(e.target.value),
            onBlur: commit,
            onKeyDown: (e) => {
                if (e.key === 'Enter') { e.preventDefault(); commit(); }
                if (e.key === 'Escape') setEditing(false);
            },
            style: {
                width: '100%', height: 22,
                backgroundColor: c.bg, color: c.text,
                border: `1px solid ${c.accent}`, borderRadius: 3,
                fontSize: 12, fontFamily: 'system-ui, -apple-system, sans-serif',
                padding: '0 4px', outline: 'none', textAlign: 'center'
            }
        });
    }

    // All unlocked cells use the full text color (not textDim) so OT/QW/FW
    // don't look disabled. The primary nm column is heavier and slightly
    // larger to mark it as the canonical representation. A hover background
    // signals "you can click here" for all four units.
    return h('div', {
        onDoubleClick: startEdit,
        onMouseEnter: () => setHover(true),
        onMouseLeave: () => setHover(false),
        title: `${displayed.toFixed(decimals)} — ${titleText}${locked ? ' (locked)' : ' — double-click to edit'}`,
        style: {
            width: '100%', height: 22, lineHeight: '22px',
            color: locked ? c.textDim : c.text,
            fontSize: primary ? 12 : 11,
            fontWeight: primary ? 600 : 400,
            textAlign: 'center',
            cursor: locked ? 'default' : 'text',
            borderRadius: 3,
            border: `1px solid ${hover && !locked ? c.border : 'transparent'}`,
            backgroundColor: hover && !locked ? (c.hover || c.panel) : 'transparent',
            userSelect: 'none', fontVariantNumeric: 'tabular-nums',
            transition: 'background-color 80ms, border-color 80ms',
            // Never let a long value spill into neighbouring columns — clip to
            // the fixed cell width; the full value is in the title tooltip.
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }
    }, displayed.toFixed(decimals));
}

// ── Medium selector row ───────────────────────────────────────────────────────

function MediaRow({ label, materialId, onChange, c, t }) {
    return h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' } },
        h(Label, { text: label, c, width: 110 }),
        h(MaterialPicker, { value: materialId, onChange, c, t })
    );
}

// Compact medium picker: small label stacked above a compact MaterialPicker, so
// the three media (incident / substrate / exit) fit on ONE 3-column row instead
// of three stacked rows. Used in the (collapsible) Design-Editor settings.
function MediaCol({ label, materialId, onChange, c, t }) {
    return h('div', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 } },
        h('div', {
            title: label,
            style: { fontSize: 10, color: c.textDim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
        }, label),
        h('div', { style: { minWidth: 0 } },
            h(MaterialPicker, { value: materialId, onChange, c, t, compact: true })
        )
    );
}

// ── Layer row ─────────────────────────────────────────────────────────────────

// Fixed, uniform row height (px). Inner controls are 22px + 2px×2 padding = 26.
const LAYER_ROW_H = 26;

// Memoized so that any parent re-render (e.g. window resize, or editing one row
// in a 500-layer stack) only re-renders rows whose own props actually
// changed. Handlers are id-passing and stabilized with useCallback in LayerList,
// and `layer` keeps a stable object reference, so untouched rows are skipped
// entirely — and scrolling, which changes no props, never re-renders any row.
const LayerRow = React.memo(function LayerRow({ layer, index, isSelected, onSelect, c,
    onMaterialChange, onThicknessChange, onLockToggle,
    onMoveUp, onMoveDown, onDuplicate, onRemove, canMoveUp, canMoveDown,
    refLambda, t }) {

    const de = t.designEditor;

    return h('div', {
        onClick: () => onSelect(layer.id),
        style: {
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '2px 4px',
            // Fixed height (border-box) so the virtualized list can compute row
            // positions exactly — see LAYER_ROW_H in LayerList.
            height: LAYER_ROW_H, boxSizing: 'border-box',
            backgroundColor: isSelected ? c.accent + '22' : 'transparent',
            borderRadius: 3, cursor: 'pointer', userSelect: 'none',
            borderLeft: `2px solid ${isSelected ? c.accent : 'transparent'}`
        }
    },
        h('div', { style: { width: 24, textAlign: 'right', fontSize: 11, color: c.textDim, flexShrink: 0 } }, index + 1),
        h('div', { style: { flex: 1, minWidth: 0, overflow: 'hidden' } },
            h(MaterialPicker, { value: layer.material, onChange: (mat) => onMaterialChange(layer.id, mat), c, t, compact: true })
        ),
        h('div', { style: { width: 70, flexShrink: 0 } },
            h(ThicknessCell, { value_nm: layer.thickness, onChange: (th) => onThicknessChange(layer.id, th), locked: layer.locked, c,
                materialId: layer.material, refLambda, unit: 'nm', primary: true })
        ),
        h('div', { style: { width: 58, flexShrink: 0 } },
            h(ThicknessCell, { value_nm: layer.thickness, onChange: (th) => onThicknessChange(layer.id, th), locked: layer.locked, c,
                materialId: layer.material, refLambda, unit: 'OT' })
        ),
        h('div', { style: { width: 50, flexShrink: 0 } },
            h(ThicknessCell, { value_nm: layer.thickness, onChange: (th) => onThicknessChange(layer.id, th), locked: layer.locked, c,
                materialId: layer.material, refLambda, unit: 'QWOT' })
        ),
        h('div', { style: { width: 50, flexShrink: 0 } },
            h(ThicknessCell, { value_nm: layer.thickness, onChange: (th) => onThicknessChange(layer.id, th), locked: layer.locked, c,
                materialId: layer.material, refLambda, unit: 'FWOT' })
        ),
        h('button', {
            title: layer.locked ? de.unlock : de.lock,
            onClick: (e) => { e.stopPropagation(); onLockToggle(layer.id, layer.locked); },
            style: {
                width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: 'none', borderRadius: 3, backgroundColor: 'transparent',
                color: layer.locked ? c.accent : c.textDim, cursor: 'pointer',
                fontSize: 13, outline: 'none', flexShrink: 0
            }
        }, h(LockIcon, { locked: layer.locked, size: 13 })),
        h('div', { style: { display: 'flex', gap: 1, marginLeft: 2 } },
            h(IconBtn, { onClick: (e) => { e.stopPropagation(); onMoveUp(layer.id); }, disabled: !canMoveUp, title: de.moveUpRow, c }, '↑'),
            h(IconBtn, { onClick: (e) => { e.stopPropagation(); onMoveDown(layer.id); }, disabled: !canMoveDown, title: de.moveDownRow, c }, '↓'),
            h(IconBtn, { onClick: (e) => { e.stopPropagation(); onDuplicate(layer.id); }, title: de.duplicate, c }, '⎘'),
            h(IconBtn, { onClick: (e) => { e.stopPropagation(); onRemove(layer.id); }, title: de.remove, c }, '×')
        )
    );
});

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

const StackDiagram = React.memo(function StackDiagram({ design, c, t }) {
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
                h('div', {
                    key: i,
                    title: b.fullId || b.label,
                    style: {
                        flex: b.role === 'substrate' ? 4 : b.role === 'ambient' ? 1 : 1,
                        minWidth: b.role === 'layer' ? 0 : 24,
                        maxWidth: b.role === 'layer' ? 20 : undefined,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        backgroundColor: b.role === 'ambient' ? 'transparent'
                            : b.role === 'substrate' ? addAlpha(subMat ? resolveColor(subMat) : c.border, 0.2)
                            : (b.mat ? resolveColor(b.mat) : c.border),
                        border: `1px solid ${c.border}`,
                        borderRadius: i === 0 ? '3px 0 0 3px' : i === blocks.length - 1 ? '0 3px 3px 0' : 0,
                        fontSize: 9, color: c.textDim, overflow: 'hidden', cursor: 'default'
                    }
                }, b.role !== 'layer' ? (b.label.length > 6 ? b.label.slice(0, 5) + '…' : b.label) : '')
            )
        ),
        h('div', { style: { fontSize: 10, color: c.textDim, display: 'flex', gap: 16, flexWrap: 'wrap' } },
            h('span', null, de.frontSummary(front.length, totalFront.toFixed(1))),
            h('span', null, de.backSummary(back.length, totalBack.toFixed(1)))
        )
    );
});

// ── Layer list panel (for one side) ──────────────────────────────────────────

function LayerList({ layers, side, design, c,
    addLayer, removeLayer, updateLayer, moveLayer, duplicateLayer,
    insertLayerAt, removeLayerAt, duplicateLayerAt,
    invertActiveSide, setAllLocked, copyToOther,
    refLambda, t }) {

    const [selectedId, setSelectedId] = useState(null);
    const selectedIndex = layers.findIndex(l => l.id === selectedId);
    const de = t.designEditor;
    const containerRef = useRef(null);

    // Front coating is displayed substrate-first (reversed) so layer 1 is the one
    // touching the substrate, matching the back coating convention.
    const reversed = side === 'front';
    const displayedLayers = reversed ? [...layers].reverse() : layers;
    const selectedDisplayIdx = selectedId
        ? displayedLayers.findIndex(l => l.id === selectedId) : -1;

    const handleAdd = () => addLayer(side, selectedIndex >= 0 ? selectedIndex : undefined);

    // ── Keyboard row shortcuts (Ins / Shift+Ins / Del / Ctrl+D) ────────────
    // All indices the hook deals with are DISPLAY-ORDER indices. The mapping
    // to underlying-array splice positions accounts for the front-side reverse.
    const displayToUnderlying = (di) => reversed ? layers.length - 1 - di : di;
    const insertAtDisplayPos = (di, below) => {
        if (layers.length === 0) {
            const newId = insertLayerAt(side, 0, null);
            if (newId) setSelectedId(newId);
            containerRef.current?.focus();
            return;
        }
        const clamped = (di != null && di >= 0 && di < layers.length) ? di : 0;
        const underlyingIdx = displayToUnderlying(clamped);
        // "Above" in DISPLAY order maps to:
        //   reversed     → splice AFTER focused in underlying (idx+1)
        //   not reversed → splice BEFORE focused in underlying (idx)
        // "Below" in display flips that.
        let splicePos;
        if (below) splicePos = reversed ? underlyingIdx : underlyingIdx + 1;
        else       splicePos = reversed ? underlyingIdx + 1 : underlyingIdx;
        const source = layers[underlyingIdx];
        const newId = insertLayerAt(side, splicePos, source);
        if (newId) setSelectedId(newId);
        containerRef.current?.focus();
    };
    const deleteAtDisplayPos = (di) => {
        if (di == null || di < 0 || di >= layers.length) return;
        const underlyingIdx = displayToUnderlying(di);
        const ok = removeLayerAt(side, underlyingIdx);
        if (!ok) return;
        // Re-focus the row above (or below if was first). All in display order.
        const newLen = layers.length - 1;
        if (newLen <= 0) { setSelectedId(null); return; }
        const newDi = Math.min(di, newLen - 1);
        const remainingDisplay = displayedLayers.filter((_, i) => i !== di);
        const nextId = remainingDisplay[newDi]?.id;
        if (nextId) setSelectedId(nextId);
        else setSelectedId(null);
    };
    const duplicateAtDisplayPos = (di) => {
        if (di == null || di < 0 || di >= layers.length) return;
        const underlyingIdx = displayToUnderlying(di);
        const newId = duplicateLayerAt(side, underlyingIdx);
        if (newId) setSelectedId(newId);
        containerRef.current?.focus();
    };
    const isLayerLocked = (row) => !!(row && row.locked);
    const { onKeyDown: tableKeyDown } = useTableShortcuts({
        focusIdx: selectedDisplayIdx,
        rows: displayedLayers,
        isLocked: isLayerLocked,
        onInsertAbove: (i) => insertAtDisplayPos(i, false),
        onInsertBelow: (i) => insertAtDisplayPos(i, true),
        onDelete:      (i) => deleteAtDisplayPos(i),
        onDuplicate:   (i) => duplicateAtDisplayPos(i),
    });

    // Stable, id-passing row callbacks. Keeping these referentially stable (and
    // the `layer` object refs stable — DesignContext.updateLayer replaces only the
    // changed layer) is what lets React.memo skip every unchanged row.
    const selectAndFocus = useCallback((id) => {
        setSelectedId(id);
        containerRef.current?.focus();
    }, []);
    const onMaterialChangeRow  = useCallback((id, mat) => updateLayer(side, id, { material: mat }), [updateLayer, side]);
    const onThicknessChangeRow = useCallback((id, th)  => updateLayer(side, id, { thickness: th }), [updateLayer, side]);
    const onLockToggleRow      = useCallback((id, locked) => updateLayer(side, id, { locked: !locked }), [updateLayer, side]);
    const onMoveUpRow          = useCallback((id) => moveLayer(side, id, reversed ? 'down' : 'up'), [moveLayer, side, reversed]);
    const onMoveDownRow        = useCallback((id) => moveLayer(side, id, reversed ? 'up' : 'down'), [moveLayer, side, reversed]);
    const onDuplicateRow       = useCallback((id) => duplicateLayer(side, id), [duplicateLayer, side]);
    const onRemoveRow          = useCallback((id) => { removeLayer(side, id); setSelectedId(null); }, [removeLayer, side]);

    // The whole row list, built once and memoized. Scrolling never re-runs this
    // (it changes no state) — the browser scrolls the DOM natively with zero React
    // work. It rebuilds only when the layers, selection, λ₀, theme or locale
    // actually change; even then React.memo on LayerRow skips every row whose own
    // props are unchanged (e.g. selection only re-renders the 2 affected rows).
    // No virtualization: a coating is a static list while you scroll, so we mount
    // it once rather than churning rows in/out of a viewport window.
    const rowEls = useMemo(() => {
        const dl = reversed ? [...layers].reverse() : layers;
        const lastIdx = dl.length - 1;
        return dl.map((layer, di) => h(LayerRow, {
            key: layer.id,
            layer, index: di,
            isSelected: layer.id === selectedId,
            onSelect: selectAndFocus,
            c,
            onMaterialChange: onMaterialChangeRow,
            onThicknessChange: onThicknessChangeRow,
            onLockToggle: onLockToggleRow,
            onMoveUp: onMoveUpRow,
            onMoveDown: onMoveDownRow,
            onDuplicate: onDuplicateRow,
            onRemove: onRemoveRow,
            canMoveUp: di > 0,
            canMoveDown: di < lastIdx,
            refLambda, t,
        }));
    }, [layers, reversed, selectedId, refLambda, c, t,
        selectAndFocus, onMaterialChangeRow, onThicknessChangeRow, onLockToggleRow,
        onMoveUpRow, onMoveDownRow, onDuplicateRow, onRemoveRow]);

    return h('div', {
        ref: containerRef,
        tabIndex: 0,
        onKeyDown: tableKeyDown,
        style: { display: 'flex', flexDirection: 'column', height: '100%', outline: 'none' }
    },
        // Toolbar
        h('div', {
            style: {
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '4px 6px', borderBottom: `1px solid ${c.border}`,
                backgroundColor: c.panel, flexShrink: 0, flexWrap: 'wrap'
            }
        },
            h(Btn, { onClick: handleAdd, c }, de.addLayer),
            h(Btn, {
                onClick: () => { if (selectedId) removeLayer(side, selectedId); setSelectedId(null); },
                disabled: !selectedId, c
            }, de.removeLayer),
            h('div', { style: { width: 1, height: 20, background: c.border, margin: '0 2px' } }),
            h(Btn, {
                onClick: () => invertActiveSide && invertActiveSide(),
                disabled: layers.length < 2, c,
                title: de.invertOrderTip
            }, de.invertOrder),
            h('div', { style: { width: 1, height: 20, background: c.border, margin: '0 2px' } }),
            (() => {
                const allLocked = layers.length > 0 && layers.every(l => l.locked);
                return h(Btn, {
                    onClick: () => setAllLocked && setAllLocked(side, !allLocked),
                    disabled: layers.length === 0, c,
                    title: allLocked ? de.unlockAllTip : de.lockAllTip
                }, h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } },
                    h(LockIcon, { locked: !allLocked, size: 12 }),
                    allLocked ? de.unlockAll : de.lockAll));
            })(),
            // Copy this side's stack to the other surface — moved here from the
            // top tab bar so that bar stays uncluttered when the window is narrow.
            h(Btn, {
                onClick: () => copyToOther && copyToOther(),
                title: side === 'front' ? de.copyToBack : de.copyToFront,
                c, style: { marginLeft: 4 }
            }, side === 'front' ? de.copyToBack : de.copyToFront)
        ),

        // Column headers — the box model must match LayerRow EXACTLY or the
        // numeric columns drift:
        //  • borderLeft:2px transparent mirrors the row's selection border so
        //    the flex track starts at the same x (rows have a 2px left border).
        //  • numeric headers are CENTER-aligned in the same fixed-width box as
        //    the (also center-aligned) ThicknessCell, so 'd (nm)'/'OT'/'QW'/'FW'
        //    align with their values by construction — independent of the cell's
        //    1px symmetric border or any padding (matching right edges is
        //    fragile; equal-width + centered is exact).
        //  • actions placeholder = 4 IconBtns (24px) + 3 flex gaps (1px) = 99,
        //    with marginLeft:2 matching the row's actions <div>.
        h('div', {
            style: {
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '2px 4px', marginBottom: 1,
                borderLeft: '2px solid transparent',
                color: c.textDim, fontSize: 11, userSelect: 'none',
                borderBottom: `1px solid ${c.border}`, flexShrink: 0
            }
        },
            h('div', { style: { width: 24, textAlign: 'right', flexShrink: 0 } }, de.colNum),
            h('div', { style: { flex: 1, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' } }, de.colMaterial),
            h('div', { style: { width: 70, textAlign: 'center', flexShrink: 0 }, title: 'Physical thickness (nm) — editable' }, 'd (nm)'),
            h('div', { style: { width: 58, textAlign: 'center', flexShrink: 0 }, title: 'Optical thickness n·d (nm)' }, 'OT'),
            h('div', { style: { width: 50, textAlign: 'center', flexShrink: 0 }, title: 'Quarter-wave optical thickness 4·n·d/λ₀' }, 'QW'),
            h('div', { style: { width: 50, textAlign: 'center', flexShrink: 0 }, title: 'Full-wave optical thickness n·d/λ₀' }, 'FW'),
            h('div', { style: { width: 22, flexShrink: 0 } }),                              // mirrors lock button
            h('div', { style: { width: 99, marginLeft: 2, flexShrink: 0 } })                // mirrors actions group (4×24 + 3×1 gap)
        ),

        // Substrate top label (both front reversed and back show substrate at top)
        h('div', { style: { padding: '2px 4px', fontSize: 10, color: c.textDim, fontStyle: 'italic', flexShrink: 0 } },
            de.substrateTopLabel(design.substrate.material)
        ),

        // Layers — full list mounted once; scrolling is pure native scroll.
        h('div', {
            style: { flex: 1, overflowY: 'auto', padding: '2px 4px' }
        },
            displayedLayers.length === 0
                ? h('div', {
                    style: {
                        textAlign: 'center', color: c.textDim, fontSize: 12,
                        padding: '20px 0', fontStyle: 'italic'
                    }
                }, de.noLayers)
                : rowEls
        ),

        // Incident / exit bottom label
        h('div', { style: { padding: '2px 4px', fontSize: 10, color: c.textDim, fontStyle: 'italic', flexShrink: 0, borderTop: `1px solid ${c.border}` } },
            side === 'front'
                ? de.incidentBottomLabel(design.incidentMedium)
                : de.exitLabel(design.exitMedium)
        )
    );
}

// ── Design Editor ─────────────────────────────────────────────────────────────

export function DesignEditor({ c, t }) {
    const { design, updateDesign, addLayer, removeLayer, updateLayer, moveLayer, duplicateLayer } = useDesign();
    const [activeSide, setActiveSide] = useState('front');
    const de = t.designEditor;

    // Which side's tab is disabled for editing, and why:
    //   • symmetric    → back is mirrored from front (edit front)
    //   • ignore other → the non-active surface is excluded from evaluation, so
    //                     its tab is dormant until "Ignore other side" is cleared.
    // both_independent / single-side+total leave both tabs editable.
    const _sm = design.surfaceMode || 'front_only';
    const _me = design.mfEvalMode  || 'side';
    const disabledSide =
        _sm === 'symmetric'                    ? 'back'
        : (_me === 'side' && _sm === 'front_only') ? 'back'
        : (_me === 'side' && _sm === 'back_only')  ? 'front'
        : null;
    const disabledReason = _sm === 'symmetric' ? 'symmetric' : 'ignored';

    // Never leave the active tab on a disabled side.
    useEffect(() => {
        if (disabledSide && activeSide === disabledSide) {
            setActiveSide(disabledSide === 'back' ? 'front' : 'back');
        }
    }, [disabledSide, activeSide]);

    const layers   = activeSide === 'front' ? (design.frontLayers || []) : (design.backLayers || []);
    const refLambda = design.referenceWavelength || 550;
    // Stack-geometry diagram is always visible; the media / λ₀ / cone settings
    // collapse so the layer list keeps its vertical space (persisted).
    const [settingsOpen, setSettingsOpen] = usePersistentBool('de.settingsOpen', true);

    // ── Index-based layer helpers (used by keyboard shortcuts) ─────
    // These complement the id-based DesignContext API so that callers who
    // already know the underlying-array splice position don't pay an
    // id-lookup round-trip and can pass a source layer for material defaults.
    const _keyOf = (side) => side === 'back' ? 'backLayers' : 'frontLayers';
    const _newId = () => `l-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    const insertLayerAt = (side, splicePos, source) => {
        const key = _keyOf(side);
        const cur = design[key] || [];
        const id  = _newId();
        const newLayer = source
            ? { id, material: source.material, thickness: source.thickness, locked: false }
            : { id, material: 'SiO2', thickness: 100, locked: false };
        const pos = Math.max(0, Math.min(splicePos, cur.length));
        const next = [...cur.slice(0, pos), newLayer, ...cur.slice(pos)];
        const patch = { [key]: next };
        if (design.surfaceMode === 'symmetric' && side === 'front') {
            patch.backLayers = mirrorLayers(next);
        }
        updateDesign(patch);
        return id;
    };
    const removeLayerAt = (side, splicePos) => {
        const key = _keyOf(side);
        const cur = design[key] || [];
        if (splicePos < 0 || splicePos >= cur.length) return false;
        if (cur[splicePos].locked) return false;
        const next = [...cur.slice(0, splicePos), ...cur.slice(splicePos + 1)];
        const patch = { [key]: next };
        if (design.surfaceMode === 'symmetric' && side === 'front') {
            patch.backLayers = mirrorLayers(next);
        }
        updateDesign(patch);
        return true;
    };
    const duplicateLayerAt = (side, splicePos) => {
        const key = _keyOf(side);
        const cur = design[key] || [];
        if (splicePos < 0 || splicePos >= cur.length) return null;
        const src = cur[splicePos];
        const id  = _newId();
        const copy = { ...src, id, locked: false };
        const next = [...cur.slice(0, splicePos + 1), copy, ...cur.slice(splicePos + 1)];
        const patch = { [key]: next };
        if (design.surfaceMode === 'symmetric' && side === 'front') {
            patch.backLayers = mirrorLayers(next);
        }
        updateDesign(patch);
        return id;
    };

    // Lock / unlock every layer's thickness on a side in one shot. In symmetric
    // mode the back stack is re-mirrored so the two sides stay identical.
    const setAllLocked = (side, locked) => {
        const key = _keyOf(side);
        const cur = design[key] || [];
        if (cur.length === 0) return;
        const next = cur.map(l => ({ ...l, locked }));
        const patch = { [key]: next };
        if (design.surfaceMode === 'symmetric' && side === 'front') {
            patch.backLayers = mirrorLayers(next);
        }
        updateDesign(patch);
    };

    const copyToOther = () => {
        const srcLayers = activeSide === 'front' ? (design.frontLayers || []) : (design.backLayers || []);
        // Reverse order: back coating is illuminated from the substrate side,
        // so layer order is mirrored relative to the front.
        const cloned = [...srcLayers].reverse().map(l => ({ ...l, id: _newId() }));
        if (activeSide === 'front') {
            updateDesign({ backLayers: cloned });
        } else {
            updateDesign({ frontLayers: cloned });
        }
    };

    // Flip the active stack's layer order on the substrate (1st ↔ last).
    // In symmetric mode the back stack is re-mirrored from the new front
    // so the two sides stay physically identical.
    const invertActiveSide = () => {
        const key = activeSide === 'front' ? 'frontLayers' : 'backLayers';
        const reversed = [...(design[key] || [])].reverse();
        if (design.surfaceMode === 'symmetric' && activeSide === 'front') {
            updateDesign({ frontLayers: reversed, backLayers: mirrorLayers(reversed) });
        } else {
            updateDesign({ [key]: reversed });
        }
    };

    return h('div', {
        style: {
            display: 'flex', flexDirection: 'column', height: '100%',
            // Floor the width so the panel can't be dragged down to nothing;
            // the docking container scrolls if it's narrower than this.
            minWidth: 340,
            backgroundColor: c.bg, color: c.text,
            fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: 13,
            overflow: 'hidden'
        }
    },
        // ── Side tabs ─────────────────────────────────────────────────────────
        h('div', {
            style: {
                display: 'flex', alignItems: 'center', borderBottom: `1px solid ${c.border}`,
                backgroundColor: c.panel, flexShrink: 0
            }
        },
            ['front', 'back'].map(side => {
                const isSymmetric = (design.surfaceMode === 'symmetric');
                const disabled = side === disabledSide;
                const mb = (t.modeBar) || {};
                const title = !disabled ? null
                    : (disabledReason === 'symmetric'
                        ? (mb.tabDisabledSymmetric || 'Back mirrors the front (Symmetric). Edit the front coating.')
                        : (mb.tabDisabledIgnored || 'This side is ignored ("Ignore other side" is on). Uncheck it to edit this coating.'));
                return h('button', {
                    key: side,
                    onClick: () => !disabled && setActiveSide(side),
                    disabled,
                    title,
                    style: {
                        padding: '6px 16px', fontSize: 12, cursor: disabled ? 'default' : 'pointer', outline: 'none',
                        border: 'none', borderBottom: `2px solid ${activeSide === side ? c.accent : 'transparent'}`,
                        backgroundColor: 'transparent',
                        color: disabled ? c.textDim : (activeSide === side ? c.accent : c.textDim),
                        opacity: disabled ? 0.45 : 1,
                        fontFamily: 'system-ui, -apple-system, sans-serif',
                        fontWeight: activeSide === side ? 600 : 400
                    }
                }, side === 'front' ? de.frontCoating : (de.backCoating + (isSymmetric ? ' (= front)' : '')));
            }),
        ),
        // Consolidated Optimize + Evaluate bar — on its OWN full-width row so it
        // always stays on one line (it used to share the tab row and stack into
        // a column when the window was narrow). Scrolls horizontally instead of
        // wrapping if the window is extremely narrow. The Front/Back tab above is
        // for editing only; this bar is what the optimizer / MF / Specification
        // read. applySurfaceMode (inside the bar) handles the symmetric mirroring;
        // onModeChange does the DE-only editing-tab follow-up.
        h('div', {
            style: {
                display: 'flex', alignItems: 'center',
                padding: '4px 10px', borderBottom: `1px solid ${c.border}`,
                backgroundColor: c.panel, flexShrink: 0, overflowX: 'auto',
            }
        },
            h(SurfaceModeControl, {
                design, updateDesign, c, t,
                style: { flexWrap: 'nowrap' },
                // Follow the chosen primary side with the editing tab.
                onModeChange: (primarySide) => setActiveSide(primarySide === 'back' ? 'back' : 'front'),
            })
        ),

        // ── Layer list (for active side) ──────────────────────────────────────
        h('div', { style: { flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' } },
            h(LayerList, {
                layers, side: activeSide, design, c,
                addLayer, removeLayer, updateLayer, moveLayer, duplicateLayer,
                insertLayerAt, removeLayerAt, duplicateLayerAt,
                invertActiveSide, setAllLocked, copyToOther,
                refLambda, t
            })
        ),

        // ── Stack geometry / media ─────────────────────────────────────────────
        h('div', {
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
            settingsOpen && (() => {
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
            })()
        )
    );
}
