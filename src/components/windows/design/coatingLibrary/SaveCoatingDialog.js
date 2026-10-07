import { evalParamsSession } from '../../../../state/evalParamsSession.js';
import {
    COATING_TYPES, POLARIZATIONS, entryFromCoating, entryFromDesign,
} from '../../../../utils/coatingLibrary/entryModel.js';
import { validateEntry } from '../../../../utils/coatingLibrary/validateEntry.js';
import { saveUserCoating } from '../../../../utils/coatingLibrary/userCoatings.js';
import { FONT, Segmented, buttonStyle, failReason, inputStyle } from './ui.js';

const { createElement: h, useMemo, useState } = React;

function Row({ label, c, children }) {
    return h('label', { style: { display: 'flex', alignItems: 'center', gap: 10, margin: '8px 0' } },
        h('span', { style: { width: 150, color: c.textDim, flexShrink: 0, fontSize: 12 } }, label),
        children);
}

// What the fields open with. The band and angle are the coating's own when it
// states them; otherwise the band is the one Optical Evaluation was last set
// to, read once, and the angle is 0°. The fields are the user's from then on.
function initialFields(design, side, coating) {
    const evalParams = evalParamsSession.peek(null);
    const band = coating?.band || [evalParams?.lambdaStart ?? 400, evalParams?.lambdaEnd ?? 700];
    return {
        name: coating ? coating.name : `${design.name} ${side}`,
        bandStart: String(band[0]), bandEnd: String(band[1]),
        aoi: String(coating?.aoi ?? 0),
    };
}

const sideLayers = (design, side) => (side === 'back' ? design.backLayers : design.frontLayers) || [];

// How many layers are saved: the coating's, or those of the chosen side of the
// design, with the picker for the side.
function StackRow({ coating, design, side, setSide, c, ts }) {
    const sd = ts.saveDialog;
    const count = (coating ? coating.layers : sideLayers(design, side)).length;
    return h(Row, { label: sd.side, c },
        !coating && h(Segmented, {
            value: side, onChange: setSide, c,
            options: [['front', sd.front], ['back', sd.back]],
        }),
        h('span', { style: { color: c.textDim } }, ts.layersShort(count)));
}

/**
 * Save a coating into My coatings. Opened from the Design Editor's Tools menu
 * and the Coating Library window on one side of the active design (`design`,
 * `side`), and from a coating import window on a coating read from a file
 * (`coating`, the shape entryFromCoating takes, plus optional `band` [from, to]
 * in nm and `aoi` in degrees that the fields open with).
 */
export function SaveCoatingDialog({ design, side: initialSide = 'front', coating = null, c, t, onClose, onSaved }) {
    const ts = t.coatingLibrary;
    const sd = ts.saveDialog;
    const initial = useMemo(() => initialFields(design, initialSide, coating), []);
    const [side, setSide] = useState(initialSide);
    const [name, setName] = useState(initial.name);
    const [type, setType] = useState('other');
    const [use, setUse] = useState('');
    const [bandStart, setBandStart] = useState(initial.bandStart);
    const [bandEnd, setBandEnd] = useState(initial.bandEnd);
    const [aoi, setAoi] = useState(initial.aoi);
    const [polarization, setPolarization] = useState('avg');
    const [problems, setProblems] = useState([]);
    const [busy, setBusy] = useState(false);

    async function save() {
        if (!name.trim()) { setProblems([sd.nameRequired]); return; }
        if (!coating && sideLayers(design, side).length === 0) { setProblems([sd.emptyStack]); return; }
        const meta = {
            name: name.trim(), type, use: use.trim(),
            band: [Number(bandStart), Number(bandEnd)], aoi: Number(aoi), polarization,
        };
        const entry = coating ? entryFromCoating(coating, meta) : entryFromDesign(design, side, meta);
        const found = validateEntry(entry);
        if (found.length > 0) { setProblems(found); return; }
        setBusy(true);
        const result = await saveUserCoating(entry);
        setBusy(false);
        if (!result?.success) { setProblems([sd.saveFailed(failReason(result, ts))]); return; }
        onSaved?.(entry.name);
        onClose();
    }

    const select = (value, onChange, options) => h('select', {
        value, onChange: event => onChange(event.target.value), style: inputStyle(c, 200),
    }, options.map(([key, label]) => h('option', { key, value: key }, label)));

    return h('div', {
        style: {
            position: 'fixed', inset: 0, zIndex: 1100, display: 'flex',
            alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.68)',
        },
    }, h('div', {
        style: {
            width: 480, maxWidth: '92vw', maxHeight: '86vh', overflow: 'auto',
            padding: 20, borderRadius: 8, border: `1px solid ${c.border}`,
            background: c.panel, color: c.text, boxShadow: '0 12px 42px rgba(0,0,0,.35)',
            fontFamily: FONT, fontSize: 12,
        },
    },
        h('h2', { style: { margin: '0 0 14px', fontSize: 17 } }, sd.title),
        h(StackRow, { coating, design, side, setSide, c, ts }),
        h(Row, { label: sd.name, c }, h('input', {
            value: name, onChange: event => setName(event.target.value), style: inputStyle(c, 260), autoFocus: true,
        })),
        h(Row, { label: sd.type, c }, select(type, setType, COATING_TYPES.map(key => [key, ts.types[key]]))),
        h(Row, { label: sd.use, c }, h('textarea', {
            value: use, onChange: event => setUse(event.target.value), rows: 3,
            style: { ...inputStyle(c, 260), resize: 'vertical', fontFamily: 'inherit' },
        })),
        h(Row, { label: sd.band, c },
            h('input', { value: bandStart, onChange: event => setBandStart(event.target.value), style: inputStyle(c, 70), inputMode: 'decimal' }),
            h('span', { style: { color: c.textDim } }, '-'),
            h('input', { value: bandEnd, onChange: event => setBandEnd(event.target.value), style: inputStyle(c, 70), inputMode: 'decimal' })),
        h(Row, { label: sd.aoi, c }, h('input', {
            value: aoi, onChange: event => setAoi(event.target.value), style: inputStyle(c, 70), inputMode: 'decimal',
        })),
        h(Row, { label: sd.polarization, c },
            select(polarization, setPolarization, POLARIZATIONS.map(key => [key, ts.pols[key]]))),
        problems.length > 0 && h('div', { style: { color: c.error, margin: '10px 0' } },
            problems.map((problem, i) => h('div', { key: i }, problem))),
        h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 } },
            h('button', { onClick: onClose, style: buttonStyle(c) }, sd.cancel),
            h('button', { onClick: save, disabled: busy, style: buttonStyle(c, { primary: true, disabled: busy }) }, sd.save)),
    ));
}
