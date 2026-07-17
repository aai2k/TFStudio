import { cardStyle } from './styles.js';
import { ConfigHeader } from './ConfigHeader.js';
import { CasesRow } from './CasesRow.js';
import { RefinementRow } from './RefinementRow.js';
import { SynthesisRow } from './SynthesisRow.js';
import { FeaturesRow } from './FeaturesRow.js';
import { EngineRow } from './EngineRow.js';
import { ConstraintsRow } from './ConstraintsRow.js';
import { RunBar } from './RunBar.js';

const { createElement: h } = React;

export function ConfigPanel(props) {
    const { c } = props;
    return h('div', { style: { ...cardStyle(c), margin: 10, marginBottom: 0 } },
        h(ConfigHeader, props),
        h(CasesRow, props),
        h(RefinementRow, props),
        h(SynthesisRow, props),
        h(FeaturesRow, props),
        h(EngineRow, props),
        h(ConstraintsRow, props),
        h(RunBar, props));
}
