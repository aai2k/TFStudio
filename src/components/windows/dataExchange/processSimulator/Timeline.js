/** Transport and scrub bar under the plot. */

import { ActionButton, ChoiceGroup, FieldLabel } from '../../analysis/chrome/controls.js';
import { ControlRow } from '../../analysis/chrome/layout.js';

const { createElement: h } = React;

const SPEEDS = [0.5, 1, 2, 5, 10];

// Diameter of the scrub thumb, in pixels. Must match `--tfs-thumb`, which the
// slider below sets from this same constant; see `.tfs-scrub` in styles.css for
// why the ticks need it.
const THUMB = 12;

/** Where the thumb's centre sits for a given fraction of the track. */
export function thumbCentre(fraction) {
    const offset = (0.5 - fraction) * THUMB;
    return `calc(${fraction * 100}% ${offset < 0 ? '-' : '+'} ${Math.abs(offset)}px)`;
}

// Layer numbers are 1-2 characters wide and the ruler is a few hundred pixels,
// so past a dozen or so they run into each other. Only every `labelStride`th
// layer is named; the tick marks themselves stay, and the number of the layer
// the timeline is on is on the transport row beside them.
const MAX_LABELS = 16;
const STRIDES = [1, 2, 5, 10, 20, 50, 100, 200, 500];

/** Round interval between labelled layers, so the ruler reads 5, 10, 15. */
export function labelStride(layerCount) {
    return STRIDES.find(stride => layerCount / stride <= MAX_LABELS) ?? 1000;
}

function TimelineTicks({ c, deposition }) {
    const stride = labelStride(deposition.N);
    return h('div', {
        style: {
            position: 'relative', height: 14, marginTop: -2,
            fontSize: 9, color: c.textDim, userSelect: 'none',
        },
    },
        deposition.cumTimes.map((time, index) => {
            const fraction = deposition.totalTime > 0 ? time / deposition.totalTime : 0;
            const labelled = index > 0 && index % stride === 0;
            return h('div', {
                key: index,
                style: {
                    position: 'absolute', left: thumbCentre(fraction),
                    transform: 'translateX(-50%)',
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', lineHeight: 1,
                },
            },
                h('div', { style: { width: 1, height: 4, background: c.border } }),
                labelled && h('span', null, index),
            );
        }),
    );
}

function Readout({ c, dim, children }) {
    return h('div', {
        style: {
            fontSize: 11, color: dim ? c.textDim : c.text,
            fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
        },
    }, children);
}

export function Timeline({ c, sp, setup, deposition }) {
    const hasActive = deposition.N > 0;
    return h(ControlRow, { c, footer: true },
        h(ActionButton, {
            c, label: deposition.playing ? sp.pause : sp.play,
            disabled: !hasActive, onClick: deposition.handlePlayPause,
        }),
        h(ActionButton, {
            c, label: sp.reset, disabled: !hasActive, onClick: deposition.handleReset,
        }),
        h(ChoiceGroup, {
            label: sp.speed, ariaLabel: sp.speed, c,
            activeId: setup.playSpeed, onSelect: setup.setPlaySpeed,
            items: SPEEDS.map(speed => ({ id: speed, label: sp.speedX(speed) })),
        }),
        h('div', {
            style: {
                flex: 1, minWidth: 200, display: 'flex', flexDirection: 'column',
                justifyContent: 'center',
            },
        },
            h('input', {
                type: 'range',
                className: 'tfs-scrub',
                min: 0,
                max: Math.max(deposition.totalTime, 0.001),
                step: Math.max(deposition.totalTime / 1000, 0.001),
                value: Math.min(deposition.progress, deposition.totalTime),
                onChange: event => deposition.onTimelineChange(parseFloat(event.target.value)),
                disabled: !hasActive,
                style: { width: '100%', margin: 0, color: c.accent, '--tfs-thumb': `${THUMB}px` },
            }),
            hasActive && h(TimelineTicks, { c, deposition }),
        ),
        h(Readout, { c }, sp.currentStep(deposition.layerIdx, deposition.N || 0)),
        h(FieldLabel, { c }, '·'),
        h(Readout, { c, dim: true }, sp.currentTime(deposition.progress, deposition.totalTime)),
    );
}
