/**
 * Shared Page-5 layout for the BBM / Mono wizards: a left control column
 * (run control + E/A/T bar chart + y-axis scale) and a right pane with the
 * live theory/actual spectrum, per-layer tab strip and deposition timeline.
 *
 * The caller supplies `leftTop` (the run control — a Start/Restart button or a
 * busy indicator) and the already-built spectrum `traces`; everything else is
 * identical between the two wizards.
 */

import { Radio, Chart, LayerTabs, DepositionTimeline, SplitPage } from '../wizardShared.js';

const { createElement: h } = React;

export function SimulationView({ p, set, c, B, run, N, layerIdx, frac, traces, leftTop, playback }) {
    const cur = layerIdx >= 1 ? layerIdx - 1 : 0;
    const tT = run ? (run.targetFront[cur] || 0) : 0;
    const tA = run ? (run.asBuiltFront[cur] || 0) * frac : 0;
    const tE = run ? (run.estimatedFront?.[cur] || 0) : 0;
    const barTraces = [{ type: 'bar', x: [B.barE, B.barA, B.barT], y: [tE, tA, tT], marker: { color: ['#e5484d', '#19b3c4', '#2da44e'] } }];

    return h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } },
        h(SplitPage, { c, leftWidth: 184,
            left: [
                leftTop,
                h('div', { key: 'barlbl', style: { fontSize: 11, color: c.textDim, marginTop: 6 } }, B.eatLegend),
                h('div', { key: 'bars', style: { height: 150, flexShrink: 0 } },
                    h(Chart, { traces: barTraces, xTitle: '', yTitle: 'nm', c, minHeight: 0, extra: { margin: { l: 38, r: 8, t: 6, b: 24 } } })),
                h('div', { key: 'ysl', style: { fontSize: 12, fontWeight: 600, color: c.text, marginTop: 2 } }, B.yAxisScale),
                h(Radio, { key: 'ya', checked: !p.yFixed, onChange: () => set('yFixed', false), label: B.auto, c }),
                h(Radio, { key: 'yf', checked: p.yFixed, onChange: () => set('yFixed', true), label: B.fixed, c }),
            ],
            right: h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } },
                h('div', { style: { flex: 1, minHeight: 0 } },
                    run ? h(Chart, { traces, xTitle: B.wavelengthAxis, yTitle: `${p.quantity}${p.pol === 'avg' ? '' : p.pol}, %`, c, yRange: p.yFixed ? [0, 100] : null })
                        : h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: c.textDim, fontStyle: 'italic' } }, B.pressStart)),
                run && h(LayerTabs, { n: N, current: layerIdx || 1, onSelect: playback.jumpLayer, c, label: B.layerWord }),
                run && h(DepositionTimeline, { progress: playback.progress, totalTime: playback.totalTime, playing: playback.playing,
                    onScrub: playback.scrub, onPlayPause: playback.playPause, onReset: playback.reset,
                    speed: p.timeMult, setSpeed: (s) => set('timeMult', s), cumTimes: playback.cumTimes, layerIdx, N, c, B })),
        }),
    );
}
