import {
    buildCumulativeTimes, buildDepositionModel, buildLayerTimes, deriveProgressState,
    stepSeekTime,
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
    // The layer the user picked out of the sequence, or null while the chart
    // follows whichever layer is being deposited.
    const [pinnedStep, setPinnedStep] = useState(null);

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

    // Moving the timeline by hand is the user asking to look somewhere else, so
    // it releases the held layer and the chart goes back to following the
    // position. Without this a hold outlives the gesture that ended it and the
    // plot keeps showing a layer the timeline has left behind.
    const onTimelineChange = (value) => {
        setPlaying(false);
        setPinnedStep(null);
        setProgress(value);
    };
    const handleReset = () => {
        setPlaying(false);
        setPinnedStep(null);
        setProgress(0);
    };
    const handlePlayPause = () => {
        if (totalTime > 0) {
            if (progress >= totalTime - 1e-9) setProgress(0);
            // Playing hands the chart back to the layer being deposited, which
            // is the one worth watching while a run is under way.
            setPinnedStep(null);
            setPlaying(current => !current);
        }
    };
    const selectStep = (step) => {
        const count = deposition.activeDep.length;
        if (step < 1 || step > count) return;
        if (step === pinnedStep) {
            setPinnedStep(null);
            return;
        }
        setPlaying(false);
        setPinnedStep(step);
        setProgress(stepSeekTime(cumTimes, layerTimes, step));
    };

    return {
        ...deposition,
        N: deposition.activeDep.length,
        layerTimes, totalTime, cumTimes,
        progress, playing,
        ...progressState,
        pinnedStep, selectStep,
        onTimelineChange, handleReset, handlePlayPause,
    };
}
