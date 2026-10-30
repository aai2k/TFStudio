// The CIE colour of a design's reflectance or transmittance, as the Color
// Evaluation window computes it (colorEvaluation/colorModel.js, physics in
// utils/physics/colorimetry.js).

import { responseSpectrum } from '../components/windows/analysis/colorEvaluation/colorModel.js';
import { sessionDefaults } from '../constants/analysisDefaults.js';
import { embedDesignMaterials, withHerpinRecords } from '../utils/materials/designMaterials.js';
import { designRangeCoverage } from '../utils/materials/materialRange.js';
import { colorReport, COLOR_RANGE_NM, ILLUMINANTS, OBSERVERS } from '../utils/physics/colorimetry.js';
import { makeConeSpec, coneIsActive } from '../utils/physics/optimizer.js';
import { requireResolved } from './materials.js';
import { requireKernel } from './environment.js';
import { viewSide } from './stackViews.js';
import { checkOptions, checkRange, requireValue, isAngle } from './check.js';

const DEFAULTS = sessionDefaults('colorEvaluation');
const OBSERVER_DEGREES = OBSERVERS.map(o => Number(o.id));
const ILLUMINANT_IDS = ILLUMINANTS.map(i => i.id);
const orList = words => `${words.slice(0, -1).join(', ')} or ${words.at(-1)}`;
const quoted = words => words.map(w => `'${w}'`);

// The swatch's 'rgb(r, g, b)' as its three channels, 0 to 255.
function channels(rgb) {
    const [r, g, b] = rgb.match(/\d+/g).map(Number);
    return { r, g, b };
}

/**
 * The CIE colour of a design's reflectance or transmittance, as the
 * [Color Evaluation](/analysis/color-evaluation/) window computes it: the tristimulus
 * values of R or T on the 380-780 nm band, where the CIE observer tables are
 * defined, under one illuminant, and the colour spaces, dominant wavelength,
 * correlated colour temperature and sRGB swatch the window shows. The sides
 * follow the design's [evaluation mode](/design/evaluation-modes/), as
 * `spectrum` does, unless `side` is given, and a design under a cone of
 * incidence is averaged over its cone, as the window averages it. A side with
 * no layers gives the colour of its bare surface.
 *
 * Y is the luminous reflectance or transmittance in % (Macleod, Thin-Film
 * Optical Filters, 5th ed., Eq. 12.2), so Y / 100 for T under D65 with the
 * 2 degree observer is the Integral Values window's Tvis when its grid has
 * this one's wavelengths on 380-780 nm, as the two default grids do. The
 * white is the illuminant's own, R or T of 1, integrated on the same grid. CCT
 * and Duv come from the 2 degree chromaticity whatever the observer, as CIE
 * 15:2004 defines them.
 *
 * @param design The design.
 * @param [options]
 * @param [options.quantity='R'] What is coloured: `'R'` or `'T'`.
 * @param [options.angle=0] The angle of incidence, degrees in the incident medium, 0 up to but not including 90; the cone's axis on a design under a cone.
 * @param [options.pol='avg'] The polarization: `'avg'`, unpolarized, `'s'` or `'p'`.
 * @param [options.observer=2] The CIE standard observer, by its field in degrees: `2` (CIE 1931) or `10` (CIE 1964).
 * @param [options.illuminant='D65'] The CIE illuminant: `'D65'`, `'D50'`, `'A'` or `'E'`.
 * @param [options.step=0.5] The wavelength step of the spectrum the colour is integrated on, nm.
 * @param [options.side] `'front'`, `'back'` or `'total'`, the whole part. Without it, what the design is scored on.
 * @returns The colour.
 * @property mode The sides computed: `'front'`, `'back'` or `'total'`.
 * @property quantity `'R'` or `'T'`.
 * @property angle The angle of incidence, degrees.
 * @property pol The polarization.
 * @property observer The observer, `2` or `10`.
 * @property illuminant The illuminant.
 * @property step The wavelength step, nm.
 * @property X The tristimulus X, with Y and Z, the white's Y being 100.
 * @property Y The tristimulus Y: the luminous R or T, %.
 * @property Z The tristimulus Z.
 * @property x The chromaticity x.
 * @property y The chromaticity y.
 * @property white The illuminant's white, `{ X, Y, Z }`, Y 100.
 * @property whiteXy The white's chromaticity, `{ x, y }`.
 * @property lab CIE L*a*b*, `{ L, a, b, C, h }`, h in degrees.
 * @property luv CIE L*u*v*, `{ L, u, v, C, h, s }`, h in degrees.
 * @property uv1976 The CIE 1976 UCS chromaticity u′ and v′, `{ u, v }`.
 * @property uv1960 The CIE 1960 UCS chromaticity, `{ u, v }`.
 * @property hunterLab Hunter Lab, `{ L, a, b }`.
 * @property dominant `{ wavelength, complementary, purity }`: the dominant wavelength in nm, or for a purple null and its complementary wavelength in nm; purity the excitation purity as a fraction of 1, measured to the purple line for a purple (Macleod Eq. 12.6). Both wavelengths are null for the white itself.
 * @property cct The correlated colour temperature, K, by McCamy's formula; NaN outside the 1000 K to 1e6 K it covers, or more than 0.05 from the Planckian locus.
 * @property duv The distance from the Planckian locus in CIE 1960 u, v, positive above it; NaN outside the range McCamy's formula covers.
 * @property srgb The window's swatch, `{ r, g, b }`, each 0 to 255: sRGB at an exposure of 1, adapted from the illuminant's white to D65.
 * @property outOfRange The materials of the sides computed whose data stop inside 380-780 nm, each `{ id, name, rangeNm, heldFlat }`: outside `rangeNm` their n and k are held at the last value (`heldFlat` is `true`) or extrapolated.
 * @throws an option it does not take, a quantity, polarization, observer, illuminant or side it does not have, an angle outside 0 to 90, a step of 0 or less, or more than a million wavelengths
 * @throws a design that names a material that resolves to nothing
 * @example
 * const design = tf.stackFromFormula(tf.newDesign({ name: 'Mirror' }), { formula: '(HL)^3 H' });
 * const c = tf.color(design, { quantity: 'R', illuminant: 'D65' });
 * console.log('x', c.x.toFixed(4), 'y', c.y.toFixed(4), 'Y', c.Y.toFixed(2), '%');
 * console.log('L*a*b*', c.lab.L.toFixed(2), c.lab.a.toFixed(2), c.lab.b.toFixed(2), 'dominant', c.dominant.wavelength?.toFixed(1), 'nm');
 */
