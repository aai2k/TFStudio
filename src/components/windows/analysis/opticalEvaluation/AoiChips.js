import { tablerIcon } from '../../../ui/tablerIcons.js';
import { ANALYSIS_DEFAULTS } from '../../../../constants/analysisDefaults.js';
import { parseNumberStrict } from '../../../../utils/misc/numberParsing.js';
import { stepKeys } from '../../../ui/numberField.js';
import { AOI_MAX, formatTheta } from './model.js';

const { createElement: h, useState } = React;

// The highest angle a chip holds, degrees, the same as the saved angle lists.
const AOI_TOP = ANALYSIS_DEFAULTS.opticalEvaluation.lists.thetas.max;

// The angle boxes are text fields that keep what is typed until Enter or the
// box is left, and take a comma or a dot as the decimal separator. An angle is
// kept to the 0.1° a chip shows, and one that rounds past the top is refused
// rather than taken as grazing incidence.
function parsedAoi(raw) {
    const value = parseNumberStrict(raw);
    if (!(value >= 0)) return null;
    const rounded = Math.round(value * 10) / 10;
    return rounded <= AOI_TOP ? rounded : null;
}

// The arrow keys step the angle being typed by 1° within 0 and the top; it
// still applies on Enter or when the box is left.
const stepAoi = (event, text, setText) => stepKeys(text, setText, { step: 1, min: 0, max: AOI_TOP })(event);

function addDraftAoi({ draft, values, onChange, setDraft, max }) {
    if (!draft.trim()) return;
    const value = parsedAoi(draft);
    if (value !== null && !values.includes(value) && values.length < max) onChange([...values, value]);
    setDraft('');
}

function editAoi({ index, raw, values, onChange }) {
    const value = parsedAoi(raw);
    const duplicate = values.some((item, itemIndex) => itemIndex !== index && item === value);
    if (value !== null && !duplicate && values[index] !== value) {
        onChange(values.map((item, itemIndex) => itemIndex === index ? value : item));
    }
}

function removeAoi({ index, values, onChange }) {
    if (values.length > 1) onChange(values.filter((_, itemIndex) => itemIndex !== index));
}

function AoiChip({ value, onRemove, onEdit, canRemove, c, oe }) {
    const [editing, setEditing] = useState(false);
    const [raw, setRaw] = useState('');
    const start = () => { setRaw(formatTheta(value)); setEditing(true); };
    const commit = () => { onEdit(raw); setEditing(false); };

    if (editing) {
        return h('input', {
            type: 'text', inputMode: 'decimal', value: raw, autoFocus: true,
            onFocus: event => event.target.select(),
            onChange: event => setRaw(event.target.value),
            onBlur: commit,
            onKeyDown: event => {
                stepAoi(event, raw, setRaw);
                if (event.key === 'Enter') commit();
                if (event.key === 'Escape') setEditing(false);
            },
            style: {
                width: 46, height: 22,
                border: `1px solid ${c.accent}`, borderRadius: 4,
                backgroundColor: c.panel, color: c.text,
                fontSize: 11, fontFamily: 'system-ui, -apple-system, sans-serif',
                padding: '0 6px', outline: 'none', textAlign: 'center'
            }
        });
    }

    return h('span', {
        style: {
            display: 'inline-flex', alignItems: 'center', height: 22,
            padding: canRemove ? '0 2px 0 7px' : '0 7px',
            border: 'none', borderRadius: 4,
            fontSize: 11, lineHeight: '20px', backgroundColor: c.panel,
            fontVariantNumeric: 'tabular-nums', color: c.text, gap: 2,
            flexShrink: 0
        }
    },
        h('span', { onClick: start, title: oe.editAoiTooltip, style: { cursor: 'pointer' } }, `${formatTheta(value)}°`),
        canRemove && h('button', {
            onClick: onRemove,
            'aria-label': `Remove ${formatTheta(value)}°`,
            style: {
                background: 'transparent', border: 'none', color: c.textDim, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '0 3px', outline: 'none'
            }
        }, tablerIcon('x', 12))
    );
}

/**
 * The angles as chips, each clicked to edit, with a + to add one. `max` is how
 * many the window takes; Optical Evaluation's six by default.
 */
export function AoiChips({ values, onChange, c, oe, max = AOI_MAX }) {
    const [draft, setDraft] = useState('');
    const [adding, setAdding] = useState(false);
    const addValue = () => {
        addDraftAoi({ draft, values, onChange, setDraft, max });
        setAdding(false);
    };
    const addTitle = oe.addAoiTooltip(max, AOI_TOP);
    return h('div', {
        style: {
            minHeight: 28, display: 'inline-flex', alignItems: 'center', gap: 2,
            padding: 2, border: `1px solid ${c.border}`, borderRadius: 7,
            backgroundColor: c.field, flexWrap: 'wrap'
        }
    },
        values.map((value, index) => h(AoiChip, {
            key: `${value}-${index}`, value,
            onRemove: () => removeAoi({ index, values, onChange }),
            onEdit: raw => editAoi({ index, raw, values, onChange }),
            canRemove: values.length > 1, c, oe
        })),
        values.length < max && adding && h('input', {
            type: 'text', inputMode: 'decimal', value: draft,
            autoFocus: true, title: addTitle, 'aria-label': addTitle,
            onChange: event => setDraft(event.target.value),
            onBlur: addValue,
            onKeyDown: event => {
                stepAoi(event, draft, setDraft);
                if (event.key === 'Enter') addValue();
                if (event.key === 'Escape') { setDraft(''); setAdding(false); }
            },
            style: {
                width: 46, height: 22,
                border: `1px solid ${c.accent}`, borderRadius: 4,
                backgroundColor: c.panel, color: c.text,
                fontSize: 11, fontFamily: 'system-ui, -apple-system, sans-serif',
                padding: '0 4px', outline: 'none', textAlign: 'center'
            }
        }),
        values.length < max && !adding && h('button', {
            onClick: () => setAdding(true), title: addTitle, 'aria-label': addTitle,
            style: {
                width: 24, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: 'none', borderRadius: 4, backgroundColor: 'transparent',
                color: c.textDim, cursor: 'pointer', outline: 'none'
            }
        }, tablerIcon('plus', 14))
    );
}
