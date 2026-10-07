import { Label } from '../zemaxCoatings/ui.js';
import { warningText } from './messages.js';

const { createElement: h } = React;

/** What the reader or the writer noted, one line each. */
export function WarningList({ c, z, warnings }) {
    if (!warnings?.length) return null;
    return h('div', null,
        h(Label, { c }, z.warningsHeader(warnings.length)),
        h('ul', { style: { margin: '4px 0 0', paddingLeft: 18, fontSize: 11, lineHeight: 1.5, color: c.warning } },
            warnings.map((warning, index) => h('li', { key: index }, warningText(z, warning)))),
    );
}

/** A text field in the window's style. */
export function TextField({ c, value, onChange, width = 180, maxLength }) {
    return h('input', {
        value, maxLength, onChange: (event) => onChange(event.target.value),
        style: { height: 24, width, background: c.bg, color: c.text, border: `1px solid ${c.border}`, borderRadius: 3, fontSize: 11, padding: '0 6px', outline: 'none' },
    });
}

/** A labelled control, label above. */
export function Field({ c, label, children }) {
    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
        h(Label, { c }, label),
        children,
    );
}
