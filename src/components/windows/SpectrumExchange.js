/**
 * SpectrumExchange — import / export measured spectrophotometer spectra
 * (generic CSV / TXT / ASCII).
 *
 * Import a measured R/T/A spectrum from a delimited text file, let the user
 * confirm the detected delimiter / X-unit / quantity / Y-scale, and add it to
 * the active design as a "measured curve" overlay (design.measuredCurves) that
 * Optical Evaluation renders on top of the computed spectrum. Export the
 * overlays back out to CSV.
 *
 * All parsing/normalization/CSV lives in utils/io/spectrumTable.js (pure +
 * tested); this component is UI + design wiring only.
 */

import { useDesign } from '../../state/DesignContext.js';
import {
    parseSpectrumTable, makeMeasuredCurve, curvesToCsv, tableToCsv, X_UNITS,
} from '../../utils/io/spectrumTable.js';
import { computeDesignSpectrum, designSpectrumColumns } from '../../utils/io/designSpectrum.js';
import { parseJcampDx, buildJcampDx } from '../../utils/io/jcampDx.js';
import { Checkbox } from '../ui/Checkbox.js';

const { createElement: h, useState, useMemo, useCallback } = React;

// Loaded-file state survives docking unmount/remount for the session.
const SESSION = { parsed: null, fileName: '', colIdx: 0, name: '', tab: 'import', expSource: 'design', expFormat: 'csv' };
function useSession(key) {
    const [v, setV] = useState(SESSION[key]);
    const set = useCallback((nv) => {
        SESSION[key] = (typeof nv === 'function') ? nv(SESSION[key]) : nv;
        setV(SESSION[key]);
    }, [key]);
    return [v, set];
}

// ── UI primitives (match ZemaxCoatings styling) ─────────────────────────────────

function Btn({ onClick, c, children, disabled, primary }) {
    return h('button', {
        onClick, disabled,
        style: {
            padding: '5px 12px', fontSize: 11.5, cursor: disabled ? 'not-allowed' : 'pointer',
            border: `1px solid ${primary && !disabled ? c.accent : c.border}`, borderRadius: 4,
            background: primary && !disabled ? c.accent + '22' : 'transparent',
            color: disabled ? c.textDim : (primary ? c.accent : c.text),
            fontWeight: primary ? 600 : 400, opacity: disabled ? 0.55 : 1, whiteSpace: 'nowrap',
        },
    }, children);
}

function TabBtn({ active, onClick, c, children }) {
    return h('button', {
        onClick,
        style: {
            padding: '8px 18px', fontSize: 12, cursor: 'pointer', outline: 'none',
            border: 'none', borderBottom: `2px solid ${active ? c.accent : 'transparent'}`,
            background: 'transparent', color: active ? c.accent : c.text,
            fontWeight: active ? 600 : 400,
        },
    }, children);
}

function Seg({ active, onClick, c, position, children }) {
    const radius = position === 'first' ? '4px 0 0 4px' : position === 'last' ? '0 4px 4px 0' : '0';
    return h('button', {
        onClick,
        style: {
            padding: '4px 10px', fontSize: 11, cursor: 'pointer', outline: 'none',
            border: `1px solid ${active ? c.accent : c.border}`, borderRadius: radius,
            marginLeft: position === 'first' ? 0 : -1,
            background: active ? c.accent + '33' : 'transparent',
            color: active ? c.accent : c.text, fontWeight: active ? 600 : 400,
            position: 'relative', zIndex: active ? 1 : 0, whiteSpace: 'nowrap',
        },
    }, children);
}

