import { Checkbox } from '../../../ui/Checkbox.js';
import { Divider, FieldLabel, NumInput } from './controls.js';

const { createElement: h } = React;

function StatusMessage({ c, status }) {
    return h('div', {
        style: {
            fontSize: 11, padding: '4px 10px', borderRadius: 4,
            backgroundColor: status.type === 'error' ? '#c0392b22' : '#27ae6022',
            color: status.type === 'error' ? '#e57373' : '#81c784',
            border: `1px solid ${status.type === 'error' ? '#c0392b' : '#27ae60'}`,
            marginLeft: 8, maxWidth: '40%',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        },
        title: status.message,
    }, status.message);
}

export function SpectrumToolbar({ c, sp, setup, statusMsg }) {
    return h('div', {
        style: {
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 10px',
            backgroundColor: c.panel,
            borderBottom: `1px solid ${c.border}`,
            flexWrap: 'wrap', flexShrink: 0,
        },
    },
        h(FieldLabel, { c }, sp.spectralRange),
        h(NumInput, { value: setup.lambdaStart, onChange: setup.setLambdaStart, min: 100, max: 50000, step: 10, c, width: 64 }),
        h('span', { style: { fontSize: 11, color: c.textDim } }, sp.to),
        h(NumInput, { value: setup.lambdaEnd, onChange: setup.setLambdaEnd, min: 100, max: 50000, step: 10, c, width: 64 }),
        h('span', { style: { fontSize: 11, color: c.textDim } }, sp.step),
        h(NumInput, { value: setup.lambdaStep, onChange: setup.setLambdaStep, min: 0.1, max: 100, step: 0.5, c, width: 60 }),
        h('span', { style: { fontSize: 11, color: c.textDim } }, 'nm'),
        h(Divider, { c }),
        h('label', {
            style: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: c.text, cursor: 'pointer' },
        },
            h(Checkbox, {
                c, checked: setup.showSteps,
                onChange: event => setup.setShowSteps(event.target.checked),
            }),
            sp.showStepCurves,
        ),
        h(Divider, { c }),
        h(FieldLabel, { c }, 'Export step (nm)'),
        h(NumInput, { value: setup.exportStep, onChange: setup.setExportStep, min: 0.01, max: 100, step: 0.1, c, width: 70 }),
        statusMsg && h(StatusMessage, { c, status: statusMsg }),
    );
}
