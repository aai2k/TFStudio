// Settings → Language: interface locale.
import { availableLocales } from '../../../constants/locales.js';
import { Section, selectStyle } from './ui.js';

const { createElement: h } = React;

export const LanguagePane = ({ locale, setLocale, c, t }) =>
  h('div', null,
    h(Section, { c, title: t.settings.language },
      h('select', {
        value: locale,
        onChange: (e) => setLocale(e.target.value),
        style: selectStyle(c),
      },
        availableLocales.map(loc => h('option', { key: loc.code, value: loc.code }, loc.name))
      )
    )
  );
