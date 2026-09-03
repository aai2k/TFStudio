import { DebouncedInput } from '../../../ui/DebouncedInput.js';
import { parseNumber } from '../../../../utils/misc/numberParsing.js';

const { createElement: h } = React;

const pct = value => (value == null ? null : value * 100);

/**
 * One row per deposited layer, in run order. Signals as percentages. The
 * material column shows the material's display name, not its catalog id;
 * `materialId` keeps the id for the colour swatch.
 */
export function worksheetRows(rows, matNames) {
    return rows.map(row => ({
        step: row.step,
        chip: row.chip,
        onChip: row.onChip,
        material: matNames?.[row.material] || row.material,
        materialId: row.material,
        lambda: row.lambda,
        signal: pct(row.signal),
        turningPoints: row.turningPoints,
        amplitude: pct(row.amplitude),
        swingIn: pct(row.swingIn),
        swingOut: pct(row.swingOut),
        cutoffRatio: row.cutoffRatio,
        terminationErrNm: row.terminationErrNm,
        // A quartz monitor is set in kilo-angstroms.
        crystal: row.crystalNm != null ? row.crystalNm / 100 : null,
        initialLevel: pct(row.initialLevel),
        poor: row.poor,
        strategy: row.strategy,
    }));
}

const fixed = digits => value => (value == null || !Number.isFinite(value) ? '—' : value.toFixed(digits));

function cellInputStyle(c, width, invalid) {
    return {
        width, padding: '1px 4px', fontSize: 11, textAlign: 'right',
        fontVariantNumeric: 'tabular-nums',
        backgroundColor: c.field, color: invalid ? c.error : c.text,
        border: `1px solid ${invalid ? c.error : c.border}`, borderRadius: 3,
    };
}

// The chip a layer is monitored on. Its position on that chip follows from the
// assignment and is shown beside it.
function chipCell(c, onChip) {
    return (value, row) => h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 3 } },
        h(DebouncedInput, {
            value: String(row.chip),
            onChange: next => onChip(row.step, parseNumber(next)),
            style: cellInputStyle(c, 34, false),
        }),
        h('span', { style: { color: c.textDim } }, `-${row.onChip}`),
    );
}

// The monitoring wavelength, flagged when the layer cannot be terminated on it
// closely enough.
function lambdaCell(c, onLambda) {
    return (value, row) => h(DebouncedInput, {
        value: String(Math.round(row.lambda)),
        onChange: next => onLambda(row.step, parseNumber(next)),
        style: cellInputStyle(c, 52, row.poor),
    });
}

// A long material name is cut with an ellipsis rather than widening the
// column; the full name is on the cell's tooltip.
function materialSwatch(c, matColorMap) {
    return (value, row) => h('span', {
        title: value,
        style: { display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0 },
    },
        h('span', {
            style: {
                width: 8, height: 8, borderRadius: 2, flexShrink: 0,
                background: matColorMap[row.materialId] || '#888',
            },
        }),
        h('span', {
            style: { maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
        }, value),
    );
}

// The thickness a signal error of the monitor's own size leaves behind.
function terminationCell(c, t) {
    return (value, row) => {
        if (value == null) return h('span', { style: { color: c.textDim } }, t.monitorWorksheet.onTime);
        const text = Number.isFinite(value) ? value.toFixed(2) : '∞';
        return h('span', { style: { color: row.poor ? c.error : c.text } }, text);
    };
}

// The thickness the quartz monitor runs to, on every layer. The flagged
// layers are the ones the crystal has to carry; the rest are dimmed.
function crystalCell(c) {
    return (value, row) => h('span', { style: { color: row.poor ? c.text : c.textDim } }, fixed(3)(value));
}

export function worksheetColumns({ t, c, matColorMap, onChip, onLambda }) {
    const mw = t.monitorWorksheet;
    return [
        { key: 'step', label: '#', align: 'left' },
        { key: 'chip', label: mw.colChip, align: 'left', fmt: chipCell(c, onChip) },
        { key: 'material', label: mw.colMaterial, align: 'left', fmt: materialSwatch(c, matColorMap) },
        { key: 'lambda', label: mw.colLambda, fmt: lambdaCell(c, onLambda) },
        { key: 'signal', label: mw.colSignal, fmt: fixed(2) },
        { key: 'turningPoints', label: mw.colTurningPoints },
        { key: 'amplitude', label: mw.colAmplitude, fmt: fixed(2) },
        { key: 'swingIn', label: mw.colSwingIn, fmt: fixed(2) },
        { key: 'swingOut', label: mw.colSwingOut, fmt: fixed(2) },
        { key: 'cutoffRatio', label: mw.colCutoff, fmt: fixed(3) },
        { key: 'terminationErrNm', label: mw.colTermination, fmt: terminationCell(c, t) },
        { key: 'crystal', label: mw.colCrystal, fmt: crystalCell(c) },
        { key: 'initialLevel', label: mw.colInitial, fmt: fixed(2) },
    ];
}
