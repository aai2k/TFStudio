import { QUALIFIER_KINDS, defaultTolForKind } from '../../../../utils/synthesis/qualifiers.js';
import { OPERAND_POLS } from '../../../../utils/physics/optimizer.js';
import { Checkbox } from '../../../ui/Checkbox.js';
import { KIND_META } from './model.js';
import { Field, numInp, numInpTarget, inpStyle, selStyle, btnStyle } from './fields.js';

const { createElement: h } = React;

export function QRow({ q, r, c, ts, updateQualifier, removeQualifier, isSelected, onSelect }) {
    const meta = KIND_META[q.kind] || {};
    const onF  = (k, v) => updateQualifier(q.id, { [k]: v });

    const passColor = r?.pass === true  ? c.success
                   : r?.pass === false ? c.error
                                      : c.textDim;
    const passBadge = r?.pass === true  ? '✓'
                   : r?.pass === false ? '✗'
                                      : '—';

    return h('div', {
        onMouseDown: (e) => {
            // Don't steal focus from inline inputs/selects the user is editing.
            const tag = e.target?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return;
            onSelect && onSelect(q.id);
        },
        style: {
            display: 'flex', flexDirection: 'column', gap: 4,
            padding: '8px 10px', background: isSelected ? (c.hover || c.panel) : c.panel,
            border: `1px solid ${isSelected ? c.accent : c.border}`,
            borderLeft: `3px solid ${passColor}`,
            borderRadius: 4,
            outline: isSelected ? `1px solid ${c.accent}55` : 'none',
        }
    },
        renderRowHeader({ q, r, c, ts, onF, updateQualifier, removeQualifier, passColor, passBadge }),

        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 11, color: c.textDim } },
            renderChannelPick(meta, q, onF, c, ts),
            renderChannelFixed(meta, c),
            renderWavelength(meta, q, onF, c),
            renderAoi(meta, q, onF, c),
            renderPol(meta, q, onF, c, ts),
            renderDirection(meta, q, onF, c, ts),
            renderLevel(meta, q, onF, c, ts),
            renderEdgeSide(meta, q, onF, c, ts),
            renderIntegral(meta, q, onF, c, ts),
            renderCmp(q, onF, c, ts),
            renderTargets(q, meta, onF, c, ts),
        ),

        // Tooltip / summary line for non-pass cases
        r?.summary && r?.pass === false && h('div', {
            style: { fontSize: 10, color: c.textDim, fontStyle: 'italic', paddingLeft: 4 },
        }, r.summary)
    );
}

// ── Row header: enabled toggle / kind / label / verdict ──────────────────────

function renderRowHeader({ q, r, c, ts, onF, updateQualifier, removeQualifier, passColor, passBadge }) {
    return h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
        h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: c.textDim, cursor: 'pointer' } },
            h(Checkbox, {
                c, checked: q.enabled !== false,
                onChange: e => onF('enabled', e.target.checked),
            }),
            ts.enabledLabel || 'on'
        ),
        h('select', {
            value: q.kind,
            // Changing kind can switch the unit (% ↔ nm ↔ count), so reset the
            // eq tolerance to the new kind's native-unit default in the same
            // update (otherwise a 0.01 fraction tol lingers as 0.01 nm).
            onChange: e => updateQualifier(q.id, { kind: e.target.value, tol: defaultTolForKind(e.target.value) }),
            style: { ...selStyle(c), minWidth: 170 },
        }, QUALIFIER_KINDS.map(k =>
            h('option', { key: k, value: k, style: { background: c.panel } },
              (ts.kinds && ts.kinds[k]) || k))
        ),
        h('input', {
            type: 'text', value: q.label || '',
            placeholder: ts.labelPlaceholder || 'optional label',
            onChange: e => onF('label', e.target.value),
            style: { ...inpStyle(c), flex: 1, width: 'auto' },
        }),
        // Verdict badge — value + cmp + pass mark
        h('div', {
            style: {
                fontSize: 11, color: passColor, fontWeight: 700,
                padding: '3px 8px', borderRadius: 11,
                background: `${passColor}1a`, border: `1px solid ${passColor}55`,
                minWidth: 60, textAlign: 'center',
            }
        }, passBadge + '  ' + (r?.displayValue || '—')),
        h('button', {
            onClick: () => removeQualifier(q.id),
            title: ts.remove || 'Remove',
            style: { ...btnStyle(c), padding: '2px 8px', color: c.textDim },
        }, '✕'),
    );
}

// ── Row body: kind-specific field groups ─────────────────────────────────────

// Channel (when not fixed by kind)
function renderChannelPick(meta, q, onF, c, ts) {
    return meta.channelPick && h(Field, { label: ts.channel || 'Ch', c },
        h('select', {
            value: q.channel || 'T', onChange: e => onF('channel', e.target.value),
            style: { ...selStyle(c), width: 48 },
        },
            ['T','R','A'].map(x => h('option', { key: x, value: x, style: { background: c.panel } }, x))
        )
    );
}

function renderChannelFixed(meta, c) {
    return meta.channelFixed && h('div', { style: { fontSize: 10, color: c.text, padding: '2px 6px', background: c.bg, borderRadius: 3, border: `1px solid ${c.border}` } },
        meta.channelFixed
    );
}

