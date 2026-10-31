/**
 * Whether a face is coated, from the thicknesses of its layers in nm: it is
 * when one of them is thicker than 0 nm. A 0 nm layer changes no spectrum and
 * no force, so a face holding nothing else is bare, and taking such a layer
 * out changes nothing.
 */
export const isCoated = thicknessesNm => (thicknessesNm || []).some(d => d > 0);
