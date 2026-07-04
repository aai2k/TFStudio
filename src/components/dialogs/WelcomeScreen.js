// ── First-run welcome screen ───────────────────────────────────────────────────
//
// Shown automatically the first time TFStudio launches (tracked by the
// `welcomeSeen` setting) and re-openable any time from Help ▸ Welcome / Tour.
// Offers the four canonical entry points — new design, sample design, guided
// tour, documentation — plus a short list of built-in starter designs.
//
// Pure presentation: every action is a callback supplied by the renderer; this
// component owns no app state. All display text comes from `t.welcome.*`.

import { getPaletteNames } from '../../constants/colorPalettes.js';
import { availableLocales } from '../../constants/locales.js';

const { createElement: h, useState, useEffect } = React;

// ── Compact labeled dropdown (theme / language on the welcome screen) ──────────
function PrefSelect({ label, value, onChange, c, children }) {
    return h('label', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
        h('span', {
            style: {
                fontSize: 10, fontWeight: 600, color: c.textDim,
                textTransform: 'uppercase', letterSpacing: '0.04em',
            },
        }, label),
        h('select', {
            value, onChange,
            style: {
                padding: '6px 8px', backgroundColor: c.bg, color: c.text,
                border: `1px solid ${c.border}`, borderRadius: 6, fontSize: 12,
                minWidth: 130, cursor: 'pointer',
            },
        }, children),
    );
}

// ── Inline icons (20×20, currentColor) ─────────────────────────────────────────
const svg = (...kids) =>
    h('svg', { width: 26, height: 26, viewBox: '0 0 20 20', fill: 'none' }, ...kids);
