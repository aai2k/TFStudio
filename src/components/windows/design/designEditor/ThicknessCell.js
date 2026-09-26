import { nmToUnit, thicknessEntryToNm } from './units.js';
import { LAYER_TABLE } from './layerTableLayout.js';
import { SPIN_WIDTH, SpinArrows, useWheelStep } from './ThicknessSpin.js';

const { createElement: h, useEffect, useState, useRef } = React;

// ── Thickness cell ────────────────────────────────────────────────────────────
// Edits one of {nm, OT, QWOT, FWOT}. value_nm is the source of truth; the cell
// converts in/out via nmToUnit/thicknessEntryToNm so all four cells in a row
// stay in sync. Editing the QW cell, for example, recomputes the nm value (and
// every other cell rerenders from the new value_nm next paint).
//
// `primary` = true → emphasized styling for the editable "main" representation;
// the others render slightly dimmed but are equally editable.

// Tooltip text for each thickness unit. Any unit other than nm/OT/QWOT (i.e.
// FWOT and any unknown) falls through to the full-wave description.
const THICKNESS_CELL_TITLES = {
    nm:   'Physical thickness (nm)',
    OT:   'Optical thickness n·d (nm)',
    QWOT: 'Quarter-wave optical thickness 4·n·d/λ₀',
    FWOT: 'Full-wave optical thickness n·d/λ₀',
};
function thicknessCellTitle(unit) {
    return THICKNESS_CELL_TITLES[unit] || THICKNESS_CELL_TITLES.FWOT;
}

// Editing state of a thickness cell: a centered text input. Enter commits,
// Escape cancels (via the injected commit/cancel callbacks), and blur commits.
function thicknessCellInput({ inputRef, raw, setRaw, commitAndNavigate, cancel, onActivate, c }) {
    return h('input', {
        ref: inputRef, value: raw,
        // Marks an open edit for the step arrows and the wheel (ThicknessSpin.js).
        'data-thickness-edit': '',
        onFocus: onActivate,
        onChange: (e) => setRaw(e.target.value),
        // The layer row selects itself on click and puts focus back on the list
        // for keyboard navigation. While this cell is being edited the input owns
        // the focus, so a click meant to place the caret must not reach the row —
        // it would blur the input and commit the value mid-edit.
        onClick: (e) => e.stopPropagation(),
        onBlur: () => commitAndNavigate(null),
        onKeyDown: (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                commitAndNavigate(e.shiftKey ? 'up' : 'down');
            }
            if (e.key === 'Tab') {
                e.preventDefault();
                commitAndNavigate(e.shiftKey ? 'left' : 'right');
            }
            if (e.key === 'Escape') { e.preventDefault(); cancel(); }
        },
        style: {
            width: '100%', height: 22, boxSizing: 'border-box',
            backgroundColor: c.bg, color: c.text,
            border: `1px solid ${c.accent}`, borderRadius: 3,
            fontSize: 12, fontFamily: 'system-ui, -apple-system, sans-serif',
            padding: `0 ${LAYER_TABLE.numericTextInset}px`, outline: 'none', textAlign: 'right'
        }
    });
}

// Read-only state of a thickness cell. All unlocked cells use the full text
// color (not textDim) so OT/QW/FW don't look disabled. The primary nm column is
// heavier and slightly larger to mark it as the canonical representation. A
// hover background signals "you can click here" for all four units, and a
// hovered cell that can step shows its arrows with the value moved clear of them.
// The arrows take the room of the text insets rather than the text's own, so a
// value up to 9999.99 nm stays whole while it is being stepped.
function thicknessCellDisplay({ text, titleText, locked, primary, active, hover,
    startEdit, setHover, onActivate, displayRef, spin, c }) {
    const inset = LAYER_TABLE.numericTextInset;
    return h('div', {
        ref: displayRef,
        onClick: event => onActivate?.(event),
        onDoubleClick: () => startEdit(),
        onMouseEnter: () => setHover(true),
        onMouseLeave: () => setHover(false),
        title: `${text} — ${titleText}${locked ? ' (locked)' : ' — double-click to edit'}`,
        style: {
            width: '100%', height: 22, lineHeight: '20px', boxSizing: 'border-box',
            color: locked ? c.textDim : c.text,
            fontSize: primary ? 12 : 11,
            fontWeight: primary ? 600 : 400,
            textAlign: 'right', padding: spin ? `0 ${SPIN_WIDTH + 2}px 0 1px` : `0 ${inset}px`,
            position: 'relative',
            cursor: locked ? 'default' : 'text',
            borderRadius: 3,
            border: `1px solid ${active ? c.accent : (hover && !locked ? c.border : 'transparent')}`,
            backgroundColor: active ? c.accent + '12'
                : (hover && !locked ? (c.hover || c.panel) : 'transparent'),
            userSelect: 'none', fontVariantNumeric: 'tabular-nums',
            transition: 'background-color 80ms, border-color 80ms',
            // Never let a long value spill into neighbouring columns — clip to
            // the fixed cell width; the full value is in the title tooltip.
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }
    }, text, spin);
}

