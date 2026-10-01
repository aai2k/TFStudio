import { buildLambdaGrid } from '../../physics/thinFilmMath.js';

/** Build an ascending nm grid [start..end] with `step` nm spacing, both ends included. */
export function buildGrid(startNm, endNm, stepNm) {
    const a = Math.min(startNm, endNm), b = Math.max(startNm, endNm);
    return buildLambdaGrid(a, b, stepNm > 0 ? stepNm : 10);
}
