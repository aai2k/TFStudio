/**
 * The Color preset's target editor, which the wizard's Pick button opens.
 *
 * On the left the colour targets, one line each: a patch of its colour as Color
 * Evaluation draws a colour at Fit, then its name, angle and polarization,
 * edited in place; Add and Delete under them. In the middle the diagram of the
 * selected target's space (x, y; a*, b* at its L*; u′, v′), with the coating's
 * colour at the targets' angles and the target as a diamond, which a click or
 * a drag on the plot moves. On the right the selected target's colour, typed
 * in x, y, Y; L*, a*, b*; or u′, v′, Y. OK keeps the changes and Cancel drops
 * them. The frame is the Save MF window's, as wide as what it holds.
 */
import { OPERAND_POLS, resolveEvalMode } from '../../../../utils/physics/optimizer.js';
import { BACKDROP, BTN_BASE, MODAL_BASE, TITLE_STYLE } from '../../../dialogs/InputDialog.js';
import { NumberField } from '../../../ui/numberField.js';
import { tablerIcon } from '../../../ui/tablerIcons.js';
import { rowButtonStyle } from '../../analysis/chrome/controls.js';
import { buildChromaticityOption } from '../../analysis/colorEvaluation/chartFigure.js';
import { computeColorReports } from '../../analysis/colorEvaluation/colorModel.js';
import { drawChart, useChartTeardown } from '../../../ui/plotSurface.js';
import { squareGrid } from '../../../ui/chartOptions.js';
import {
    COLOR_TARGET_SPACES, TARGET_DIAGRAMS, TARGET_PLACES, newColorTarget, targetAtPlanePoint, targetInSpace, targetOnPlane,
    targetPatch, targetWhite,
} from './colorTargetModel.js';

const { createElement: h, useEffect, useMemo, useRef, useState } = React;

// The labels of each space's three fields: symbols, and Y's unit; and the
// colorEval.valueTips key of each, which says what it is, as Color
// Evaluation's results do.
const FIELD_LABELS = { xyY: ['x', 'y', 'Y (%)'], Lab: ['L*', 'a*', 'b*'], uvY: ['u′', 'v′', 'Y (%)'] };
const FIELD_TIPS = { xyY: ['x', 'y', 'Y'], Lab: ['L', 'a', 'b'], uvY: ['up', 'vp', 'Y'] };
const DIAGRAM_PX = 280;
const DIAGRAM_MARGIN = { left: 34, right: 10, top: 10, bottom: 28 };
// The list and the colour's fields, px: the list holds a patch, a name, a
// two-digit angle and a polarization; the fields a label, a number box and the
// hint under them, wrapped.
const LIST_PX = 300;
const FIELDS_PX = 200;
const NO_DISPLAY = { showWhite: true, showWavelengths: false, showPlanckian: false, showSrgb: false };

// The coating's colour at each target's angle and polarization, in the order
// the targets are listed, one ring per angle and polarization.
function coatingRings(design, targets, light) {
    if (!design) return [];
    const seen = new Set();
    return targets.flatMap(({ aoi, pol }) => {
        const key = `${aoi}|${pol}`;
        if (seen.has(key)) return [];
        seen.add(key);
        return computeColorReports({ ...light, design, thetas: [aoi], pol, setError: () => {} }) || [];
    });
}

// The colour a new target starts at: the coating's at 0°, or the white.
function startingColor(design, light, white) {
    const [ring] = coatingRings(design, [{ aoi: 0, pol: 'avg' }], light);
    return ring ? ring.report.XYZ : white;
}

// The diagram. A press inside its plot hands the point under the pointer to
// `onPick` as plane coordinates, and so does every move until the button is
// let go, anywhere on the page; `onDrag(true)` and `onDrag(false)` mark the
// press and the release.
function TargetDiagram({ option, onPick, onDrag }) {
    const divRef = useRef(null);
    const chartRef = useRef(null);
    const boundRef = useRef(null);
    const handlers = useRef({ onPick, onDrag });
    handlers.current = { onPick, onDrag };
    const redraw = () => {
        drawChart(divRef.current, chartRef, option);
        const chart = chartRef.current;
        if (!chart || boundRef.current === chart) return;
        boundRef.current = chart;
        let dragging = false;
        const pickAt = event => {
            const at = [event.offsetX, event.offsetY];
            if (chart.containPixel({ gridIndex: 0 }, at)) handlers.current.onPick(chart.convertFromPixel({ gridIndex: 0 }, at));
        };
        const release = () => {
            if (!dragging) return;
            dragging = false;
            window.removeEventListener('mouseup', release);
            handlers.current.onDrag(false);
        };
        const zr = chart.getZr();
        zr.on('mousedown', event => {
            if (!chart.containPixel({ gridIndex: 0 }, [event.offsetX, event.offsetY])) return;
            dragging = true;
            window.addEventListener('mouseup', release);
            handlers.current.onDrag(true);
            pickAt(event);
        });
        zr.on('mousemove', event => { if (dragging) pickAt(event); });
    };
    useEffect(redraw);
    useChartTeardown(divRef, chartRef, redraw);
    return h('div', {
        ref: divRef,
        style: { width: DIAGRAM_PX, height: DIAGRAM_PX, flex: 'none', cursor: 'crosshair', borderRadius: 3 },
    });
}