const path = (d, w = 1.5) =>
    h('path', { d, stroke: 'currentColor', strokeWidth: w, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' });

const ICON = {
    new:   svg(h('rect', { x: 3, y: 2, width: 11, height: 16, rx: 1, stroke: 'currentColor', strokeWidth: 1.5, fill: 'none' }),
               path('M10 2v4h4'), path('M8 11h4M8 14h4M8 8h2')),
    tour:  svg(h('circle', { cx: 10, cy: 10, r: 7.5, stroke: 'currentColor', strokeWidth: 1.5, fill: 'none' }),
               path('M10 6v4l3 2'), h('circle', { cx: 10, cy: 10, r: 1, fill: 'currentColor' })),
    docs:  svg(path('M5 3h7l3 3v11H5z'), path('M12 3v3h3'), path('M7.5 10h5M7.5 12.5h5M7.5 7.5h3')),
    learn: svg(path('M3 6l7-3 7 3-7 3-7-3z'), path('M6 7.5v4c0 1 2 2 4 2s4-1 4-2v-4'), path('M17 6v4')),
    sample: svg(h('rect', { x: 3, y: 12, width: 3, height: 5, fill: 'currentColor' }),
                h('rect', { x: 8.5, y: 8, width: 3, height: 9, fill: 'currentColor' }),
                h('rect', { x: 14, y: 4, width: 3, height: 13, fill: 'currentColor' })),
};

// ── Action card ────────────────────────────────────────────────────────────────
function Card({ icon, title, desc, c, onClick }) {
    const [hov, setHov] = useState(false);
    return h('button', {
        onClick,
        onMouseEnter: () => setHov(true),
        onMouseLeave: () => setHov(false),
        style: {
            display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8,
            textAlign: 'left', padding: '16px 16px', borderRadius: 10, cursor: 'pointer',
            background: hov ? c.hover : 'transparent',
            border: `1px solid ${hov ? c.accent : c.border}`,
            color: c.text, transition: 'background-color 0.12s, border-color 0.12s',
            fontFamily: 'system-ui, -apple-system, sans-serif', minHeight: 108,
        },
    },
        h('span', { style: { color: c.accent, display: 'flex' } }, icon),
        h('span', { style: { fontSize: 14, fontWeight: 600 } }, title),
        h('span', { style: { fontSize: 11.5, color: c.textDim, lineHeight: 1.35 } }, desc),
    );
}

// ── Sample row ──────────────────────────────────────────────────────────────────
function SampleRow({ name, desc, c, onClick }) {
    const [hov, setHov] = useState(false);
    return h('button', {
        onClick,
        onMouseEnter: () => setHov(true),
        onMouseLeave: () => setHov(false),
        style: {
            display: 'flex', alignItems: 'center', gap: 12, width: '100%',
            padding: '9px 12px', borderRadius: 7, cursor: 'pointer', textAlign: 'left',
            background: hov ? c.hover : 'transparent',
            border: `1px solid ${hov ? c.accent : 'transparent'}`,
            color: c.text, fontFamily: 'system-ui, -apple-system, sans-serif',
            transition: 'background-color 0.1s',
        },
    },
        h('span', { style: { color: c.accent, display: 'flex', flexShrink: 0 } }, ICON.sample),
        h('span', { style: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 } },
            h('span', { style: { fontSize: 13, fontWeight: 600 } }, name),
            h('span', { style: { fontSize: 11, color: c.textDim, lineHeight: 1.3 } }, desc),
        ),
    );
}

export function WelcomeScreen({ c, t, samples = [], theme, setTheme, locale, setLocale, onNewDesign, onOpenSample, onDocs, onTour, onTutorials, onClose }) {
    const w = t.welcome;
    const [version, setVersion] = useState('');
    const showPrefs = typeof setTheme === 'function' && typeof setLocale === 'function';

    useEffect(() => {
        window.electronAPI?.getAppVersion?.().then(v => setVersion(v)).catch(() => {});
    }, []);

    // Localized sample text with English fallback from the sample definition.
    const sampleText = (s) => {
        const loc = w.samples && w.samples[s.key];
        return { name: loc?.name || s.name, desc: loc?.desc || s.description };
    };

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
                boxShadow: '0 12px 48px rgba(0,0,0,0.55)', width: 720, maxWidth: '94vw',
                maxHeight: '90vh', overflowY: 'auto', padding: 32,
                fontFamily: 'system-ui, -apple-system, sans-serif',
            },
        },
            // ── Header ──────────────────────────────────────────────────────────
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 16, marginBottom: 6, justifyContent: 'space-between' } },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 16, minWidth: 0 } },
                    h('img', {
                        src: '../icons/tfstudio-purple2.png', alt: '',
                        style: { width: 64, height: 64, objectFit: 'contain', flexShrink: 0 },
                    }),
                    h('div', null,
                        h('h2', { style: { margin: 0, fontSize: 24, fontWeight: 700, color: c.text } }, w.title),
                        h('div', { style: { fontSize: 13, color: c.textDim, marginTop: 4 } }, w.subtitle),
                    ),
                ),
                // Quick theme + language pickers (same options as Settings) so a
                // first-run user can set look & language before doing anything.
                showPrefs && h('div', { style: { display: 'flex', gap: 10, flexShrink: 0 } },
                    h(PrefSelect, { label: t.settings.colorTheme, value: theme, onChange: (e) => setTheme(e.target.value), c },
                        getPaletteNames().map(name => h('option', { key: name, value: name }, name))),
                    h(PrefSelect, { label: t.settings.language, value: locale, onChange: (e) => setLocale(e.target.value), c },
                        availableLocales.map(loc => h('option', { key: loc.code, value: loc.code }, loc.name))),
                ),
            ),
            version && h('div', {
                style: { fontSize: 11, color: c.textDim, marginBottom: 22, marginLeft: 80, marginTop: -2 },
            }, `${t.dialogs.about.version} ${version}`),

            // ── Primary action cards (2×2) ──────────────────────────────────────
            h('div', {
                style: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 26 },
            },
                h(Card, { icon: ICON.new,   title: w.newTitle,      desc: w.newDesc,      c, onClick: onNewDesign }),
                h(Card, { icon: ICON.learn, title: w.tutorialsTitle, desc: w.tutorialsDesc, c, onClick: onTutorials }),
                h(Card, { icon: ICON.tour,  title: w.tourTitle,     desc: w.tourDesc,     c, onClick: onTour }),
                h(Card, { icon: ICON.docs,  title: w.docsTitle,     desc: w.docsDesc,     c, onClick: onDocs }),
            ),

            // ── Samples ─────────────────────────────────────────────────────────
            samples.length > 0 && h('div', null,
                h('div', {
                    style: {
                        fontSize: 11, fontWeight: 600, color: c.textDim, textTransform: 'uppercase',
                        letterSpacing: '0.05em', marginBottom: 8,
                    },
                }, w.samplesHeading),
                h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
                    samples.map(s => {
                        const txt = sampleText(s);
                        return h(SampleRow, {
                            key: s.key, name: txt.name, desc: txt.desc, c,
                            onClick: () => onOpenSample(s),
                        });
                    }),
                ),
            ),

            // ── Footer ──────────────────────────────────────────────────────────
            h('div', {
                style: {
                    display: 'flex', justifyContent: 'flex-end', alignItems: 'center',
                    marginTop: 28, paddingTop: 18, borderTop: `1px solid ${c.border}`,
                },
            },
                h('button', {
                    onClick: onClose,
                    style: {
                        padding: '9px 26px', background: c.accent, color: '#fff', border: 'none',
                        borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                    },
                }, w.close),
            ),
        ),
    );
}
