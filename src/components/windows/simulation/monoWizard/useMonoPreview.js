/**
 * The signal-vs-thickness preview the monitoring pages share: the selected
 * deposition layer clamped to the run, its monitor-table row, and the
 * memoized curve with the cut thickness marked. One implementation, so the
 * pages cannot drift into previewing different signals for the same state.
 */

import { flipLayerIndex } from '../../../../utils/monitoring/depositionSpectrum.js';
import { monoSignalVsThickness } from './monoSignalModel.js';
import { lineSeries } from '../../../ui/chartOptions.js';

const { useMemo } = React;

export function useMonoPreview({ p, layers, ctx, design, noisePct = 0, absPct = 0, nonce = 0, color = '#1f6feb', width = 1.6 }) {
    const k = Math.min(Math.max(1, p.previewLayer || 1), layers.length);
    const common = { char: p.quantity, aoi: p.aoi, pol: p.pol };
    // `k` is a deposition layer; `monTable` is storage-indexed (see LayerTabs).
    const monRow = p.monTable[flipLayerIndex(layers.length, k)]
        || { lambda: design.referenceWavelength || 550, strategy: 'turning', order: 1 };
    const preview = useMemo(() =>
        (layers.length && ctx) ? monoSignalVsThickness({ layers, k, monRow, common, ctx, noisePct, absPct, nonce }) : null,
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [layers, k, monRow.lambda, p.quantity, p.aoi, p.pol, noisePct, absPct, nonce, ctx]);
    const series = preview ? [lineSeries({ x: preview.d, y: preview.signal, color, width })] : [];
    const referenceLines = preview ? [{ x: preview.dTarget, color: '#2da44e', width: 1.2, dash: 'dashed' }] : [];
    return { k, series, referenceLines };
}