// One line of the list: the patch, then the name, angle and polarization.
function targetLine({ target, index, selected, white, c, polLabel, update, select }) {
    const cell = { padding: '2px 4px', height: 28, background: selected ? `${c.accent}33` : 'transparent' };
    const field = {
        width: '100%', height: 22, padding: '0 6px', boxSizing: 'border-box', background: c.bg, color: c.text,
        border: `1px solid ${c.border}`, borderRadius: 4, fontSize: 12, outline: 'none',
    };
    return h('tr', { key: target.id, onMouseDown: () => select(index) },
        h('td', { style: cell }, h('span', {
            style: {
                display: 'block', width: 30, height: 18, margin: '0 auto', borderRadius: 4,
                background: targetPatch(target, white), border: `1px solid ${c.border}`,
            },
        })),
        h('td', { style: cell }, h('input', {
            type: 'text', value: target.name, style: field,
            onChange: event => update(index, { name: event.target.value }),
        })),
        h('td', { style: cell }, h(NumberField, {
            value: target.aoi, min: 0, max: 89, c, style: { ...field, textAlign: 'right' },
            onChange: aoi => update(index, { aoi }),
        })),
        h('td', { style: cell }, h('select', {
            value: target.pol, style: { ...field, padding: '0 5px', cursor: 'pointer' },
            onChange: event => update(index, { pol: event.target.value }),
        }, OPERAND_POLS.map(pol => h('option', { key: pol, value: pol }, polLabel(pol))))));
}

function targetList({ draft, selected, white, c, te, polLabel, update, select, add, remove }) {
    const head = { padding: '2px 4px', textAlign: 'left', fontSize: 10, color: c.textDim, fontWeight: 600,
        letterSpacing: '0.03em', borderBottom: `1px solid ${c.border}`, position: 'sticky', top: 0,
        background: c.panel, zIndex: 1, whiteSpace: 'nowrap' };
    const button = (icon, label, onClick, disabled) => h('button', {
        type: 'button', onClick, disabled, style: rowButtonStyle(c, { disabled }),
    }, h('span', { style: { display: 'flex', alignItems: 'center', gap: 4 } }, tablerIcon(icon, 12), label));
    return h('div', { style: { width: LIST_PX, flex: 'none', display: 'flex', flexDirection: 'column' } },
        h('div', { style: { border: `1px solid ${c.border}`, borderRadius: 3, height: 236, overflow: 'auto', background: c.bg } },
            h('table', { style: { borderCollapse: 'collapse', tableLayout: 'fixed', width: '100%', fontSize: 12 } },
                h('thead', null, h('tr', null,
                    h('th', { style: { ...head, width: 48 } }, te.color),
                    h('th', { style: head }, te.name),
                    h('th', { style: { ...head, width: 66 } }, te.aoi),
                    h('th', { style: { ...head, width: 72 } }, te.pol))),
                h('tbody', null, draft.map((target, index) => targetLine({
                    target, index, selected: index === selected, white, c, polLabel, update, select,
                }))))),
        h('div', { style: { display: 'flex', gap: 6, marginTop: 8 } },
            button('plus', te.add, add, false),
            // The list keeps one target at least: with none the editor would have
            // nothing to show, and the preset nothing to write.
            button('trash', te.delete, remove, draft.length < 2)));
}

// The selected target's colour: its space, its three values and what a click
// on the diagram sets.
function colorFields({ target, rings, white, c, te, tips, update }) {
    const label = text => h('span', { style: { fontSize: 11, color: c.textDim, whiteSpace: 'nowrap', width: 50, flex: 'none' } }, text);
    const row = (key, title, ...children) => h('div', { key, title, style: { display: 'flex', alignItems: 'center', gap: 8, minHeight: 38 } }, ...children);
    const input = { width: 100, padding: '8px 12px', boxSizing: 'border-box', background: c.bg, color: c.text,
        border: `1px solid ${c.border}`, borderRadius: 4, fontSize: 14, outline: 'none' };
    const angles = [...new Set(rings.map(ring => `${ring.theta}°`))];
    return h('div', { style: { width: FIELDS_PX, flex: 'none', display: 'flex', flexDirection: 'column', gap: 2 } },
        row('space', null, label(te.space), h('select', {
            value: target.space, style: { height: 24, width: 120, background: c.field, color: c.text, border: `1px solid ${c.border}`,
                borderRadius: 3, fontSize: 11, padding: '0 5px', outline: 'none', cursor: 'pointer' },
            onChange: event => update(targetInSpace(target, event.target.value, white)),
        }, Object.keys(COLOR_TARGET_SPACES).map(space => h('option', { key: space, value: space }, te.spaces[space])))),
        ...FIELD_LABELS[target.space].map((name, k) => row(`v${k}`, tips[FIELD_TIPS[target.space][k]], label(name), h(NumberField, {
            value: Number(target.values[k].toFixed(TARGET_PLACES[target.space][k])), c, style: input,
            onChange: value => update({ ...target, values: target.values.map((old, j) => (j === k ? value : old)) }),
        }))),
        h('div', { style: { fontSize: 12, color: c.textDim, lineHeight: 1.45, marginTop: 8 } },
            [te.hint[target.space], angles.length ? te.rings(angles) : ''].filter(Boolean).join(' ')));
}

