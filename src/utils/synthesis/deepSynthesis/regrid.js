// Moving a Deep Synthesis run onto a denser sampling grid as its design grows.

import { designMaterialLookup } from '../../materials/designMaterials.js';
import { regridForDesign, presampleSynthesisMaterials } from '../../../components/windows/optimization/synthesisShared/runGrid.js';
import { makeEvaluator } from './evaluator.js';

/**
 * run.regrid (runGrid.js): when the design about to be worked on needs more
 * band samples than the run's grid holds, the run moves to a grid for it, with
 * material tables sampled here, and `current.ev` becomes the evaluator on that
 * grid. source: the design with its non-built-in materials embedded, and the
 * pool's non-built-in materials as records (setup.js); built-in materials
 * resolve by id. A catalog and the design's copy resolve the same way, so the
 * design's record and a pool record of one id hold the same data. `onRegrid`
 * hears the new operands and tables and the layer count.
 */
export function makeRegrid(current, source, onRegrid = () => {}) {
    const lookup = designMaterialLookup({ ...source.design, materials: { ...source.pool, ...source.design.materials } });
    const poolLookup = designMaterialLookup({ materials: source.pool });
    return (layers) => {
        const operands = regridForDesign(current.ev.spec.operands, current.ev.designOf(layers), lookup);
        if (!operands) return null;
        const pool = current.ev.spec.pool.map(id => ({ id, mat: poolLookup(id) }));
        const materials = presampleSynthesisMaterials(source.design, operands, pool);
        current.ev = makeEvaluator({ ...current.ev.spec, operands }, { materials });
        onRegrid({ operands, materials, n: layers.length });
        return current.ev;
    };
}