// Place the caret in a freshly opened input: behind a typed seed character, or
// selecting the whole value so typing replaces it.
function focusNewInput(input, seeded) {
    if (!input) return;
    if (seeded) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
    } else {
        input.select();
    }
}

// Editing state of one thickness cell. `valueText` is what an edit opens with,
// `toNm(raw)` reads typed text as nm or null, and `editRequest` opens an edit
// from outside (keyboard navigation), seeded with `editSeed`.
function useThicknessEdit({ locked, valueText, toNm, setHover,
    onChange, onActivate, onNavigate, onExit, editRequest, editSeed }) {
    const [editing, setEditing] = useState(false);
    const [raw, setRaw]         = useState('');
    const inputRef = useRef(null);
    const finishRef = useRef(false);
    const lastEditRequestRef = useRef(0);

    // `seed` is the character the user typed to start the edit. The cell then
    // opens holding just that character, caret behind it, rather than the
    // current value selected for replacement.
    const startEdit = (seed = null) => {
        if (locked) return;
        onActivate?.();
        finishRef.current = false;
        setHover(false);
        setRaw(seed != null ? seed : valueText);
        setEditing(true);
        setTimeout(() => focusNewInput(inputRef.current, seed != null), 0);
    };

    const commit = () => {
        if (finishRef.current) return false;
        finishRef.current = true;
        const nm = toNm(raw);
        if (nm != null) onChange(nm);
        setHover(false);
        setEditing(false);
        return nm != null;
    };
    const cancel = () => {
        finishRef.current = true;
        setHover(false);
        setEditing(false);
        requestAnimationFrame(() => onExit?.());
    };
    const commitAndNavigate = direction => {
        if (commit() && direction) onNavigate?.(direction);
    };

    useEffect(() => {
        if (editRequest && editRequest !== lastEditRequestRef.current) {
            lastEditRequestRef.current = editRequest;
            startEdit(editSeed);
        }
    }, [editRequest]);

    return { editing, raw, setRaw, inputRef, startEdit, cancel, commitAndNavigate };
}

// `designMaterials` is the design's own `materials` block, so a layer whose
// material travels inside the design converts with that definition. An optical
// unit of a material that resolves nowhere has no value to show and shows a
// dash; typing into it commits nothing, and it has no arrows to step with.
// `onStep(ticks, modifiers)` steps the value from the arrows and the wheel;
// `stepTitles` holds the arrows' `up` and `down` tooltips.
export function ThicknessCell({ value_nm, onChange, locked, c, materialId, refLambda,
    unit, primary, active = false, editRequest = 0, editSeed = null,
    onActivate, onNavigate, onExit, designMaterials, onStep, stepTitles }) {
    const [hover, setHover] = useState(false);
    const displayRef = useRef(null);

    const displayed = nmToUnit(value_nm, materialId, refLambda, unit, designMaterials);
    const decimals  = (unit === 'QWOT' || unit === 'FWOT') ? 4 : 2;
    const hasValue  = Number.isFinite(displayed);
    const edit = useThicknessEdit({
        locked, setHover, onChange, onActivate, onNavigate, onExit, editRequest, editSeed,
        valueText: hasValue ? displayed.toFixed(decimals) : '',
        toNm: raw => thicknessEntryToNm(raw, materialId, refLambda, unit, designMaterials),
    });
    const steppable = hasValue && !locked && !!onStep;
    useWheelStep(displayRef, steppable && !edit.editing, onStep);

    if (edit.editing) {
        return thicknessCellInput({ ...edit, onActivate, c });
    }

    return thicknessCellDisplay({
        text: hasValue ? displayed.toFixed(decimals) : '–',
        titleText: thicknessCellTitle(unit),
        locked, primary, active, hover, startEdit: edit.startEdit, setHover, onActivate, displayRef,
        spin: hover && steppable ? h(SpinArrows, { titles: stepTitles, onStep, c }) : null,
        c,
    });
}
