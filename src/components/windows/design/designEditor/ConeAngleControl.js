import { DebouncedInput } from '../../../ui/DebouncedInput.js';
import { Checkbox } from '../../../ui/Checkbox.js';

const { createElement: h } = React;

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

function ConeHalfAngleRow({ cone, cc, dim, inStyle, patch }) {
    const Th    = Math.max(0, cone.halfAngleDeg || 0);
    const na    = Math.sin(Th * Math.PI / 180);
    const fnum  = na > 1e-9 ? 1 / (2 * na) : Infinity;
    const fnumS = Number.isFinite(fnum) ? fnum.toFixed(2) : '∞';
    return h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', flexWrap: 'wrap' } },
        h('div', { style: { ...dim, width: 110, flexShrink: 0 }, title: cc.halfAngleTip }, cc.halfAngle || 'Half-angle Θ'),
        h(DebouncedInput, {
            value: cone.halfAngleDeg, title: cc.halfAngleTip,
            onChange: (s) => { const v = parseFloat(s); if (!isNaN(v) && v >= 0 && v < 90) patch({ halfAngleDeg: v }); },
            style: inStyle,
        }),
        h('span', dim, '°'),
        h('span', { style: { ...dim, marginLeft: 6 } },
            `${cc.na || 'NA'} ${na.toFixed(3)} · ${cc.fnum || 'f/#'} ${fnumS} · ${(cc.fullAngle ? cc.fullAngle((Th * 2).toFixed(1)) : `2Θ = ${(Th * 2).toFixed(1)}°`)}`),
    );
}

function ConeDistributionRow({ cone, cc, dim, inStyle, patch, Th }) {
    return h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', flexWrap: 'wrap' } },
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
    );
}

// User-defined intensity table for the 'user' distribution.
function ConeUserTable({ cone, cc, dim, inStyle, patch, Th, c }) {
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
    return h('div', { style: { padding: '2px 0 2px 6px' } },
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
    );
}

export function ConeAngleControl({ design, updateDesign, c, t }) {
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
    const Th = Math.max(0, cone.halfAngleDeg || 0);

    const rows = [
        h('label', {
            key: 'en',
            style: { display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', padding: '3px 0' },
            title: cc.enableTip,
        },
            h(Checkbox, { c, checked: !!cone.enabled, onChange: (e) => patch({ enabled: e.target.checked }) }),
            h('span', { style: { fontSize: 11, color: c.text } }, cc.enable || 'Average over illumination cone'),
        ),
    ];

    if (cone.enabled) {
        rows.push(h(ConeHalfAngleRow, { key: 'ha', cone, cc, dim, inStyle, patch }));
        rows.push(h(ConeDistributionRow, { key: 'di', cone, cc, dim, inStyle, patch, Th }));
        if (cone.distribution === 'user') {
            rows.push(h(ConeUserTable, { key: 'ut', cone, cc, dim, inStyle, patch, Th, c }));
        }
    }

    return h('div', null,
        h('div', { style: { fontSize: 10, fontWeight: 600, color: c.textDim, margin: '2px 0 4px', textTransform: 'uppercase', letterSpacing: 1 } },
            cc.title || 'Cone angle'),
        ...rows,
    );
}
