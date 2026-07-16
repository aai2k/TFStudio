import { nmToUnit, unitToNm } from './units.js';

const { createElement: h, useState, useRef } = React;

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
function thicknessCellInput({ inputRef, raw, setRaw, commit, cancel, c }) {
    return h('input', {
        ref: inputRef, value: raw,
        onChange: (e) => setRaw(e.target.value),
        onBlur: commit,
        onKeyDown: (e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            if (e.key === 'Escape') cancel();
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

// Read-only state of a thickness cell. All unlocked cells use the full text
// color (not textDim) so OT/QW/FW don't look disabled. The primary nm column is
// heavier and slightly larger to mark it as the canonical representation. A
// hover background signals "you can click here" for all four units.
function thicknessCellDisplay({ text, titleText, locked, primary, hover, startEdit, setHover, c }) {
    return h('div', {
        onDoubleClick: startEdit,
        onMouseEnter: () => setHover(true),
        onMouseLeave: () => setHover(false),
        title: `${text} — ${titleText}${locked ? ' (locked)' : ' — double-click to edit'}`,
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
    }, text);
}

export function ThicknessCell({ value_nm, onChange, locked, c, materialId, refLambda, unit, primary }) {
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
    const cancel = () => setEditing(false);

    if (editing) {
        return thicknessCellInput({ inputRef, raw, setRaw, commit, cancel, c });
    }

    return thicknessCellDisplay({
        text: displayed.toFixed(decimals),
        titleText: thicknessCellTitle(unit),
        locked, primary, hover, startEdit, setHover, c,
    });
}