function Label({ children, c }) {
    return h('span', {
        style: { fontSize: 10, color: c.textDim, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px', whiteSpace: 'nowrap' },
    }, children);
}

function Num({ value, onChange, min, max, step = 1, c, width = 70 }) {
    const [raw, setRaw] = useState(String(value));
    React.useEffect(() => { setRaw(String(value)); }, [value]);
    const commit = () => {
        const v = parseFloat(raw);
        if (!isNaN(v)) { const cl = Math.min(Math.max(v, min ?? -Infinity), max ?? Infinity); onChange(cl); setRaw(String(cl)); }
        else setRaw(String(value));
    };
    return h('input', {
        type: 'number', value: raw, min, max, step,
        onChange: (e) => setRaw(e.target.value), onBlur: commit,
        onKeyDown: (e) => { if (e.key === 'Enter') e.currentTarget.blur(); },
        style: {
            width, height: 24, background: c.bg, color: c.text,
            border: `1px solid ${c.border}`, borderRadius: 3, fontSize: 11, padding: '0 5px',
            outline: 'none', textAlign: 'right',
        },
    });
}

function Check({ checked, onChange, c, children }) {
    return h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: c.text, cursor: 'pointer' } },
        h(Checkbox, { c, checked, onChange: (e) => onChange(e.target.checked) }),
        children,
    );
}

const FAMILY_COLOR = { R: '#ef5350', T: '#2196f3', A: '#66bb6a' };

// ── Tiny dependency-free SVG preview of a normalized curve ──────────────────────

function MiniPlot({ curve, c, W = 320, H = 120 }) {
    if (!curve || !curve.x.length) return null;
    const pad = 4;
    const xs = curve.x, ys = curve.y;
    const xMin = xs[0], xMax = xs[xs.length - 1];
    let yMin = Infinity, yMax = -Infinity;
    for (const v of ys) { if (v < yMin) yMin = v; if (v > yMax) yMax = v; }
    if (!(xMax > xMin)) return null;
    if (!(yMax > yMin)) { yMax = yMin + 1; }
    const px = (x) => pad + (x - xMin) / (xMax - xMin) * (W - 2 * pad);
    const py = (y) => H - pad - (y - yMin) / (yMax - yMin) * (H - 2 * pad);
    // Decimate to ~400 pts for the path.
    const step = Math.max(1, Math.floor(xs.length / 400));
    let d = '';
    for (let i = 0; i < xs.length; i += step) d += (d ? 'L' : 'M') + px(xs[i]).toFixed(1) + ' ' + py(ys[i]).toFixed(1);
    return h('svg', { width: W, height: H, style: { background: c.bg, border: `1px solid ${c.border}`, borderRadius: 4 } },
        h('path', { d, fill: 'none', stroke: curve.color || FAMILY_COLOR[curve.quantity], strokeWidth: 1.5 }),
    );
}

// ── Component ────────────────────────────────────────────────────────────────────

