import { computeEllipsometrySweep } from './spectrum.js';
import { ellipsometrySession } from './sessionState.js';
import { useWindowSession } from '../../windowSession.js';

const { useEffect, useState } = React;

export function useEllipsometryEvaluation(design) {
    const [session, setField] = useWindowSession(ellipsometrySession, design);
    const {
        mode, side, lambdaStart, lambdaEnd, lambdaStep, thetaDeg,
        lambdaNm, angleStart, angleEnd, angleStep, deltaConvention,
    } = session;
    const [data, setData] = useState(null);

    useEffect(() => {
        if (!design) { setData(null); return; }
        try {
            setData(computeEllipsometrySweep(design, {
                mode, side, lambdaStart, lambdaEnd, lambdaStep, thetaDeg,
                lambdaNm, angleStart, angleEnd, angleStep, deltaConvention,
            }));
        } catch (error) {
            console.error('Ellipsometry computation failed:', error);
            setData(null);
        }
    }, [design, mode, side, lambdaStart, lambdaEnd, lambdaStep, thetaDeg, lambdaNm, angleStart, angleEnd, angleStep, deltaConvention]);

    return {
        mode, setMode: value => setField('mode', value),
        side, setSide: value => setField('side', value),
        lambdaStart, setLambdaStart: value => setField('lambdaStart', value),
        lambdaEnd, setLambdaEnd: value => setField('lambdaEnd', value),
        lambdaStep, setLambdaStep: value => setField('lambdaStep', value),
        thetaDeg, setThetaDeg: value => setField('thetaDeg', value),
        lambdaNm, setLambdaNm: value => setField('lambdaNm', value),
        angleStart, setAngleStart: value => setField('angleStart', value),
        angleEnd, setAngleEnd: value => setField('angleEnd', value),
        angleStep, setAngleStep: value => setField('angleStep', value),
        deltaConvention, setDeltaConvention: value => setField('deltaConvention', value),
        data,
    };
}
