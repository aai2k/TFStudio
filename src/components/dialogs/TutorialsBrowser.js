// ── Tutorials browser ──────────────────────────────────────────────────────────
//
// Lists the interactive worked-example lessons grouped by level, shows a ✓ for
// lessons the user has completed (tracked in localStorage by the renderer), and
// launches the TutorialPlayer for the chosen lesson. Pure presentation — lesson
// structure + completion set + callbacks come from the renderer; all text from
// `t.tutorials.*`.

const { createElement: h, useState } = React;

const LEVEL_ORDER = ['beginner', 'intermediate', 'advanced'];
const LEVEL_COLOR = { beginner: '#46b450', intermediate: '#e8943a', advanced: '#cf5fa0' };

function LessonRow({ lesson, text, done, c, t, onStart }) {
    const [hov, setHov] = useState(false);
    const tu = t.tutorials;
    return h('button', {
        onClick: () => onStart(lesson.key),
        onMouseEnter: () => setHov(true),
        onMouseLeave: () => setHov(false),
        style: {
            display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left',
            padding: '11px 13px', borderRadius: 9, cursor: 'pointer',
            background: hov ? c.hover : 'transparent',
            border: `1px solid ${hov ? c.accent : c.border}`,
            color: c.text, fontFamily: 'system-ui, -apple-system, sans-serif', marginBottom: 7,
            transition: 'background-color 0.1s, border-color 0.1s',
        },
    },
        // Completion badge
        h('span', {
            style: {
                width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13,
                background: done ? c.accent : 'transparent',
                border: done ? 'none' : `1.5px solid ${c.border}`,
                color: done ? '#fff' : c.textDim, fontWeight: 700,
            },
        }, done ? '✓' : ''),
        // Title + summary
        h('span', { style: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 } },
            h('span', { style: { fontSize: 13.5, fontWeight: 600 } }, text.title),
            h('span', { style: { fontSize: 11.5, color: c.textDim, lineHeight: 1.35 } }, text.summary),
        ),
        // Meta: steps + minutes
        h('span', { style: { fontSize: 10.5, color: c.textDim, whiteSpace: 'nowrap', flexShrink: 0, textAlign: 'right' } },
            h('div', null, tu.stepsCount(lesson.steps.length)),
            h('div', { style: { marginTop: 2 } }, tu.minutes(lesson.estMin)),
        ),
    );
}

export function TutorialsBrowser({ c, t, lessons = [], doneKeys, onStart, onClose }) {
    const tu = t.tutorials;
    const done = doneKeys || new Set();
    const byLevel = LEVEL_ORDER
        .map(level => ({ level, items: lessons.filter(l => l.level === level) }))
        .filter(g => g.items.length > 0);

    return h('div', {
        style: {
            position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.72)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10001,
        },
        onClick: onClose,
    },
        h('div', {
            onClick: (e) => e.stopPropagation(),
            style: {
                backgroundColor: c.panel, border: `1px solid ${c.border}`, borderRadius: 14,
                boxShadow: '0 12px 48px rgba(0,0,0,0.55)', width: 660, maxWidth: '94vw',
                maxHeight: '88vh', overflowY: 'auto', padding: 28,
                fontFamily: 'system-ui, -apple-system, sans-serif',
            },
        },
            // Header
            h('div', { style: { marginBottom: 20 } },
                h('h2', { style: { margin: 0, fontSize: 21, fontWeight: 700, color: c.text } }, tu.title),
                h('div', { style: { fontSize: 12.5, color: c.textDim, marginTop: 5 } }, tu.subtitle),
            ),

            // Lessons grouped by level
            byLevel.map(g =>
                h('div', { key: g.level, style: { marginBottom: 18 } },
                    h('div', {
                        style: {
                            display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9,
                            fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
                            color: LEVEL_COLOR[g.level] || c.textDim,
                        },
                    },
                        h('span', { style: { width: 7, height: 7, borderRadius: '50%', background: LEVEL_COLOR[g.level] || c.textDim } }),
                        tu.levels[g.level],
                    ),
                    g.items.map(lesson =>
                        h(LessonRow, {
                            key: lesson.key, lesson,
                            text: tu.lessons[lesson.key] || { title: lesson.key, summary: '' },
                            done: done.has(lesson.key), c, t, onStart,
                        })
                    ),
                )
            ),

            // Footer
            h('div', {
                style: { display: 'flex', justifyContent: 'flex-end', marginTop: 14, paddingTop: 16, borderTop: `1px solid ${c.border}` },
            },
                h('button', {
                    onClick: onClose,
                    style: { padding: '9px 24px', background: c.accent, color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: 'pointer' },
                }, tu.close),
            ),
        ),
    );
}
