import { displayLayerLabel } from './viewModel.js';

const { createElement: h } = React;

export function SensitivityPlaceholder({ message, c }) {
    return h('div', {
        style: {
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: c.textDim, fontSize: 13, fontStyle: 'italic',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            padding: 16, textAlign: 'center',
        }
    }, message);
}

export function SensitivitySummary({ result, peakRank1, frontCount, rowCount, ls, c }) {
    const text = result && !result.error && result.mf0 != null
        ? `${ls.mfNow}: ${result.mf0.toFixed(6)}  |  ${ls.peakLayer}: ${
            peakRank1 ? displayLayerLabel(peakRank1, frontCount) : '—'
        }  |  ${rowCount} ${ls.layers}`
        : '';
    return h('span', {
        style: { marginLeft: 'auto', color: c.textDim, fontSize: 11 },
    }, text);
}
