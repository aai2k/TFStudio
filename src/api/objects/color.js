// The CIE colour of a design's reflectance or transmittance, as
// design.color() answers.

import { inspect } from 'node:util';

/**
 * The CIE colour of a design's reflectance or transmittance, as
 * design.color() computes it and the Color Evaluation window shows it: the
 * tristimulus values on the 380-780 nm band under one illuminant, the colour
 * spaces, the dominant wavelength, the correlated colour temperature and the
 * sRGB swatch.
 *
 * @example
 * const design = tf.newDesign('Mirror');
 * design.stack('(HL)^3 H');
 * const c = design.color({ illuminant: 'D50' });
 * console.log(c.mode, c.x.toFixed(4), c.y.toFixed(4), c.lab);
 */
export class Color {
    constructor(colour) {
        this._colour = colour;
    }

    /**
     * The sides computed: `'front'`, `'back'` or `'total'`, the whole part.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * console.log(design.color().mode);
     */
    get mode() { return this._colour.mode; }

    /**
     * What is coloured: `'R'` or `'T'`.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * console.log(design.color({ quantity: 'T' }).quantity);
     */
    get quantity() { return this._colour.quantity; }

    /**
     * The angle of incidence, degrees in the incident medium.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * console.log(design.color({ angle: 30 }).angle, 'degrees');
     */
    get angle() { return this._colour.angle; }

    /**
     * The polarization: `'avg'`, `'s'` or `'p'`.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * console.log(design.color({ angle: 45, pol: 's' }).pol);
     */
    get pol() { return this._colour.pol; }

    /**
     * The CIE standard observer, by its field in degrees: `2` or `10`.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * console.log(design.color({ observer: 10 }).observer);
     */
    get observer() { return this._colour.observer; }

    /**
     * The CIE illuminant: `'D65'`, `'D50'`, `'A'` or `'E'`.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * console.log(design.color({ illuminant: 'A' }).illuminant);
     */
    get illuminant() { return this._colour.illuminant; }

    /**
     * The wavelength step of the spectrum the colour is integrated on, nm.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * console.log(design.color({ step: 1 }).step, 'nm');
     */
    get step() { return this._colour.step; }

    /**
     * The tristimulus X, on the scale where the white's Y is 100.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * console.log(design.color().X);
     */
    get X() { return this._colour.X; }

    /**
     * The tristimulus Y: the luminous reflectance or transmittance, %.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * console.log('luminous R', design.color().Y.toFixed(2), '%');
     */
    get Y() { return this._colour.Y; }

    /**
     * The tristimulus Z, on the scale where the white's Y is 100.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * console.log(design.color().Z);
     */
    get Z() { return this._colour.Z; }

    /**
     * The chromaticity x.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * console.log(design.color().x.toFixed(4));
     */
    get x() { return this._colour.x; }

    /**
     * The chromaticity y.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * console.log(design.color().y.toFixed(4));
     */
    get y() { return this._colour.y; }

    /**
     * The illuminant's white, `{ X, Y, Z }` with Y 100: R or T of 1,
     * integrated on the same grid.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * console.log(design.color({ illuminant: 'D50' }).white);
     */
    get white() { return this._colour.white; }

    /**
     * The white's chromaticity, `{ x, y }`.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * console.log(design.color().whiteXy);
     */
    get whiteXy() { return this._colour.whiteXy; }

    /**
     * CIE L*a*b*, `{ L, a, b, C, h }`, the hue angle h in degrees.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * const { L, a, b } = design.color().lab;
     * console.log(L.toFixed(2), a.toFixed(2), b.toFixed(2));
     */
    get lab() { return this._colour.lab; }

    /**
     * CIE L*u*v*, `{ L, u, v, C, h, s }`, the hue angle h in degrees and s
     * the saturation.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * console.log(design.color().luv);
     */
    get luv() { return this._colour.luv; }

    /**
     * The CIE 1976 UCS chromaticity, `{ u, v }`: u′ and v′.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * console.log(design.color().uv1976);
     */
    get uv1976() { return this._colour.uv1976; }

    /**
     * The CIE 1960 UCS chromaticity, `{ u, v }`.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * console.log(design.color().uv1960);
     */
    get uv1960() { return this._colour.uv1960; }

    /**
     * Hunter Lab, `{ L, a, b }`.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * console.log(design.color().hunterLab);
     */
    get hunterLab() { return this._colour.hunterLab; }

    /**
     * `{ wavelength, complementary, purity }`: the dominant wavelength in nm,
     * or for a purple null and its complementary wavelength in nm; purity the
     * excitation purity as a fraction of 1, measured to the purple line for a
     * purple. Both wavelengths are null for the white itself.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * const { wavelength, complementary, purity } = design.color().dominant;
     * console.log(wavelength ?? `complementary ${complementary}`, 'nm, purity', purity.toFixed(3));
     */
    get dominant() { return this._colour.dominant; }

    /**
     * The correlated colour temperature, K, by McCamy's formula on the 2
     * degree chromaticity whatever the observer; NaN outside the 1000 K to
     * 1e6 K it covers, or more than 0.05 from the Planckian locus.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('HL');
     * console.log(design.color({ quantity: 'T' }).cct.toFixed(0), 'K');
     */
    get cct() { return this._colour.cct; }

    /**
     * The distance from the Planckian locus in CIE 1960 u, v, positive above
     * it; NaN outside the range McCamy's formula covers.
     *
     * @example
     * const design = tf.newDesign('AR');
     * design.stack('HL');
     * console.log(design.color({ quantity: 'T' }).duv.toFixed(4));
     */
    get duv() { return this._colour.duv; }

    /**
     * The window's swatch, `{ r, g, b }`, each 0 to 255: sRGB at an exposure
     * of 1, adapted from the illuminant's white to D65.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * const { r, g, b } = design.color().srgb;
     * console.log(`rgb(${r}, ${g}, ${b})`);
     */
    get srgb() { return this._colour.srgb; }

    /**
     * The materials of the sides computed whose data stop inside 380-780
     * nm, an array of `{ id, name, rangeNm, heldFlat }`: outside `rangeNm`
     * their n and k are held at the last value (`heldFlat` true) or
     * extrapolated. Empty when every material covers the band.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^3 H');
     * console.log(design.color().outOfRange.map(m => m.id));
     */
    get outOfRange() { return this._colour.outOfRange; }

    // What console.log prints for the colour.
    [inspect.custom]() {
        const { mode, quantity, illuminant, observer, x, y, Y } = this._colour;
        return `<Color ${quantity} ${mode}, ${illuminant} ${observer} degrees: x ${x.toFixed(4)}, y ${y.toFixed(4)}, Y ${Y.toFixed(3)}>`;
    }
}
