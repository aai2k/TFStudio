/**
 * Setting rows for a delimited text file a window writes: the delimiter, the
 * decimal places and the decimal mark. `output` holds them under `delimiter`,
 * `decimals` and `decimalMark`; `setOption(key, value)` sets one.
 *
 * A decimal comma in a comma-delimited row has to be quoted, and most readers,
 * the spectrum importer among them, do not undo the quotes. The comma
 * delimiter is not offered beside a decimal comma, and choosing the comma mark
 * moves a comma delimiter to a semicolon.
 */

import { ChoiceGroup, NumInput } from './controls.js';
import { SettingRow } from './popover.js';

const { createElement: h } = React;

const DELIMITERS = [
    { id: ',', key: 'delimComma' }, { id: ';', key: 'delimSemicolon' },
    { id: '\t', key: 'delimTab' }, { id: ' ', key: 'delimSpace' },
];

const choiceRow = ({ c, label, activeId, items, onSelect }) => h(SettingRow, { c, label },
    h(ChoiceGroup, { ariaLabel: label, activeId, c, items, onSelect }),
);

export function delimiterRow({ c, t, output, setOption }) {
    const shown = output.decimalMark === ',' ? DELIMITERS.filter(({ id }) => id !== ',') : DELIMITERS;
    return choiceRow({
        c, label: t.processSim.delimiterLabel, activeId: output.delimiter,
        items: shown.map(({ id, key }) => ({ id, label: t.spectrumExchange[key] })),
        onSelect: id => setOption('delimiter', id),
    });
}

// Twelve, the decimals the shared writer keeps when no count is set: a
// percentage held in double precision has no more to give.
export function decimalsRow({ c, t, output, setOption }) {
    return h(SettingRow, { c, label: t.processSim.decimalsLabel },
        h(NumInput, {
            c, width: 68, value: output.decimals, min: 0, max: 12, step: 1,
            onChange: value => setOption('decimals', Math.round(value)),
        }),
    );
}

// The marks are shown as the numbers they write.
export function decimalMarkRow({ c, t, output, setOption }) {
    return choiceRow({
        c, label: t.processSim.decimalMarkLabel, activeId: output.decimalMark,
        items: [{ id: '.', label: '0.5' }, { id: ',', label: '0,5' }],
        onSelect: id => {
            setOption('decimalMark', id);
            if (id === ',' && output.delimiter === ',') setOption('delimiter', ';');
        },
    });
}
