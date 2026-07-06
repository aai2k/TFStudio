import { getPaletteNames } from '../../constants/colorPalettes.js';
import { availableLocales } from '../../constants/locales.js';
// Synthesis settings (inner engine / candidate search / thick-seed handling)
// now live INSIDE the Needle + Gradual-Evolution windows (Advanced section) —
// they belong with the synthesis tool, not the global app settings.

import { Checkbox } from '../ui/Checkbox.js';

const { createElement: h } = React;

export const SettingsModal = ({ theme, setTheme, locale, setLocale, wasmTmm, setWasmTmm, ribbonStyle, setRibbonStyle, customThemes = {}, onImportTheme, onDeleteTheme, onClose, c, t }) => {
    const customNames  = Object.keys(customThemes);
    const builtinNames = getPaletteNames().filter((n) => !customThemes[n]);
    const isCustomTheme = !!customThemes[theme];
    return h('div', {
        style: {
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }
    },
        h('div', {
            style: {
                backgroundColor: c.panel, borderRadius: '8px', padding: '24px',
                width: '400px', maxHeight: '85vh', overflow: 'auto',
                boxShadow: '0 10px 40px rgba(0, 0, 0, 0.3)', border: `1px solid ${c.border}`
            }
        },
            h('h2', { style: { marginTop: 0, marginBottom: '20px', fontSize: '18px', fontWeight: 'bold', color: c.text } },
                t.settings.title),
            h('div', { style: { marginBottom: '20px' } },
                h('label', { style: { display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '8px', color: c.textDim, textTransform: 'uppercase', letterSpacing: '0.5px' } },
                    t.settings.colorTheme),
                h('select', {
                    value: theme,
                    onChange: (e) => setTheme(e.target.value),
                    style: { width: '100%', padding: '10px', backgroundColor: c.bg, color: c.text, border: `1px solid ${c.border}`, borderRadius: '6px', fontSize: '13px' }
                },
                    h('optgroup', { label: t.settings.themeBuiltIn },
                        builtinNames.map(name => h('option', { key: name, value: name }, name))),
                    customNames.length > 0 && h('optgroup', { label: t.settings.themeImported },
                        customNames.map(name => h('option', { key: name, value: name }, name)))
                ),
                // Import / remove row
                h('div', { style: { display: 'flex', gap: '8px', marginTop: '8px' } },
                    h('button', {
                        onClick: () => onImportTheme && onImportTheme(),
                        style: {
                            flex: 1, padding: '8px 12px', backgroundColor: c.bg, color: c.text,
                            border: `1px solid ${c.border}`, borderRadius: '6px', cursor: 'pointer',
                            fontSize: '12px', fontWeight: '600', display: 'flex', alignItems: 'center',
                            justifyContent: 'center', gap: '6px'
                        }
                    },
                        h('svg', { width: 13, height: 13, viewBox: '0 0 16 16', fill: 'none' },
                            h('path', { d: 'M8 2v8M5 7l3 3 3-3', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }),
                            h('path', { d: 'M3 13h10', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' })),
                        t.settings.importVscodeTheme),
                    isCustomTheme && h('button', {
                        onClick: () => onDeleteTheme && onDeleteTheme(theme),
                        title: t.settings.removeTheme,
                        style: {
                            padding: '8px 12px', backgroundColor: 'transparent', color: c.error,
                            border: `1px solid ${c.border}`, borderRadius: '6px', cursor: 'pointer',
                            fontSize: '12px', fontWeight: '600'
                        }
                    }, t.settings.removeTheme)
                ),
                h('span', { style: { display: 'block', fontSize: '12px', color: c.textDim, marginTop: '6px' } },
                    t.settings.themeImportHint)
            ),
            h('div', { style: { marginBottom: '20px' } },
                h('label', { style: { display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '8px', color: c.textDim, textTransform: 'uppercase', letterSpacing: '0.5px' } },
                    t.settings.ribbonStyle),
                h('select', {
                    value: ribbonStyle || 'colorful',
                    onChange: (e) => setRibbonStyle && setRibbonStyle(e.target.value),
                    style: { width: '100%', padding: '10px', backgroundColor: c.bg, color: c.text, border: `1px solid ${c.border}`, borderRadius: '6px', fontSize: '13px' }
                },
                    h('option', { value: 'colorful' },   t.settings.ribbonColorful),
                    h('option', { value: 'minimalist' }, t.settings.ribbonMinimalist)
                ),
                h('span', { style: { display: 'block', fontSize: '12px', color: c.textDim, marginTop: '6px' } },
                    t.settings.ribbonStyleHint)
            ),
            h('div', { style: { marginBottom: '20px' } },
                h('label', { style: { display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '8px', color: c.textDim, textTransform: 'uppercase', letterSpacing: '0.5px' } },
                    t.settings.language),
                h('select', {
                    value: locale,
                    onChange: (e) => setLocale(e.target.value),
                    style: { width: '100%', padding: '10px', backgroundColor: c.bg, color: c.text, border: `1px solid ${c.border}`, borderRadius: '6px', fontSize: '13px' }
                },
                    availableLocales.map(loc => h('option', { key: loc.code, value: loc.code }, loc.name))
                )
            ),
            h('div', { style: { marginBottom: '20px' } },
                h('label', { style: { display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '8px', color: c.textDim, textTransform: 'uppercase', letterSpacing: '0.5px' } },
                    t.settings.performance),
                h('label', { style: { display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer' } },
                    h(Checkbox, {
                        c,
                        checked: !!wasmTmm,
                        onChange: (e) => setWasmTmm && setWasmTmm(e.target.checked),
                        style: { marginTop: '2px' }
                    }),
                    h('span', { style: { fontSize: '13px', color: c.text } },
                        h('span', { style: { fontWeight: '600' } }, t.settings.wasmAccel),
                        h('span', { style: { display: 'block', fontSize: '12px', color: c.textDim, marginTop: '2px' } },
                            t.settings.wasmAccelHint)
                    )
                )
            ),
            h('div', { style: { display: 'flex', justifyContent: 'flex-end' } },
                h('button', {
                    onClick: onClose,
                    style: { padding: '10px 24px', backgroundColor: c.accent, color: c.accentText, border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px', fontWeight: '600' }
                }, t.settings.close)
            )
        )
    );
};
