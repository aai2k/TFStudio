import { FieldLabel, SegBtn } from './controls.js';

const { createElement: h } = React;

function TimelineTicks({ c, deposition }) {
    return h('div', {
        style: {
            position: 'relative', height: 14, marginTop: -2,
            fontSize: 9, color: c.textDim, userSelect: 'none',
        },
    },
        deposition.cumTimes.map((time, index) => {
            const percentage = deposition.totalTime > 0
                ? (time / deposition.totalTime) * 100
                : 0;
            return h('div', {
                key: index,
                style: {
                    position: 'absolute', left: `${percentage}%`,
                    transform: 'translateX(-50%)',
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', lineHeight: 1,
                },
            },
                h('div', { style: { width: 1, height: 4, background: c.border } }),
                index > 0 && h('span', null, index),
            );
        }),
    );
}

export function Timeline({ c, sp, setup, deposition }) {
    const hasActive = deposition.N > 0;
    return h('div', {
        style: {
            display: 'flex', flexDirection: 'column', gap: 4,
            padding: '8px 12px',
            backgroundColor: c.panel,
            borderTop: `1px solid ${c.border}`,
            flexShrink: 0,
        },
    },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
            h('button', {
                onClick: deposition.handlePlayPause, disabled: !hasActive,
                style: {
                    padding: '4px 12px', fontSize: 12,
                    border: `1px solid ${c.border}`, borderRadius: 4,
                    backgroundColor: c.bg, color: c.text,
                    cursor: hasActive ? 'pointer' : 'not-allowed',
                    opacity: hasActive ? 1 : 0.5,
                    fontWeight: 600, minWidth: 86,
                },
            }, deposition.playing ? sp.pause : sp.play),
            h('button', {
                onClick: deposition.handleReset, disabled: !hasActive,
                style: {
                    padding: '4px 10px', fontSize: 12,
                    border: `1px solid ${c.border}`, borderRadius: 4,
                    backgroundColor: c.bg, color: c.text,
                    cursor: hasActive ? 'pointer' : 'not-allowed',
                    opacity: hasActive ? 1 : 0.5,
                },
            }, sp.reset),
            h(FieldLabel, { c }, sp.speed),
            h('div', { style: { display: 'flex' } },
                [0.5, 1, 2, 5, 10].map((speed, index, speeds) => h(SegBtn, {
                    key: speed,
                    active: setup.playSpeed === speed,
                    onClick: () => setup.setPlaySpeed(speed),
                    c,
                    position: index === 0 ? 'first' : index === speeds.length - 1 ? 'last' : null,
                }, sp.speedX(speed))),
            ),
            h('div', { style: { flex: 1 } }),
            h('div', { style: { fontSize: 11, color: c.text, fontVariantNumeric: 'tabular-nums' } },
                sp.currentStep(deposition.layerIdx, deposition.N || 0)),
            h('div', { style: { fontSize: 11, color: c.textDim, fontVariantNumeric: 'tabular-nums' } },
                sp.currentTime(deposition.progress, deposition.totalTime)),
        ),
        h('div', { style: { position: 'relative' } },
            h('input', {
                type: 'range',
                min: 0,
                max: Math.max(deposition.totalTime, 0.001),
                step: Math.max(deposition.totalTime / 1000, 0.001),
                value: Math.min(deposition.progress, deposition.totalTime),
                onChange: event => deposition.onTimelineChange(parseFloat(event.target.value)),
                disabled: !hasActive,
                style: {
                    width: '100%', accentColor: c.accent,
                    opacity: hasActive ? 1 : 0.4,
                },
            }),
            hasActive && h(TimelineTicks, { c, deposition }),
        ),
    );
}
