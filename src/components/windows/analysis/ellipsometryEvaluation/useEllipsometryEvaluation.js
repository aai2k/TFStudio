import { computeEllipsometrySweep } from './spectrum.js';
import { ellipsometrySession } from './sessionState.js';
import { offeredSides } from '../availableSide.js';
import { useWindowSession } from '../../windowSession.js';
import { useEnvironmentChoice } from '../chrome/environmentChoice.js';
import { rangeMaterials } from '../../../../utils/materials/materialRange.js';

const { useMemo } = React;

// The sweep in each environment shown, `{ env, data }` with `env` its
// `{ number, label }`, each from the design that environment computes; null
// when the computation failed.
function computeSweeps(views, options) {
    try {
        return views.map(view => ({
            env: { number: view.number, label: view.label },
            data: computeEllipsometrySweep(view.design, options),
        }));
    } catch (error) {
        console.error('Ellipsometry computation failed:', error);
        return null;
    }
}

export function useEllipsometryEvaluation(design) {
    const [session, setField] = useWindowSession(ellipsometrySession, design);
    const {
        mode, side, lambdaStart, lambdaEnd, lambdaStep, thetaDeg,
        lambdaNm, angleStart, angleEnd, angleStep, deltaConvention, showPsi, showDelta, showTable,
    } = session;
    // The environments the Environment droplist names; environment 1's design
    // is the design itself.
    const environment = useEnvironmentChoice(design, { overlay: true });
    const { views, every } = environment;

    // Computed in the same render as the views they belong to, so the curves,
    // the legend and the table never name different environments.
    const sweeps = useMemo(() => computeSweeps(views, {
        mode, side, lambdaStart, lambdaEnd, lambdaStep, thetaDeg,
        lambdaNm, angleStart, angleEnd, angleStep, deltaConvention,
    }), [views, mode, side, lambdaStart, lambdaEnd, lambdaStep, thetaDeg,
        lambdaNm, angleStart, angleEnd, angleStep, deltaConvention]);
    // The materials the range notice reads: those of the side computed, in
    // every environment shown.
    const materials = useMemo(() => views.flatMap(view => rangeMaterials(view.design, side)), [views, side]);

    return {
        environment, materials,
        mode, setMode: value => setField('mode', value),
        side, setSide: value => setField('side', value), sideOffered: offeredSides(design),
        lambdaStart, setLambdaStart: value => setField('lambdaStart', value),
        lambdaEnd, setLambdaEnd: value => setField('lambdaEnd', value),
        lambdaStep, setLambdaStep: value => setField('lambdaStep', value),
        thetaDeg, setThetaDeg: value => setField('thetaDeg', value),
        lambdaNm, setLambdaNm: value => setField('lambdaNm', value),
        angleStart, setAngleStart: value => setField('angleStart', value),
        angleEnd, setAngleEnd: value => setField('angleEnd', value),
        angleStep, setAngleStep: value => setField('angleStep', value),
        deltaConvention, setDeltaConvention: value => setField('deltaConvention', value),
        showPsi, setShowPsi: value => setField('showPsi', value),
        showDelta, setShowDelta: value => setField('showDelta', value),
        showTable, setShowTable: value => setField('showTable', value),
        // The first environment's sweep, and under All every environment's.
        data: sweeps ? sweeps[0].data : null,
        sets: every ? sweeps : null,
    };
}
