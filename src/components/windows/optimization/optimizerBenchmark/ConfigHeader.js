import { getMaterial } from '../../../../utils/materials/materialDatabase.js';
import { describePool } from '../../../../utils/benchmark/optimizerBenchmark.js';
import { OK, WARN } from './model.js';
import { poolSize } from './store.js';

const { createElement: h } = React;

export function ConfigHeader({ c, wasmOn }) {
    return h(React.Fragment, null,
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' } },
            h('span', { style: { fontWeight: 700, fontSize: 14 } }, 'Optimizer Benchmark'),
            h('span', { style: { fontSize: 11, padding: '2px 7px', borderRadius: 4, background: wasmOn ? `${OK}22` : `${WARN}22`, color: wasmOn ? OK : WARN, border: `1px solid ${wasmOn ? OK : WARN}55` } },
                wasmOn ? 'WASM ✓' : 'JS (enable WASM in Settings)'),
            h('span', { style: { fontSize: 11, color: c.textDim } }, `${poolSize()} workers · dev/QA · results persist across tab switches`)),
        h('div', { style: { fontSize: 10.5, color: c.textDim, marginBottom: 6, fontFamily: 'monospace' } },
            `Synthesis pool: ${describePool(getMaterial)}`),
    );
}
