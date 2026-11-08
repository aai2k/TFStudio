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

// The sRGB transfer curve, linear 0..1 to encoded 0..1 (IEC 61966-2-1).
function encode(v) {
  return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

/**
 * Chromaticities x, y of the sRGB primaries and white, IEC 61966-2-1. The
 * matrix above takes each primary to one channel alone and the white to equal
 * channels.
 */
export const SRGB_PRIMARIES = {
  red: { x: 0.64, y: 0.33 }, green: { x: 0.30, y: 0.60 }, blue: { x: 0.15, y: 0.06 },
  white: { x: 0.3127, y: 0.3290 },
};

/**
 * The colour a chromaticity diagram is filled with at x, y: the chromaticity as
 * an sRGB display shows it, at full brightness. Returns [r, g, b], each 0 to
 * 255, or null where y is not positive.
 *
 * Linear sRGB of the stimulus first. A chromaticity outside the sRGB primaries
 * has a negative channel; equal parts of R, G and B, which is the display's D65
 * white, are added until none is negative. Adding white moves the point
 * straight toward the D65 white point, so the colour shown keeps the dominant
 * wavelength, measured from D65, of the chromaticity it stands for and gives
 * up purity only: a
 * colour is its spectral line mixed with white (Macleod, Thin-Film Optical
 * Filters, 5th ed., §12.2). The brightest channel is then set to 1 and the
 * result encoded with the sRGB transfer curve.
 *
 * There is no chromatic adaptation: each chromaticity is shown as a D65 display
 * shows it, whatever illuminant the colour was computed under. The sRGB matrix
 * is defined on the 1931 2° observer, so on a 10° diagram the fill is that
 * matrix applied to 10° chromaticities, which is close but not exact.
 */
export function chromaticityDisplayRgb(x, y) {
  if (!(y > 0)) return null;
  const linear = mul3(M_XYZ_RGB, [x / y, 1, (1 - x - y) / y]);
  const low = Math.min(linear[0], linear[1], linear[2]);
  const lifted = low < 0 ? linear.map(v => v - low) : linear;
  const peak = Math.max(lifted[0], lifted[1], lifted[2]);
  if (!(peak > 0)) return null;
  return lifted.map(v => Math.round(encode(v / peak) * 255));
}

/**
 * sRGB swatch for the sample, Bradford-adapted from the source illuminant
 * white to D65 so the patch shows the perceived colour under that source.
 * Returns 'rgb(r,g,b)' (clamped, gamut-projected by clipping).
 *
 * Without `fit` the swatch is scaled relative to a perfect (100%) white
 * reflector, so a near-zero luminance renders as black: faithful, but it hides
 * the hue. A strong antireflection coating, for example, has a saturated but
 * extremely dim reflected colour; against a bright source the eye still reads
 * that hue, which a fixed-reference patch cannot show.
 *   - `fit`: normalise the sample's linear RGB to its peak channel, showing the
 *     hue at full brightness independent of luminance.
 */
export function xyzToSRGB(XYZ, white, { fit = false } = {}) {
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
  }
  rgb = rgb.map(v => Math.round(encode(Math.max(0, Math.min(1, v))) * 255));
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}
