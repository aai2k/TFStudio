import { LockIcon } from '../../../ui/LockIcon.js';
import { provisionalMark } from '../../optimization/provisionalMark.js';
import { matFriendlyName } from '../../optimization/synthesisShared/materialNames.js';
import { displayLayerLabel, rankSensitivityRows } from './viewModel.js';

const { createElement: h } = React;

/**
 * One row per perturbed layer, in stack order, each carrying the rank it holds
 * when the layers are sorted by how far the merit function moved. The material
 * is named as `design` shows it.
 */
export function sensitivityRows(orderedRows, frontCount, design) {
    // A stack repeats a few materials many times, so each is looked up once.
    const names = new Map();
    const nameOf = id => {
        if (!names.has(id)) names.set(id, matFriendlyName(id, design));
        return names.get(id);
    };
    return rankSensitivityRows(orderedRows).map((row, index) => ({
        index: index + 1,
        layer: displayLayerLabel(row, frontCount),
        material: row.materialId ? nameOf(row.materialId) : '—',
        thickness: row.thickness,
        deltaNm: row.deltaNm,
        deltaMFAbs: row.deltaMFAbs,
        sensitivity: row.sensitivity,
        rank: row.rank,
        locked: !!row.locked,
        materialId: row.materialId || '',
    }));
}

function lockedLabel(c) {
    return (value, row) => (row.locked
        ? h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 5 } },
            value,
            h('span', { style: { display: 'inline-flex', color: c.accent } },
                h(LockIcon, { locked: true, size: 11 })))
        : value);
}

// The bars are coloured by material, so the table repeats that colour: it is
// what ties a bar to the row explaining it.
function materialSwatch(c, matColorMap) {
    return (value, row) => h('span', {
        style: { display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0 },
    },
        h('span', {
            style: {
                width: 8, height: 8, borderRadius: 2, flexShrink: 0,
                background: matColorMap[row.materialId] || '#888',
            },
        }),
        value,
    );
}

// A ranking read with a row at its default step in place of its own Step
// shows its merit changes and ranks as the merit tables show such a value
// until the ranking at the rows' own Steps comes (provisionalMark.js).
function marked(provisional, tip, format) {
    if (!provisional) return format;
    const mark = provisionalMark(true, tip);
    return value => h('span', { title: mark.title, style: { opacity: mark.opacity } }, mark.prefix + format(value));
}

export function sensitivityColumns({ t, c, matColorMap, provisional = false, tip }) {
    const ls = t.layerSensitivity;
    return [
        { key: 'index', label: '#', align: 'left' },
        { key: 'layer', label: ls.colLayer, align: 'left', fmt: lockedLabel(c) },
        { key: 'material', label: ls.colMaterial, align: 'left', fmt: materialSwatch(c, matColorMap) },
        { key: 'thickness', label: `d (${t.units.nm})`, fmt: value => value.toFixed(2) },
        { key: 'deltaNm', label: `Δd (${t.units.nm})`, fmt: value => value.toFixed(3) },
        { key: 'deltaMFAbs', label: '|ΔOMF|', fmt: marked(provisional, tip, value => value.toExponential(3)) },
        { key: 'sensitivity', label: ls.colSens, fmt: marked(provisional, tip, value => value.toFixed(1)) },
        { key: 'rank', label: ls.colRank, fmt: marked(provisional, tip, String) },
    ];
}
