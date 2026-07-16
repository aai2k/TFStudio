import { MaterialPicker } from '../../../ui/MaterialPicker.js';

const { createElement: h } = React;

function mediaField(key, field, c, t) {
    return h('label', { key, style: { display: 'flex', flexDirection: 'column', gap: 3,
                 fontSize: 11, color: c.textDim, width: 190, maxWidth: '48%' } },
        h('span', {}, field.label),
        h(MaterialPicker, { value: field.value, onChange: field.onChange, c, t }));
}

// Media dropdowns — front coating: incident + substrate; back coating:
// substrate + exit medium.
export function MediaRow({ state, c, t, sf }) {
    return h('div', { style: { display: 'flex', gap: 12, flexWrap: 'wrap' } },
        state.showIncident && mediaField('inc', { label: sf.incidentMedium, value: state.incidentMat, onChange: state.setIncidentMat }, c, t),
        mediaField('sub', { label: sf.substrate, value: state.substrateMat, onChange: state.setSubstrateMat }, c, t),
        state.showExit && mediaField('exit', { label: sf.exitMedium, value: state.exitMat, onChange: state.setExitMat }, c, t),
    );
}
