// A material's own phase and its derivatives against wavelength, through a
// slab of it, as the Material Dispersion window computes them
// (utils/materials/materialDispersionSpectrum.js).

import { ANALYSIS_DEFAULTS, sessionDefaults } from '../constants/analysisDefaults.js';
import { materialDispersionRows, materialDispersionSpectrum } from '../utils/materials/materialDispersionSpectrum.js';
import { requireMaterial } from './materials.js';
import { checkOptions, checkRange, requireValue } from './check.js';

const DEFAULTS = sessionDefaults('materialDispersion');
// The slab thicknesses the window's field takes, mm; it clamps any other.
const THICKNESS = ANALYSIS_DEFAULTS.materialDispersion.numbers.thicknessMm;

/**
 * Phase, group delay, GDD, CDC and TOD of light through a slab of one
 * material, and the material's group index, against wavelength, as the
 * [Material Dispersion](/analysis/material-dispersion/) window computes them:
 * φ = −(d/c)·ω·n, GD = −dφ/dω, GDD = −d²φ/dω² and TOD = −d³φ/dω³ of the slab
 * of thickness d, the phase taken from n alone, CDC = GDD · 2πc/λ² in fs/nm,
 * with the sign of GDD, and the group index n − λ·dn/dλ. The values are
 * analytic at each wavelength, from the material's formula or its table read
 * as the app reads it, so the phase is absolute and needs no unwrapping.
 *
 * The wavelengths are the window's: 2000 steps over the range, never finer
 * than 0.2 nm, with a sample on each knot of the material's table in range
 * unless the knots are dense against the grid, more than one per 8 points.
 * Light that the slab absorbs to an optical depth above 50, 2πkd/λ, leaves no
 * value.
 *
 * @param id The material, by id.
 * @param [options]
 * @param [options.from=400] The first wavelength, nm.
 * @param [options.to=1100] The last wavelength, nm, above `from`.
 * @param [options.thickness=1] The slab's thickness, mm, from 1e-9 (1 pm) to 100000 (100 m), the thicknesses the window's field takes.
 * @param [design=null] A design, so that its own copies of materials count as they do when it computes, as materialNK takes it.
 * @returns The curves.
 * @property id The material's id.
 * @property name The material's name.
 * @property thickness The slab's thickness, mm.
 * @property wavelength The wavelengths, nm.
 * @property phase The phase φ at each wavelength, degrees.
 * @property gd The group delay at each wavelength, fs.
 * @property gdd The GDD at each wavelength, fs².
 * @property cdc The CDC at each wavelength, fs/nm: GDD · 2πc/λ², with the sign of GDD, so −dGD/dλ.
 * @property tod The TOD at each wavelength, fs³.
 * @property groupIndex The group index at each wavelength.
 * @property outside For each wavelength, the material's name where its value was taken outside the material's data, held at the edge or extrapolated, or `null`.
 * @property masked The wavelengths with no value, each `{ wavelength, reason, maximumThickness }`, `maximumThickness` the thickness in mm up to which the slab would have one there, or `null` when no thickness gives one, as where the material's model has no third derivative; every curve is NaN there.
 * @property knots The table knots that are wavelengths of the grid, each `{ wavelength, gd, gdd, tod, cdc }`, each quantity a pair `[left, right]` of its values on the two sides of the knot; the value at that wavelength reads the material averaged across the knot.
 * @property model The models the material's n and k come from, such as `'Table (PCHIP)'`, or `'n: Sellmeier (general); k: Table (PCHIP)'` when they differ.
 * @throws an option it does not take, a range that is not one, or a thickness outside 1e-9 to 100000 mm
 * @throws a material id that resolves to nothing, naming the closest ids
 * @example
 * const d = tf.materialDispersion('BK7', { from: 700, to: 900, thickness: 2 });
 * const at = d.wavelength.indexOf(800);
 * console.log('2 mm of BK7 at 800 nm: GDD', d.gdd[at].toFixed(1), 'fs², group index', d.groupIndex[at].toFixed(5));
 */
export function materialDispersion(id, options, design = null) {
    const {
        from = DEFAULTS.start, to = DEFAULTS.end, thickness = DEFAULTS.thicknessMm,
    } = checkOptions('materialDispersion', options, ['from', 'to', 'thickness']);
    // The window's grid holds at most 2001 points and the knots, so the range
    // is checked for itself alone.
    checkRange('materialDispersion', { from, to, step: to - from });
    requireValue('materialDispersion', 'thickness', thickness, v => Number.isFinite(v) && v >= THICKNESS.min && v <= THICKNESS.max,
        `a thickness in mm from ${THICKNESS.min} to ${THICKNESS.max}`);
    const material = requireMaterial(design, id);
    const spectrum = materialDispersionSpectrum(material, from, to, thickness);
    const rows = materialDispersionRows(spectrum);
    const column = key => rows.map(row => row[key]);
    return {
        id, name: spectrum.materialName, thickness,
        wavelength: spectrum.lambda,
        phase: column('phase'), gd: column('gd'), gdd: column('gdd'), cdc: column('cdc'), tod: column('tod'),
        groupIndex: column('groupIndex'),
        outside: rows.map(row => row.outside || null),
        masked: spectrum.invalid.map(({ wavelengthNm, reason, maximumThicknessMm }) => ({
            wavelength: wavelengthNm, reason, maximumThickness: Number.isFinite(maximumThicknessMm) ? maximumThicknessMm : null,
        })),
        knots: spectrum.knotSamples.map(({ wavelengthNm, gd, gdd, tod, cdc }) => ({ wavelength: wavelengthNm, gd, gdd, tod, cdc })),
        model: spectrum.model,
    };
}
