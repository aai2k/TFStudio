/**
 * Page 6 — Resulting Performance (shared by BBM / Mono).
 *
 * Manufactured vs theory spectrum + per-layer relative / absolute thickness
 * error bars + thickness & refractive-index tables. `showDeferredActions` adds
 * the (disabled) Generate-Report / Load buttons used by the broadband wizard.
 */

import { matName, cullName, resolveMat, Radio, Chart, computeWizardResultSpectra } from '../wizardShared.js';

const { createElement: h, useMemo } = React;

// Per-layer theory vs as-built thickness + index rows for the tables/bars.
function resultRows({ layers, run, ctx, p }) {
    const refLam = ctx.design.referenceWavelength || (p.lamMin + p.lamMax) / 2;
    return layers.map((l, i) => {
        const theor = run.targetFront[i] || 0, dep = run.asBuiltFront[i] || 0;
        const abs = dep - theor, rel = theor > 0 ? abs / theor * 100 : 0;
        const n0 = resolveMat(l.material).getNK(refLam)[0];
        const dn = run.matDeltas[i]?.dn || 0, inh = run.matDeltas[i]?.inh || 0;
        return { i, name: matName(l.material), theor, dep, abs, rel, nTheor: n0, nDep: n0 + dn, dn, inh };
    });
}

function spectralBody({ spectra, p, c, B }) {
    const tr = spectra ? [
        { x: spectra.theory.lambda, y: spectra.theory.values.map(v => v * 100), type: 'scatter', mode: 'lines', line: { color: c.text === '#cccccc' ? '#dddddd' : '#222', width: 2 }, name: 'theory' },
        { x: spectra.manuf.lambda, y: spectra.manuf.values.map(v => v * 100), type: 'scatter', mode: 'lines', line: { color: '#e5484d', width: 1.6 }, name: 'manufactured' },
    ] : [];
    return h(Chart, { traces: tr, xTitle: B.wavelengthAxis, yTitle: `${p.quantity}${p.pol === 'avg' ? '' : p.pol}, %`, c, yRange: p.yFixed ? [0, 100] : null });
}

function errorBody({ rows, isRel, p, c, B }) {
    const y = rows.map(r => isRel ? r.rel : r.abs);
    const tr = [{ type: 'bar', x: rows.map(r => r.i + 1), y, marker: { color: y.map(v => v >= 0 ? '#e5484d' : '#1f6feb') } }];
    return h(Chart, { traces: tr, xTitle: B.layerWord, yTitle: isRel ? B.deltaPct : B.deltaNm, c });
}

function thickTable({ rows, c, B, th, td, errColor }) {
    return h('div', { style: { overflow: 'auto', height: '100%', border: `1px solid ${c.border}`, borderRadius: 4 } },
        h('table', { style: { width: '100%', borderCollapse: 'collapse' } },
            h('thead', null, h('tr', null, [B.tblLayerNum, B.tblName, B.tblTheor, B.tblDep, B.tblRelErr, B.tblAbsErr].map((x, i) => h('th', { key: i, style: th }, x)))),
            h('tbody', null, rows.map(r => h('tr', { key: r.i },
                h('td', { style: td }, r.i + 1),
                h('td', { style: { ...td, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }, title: r.name }, cullName(r.name, 22)),
                h('td', { style: td }, r.theor.toFixed(4)),
                h('td', { style: td }, r.dep.toFixed(4)),
                h('td', { style: { ...td, color: errColor(r.rel) } }, r.rel.toFixed(4)),
                h('td', { style: { ...td, color: errColor(r.abs) } }, r.abs.toFixed(4)))))));
}

function riTable({ rows, c, B, th, td, errColor }) {
    return h('div', { style: { overflow: 'auto', height: '100%', border: `1px solid ${c.border}`, borderRadius: 4 } },
        h('table', { style: { width: '100%', borderCollapse: 'collapse' } },
            h('thead', null, h('tr', null, [B.riLayer, B.riTheor, B.riDep, B.riDeltaN, B.riInh].map((x, i) => h('th', { key: i, style: th }, x)))),
            h('tbody', null, rows.map(r => h('tr', { key: r.i },
                h('td', { style: { ...td, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }, title: r.name }, cullName(r.name, 18)),
                h('td', { style: td }, r.nTheor.toFixed(4)),
                h('td', { style: td }, r.nDep.toFixed(4)),
                h('td', { style: { ...td, color: errColor(r.dn * 100) } }, r.dn.toFixed(4)),
                h('td', { style: td }, r.inh.toFixed(3)))))));
}

