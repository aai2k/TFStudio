// Preferences → Appearance: colour theme (built-in + imported) and ribbon style.
import { getPaletteNames } from '../../../constants/colorPalettes.js';
import { Row, selectStyle, buttonStyle } from './ui.js';

const { createElement: h } = React;

const ImportIcon = () =>
  h('svg', { width: 13, height: 13, viewBox: '0 0 16 16', fill: 'none' },
    h('path', { d: 'M8 2v8M5 7l3 3 3-3', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }),
    h('path', { d: 'M3 13h10', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }));

export const AppearancePane = ({ theme, setTheme, ribbonStyle, setRibbonStyle, customThemes = {}, onImportTheme, onDeleteTheme, c, t }) => {
  const customNames = Object.keys(customThemes);
  const builtinNames = getPaletteNames().filter((n) => !customThemes[n]);
  const isCustomTheme = !!customThemes[theme];

  return h('div', null,
    h(Row, { c, label: t.settings.colorTheme },
      h('select', {
        value: theme,
        onChange: (e) => setTheme(e.target.value),
        style: selectStyle(c),
      },
        h('optgroup', { label: t.settings.themeBuiltIn },
          builtinNames.map(name => h('option', { key: name, value: name }, name))),
        customNames.length > 0 && h('optgroup', { label: t.settings.themeImported },
          customNames.map(name => h('option', { key: name, value: name }, name)))
      )
    ),
    h(Row, { c, label: t.settings.importVscodeTheme, hint: t.settings.themeImportHint },
      h('button', {
        onClick: () => onImportTheme && onImportTheme(),
        style: {
          ...buttonStyle(c),
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
        },
      }, h(ImportIcon), t.settings.importVscodeTheme),
      isCustomTheme && h('button', {
        onClick: () => onDeleteTheme && onDeleteTheme(theme),
        title: t.settings.removeTheme,
        style: { ...buttonStyle(c), backgroundColor: 'transparent', color: c.error },
      }, t.settings.removeTheme)
    ),
    h(Row, { c, label: t.settings.ribbonStyle, hint: t.settings.ribbonStyleHint },
      h('select', {
        value: ribbonStyle || 'colorful',
        onChange: (e) => setRibbonStyle && setRibbonStyle(e.target.value),
        style: selectStyle(c),
      },
        h('option', { value: 'colorful' }, t.settings.ribbonColorful),
        h('option', { value: 'minimalist' }, t.settings.ribbonMinimalist)
      )
    )
  );
};