// λ — single, band, or hidden (geom-only kinds)
function renderWavelength(meta, q, onF, c) {
    return meta.single
        ? h(Field, { label: 'λ', c },
            numInp(q.lambda, v => onF('lambda', v), c))
        : !meta.geomOnly
            ? [
                h(Field, { label: 'λ start', c, key: 'ls' },
                    numInp(q.lambdaStart, v => onF('lambdaStart', v), c)),
                h(Field, { label: 'λ end',   c, key: 'le' },
                    numInp(q.lambdaEnd,   v => onF('lambdaEnd',   v), c)),
              ]
            : null;
}

// AOI, pol — only for optical kinds
function renderAoi(meta, q, onF, c) {
    return !meta.geomOnly && h(Field, { label: 'AOI', c },
        numInp(q.aoi, v => onF('aoi', v), c));
}

function renderPol(meta, q, onF, c, ts) {
    return !meta.geomOnly && h(Field, { label: ts.pol || 'pol', c },
        h('select', {
            value: q.pol || 'avg', onChange: e => onF('pol', e.target.value),
            style: { ...selStyle(c), width: 54 },
        }, OPERAND_POLS.map(p =>
            h('option', { key: p, value: p, style: { background: c.panel } }, p)
        ))
    );
}

// Peak direction
function renderDirection(meta, q, onF, c, ts) {
    return meta.direction && h(Field, { label: ts.direction || 'dir', c },
        h('select', {
            value: q.direction || 'max', onChange: e => onF('direction', e.target.value),
            style: { ...selStyle(c), width: 70 },
        },
            h('option', { value: 'max', style: { background: c.panel } }, ts.dirMax || 'max'),
            h('option', { value: 'min', style: { background: c.panel } }, ts.dirMin || 'min'),
        )
    );
}

// FWHM / edge crossing level
function renderLevel(meta, q, onF, c, ts) {
    return meta.level && h(Field, { label: ts.level || 'level', c, tip: ts.levelTip || 'Crossing level as a fraction of peak (e.g. 0.5 = half-max).' },
        numInp(q.level ?? 0.5, v => onF('level', v), c, 0, 1, 0.01));
}

// Edge side
function renderEdgeSide(meta, q, onF, c, ts) {
    return meta.edgeSide && h(Field, { label: ts.edge || 'edge', c },
        h('select', {
            value: q.edgeSide || 'left', onChange: e => onF('edgeSide', e.target.value),
            style: { ...selStyle(c), width: 70 },
        },
            h('option', { value: 'left',  style: { background: c.panel } }, ts.left  || 'left'),
            h('option', { value: 'right', style: { background: c.panel } }, ts.right || 'right'),
        )
    );
}

// INTEGRAL — source & detector picker (simple v1: id-only strings)
function renderIntegral(meta, q, onF, c, ts) {
    return meta.integral && [
        h(Field, { label: ts.source || 'source', c, key: 'src' },
            h('select', {
                value: q.source?.id || 'D65', onChange: e => onF('source', { id: e.target.value }),
                style: { ...selStyle(c), width: 100 },
            },
                ['D65','D50','A','AM1.5G','E','BB','user'].map(x =>
                    h('option', { key: x, value: x, style: { background: c.panel } }, x))
            )),
        h(Field, { label: ts.detector || 'detector', c, key: 'det' },
            h('select', {
                value: q.detector?.id || 'photopic', onChange: e => onF('detector', { id: e.target.value }),
                style: { ...selStyle(c), width: 100 },
            },
                ['photopic','flat','user'].map(x =>
                    h('option', { key: x, value: x, style: { background: c.panel } }, x))
            )),
    ];
}

// Comparison cmp + target(s)
function renderCmp(q, onF, c, ts) {
    return h(Field, { label: ts.cmp || 'cmp', c },
        h('select', {
            value: q.cmp || 'ge', onChange: e => onF('cmp', e.target.value),
            style: { ...selStyle(c), width: 78 },
        },
            h('option', { value: 'ge',      style: { background: c.panel } }, '≥'),
            h('option', { value: 'le',      style: { background: c.panel } }, '≤'),
            h('option', { value: 'eq',      style: { background: c.panel } }, '= ±tol'),
            h('option', { value: 'between', style: { background: c.panel } }, '∈ [lo,hi]'),
        )
    );
}

function renderTargets(q, meta, onF, c, ts) {
    return (q.cmp === 'between')
        ? [
            h(Field, { label: ts.lo || 'lo', c, key: 'lo' },
                numInpTarget(q.lo,  meta, v => onF('lo', v), c)),
            h(Field, { label: ts.hi || 'hi', c, key: 'hi' },
                numInpTarget(q.hi,  meta, v => onF('hi', v), c)),
          ]
        : [
            h(Field, { label: ts.target || 'target', c, key: 'tgt' },
                numInpTarget(q.target, meta, v => onF('target', v), c)),
            q.cmp === 'eq' && h(Field, { label: ts.tol || 'tol', c, key: 'tol' },
                numInpTarget(q.tol,    meta, v => onF('tol',    v), c)),
          ];
}