export function SpectrumExchange({ c, t }) {
    const sx = t.spectrumExchange;
    const { design, updateDesign, checkpoint, evalParams, evalMode } = useDesign();

    const [tab, setTab] = useSession('tab');               // 'import' | 'export'
    const [expSource, setExpSource] = useSession('expSource'); // 'design' | 'measured'
    const [expFormat, setExpFormat] = useSession('expFormat'); // 'csv' | 'jcamp'
    const [parsed, setParsed] = useSession('parsed');      // parseSpectrumTable result + fileName
    const [fileName, setFileName] = useSession('fileName');
    const [colIdx, setColIdx] = useSession('colIdx');      // selected Y column index (into parsed.columns)
    const [name, setName] = useSession('name');

    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState(null);            // { type:'success'|'error'|'info', msg }

    // Per-column user overrides (unit is file-wide). Keyed so switching columns
    // restores the right override; default comes from detection.
    const [xUnit, setXUnit] = useState(X_UNITS.NM);
    const [ov, setOv] = useState({});                       // { [colIdx]: { quantity, yscale } }

    const flash = (type, msg) => setStatus({ type, msg });

    const curves = design.measuredCurves || [];
    const col = parsed?.columns?.[colIdx] || null;

    // Effective settings for the active column (override → detected → default).
    const colOv = ov[colIdx] || {};
    const quantity = colOv.quantity || col?.quantity || 'T';
    const yscale = colOv.yscale || (col?.isAbsorbance ? 'absorbance' : (col?.isPercent ? 'percent' : 'fraction'));

    const setColOv = (patch) => setOv(prev => ({ ...prev, [colIdx]: { ...prev[colIdx], ...patch } }));

    // ── Import ──────────────────────────────────────────────────────────────────
    const onImport = useCallback(async () => {
        setLoading(true); setStatus(null);
        try {
            const res = await window.electronAPI.spectrumPickFile();
            if (!res?.success) { if (!res?.canceled) flash('error', sx.errLoad(res?.error || '')); setLoading(false); return; }

            // JCAMP-DX is self-describing (units + quantity) → add its spectra
            // directly as overlays, skipping the table-configure step.
            if (/##\s*(TITLE|JCAMP)/i.test(res.text)) {
                const jd = parseJcampDx(res.text);
                if (!jd.ok) { flash('error', sx.errParse); setLoading(false); return; }
                checkpoint();
                const baseName = (res.fileName || 'spectrum').replace(/\.[^.]+$/, '');
                const added = jd.spectra.map((s, i) => makeMeasuredCurve({
                    name: s.title && s.title !== 'JCAMP-DX' ? s.title : `${baseName}${jd.spectra.length > 1 ? ' ' + (i + 1) : ''}`,
                    x: s.x, xUnit: s.xUnit, y: s.y, quantity: s.quantity || 'T',
                    isPercent: s.isPercent, isAbsorbance: s.isAbsorbance, source: res.fileName,
                }));
                updateDesign({ measuredCurves: [...(design.measuredCurves || []), ...added] });
                setFileName(res.fileName || 'spectrum');
                flash('success', sx.loadedJcamp(res.fileName || '', added.length));
                setLoading(false);
                return;
            }

            const p = parseSpectrumTable(res.text);
            if (!p.ok) { flash('error', sx.errParse); setLoading(false); return; }
            setParsed(p); setFileName(res.fileName || 'spectrum');
            setColIdx(0); setOv({}); setXUnit(p.xUnit === X_UNITS.UNKNOWN ? X_UNITS.NM : p.xUnit);
            const base = (res.fileName || 'spectrum').replace(/\.[^.]+$/, '');
            setName(base);
            flash('success', sx.loaded(res.fileName || '', p.nRows, p.columns.length));
        } catch (err) {
            flash('error', sx.errLoad(err.message));
        }
        setLoading(false);
    }, [sx, design, updateDesign, checkpoint]);

    // Live preview curve for the currently-configured column.
    const previewCurve = useMemo(() => {
        if (!parsed || !col) return null;
        return makeMeasuredCurve({
            name: name || col.name, x: parsed.x, xUnit,
            y: col.values, quantity,
            isPercent: yscale === 'percent',
            isAbsorbance: yscale === 'absorbance',
            source: fileName,
        });
    }, [parsed, col, name, xUnit, quantity, yscale, fileName]);

    // ── Add overlay to design ─────────────────────────────────────────────────────
    const onAdd = useCallback(() => {
        if (!previewCurve || !previewCurve.x.length) return;
        checkpoint();
        const existing = design.measuredCurves || [];
        updateDesign({ measuredCurves: [...existing, previewCurve] });
        flash('success', sx.added(previewCurve.name));
    }, [previewCurve, design, updateDesign, checkpoint, sx]);

    const removeCurve = useCallback((id) => {
        checkpoint();
        updateDesign({ measuredCurves: (design.measuredCurves || []).filter(cv => cv.id !== id) });
    }, [design, updateDesign, checkpoint]);

    const toggleCurve = useCallback((id) => {
        updateDesign({ measuredCurves: (design.measuredCurves || []).map(cv => cv.id === id ? { ...cv, visible: cv.visible === false } : cv) });
    }, [design, updateDesign]);

    // ── Export overlays (measured curves) to CSV or JCAMP-DX ──────────────────────
    const onExport = useCallback(async () => {
        const list = (design.measuredCurves || []);
        if (!list.length) { flash('info', sx.nothingToExport); return; }
        const base = (design.name || 'spectrum').replace(/[^\w.-]+/g, '_');
        let text, fname;
        if (expFormat === 'jcamp') {
            const specs = list.map(cv => ({ title: cv.name, xUnit: X_UNITS.NM, quantity: cv.quantity, isAbsorbance: cv.quantity === 'A', x: cv.x, y: cv.y }));
            text = buildJcampDx(specs, { title: `${design.name || 'spectra'} (measured)` });
            fname = `${base}_measured.dx`;
        } else {
            text = curvesToCsv(list);
            fname = `${base}_measured.csv`;
        }
        try {
            const res = await window.electronAPI.spectrumSaveFile(text, fname);
            if (res?.success) flash('success', sx.exported(res.filePath));
            else if (!res?.canceled) flash('error', sx.errExport(res?.error || ''));
        } catch (err) {
            flash('error', sx.errExport(err.message));
        }
    }, [design, expFormat, sx]);

    // ── Export the design's COMPUTED spectrum ─────────────────────────────────────
    const [dStart, setDStart] = useState(evalParams?.lambdaStart ?? 400);
    const [dEnd, setDEnd]     = useState(evalParams?.lambdaEnd ?? 800);
    const [dStep, setDStep]   = useState(evalParams?.lambdaStep ?? 2);
    const [dAoi, setDAoi]     = useState((evalParams?.thetas?.length ? evalParams.thetas : [0]).join(', '));
    const [dQ, setDQ]         = useState({ T: true, R: true, A: true });
    const [dSP, setDSP]       = useState(false);

    const onExportDesign = useCallback(async () => {
        const thetas = String(dAoi).split(',').map(s => parseFloat(s.trim())).filter(Number.isFinite);
        const quantities = ['T', 'R', 'A'].filter(q => dQ[q]);
        if (!quantities.length) { flash('info', sx.pickQuantity); return; }
        const params = { lambdaStart: dStart, lambdaEnd: dEnd, lambdaStep: dStep, thetas: thetas.length ? thetas : [0] };
        const base = (design.name || 'design').replace(/[^\w.-]+/g, '_');
        try {
            const spec = computeDesignSpectrum(design, params, evalMode);
            if (!spec.lambda.length) { flash('error', sx.errParse); return; }
            let text, fname;
            if (expFormat === 'jcamp') {
                // One JCAMP block per (quantity × AOI × polarization). JCAMP carries
                // transmittance/reflectance as a fraction → asPercent off.
                const pols = dSP ? ['avg', 's', 'p'] : ['avg'];
                const polKey = { avg: { T: 'T', R: 'R', A: 'A' }, s: { T: 'Ts', R: 'Rs' }, p: { T: 'Tp', R: 'Rp' } };
                const multi = spec.series.length > 1;
                const specs = [];
                spec.series.forEach(s => {
                    const suf = multi ? ` @${Number.isInteger(s.theta) ? s.theta : s.theta.toFixed(1)}°` : '';
                    pols.forEach(pol => quantities.forEach(q => {
                        const key = polKey[pol]?.[q];
                        if (!key || !s[key]) return;
                        const pl = pol === 'avg' ? '' : ` ${pol}`;
                        specs.push({ title: `${design.name || 'design'} ${q}${pl}${suf}`, xUnit: X_UNITS.NM, quantity: q, isAbsorbance: q === 'A', x: spec.lambda, y: s[key] });
                    }));
                });
                text = buildJcampDx(specs, { title: `${design.name || 'design'} spectrum` });
                fname = `${base}_spectrum.dx`;
            } else {
                const cols = designSpectrumColumns(spec, { quantities, pols: dSP ? ['avg', 's', 'p'] : ['avg'] });
                text = tableToCsv(cols);
                fname = `${base}_spectrum.csv`;
            }
            const res = await window.electronAPI.spectrumSaveFile(text, fname);
            if (res?.success) flash('success', sx.exported(res.filePath));
            else if (!res?.canceled) flash('error', sx.errExport(res?.error || ''));
        } catch (err) {
            flash('error', sx.errExport(err.message));
        }
    }, [design, evalMode, dStart, dEnd, dStep, dAoi, dQ, dSP, expFormat, sx]);

    // ── Render ────────────────────────────────────────────────────────────────────
    const wrap = { display: 'flex', flexDirection: 'column', height: '100%', background: c.bg, color: c.text, fontFamily: 'system-ui, -apple-system, sans-serif' };
    const section = { padding: '12px 14px', borderBottom: `1px solid ${c.border}`, display: 'flex', flexDirection: 'column', gap: 10 };
    const rowFlex = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' };

    // Configure panel (after a successful parse) — shared by the Import tab.
    const configurePanel = parsed && col && h('div', { style: section },
        h(Label, { c }, sx.configure),
        h('div', { style: rowFlex },
            h('span', { style: { fontSize: 11, color: c.textDim } },
                sx.detected(delimiterName(parsed.delimiter, sx), parsed.nRows)),
        ),
        // X unit
        h('div', { style: rowFlex },
            h(Label, { c }, sx.unitLabel),
            h('div', { style: { display: 'flex' } },
                h(Seg, { active: xUnit === X_UNITS.NM, onClick: () => setXUnit(X_UNITS.NM), c, position: 'first' }, 'nm'),
                h(Seg, { active: xUnit === X_UNITS.UM, onClick: () => setXUnit(X_UNITS.UM), c, position: 'middle' }, 'µm'),
                h(Seg, { active: xUnit === X_UNITS.CM1, onClick: () => setXUnit(X_UNITS.CM1), c, position: 'last' }, 'cm⁻¹'),
            ),
        ),
        // Column selector (only when multiple Y columns)
        parsed.columns.length > 1 && h('div', { style: rowFlex },
            h(Label, { c }, sx.columnLabel),
            h('select', {
                value: colIdx,
                onChange: (e) => setColIdx(+e.target.value),
                style: { background: c.bg, color: c.text, border: `1px solid ${c.border}`, borderRadius: 3, fontSize: 11, padding: '3px 6px', outline: 'none' },
            }, parsed.columns.map((cc, i) => h('option', { key: i, value: i }, cc.name))),
        ),
        // Quantity
        h('div', { style: rowFlex },
            h(Label, { c }, sx.quantityLabel),
            h('div', { style: { display: 'flex' } },
                h(Seg, { active: quantity === 'T', onClick: () => setColOv({ quantity: 'T' }), c, position: 'first' }, 'T'),
                h(Seg, { active: quantity === 'R', onClick: () => setColOv({ quantity: 'R' }), c, position: 'middle' }, 'R'),
                h(Seg, { active: quantity === 'A', onClick: () => setColOv({ quantity: 'A' }), c, position: 'last' }, 'A'),
            ),
        ),
        // Y scale
        h('div', { style: rowFlex },
            h(Label, { c }, sx.yscaleLabel),
            h('div', { style: { display: 'flex' } },
                h(Seg, { active: yscale === 'percent', onClick: () => setColOv({ yscale: 'percent' }), c, position: 'first' }, sx.percent),
                h(Seg, { active: yscale === 'fraction', onClick: () => setColOv({ yscale: 'fraction' }), c, position: 'middle' }, sx.fraction),
                h(Seg, { active: yscale === 'absorbance', onClick: () => setColOv({ yscale: 'absorbance' }), c, position: 'last' }, sx.absorbance),
            ),
        ),
        // Name + Add
        h('div', { style: rowFlex },
            h(Label, { c }, sx.nameLabel),
            h('input', {
                value: name, onChange: (e) => setName(e.target.value),
                style: { background: c.bg, color: c.text, border: `1px solid ${c.border}`, borderRadius: 3, fontSize: 11.5, padding: '4px 7px', outline: 'none', minWidth: 180 },
            }),
            h(Btn, { onClick: onAdd, c, primary: true, disabled: !previewCurve?.x.length }, sx.addOverlay),
        ),
        // Preview
        previewCurve && h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
            h(Label, { c }, sx.preview + (yscale === 'absorbance' ? ` — ${sx.absHint}` : '')),
            h(MiniPlot, { curve: previewCurve, c }),
        ),
    );

    // ── IMPORT tab ────────────────────────────────────────────────────────────────
    const importTab = h(React.Fragment, null,
        h('div', { style: section },
            h(Label, { c }, sx.importTitle),
            h('div', { style: rowFlex },
                h(Btn, { onClick: onImport, c, primary: true, disabled: loading }, loading ? sx.importing : sx.import),
                fileName && h('span', { style: { fontSize: 11.5, color: c.textDim } }, fileName),
            ),
            h('span', { style: { fontSize: 10.5, color: c.textDim } }, sx.importHint),
        ),
        configurePanel,
        // Imported (measured) curves — manage: show/hide/remove
        h('div', { style: section },
            h(Label, { c }, sx.importedTitle),
            !curves.length
                ? h('span', { style: { fontSize: 11.5, color: c.textDim, fontStyle: 'italic' } }, sx.noOverlays)
                : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
                    curves.map(cv => h('div', {
                        key: cv.id,
                        style: { ...rowFlex, padding: '4px 6px', border: `1px solid ${c.border}`, borderRadius: 4, background: c.panel },
                    },
                        h('span', { style: { width: 12, height: 12, borderRadius: 2, background: cv.color, display: 'inline-block', flexShrink: 0, opacity: cv.visible === false ? 0.3 : 1 } }),
                        h('span', { style: { fontSize: 11.5, color: cv.visible === false ? c.textDim : c.text, fontWeight: 500 } }, cv.name),
                        h('span', { style: { fontSize: 10, color: '#fff', background: FAMILY_COLOR[cv.quantity] || '#888', borderRadius: 3, padding: '1px 5px' } }, cv.quantity),
                        h('span', { style: { fontSize: 10.5, color: c.textDim } }, sx.points(cv.x.length, Math.round(cv.x[0]), Math.round(cv.x[cv.x.length - 1]))),
                        h('div', { style: { marginLeft: 'auto', display: 'flex', gap: 4 } },
                            h(Btn, { onClick: () => toggleCurve(cv.id), c }, cv.visible === false ? sx.show : sx.hide),
                            h(Btn, { onClick: () => removeCurve(cv.id), c }, sx.remove),
                        ),
                    )),
                ),
        ),
    );

    // ── EXPORT tab ────────────────────────────────────────────────────────────────
    const exportTab = h(React.Fragment, null,
        // What to export + file format
        h('div', { style: section },
            h('div', { style: rowFlex },
                h(Label, { c }, sx.exportWhat),
                h('div', { style: { display: 'flex' } },
                    h(Seg, { active: expSource === 'design', onClick: () => setExpSource('design'), c, position: 'first' }, sx.sourceDesign),
                    h(Seg, { active: expSource === 'measured', onClick: () => setExpSource('measured'), c, position: 'last' }, sx.sourceMeasured),
                ),
            ),
            h('div', { style: rowFlex },
                h(Label, { c }, sx.formatLabel),
                h('div', { style: { display: 'flex' } },
                    h(Seg, { active: expFormat === 'csv', onClick: () => setExpFormat('csv'), c, position: 'first' }, 'CSV'),
                    h(Seg, { active: expFormat === 'jcamp', onClick: () => setExpFormat('jcamp'), c, position: 'last' }, 'JCAMP-DX'),
                ),
            ),
        ),

        // Export the design's COMPUTED spectrum
        expSource === 'design' && h('div', { style: section },
            h('span', { style: { fontSize: 11, color: c.textDim } }, sx.exportDesignDesc),
            h('div', { style: rowFlex },
                h(Label, { c }, sx.rangeLabel),
                h(Num, { value: dStart, onChange: setDStart, min: 100, max: 50000, step: 10, c }),
                h('span', { style: { color: c.textDim } }, '–'),
                h(Num, { value: dEnd, onChange: setDEnd, min: 100, max: 50000, step: 10, c }),
                h(Label, { c }, sx.stepLabel),
                h(Num, { value: dStep, onChange: setDStep, min: 0.1, max: 100, step: 0.5, c, width: 56 }),
            ),
            h('div', { style: rowFlex },
                h(Label, { c }, sx.aoiLabel),
                h('input', {
                    value: dAoi, onChange: (e) => setDAoi(e.target.value),
                    style: { background: c.bg, color: c.text, border: `1px solid ${c.border}`, borderRadius: 3, fontSize: 11.5, padding: '4px 7px', outline: 'none', width: 120 },
                }),
            ),
            h('div', { style: rowFlex },
                h(Label, { c }, sx.quantitiesLabel),
                h(Check, { checked: dQ.T, onChange: (v) => setDQ(p => ({ ...p, T: v })), c }, 'T'),
                h(Check, { checked: dQ.R, onChange: (v) => setDQ(p => ({ ...p, R: v })), c }, 'R'),
                h(Check, { checked: dQ.A, onChange: (v) => setDQ(p => ({ ...p, A: v })), c }, 'A'),
                h('span', { style: { width: 10 } }),
                h(Check, { checked: dSP, onChange: setDSP, c }, sx.includeSP),
            ),
            h('div', { style: rowFlex },
                h(Btn, { onClick: onExportDesign, c, primary: true }, sx.exportDesign),
                h('span', { style: { fontSize: 10.5, color: c.textDim } }, sx.exportDesignHint(evalMode)),
            ),
        ),

        // Export the imported MEASURED curves
        expSource === 'measured' && h('div', { style: section },
            h('span', { style: { fontSize: 11, color: c.textDim } }, sx.exportMeasuredDesc),
            !curves.length
                ? h('span', { style: { fontSize: 11.5, color: c.textDim, fontStyle: 'italic' } }, sx.noOverlays)
                : h(React.Fragment, null,
                    h('div', { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
                        curves.map(cv => h('div', { key: cv.id, style: { ...rowFlex, gap: 6 } },
                            h('span', { style: { width: 10, height: 10, borderRadius: 2, background: cv.color, display: 'inline-block', flexShrink: 0 } }),
                            h('span', { style: { fontSize: 11.5, color: c.text } }, cv.name),
                            h('span', { style: { fontSize: 10, color: '#fff', background: FAMILY_COLOR[cv.quantity] || '#888', borderRadius: 3, padding: '1px 5px' } }, cv.quantity),
                        )),
                    ),
                    h('div', { style: rowFlex },
                        h(Btn, { onClick: onExport, c, primary: true }, sx.exportMeasured),
                        h('span', { style: { fontSize: 10.5, color: c.textDim } }, sx.measuredCount(curves.length)),
                    ),
                ),
        ),
    );

    return h('div', { style: wrap },
        // Tabs
        h('div', { style: { display: 'flex', borderBottom: `1px solid ${c.border}`, background: c.panel } },
            h(TabBtn, { active: tab === 'import', onClick: () => setTab('import'), c }, sx.tabImport),
            h(TabBtn, { active: tab === 'export', onClick: () => setTab('export'), c }, sx.tabExport),
        ),

        // Status (shared)
        status && h('div', {
            style: {
                padding: '6px 14px', fontSize: 11.5,
                color: status.type === 'error' ? c.error : status.type === 'success' ? c.success : c.textDim,
                background: c.panel, borderBottom: `1px solid ${c.border}`,
            },
        }, status.msg),

        h('div', { style: { flex: 1, overflow: 'auto' } },
            tab === 'import' ? importTab : exportTab,
        ),
    );
}

function delimiterName(d, sx) {
    if (d === ',') return sx.delimComma;
    if (d === ';') return sx.delimSemicolon;
    if (d === '\t') return sx.delimTab;
    return sx.delimWhitespace;
}