export function color(design, options) {
    const {
        quantity = DEFAULTS.characteristic, angle = DEFAULTS.theta, pol = DEFAULTS.pol, observer = Number(DEFAULTS.observer),
        illuminant = DEFAULTS.illuminant, step = DEFAULTS.step, side,
    } = checkOptions('color', options, ['quantity', 'angle', 'pol', 'observer', 'illuminant', 'step', 'side']);
    requireValue('color', 'quantity', quantity, v => v === 'R' || v === 'T', "'R' or 'T'");
    requireValue('color', 'angle', angle, isAngle, 'an angle of incidence in degrees, 0 <= angle < 90');
    requireValue('color', 'pol', pol, v => ['avg', 's', 'p'].includes(v), "'avg', 's' or 'p'");
    // colorimetry.js reads any observer but 10 as 2 and any illuminant it
    // does not have as D65, so a name it does not have is refused here.
    requireValue('color', 'observer', observer, v => OBSERVER_DEGREES.includes(v), orList(OBSERVER_DEGREES));
    requireValue('color', 'illuminant', illuminant, v => ILLUMINANT_IDS.includes(v), orList(quoted(ILLUMINANT_IDS)));
    checkRange('color', { from: COLOR_RANGE_NM[0], to: COLOR_RANGE_NM[1], step });
    const shown = withHerpinRecords(design);
    const mode = viewSide('color', shown, side);
    requireResolved(design);
    requireKernel();
    // Under a cone the window computes in the analysis worker, on the design
    // with its materials embedded, as the worker receives it.
    const computed = coneIsActive(makeConeSpec(shown.cone || {})) ? embedDesignMaterials(shown) : shown;
    const spectrum = responseSpectrum(computed, { evalMode: mode, characteristic: quantity, pol, theta: angle, step });
    const report = colorReport(spectrum, { observer: String(observer), illuminant });
    return {
        mode, quantity, angle, pol, observer, illuminant, step,
        ...report.XYZ, ...report.xy,
        white: report.white, whiteXy: report.whiteXy,
        lab: report.Lab, luv: report.Luv,
        uv1976: { u: report.uvP.up, v: report.uvP.vp }, uv1960: report.uv60,
        hunterLab: report.Hunter,
        dominant: { wavelength: report.dom.dom, complementary: report.dom.comp, purity: report.dom.purity },
        cct: report.cct.cct, duv: report.cct.duv,
        srgb: channels(report.rgb),
        outOfRange: designRangeCoverage(shown, COLOR_RANGE_NM, mode).offenders,
    };
}
