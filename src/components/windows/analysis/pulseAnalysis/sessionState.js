import { registryKeys, sessionDefaults } from '../../../../constants/analysisDefaults.js';
import { createWindowSession } from '../../windowSession.js';
import { spectrumCentreField } from './pulseModel.js';

/** Side to show when a design is selected: whichever side carries the coating. */
function preferredSide(design) {
    const count = layers => (layers || []).filter(layer => layer.material && layer.thickness > 0).length;
    return count(design?.frontLayers) === 0 && count(design?.backLayers) > 0 ? 'back' : 'front';
}

export const pulseSession = createWindowSession({
    ...sessionDefaults('pulseAnalysis'),
    // Front and Back each show one coating on its own, as in the GD/GDD window;
    // Whole part is the front coating, the substrate and the back coating, in
    // transmission.
    side: 'front',
    // Super-Gaussian order; 2 is the Gaussian.
    order: 2,
    // The input's own chirp, fs² and fs³, added to whichever spectrum it has.
    gdd: 0,
    tod: 0,
    passes: 1,
    // 'model' draws the spectrum from the shape; 'file' uses the measured or
    // typed spectrum the design holds (design.pulseSpectrum).
    source: 'model',
}, {
    id: 'pulseAnalysis',
    savable: registryKeys('pulseAnalysis'),
    // A design's own spectrum is taken about its own centroid, as Apply sets it.
    onDesignChange: (design, current) => {
        const centre = current.source === 'file' ? spectrumCentreField(design?.pulseSpectrum) : NaN;
        return { side: preferredSide(design), ...(centre > 0 ? { centerWavelength: centre } : null) };
    },
    // Whole part is transmission through the part, so it has no reflection.
    normalize: state => (state.side === 'whole' && state.target !== 'T'
        ? { ...state, target: 'T' }
        : state),
});
