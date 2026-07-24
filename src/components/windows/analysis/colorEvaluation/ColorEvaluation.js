/**
 * Color Evaluation — CIE color of the coating's reflectance / transmittance.
 *
 * Physics in ../../../../utils/physics/colorimetry.js
 * (Macleod §12.2 Eqs. 12.1–12.5 + CIE 15:2004 standard data).
 *
 * The spectral response R(λ)/T(λ) is taken from the same validated TMM used
 * by Optical Evaluation (evaluateSpectrum / …Back / …Total), sampled on the
 * 380–780 nm color grid and fed to the colorimetric integral.
 */

import { useDesign } from '../../../../state/DesignContext.js';
import { evaluateSpectrum, evaluateSpectrumBack, evaluateSpectrumTotal }
  from '../../../../utils/physics/thinFilmMath.js';
import { getMaterialById } from '../../../../utils/materials/catalogManager.js';
import { getMaterial } from '../../../../utils/materials/materialDatabase.js';
import {
  colorReport, xyzToSRGB, OBSERVERS, ILLUMINANTS
} from '../../../../utils/physics/colorimetry.js';
import { makeConeSpec, coneAverageResult } from '../../../../utils/physics/optimizer.js';
import { EvalModeBadge, ConeBadge } from '../../../SurfaceModeBar.js';
import { ChromaticityChart } from './chartFigure.js';

const { createElement: h, useState, useEffect, useMemo } = React;

function resolveMaterial(id) {
  if (!id) return getMaterial('Air');
  return getMaterialById(id) || getMaterial(id) || getMaterial('Air');
}

// Build an interpolating R|T(λ) fraction-function from a TMM spectrum sweep.
function responseFn(design, evalMode, characteristic, pol, theta) {
  const incMat  = resolveMaterial(design.incidentMedium);
  const subMat  = resolveMaterial(design.substrate?.material);
  const exitMat = resolveMaterial(design.exitMedium);
  const subThk  = design.substrate?.thickness ?? 1.0;
  const params  = { lambdaStart: 380, lambdaEnd: 780, lambdaStep: 1,
                     theta, polarization: pol };

  const front = (design.frontLayers || []).filter(l => l.thickness > 0)
    .map(l => ({ material: resolveMaterial(l.material), thickness: l.thickness }));
  const back  = (design.backLayers || []).filter(l => l.thickness > 0)
    .map(l => ({ material: resolveMaterial(l.material), thickness: l.thickness }));

  // Cone-angle averaging: `theta` is the cone axis; the colour is
  // computed from the cone-averaged spectrum so it matches the Optical
  // Evaluation plot and the merit function. Inactive cone → single call.
  const coneSpec = makeConeSpec(design.cone || {});
  const computeAt = (th) => {
    const p = { ...params, theta: th };
    if (evalMode === 'back')  return evaluateSpectrumBack(p, exitMat, subMat, back);
    if (evalMode === 'total') return evaluateSpectrumTotal(p, incMat, subMat, exitMat, front, back, subThk);
    return evaluateSpectrum(p, incMat, subMat, front);
  };
  const res = coneAverageResult(coneSpec, theta, computeAt, ['T', 'R', 'A', 'Ts', 'Rs', 'Tp', 'Rp', 'As', 'Ap']);

  const arr = characteristic === 'T' ? res.T : res.R;
  const lam0 = res.lambda[0], n = res.lambda.length;
  const dl = n > 1 ? (res.lambda[n - 1] - lam0) / (n - 1) : 1;
  return (lam) => {
    if (lam <= lam0) return arr[0] ?? 0;
    if (lam >= res.lambda[n - 1]) return arr[n - 1] ?? 0;
    const f = (lam - lam0) / dl, i = Math.floor(f), t = f - i;
    return (arr[i] ?? 0) * (1 - t) + (arr[i + 1] ?? 0) * t;
  };
}

// ── Small UI helpers ──────────────────────────────────────────────────────────

function Field({ label, children, c }) {
  return h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
    h('div', { style: { fontSize: 11, color: c.textDim, flexShrink: 0 } }, label),
    children);
}

function Sel({ value, onChange, options, c, width = 'auto' }) {
  return h('select', {
    value, onChange: e => onChange(e.target.value),
    style: { height: 24, width, backgroundColor: c.panel, color: c.text,
      border: `1px solid ${c.border}`, borderRadius: 3, fontSize: 12,
      paddingTop: 0, paddingBottom: 0, paddingLeft: 6, outline: 'none' }
  }, options.map(o =>
    h('option', { key: o.id, value: o.id }, o.label)));
}

function Num({ value, onChange, min, max, step, c, width = 56 }) {
  const [raw, setRaw] = useState(String(value));
  useEffect(() => { setRaw(String(value)); }, [value]);
  const commit = () => {
    const v = parseFloat(raw);
    if (!isNaN(v)) onChange(Math.min(Math.max(v, min ?? -Infinity), max ?? Infinity));
    else setRaw(String(value));
  };
  return h('input', { type: 'number', value: raw, min, max, step,
    onChange: e => setRaw(e.target.value), onBlur: commit,
    onKeyDown: e => { if (e.key === 'Enter') commit(); },
    style: { width, height: 22, backgroundColor: c.panel, color: c.text,
      border: `1px solid ${c.border}`, borderRadius: 3, fontSize: 12,
      padding: '0 4px', outline: 'none', textAlign: 'right' } });
}

