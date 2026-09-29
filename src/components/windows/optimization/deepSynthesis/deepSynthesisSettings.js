export const DEEP_CATS_KEY = 'tfstudio_deepSynthesis_selectedCats';
export const DEEP_MAX_LAYERS_KEY = 'tfstudio_deepSynthesis_maxLayers';
export const DEEP_DMIN_KEY = 'tfstudio_deepSynthesis_dMin';

// Settings a fresh window starts with: a 20 nm floor and a cap of 40 layers,
// the conditions the method was measured under in the synthesis lab. The floor
// follows the merit function's MNT row when it has one (useMinThickness.js).
export const DEEP_SYNTHESIS_WINDOW_DEFAULTS = { dMin: 20, maxLayers: 40 };
