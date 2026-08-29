// Preferences → Language: interface locale.
import { availableLocales } from '../../../constants/locales.js';
import { Row, selectStyle } from './ui.js';

const { createElement: h } = React;

export const LanguagePane = ({ locale, setLocale, c, t }) =>
  h('div', null,
    h(Row, { c, label: t.settings.language },
      h('select', {
        value: locale,
        onChange: (e) => setLocale(e.target.value),
        style: selectStyle(c),
      },
        availableLocales.map(loc => h('option', { key: loc.code, value: loc.code }, loc.name))
      )
    )
  );