function Swatch({ color, label, sub, c }) {
  return h('div', { style: { display: 'flex', flexDirection: 'column',
    alignItems: 'center', gap: 3 } },
    h('div', { style: { width: 76, height: 76, borderRadius: 6,
      background: color, border: `1px solid ${c.border}`,
      boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.06)' } }),
    h('div', { style: { fontSize: 11, color: c.text, fontWeight: 600 } }, label),
    sub && h('div', { style: { fontSize: 10, color: c.textDim } }, sub));
}

function Row({ k, v, c }) {
  return h('tr', null,
    h('td', { style: { padding: '2px 10px 2px 0', fontSize: 11,
      color: c.textDim, whiteSpace: 'nowrap' } }, k),
    h('td', { style: { padding: '2px 0', fontSize: 11, color: c.text,
      fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' } }, v));
}

const f2 = (x, d = 4) => (x == null || !isFinite(x)) ? '—' : x.toFixed(d);

// Colorimetric report for the current design, or null when there is nothing to
// show (no design / empty front stack). Reports failures via `setError`.
function computeColorReport(o) {
  const { design, evalMode, characteristic, pol, theta,
          observer, illuminant, step, setError } = o;
  if (!design) return null;
  const front = (design.frontLayers || []).filter(l => l.thickness > 0);
  if (evalMode === 'front' && front.length === 0) return null;
  try {
    const Rfn = responseFn(design, evalMode, characteristic, pol, theta);
    setError(null);
    return colorReport(Rfn, { observer, illuminant, step });
  } catch (e) {
    console.error('Color eval error:', e);
    setError(e.message || 'Computation error');
    return null;
  }
}

// Right-panel readout: label/value pairs for the colorimetric spaces.
function colorReadoutRows(r, ce) {
  if (!r) return [];
  const dom = r.dom.dom != null
    ? `${f2(r.dom.dom, 1)} nm   ${ce.purity} ${f2(r.dom.purity * 100, 2)}%`
    : (r.dom.comp != null
        ? `${ce.compl} ${f2(r.dom.comp, 1)} nm   ${ce.purity} ${f2(r.dom.purity * 100, 2)}%`
        : '—');
  return [
    [ce.xyY, `x ${f2(r.xy.x)}   y ${f2(r.xy.y)}   Y ${f2(r.XYZ.Y, 3)}`],
    [ce.XYZ, `X ${f2(r.XYZ.X, 3)}   Y ${f2(r.XYZ.Y, 3)}   Z ${f2(r.XYZ.Z, 3)}`],
    ['CIE L*a*b*', `L* ${f2(r.Lab.L, 3)}   a* ${f2(r.Lab.a, 3)}   b* ${f2(r.Lab.b, 3)}`],
    ['L* C*ab h°ab', `C* ${f2(r.Lab.C, 3)}   h° ${f2(r.Lab.h, 2)}`],
    ['CIE L*u*v*', `L* ${f2(r.Luv.L, 3)}   u* ${f2(r.Luv.u, 3)}   v* ${f2(r.Luv.v, 3)}`],
    ['C*uv h°uv suv', `C* ${f2(r.Luv.C, 3)}   h° ${f2(r.Luv.h, 2)}   s ${f2(r.Luv.s, 4)}`],
    ["u' v' (1976)", `u' ${f2(r.uvP.up)}   v' ${f2(r.uvP.vp)}`],
    ['u v (1960)', `u ${f2(r.uv60.u)}   v ${f2(r.uv60.v)}`],
    ['Hunter Lab', `L ${f2(r.Hunter.L, 3)}   a ${f2(r.Hunter.a, 3)}   b ${f2(r.Hunter.b, 3)}`],
    [ce.dominant, dom],
    ['CCT / Duv', `${f2(r.cct.cct, 0)} K   Duv ${f2(r.cct.duv, 4)}`],
  ];
}

// ── Main component ────────────────────────────────────────────────────────────

export function ColorEvaluation({ c, theme, t }) {
  const { design, evalMode } = useDesign();
  const ce = t.colorEval;

  const [characteristic, setCharacteristic] = useState('R'); // 'R' | 'T'
  const [pol, setPol]             = useState('avg');
  const [theta, setTheta]         = useState(0);
  const [observer, setObserver]   = useState('2');
  const [illuminant, setIllum]    = useState('D65');
  const [step, setStep]           = useState(5);
  const [exposure, setExposure]   = useState('1');
  const [error, setError]         = useState(null);

  useEffect(() => { setError(null); }, [evalMode]);

  const report = useMemo(
    () => computeColorReport({ design, evalMode, characteristic, pol, theta,
      observer, illuminant, step, setError }),
    [design, evalMode, characteristic, pol, theta, observer, illuminant, step]);

  const charOptions = [
    { id: 'R', label: ce.reflectance },
    { id: 'T', label: ce.transmittance },
  ];
  const polOptions = [
    { id: 'avg', label: ce.polAvg }, { id: 's', label: 'S' }, { id: 'p', label: 'P' }];
  const expOptions = [
    { id: '1', label: ce.expAsIs }, { id: '10', label: '×10' },
    { id: '50', label: '×50' }, { id: '200', label: '×200' },
    { id: '1000', label: '×1000' }, { id: 'fit', label: ce.expFit }];
  const r = report;
  // Exposure only rescales the on-screen swatch; the colorimetric report and
  // its readout are unchanged. '1' reuses the report's reference-white swatch.
  const sampleRgb = r && (exposure === '1' ? r.rgb
    : xyzToSRGB(r.XYZ, r.white,
        exposure === 'fit' ? { fit: true } : { gain: Number(exposure) }));
  const rows = colorReadoutRows(r, ce);

  return h('div', { style: { display: 'flex', flexDirection: 'column',
    height: '100%', backgroundColor: c.bg, color: c.text,
    fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: 12,
    overflow: 'hidden' } },

    // Controls
    h('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center',
      gap: 10, padding: '5px 10px', borderBottom: `1px solid ${c.border}`,
      backgroundColor: c.panel, flexShrink: 0 } },
      h(EvalModeBadge, { design, c, t }),
      h(ConeBadge, { design, c, t }),
      h('div', { style: { width: 1, height: 20, background: c.border } }),
      h(Field, { label: ce.characteristic, c },
        h(Sel, { value: characteristic, onChange: setCharacteristic,
          options: charOptions, c })),
      h(Field, { label: ce.pol, c },
        h(Sel, { value: pol, onChange: setPol, options: polOptions, c })),
      h(Field, { label: ce.aoi, c },
        h(Num, { value: theta, min: 0, max: 89, step: 1, c, width: 46,
          onChange: setTheta })),
      h(Field, { label: ce.observer, c },
        h(Sel, { value: observer, onChange: setObserver,
          options: OBSERVERS, c })),
      h(Field, { label: ce.illuminant, c },
        h(Sel, { value: illuminant, onChange: setIllum,
          options: ILLUMINANTS, c })),
      h(Field, { label: ce.step, c },
        h(Num, { value: step, min: 1, max: 20, step: 1, c, width: 42,
          onChange: setStep })),
      h(Field, { label: ce.exposure, c },
        h(Sel, { value: exposure, onChange: setExposure,
          options: expOptions, c, width: 116 }))),

    // Body: diagram (left) + readout (right)
    h('div', { style: { flex: 1, minHeight: 0, display: 'flex' } },
      h('div', { style: { flex: 1, minWidth: 0, position: 'relative' } },
        error
          ? h('div', { style: { display: 'flex', alignItems: 'center',
              justifyContent: 'center', height: '100%', color: '#ef5350',
              fontSize: 12, padding: 16, textAlign: 'center' } },
              `Error: ${error}`)
          : !r
            ? h('div', { style: { display: 'flex', alignItems: 'center',
                justifyContent: 'center', height: '100%', color: c.textDim,
                fontSize: 12, fontStyle: 'italic' } }, ce.noData)
            : h(ChromaticityChart, { report: r, observer, c, theme })),

      h('div', { style: { width: 300, flexShrink: 0,
        borderLeft: `1px solid ${c.border}`, backgroundColor: c.panel + '66',
        overflowY: 'auto', padding: 12, display: 'flex',
        flexDirection: 'column', gap: 14 } },
        r && h('div', { style: { display: 'flex', gap: 16,
          justifyContent: 'center' } },
          h(Swatch, { color: sampleRgb,
            label: characteristic === 'T' ? ce.swatchT : ce.swatchR,
            sub: exposure === '1'
              ? `Y = ${f2(r.XYZ.Y, 2)}`
              : `Y = ${f2(r.XYZ.Y, 2)} · ${exposure === 'fit' ? ce.expFit : '×' + exposure}`,
            c }),
          h(Swatch, { color: `rgb(${Math.round(255)},${Math.round(255)},${Math.round(255)})`,
            label: ce.refWhite, sub: illuminant, c })),
        r && h('table', { style: { borderCollapse: 'collapse', width: '100%' } },
          h('tbody', null,
            rows.map(([k, v], i) => h(Row, { key: i, k, v, c })))),
        r && h('div', { style: { fontSize: 10, color: c.textDim,
          lineHeight: 1.5, marginTop: 'auto', paddingTop: 8,
          borderTop: `1px solid ${c.border}` } },
          ce.refNote)),
    ),

    // Status strip
    h('div', { style: { padding: '3px 10px', borderTop: `1px solid ${c.border}`,
      backgroundColor: c.panel, flexShrink: 0, display: 'flex',
      alignItems: 'center', gap: 12, fontSize: 11, color: c.textDim } },
      h('span', null, design?.name || '—'),
      h('span', null, `${characteristic === 'T' ? 'T' : 'R'} · ${pol} · ${theta}°`),
      h('span', null, `${OBSERVERS.find(o => o.id === observer)?.label} · ${illuminant} · Δλ ${step} nm`)));
}
