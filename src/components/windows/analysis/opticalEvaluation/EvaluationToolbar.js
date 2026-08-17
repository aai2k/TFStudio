import { EvalModeBadge, ConeBadge } from '../../../SurfaceModeBar.js';
import { FieldLabel } from './controls.js';
import { AoiChips } from './AoiChips.js';

const { createElement: h } = React;

export function EvaluationToolbar(props) {
    const { design, c, t, oe, params, setThetas } = props;
    return h('div', {
        style: {
            display: 'flex', flexWrap: 'wrap', alignItems: 'center',
            gap: 10, rowGap: 5,
            padding: '7px 14px 4px',
            backgroundColor: c.panel, flexShrink: 0
        }
    },
        h(EvalModeBadge, { design, c, t }),
        h(ConeBadge, { design, c, t }),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 } },
            h(FieldLabel, { c }, oe.aoi),
            h(AoiChips, { values: params.thetas, onChange: setThetas, c, oe })
        )
    );
}