function resultBody({ tab, spectra, rows, p, c, B, th, td, errColor }) {
    if (tab === 'spectral') return spectralBody({ spectra, p, c, B });
    if (tab === 'relerr' || tab === 'abserr') return errorBody({ rows, isRel: tab === 'relerr', p, c, B });
    if (tab === 'thick') return thickTable({ rows, c, B, th, td, errColor });
    return riTable({ rows, c, B, th, td, errColor });
}

function deferredActions({ c, B }) {
    const style = { padding: '7px', fontSize: 12, borderRadius: 4, border: `1px solid ${c.border}`, background: c.bg, color: c.textDim, cursor: 'not-allowed', opacity: 0.5 };
    return [
        h('button', { key: 'rep', disabled: true, title: B.deferredHint, style: { ...style, marginTop: 8 } }, B.generateReport),
        h('button', { key: 'load', disabled: true, title: B.deferredHint, style }, B.load),
    ];
}

export function PageResults({ p, set, layers, c, B, ctx, run, showDeferredActions = false }) {
    const tab = p.resultTab || 'spectral';

    const spectra = useMemo(
        () => computeWizardResultSpectra({ run, ctx, layers, quantity: p.quantity, aoi: p.aoi, pol: p.pol, lamMin: p.lamMin, lamMax: p.lamMax }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [run, ctx, p.quantity, p.aoi, p.pol, p.lamMin, p.lamMax]);

    if (!run) return h('div', { style: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: c.textDim, fontStyle: 'italic' } }, B.runFirst);

    const rows = resultRows({ layers, run, ctx, p });
    const th = { textAlign: 'left', padding: '5px 9px', borderBottom: `1px solid ${c.border}`, fontWeight: 600, color: c.textDim, fontSize: 11.5, whiteSpace: 'nowrap', position: 'sticky', top: 0, background: c.panel };
    const td = { padding: '3px 9px', borderBottom: `1px solid ${c.border}55`, fontSize: 12, color: c.text, whiteSpace: 'nowrap' };
    const errColor = (v) => Math.abs(v) > 0.2 ? '#e5484d' : c.text;

    const tabBtn = (id, label) => h('button', { key: id, onClick: () => set('resultTab', id),
        style: { padding: '6px 14px', fontSize: 12, cursor: 'pointer', background: tab === id ? c.bg : 'transparent',
                 color: tab === id ? c.accent : c.text, fontWeight: tab === id ? 600 : 400,
                 border: 'none', borderBottom: `2px solid ${tab === id ? c.accent : 'transparent'}`, borderRadius: '3px 3px 0 0' } }, label);

    const body = resultBody({ tab, spectra, rows, p, c, B, th, td, errColor });

    return h('div', { style: { display: 'flex', gap: 16, flex: 1, minHeight: 0 } },
        h('div', { style: { width: 130, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 12 } },
            h('div', { style: { fontSize: 12, fontWeight: 600, color: c.text } }, B.yAxisScale),
            h(Radio, { checked: !p.yFixed, onChange: () => set('yFixed', false), label: B.auto, c }),
            h(Radio, { checked: p.yFixed, onChange: () => set('yFixed', true), label: B.fixed, c }),
            showDeferredActions && deferredActions({ c, B })),
        h('div', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' } },
            h('div', { style: { display: 'flex', alignItems: 'flex-end', borderBottom: `1px solid ${c.border}`, marginBottom: 8 } },
                tabBtn('spectral', B.spectralPerf), tabBtn('relerr', B.relErrors), tabBtn('abserr', B.absErrors), tabBtn('thick', B.thicknesses), tabBtn('ri', B.refIndices)),
            h('div', { style: { flex: 1, minHeight: 0 } }, body)));
}