/**
 * The target editor over the wizard. `targets` are the wizard's; `onApply`
 * takes the edited list, `onCancel` closes it unchanged. `typeId` is the
 * preset's type, COLOR_R or COLOR_T, whose side the coating's colour is shown
 * for.
 */
export function ColorTargetEditor({ design, typeId, targets, illuminant, observer, onApply, onCancel, c, t }) {
    const tw = t.meritFunctionEditor.wizard;
    const te = tw.colorEditor;
    const polLabel = pol => (pol === 'avg' ? tw.polAvg : pol);
    const white = targetWhite(illuminant, observer);
    const light = useMemo(() => ({
        evalMode: resolveEvalMode(design), characteristic: typeId === 'COLOR_T' ? 'T' : 'R',
        observer: String(observer), illuminant, step: 1,
    }), [design, typeId, observer, illuminant]);
    // With no targets yet the editor opens on one, at the coating's colour at
    // 0°, so the fields and the diagram have a target to show.
    const [draft, setDraft] = useState(() => (targets.length ? targets
        : [newColorTarget(te.targetName(1), startingColor(design, light, white), white)]));
    const [selected, setSelected] = useState(0);
    const ringKey = draft.map(target => `${target.aoi}|${target.pol}`).join(',');
    const rings = useMemo(() => coatingRings(design, draft, light), [design, light, ringKey]); // eslint-disable-line react-hooks/exhaustive-deps
    const target = draft[selected];
    // Where the dragged target was grabbed, which holds the frame of the a*, b*
    // plane still while it moves; null when nothing is dragged.
    const [grabbedAt, setGrabbedAt] = useState(null);
    const update = (index, patch) => setDraft(list => list.map((item, k) => (k === index ? { ...item, ...patch } : item)));
    const option = useMemo(() => {
        const at = targetOnPlane(target);
        const built = buildChromaticityOption({
            reports: rings, white, observer: String(observer), diagram: TARGET_DIAGRAMS[target.space],
            display: NO_DISPLAY, c, tr: t.colorEval, units: t.units,
            targets: [{ value: at, label: null }], viewPoints: [grabbedAt || at],
            ...(target.space === 'Lab' ? { lightness: Math.min(100, Math.max(1, Math.ceil(target.values[0]))) } : {}),
            grid: aspect => squareGrid({ clientWidth: DIAGRAM_PX, clientHeight: DIAGRAM_PX }, DIAGRAM_MARGIN, aspect),
        });
        return { ...built, legend: { show: false }, toolbox: { show: false } };
    }, [rings, target, grabbedAt, white, observer, c, t]);
    const add = () => {
        const made = newColorTarget(te.targetName(draft.length + 1), startingColor(design, light, white), white);
        setDraft(list => [...list, made]);
        setSelected(draft.length);
    };
    const remove = () => {
        setDraft(list => list.filter((_, k) => k !== selected));
        setSelected(index => Math.min(index, draft.length - 2));
    };
    const pick = point => update(selected, targetAtPlanePoint(target, point));
    const drag = pressed => setGrabbedAt(pressed ? targetOnPlane(target) : null);
    return h('div', { style: BACKDROP, onKeyDown: event => event.key === 'Escape' && onCancel() },
        h('div', { style: { ...MODAL_BASE(c), width: 'fit-content', maxWidth: '96vw' } },
            h('h3', { style: TITLE_STYLE(c) }, te.title),
            h('div', { style: { display: 'flex', gap: 18, alignItems: 'flex-start', margin: '4px 0 14px' } },
                targetList({ draft, selected, white, c, te, polLabel, update, select: setSelected, add, remove }),
                h(TargetDiagram, { option, onPick: pick, onDrag: drag }),
                colorFields({ target, rings, white, c, te, tips: t.colorEval.valueTips, update: next => update(selected, next) })),
            h('div', { style: { display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' } },
                h('button', {
                    type: 'button', onClick: onCancel,
                    style: { ...BTN_BASE, backgroundColor: c.panel, color: c.text, border: `1px solid ${c.border}` },
                }, t.dialogs.input.cancel),
                h('button', {
                    type: 'button', onClick: () => onApply(draft),
                    style: { ...BTN_BASE, backgroundColor: c.accent, color: '#fff' },
                }, t.dialogs.input.ok))));
}

