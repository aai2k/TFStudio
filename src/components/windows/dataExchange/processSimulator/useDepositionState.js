import {
    buildCumulativeTimes, buildDepositionModel, buildLayerTimes, deriveProgressState,
} from './model.js';

const { useState, useEffect, useMemo } = React;

export function useDepositionState(design, setup) {
    const deposition = useMemo(
        () => buildDepositionModel(design, setup.activeSide),
        [design, setup.activeSide],
    );
    const layerTimes = useMemo(
        () => buildLayerTimes(deposition.activeDep, setup.rates),
        [deposition.activeDep, setup.rates],
    );
    const totalTime = useMemo(
        () => layerTimes.reduce((sum, time) => sum + time, 0),
        [layerTimes],
    );
    const cumTimes = useMemo(() => buildCumulativeTimes(layerTimes), [layerTimes]);
    const [progress, setProgress] = useState(0);
    const [playing, setPlaying] = useState(false);

    useEffect(() => {
        setProgress(current => Math.min(current, totalTime));
        if (totalTime === 0) setPlaying(false);
    }, [totalTime]);

    const progressState = useMemo(
        () => deriveProgressState(progress, cumTimes, layerTimes, deposition.activeDep.length),
        [progress, cumTimes, layerTimes, deposition.activeDep.length],
    );

    useEffect(() => {
        const hasLayers = deposition.activeDep.length !== 0;
        const hasDuration = totalTime > 0;
        let cleanup;
        if (playing && hasLayers && hasDuration) {
            let frame;
            let last;
            const tick = (now) => {
                if (last == null) last = now;
                const elapsed = (now - last) / 1000;
                last = now;
                setProgress(current => {
                    const candidate = current + elapsed * setup.playSpeed;
                    let next = candidate;
                    if (candidate >= totalTime) {
                        setPlaying(false);
                        next = totalTime;
                    }
                    return next;
                });
                frame = requestAnimationFrame(tick);
            };
            frame = requestAnimationFrame(tick);
            cleanup = () => cancelAnimationFrame(frame);
        }
        return cleanup;
    }, [playing, deposition.activeDep.length, totalTime, setup.playSpeed]);

    const onTimelineChange = (value) => {
        setPlaying(false);
        setProgress(value);
    };
    const handleReset = () => {
        setPlaying(false);
        setProgress(0);
    };
    const handlePlayPause = () => {
        if (totalTime > 0) {
            if (progress >= totalTime - 1e-9) setProgress(0);
            setPlaying(current => !current);
        }
    };

    return {
        ...deposition,
        N: deposition.activeDep.length,
        layerTimes, totalTime, cumTimes,
        progress, playing,
        ...progressState,
        onTimelineChange, handleReset, handlePlayPause,
    };
}
