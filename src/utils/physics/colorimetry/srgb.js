/**
 * XYZ → sRGB swatch conversion with Bradford chromatic adaptation. See
 * ../colorimetry.js for the full physics provenance.
 */

// Bradford chromatic-adaptation matrix product (von Kries in LMS).
const M_BFD     = [[ 0.8951, 0.2664,-0.1614],
                   [-0.7502, 1.7135, 0.0367],
                   [ 0.0389,-0.0685, 1.0296]];
const M_BFD_INV = [[ 0.9869929,-0.1470543, 0.1599627],
                   [ 0.4323053, 0.5183603, 0.0492912],
                   [-0.0085287, 0.0400428, 0.9684867]];
const M_XYZ_RGB = [[ 3.2406255,-1.5372080,-0.4986286],
                   [-0.9689307, 1.8757561, 0.0415175],
                   [ 0.0557101,-0.2040211, 1.0569959]]; // sRGB, D65

function mul3(M, v) {
  return [M[0][0]*v[0]+M[0][1]*v[1]+M[0][2]*v[2],
          M[1][0]*v[0]+M[1][1]*v[1]+M[1][2]*v[2],
          M[2][0]*v[0]+M[2][1]*v[1]+M[2][2]*v[2]];
}

/**
 * sRGB swatch for the sample, Bradford-adapted from the source illuminant
 * white to D65 so the patch shows the perceived colour under that source.
 * Returns 'rgb(r,g,b)' (clamped, gamut-projected by clipping).
 *
 * Exposure options let a very dim reflection reveal its hue on screen. By
 * default the swatch is scaled relative to a perfect (100%) white reflector, so
 * a near-zero luminance renders as black — faithful, but it hides the hue. A
 * strong antireflection coating, for example, has a saturated but extremely dim
 * reflected colour; against a bright source the eye still reads that hue, which
 * a fixed-reference patch cannot show.
 *   - `gain`: linear exposure multiplier applied to the sample only (the
 *     reference white is unaffected), emulating a brighter reflected source.
 *   - `fit`: normalise the sample's linear RGB to its peak channel, showing the
 *     hue at full brightness independent of luminance. Overrides `gain`.
 */
export function xyzToSRGB(XYZ, white, { gain = 1, fit = false } = {}) {
  // Normalise so white maps to Y=1; adapt source-white → D65.
  const src = [XYZ.X / 100, XYZ.Y / 100, XYZ.Z / 100];
  const wS  = [white.X / 100, white.Y / 100, white.Z / 100];
  const wD  = [0.95047, 1.0, 1.08883]; // D65 reference white
  const lmsS = mul3(M_BFD, wS), lmsD = mul3(M_BFD, wD);
  const lms  = mul3(M_BFD, src);
  const adapted = mul3(M_BFD_INV,
    [lms[0]*lmsD[0]/lmsS[0], lms[1]*lmsD[1]/lmsS[1], lms[2]*lmsD[2]/lmsS[2]]);
  let rgb = mul3(M_XYZ_RGB, adapted);
  if (fit) {
    const peak = Math.max(rgb[0], rgb[1], rgb[2], 1e-12);
    rgb = rgb.map(v => Math.max(0, v) / peak);
  } else if (gain !== 1) {
    rgb = rgb.map(v => v * gain);
  }
  rgb = rgb.map(v => {
    v = Math.max(0, Math.min(1, v));
    v = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    return Math.round(Math.max(0, Math.min(1, v)) * 255);
  });
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}
