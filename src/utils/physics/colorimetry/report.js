/**
 * Full colour report composing the tristimulus, colour-space, locus and sRGB
 * conversions into one result for a spectral response. See ../colorimetry.js
 * for the full physics provenance.
 */

import { tristimulus, whitePoint, chromaticityXy, uvPrime, uv1960, lab, luv, hunterLab } from './colorSpaces.js';
import { dominantWavelength, correlatedColorTemperature } from './locus.js';
import { xyzToSRGB } from './srgb.js';

/**
 * Full colour report for one spectral response.
 * @param {(lam:number)=>number} Rfn  R|T as a fraction (0–1)
 */
export function colorReport(Rfn, { observer = '2', illuminant = 'D65', step = 5 } = {}) {
  const XYZ   = tristimulus(Rfn, observer, illuminant, step);
  const white = whitePoint(observer, illuminant, step);
  const xy    = chromaticityXy(XYZ);
  const wxy   = chromaticityXy(white);
  return {
    XYZ, xy,
    white, whiteXy: wxy,
    Lab:   lab(XYZ, white),
    Luv:   luv(XYZ, white),
    Hunter: hunterLab(XYZ, white),
    uvP:   uvPrime(XYZ),
    uv60:  uv1960(XYZ),
    dom:   dominantWavelength(xy, wxy, observer),
    cct:   correlatedColorTemperature(xy, observer),
    rgb:   xyzToSRGB(XYZ, white),
  };
}
