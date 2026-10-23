// A coated side's admittance locus at one wavelength, as the Admittance
// Diagram window draws it (admittanceDiagram/model.js) and tables it
// (admittanceDiagram/tableModel.js).

import { buildDiagramData, sideStackLayers } from '../components/windows/analysis/admittanceDiagram/model.js';
import { buildAdmittanceTableRows, buildMaterialNames } from '../components/windows/analysis/admittanceDiagram/tableModel.js';
import { ADMITTANCE_LAMBDA_NM } from '../components/windows/analysis/admittanceDiagram/sessionState.js';
import { sessionDefaults } from '../constants/analysisDefaults.js';
import { withHerpinRecords } from '../utils/materials/designMaterials.js';
import { designRangeCoverage } from '../utils/materials/materialRange.js';
import { requireResolved } from './materials.js';
import { requireLayers, scoredSide, viewWavelength } from './stackViews.js';
import { checkOptions, requireValue, isAngle } from './check.js';

const DEFAULTS = sessionDefaults('admittanceDiagram');
const isPlane = v => v === 'admittance' || v === 'reflection';
const complex = ([re, im]) => ({ re, im });

// A row of the window's table as a boundary of the locus.
const boundaryOf = (row, layer, material) => ({
    layer, material, name: row.material, Y: { re: row.re, im: row.im }, gamma: { re: row.gRe, im: row.gIm },
});

// One polarization's locus from the window's diagram data `series` and the
// rows of its table for it, `rows`: the substrate's row, one per layer, and
// the incident medium's, which closes the table and adds nothing to eta0.
function locusOf(series, rows, substrate) {
    return {
        eta0: complex(series.eta0),
        etaSubstrate: complex(series.etaS),
        boundaries: [boundaryOf(rows[0], 0, substrate), ...series.arcs.map((arc, i) => boundaryOf(rows[i + 1], arc.layerNum, arc.material))],
        arcs: series.arcs.map(arc => ({ layer: arc.layerNum, material: arc.material, re: arc.re, im: arc.im })),
    };
}

/**
 * The admittance locus of one coated side at one wavelength, for s and p, as
 * the [Admittance Diagram](/analysis/admittance/) window draws it and
 * lists it in its table. The locus starts at the substrate's admittance and
 * runs through the admittance reached at the outer surface of each layer, from
 * the substrate out, to the coating's outer surface, which is compared against the
 * medium light comes from. It is computed on the front, or on the back of a
 * design coated on the back alone, the side the PR, GD, PSI and EFMX merit
 * rows score, unless `side` is given. The design's cone of incidence is not
 * used, as the window does not use it.
 *
 * Complex values are `{ re, im }` in Macleod's sign, the one the window plots
 * and tables: the index of an absorbing material is n − ik, so its admittance
 * has a negative imaginary part, and a dielectric layer's locus runs clockwise
 * (Macleod, Thin-Film Optical Filters, 5th ed., ch. 3, Admittance Loci).
 * Admittances are in free-space units, the tilted admittance of each
 * polarization at an angle. The reflection coefficient of an admittance Y is
 * Γ = (η0 − Y) / (η0 + Y), so |Γ|² at the coating's outer surface is the
 * side's reflectance.
 *
 * @param design The design.
 * @param [options]
 * @param [options.wavelength] The wavelength, nm. Without it, the design's reference wavelength, as the window opens at it.
 * @param [options.angle=0] The angle of incidence, degrees in the medium light comes from, 0 up to but not including 90.
 * @param [options.side] `'front'` or `'back'`. Without it, the back of a design coated on the back alone and the front of any other.
 * @param [options.plane='admittance'] What the arcs are drawn in: `'admittance'`, the Y plane, or `'reflection'`, the plane of Γ, as the window's two views draw them.
 * @returns The loci.
 * @property mode The side computed: `'front'` or `'back'`.
 * @property wavelength The wavelength, nm.
 * @property angle The angle of incidence, degrees.
 * @property plane The plane the arcs are in: `'admittance'` or `'reflection'`.
 * @property incident The medium light comes from, `{ material, name }`: the incident medium on the front, the exit medium on the back; name as the window's table gives it.
 * @property substrate The substrate, `{ material, name }`.
 * @property s The s locus: `eta0`, the medium's admittance; `etaSubstrate`, the substrate's; `boundaries`, the window's table, one `{ layer, material, name, Y, gamma }` per boundary from the substrate out: layer 0 is the bare substrate, then each layer with a thickness by its Design Editor number, Y the admittance at its outer surface and gamma Γ there, the last at the coating's outer surface; `arcs`, one `{ layer, material, re, im }` per layer with a thickness, from the substrate out, `re` and `im` the points the window draws it through, in the plane chosen. A layer with no thickness has neither a boundary nor an arc.
 * @property p The p locus, as `s`.
 * @property outOfRange The materials of the side computed whose data do not reach the wavelength, each `{ id, name, rangeNm, heldFlat }`: their n and k there are held at the last value (`heldFlat` is `true`) or extrapolated.
 * @throws an option it does not take, a wavelength of 0 or less, an angle outside 0 to 90, a side other than `'front'` or `'back'`, or a plane other than `'admittance'` or `'reflection'`
 * @throws a side with no layers
 * @throws a design that names a material that resolves to nothing
 * @example
 * const design = tf.stackFromFormula(tf.newDesign({ name: 'Mirror' }), { formula: '(HL)^3 H' });
 * const { s, p } = tf.admittance(design, { wavelength: 550, angle: 45 });
 * const front = s.boundaries.at(-1);
 * console.log('Y at the front surface, s:', front.Y.re.toFixed(4), front.Y.im.toFixed(4));
 * console.log('Rs', (front.gamma.re ** 2 + front.gamma.im ** 2).toFixed(6), 'over', p.arcs.length, 'arcs');
 */
export function admittance(design, options) {
    const { wavelength, angle = DEFAULTS.theta, side, plane = DEFAULTS.view } = checkOptions('admittance', options, ['wavelength', 'angle', 'side', 'plane']);
    const mode = scoredSide('admittance', design, side);
    const lambda = viewWavelength('admittance', design, wavelength, ADMITTANCE_LAMBDA_NM);
    requireValue('admittance', 'angle', angle, isAngle, 'an angle of incidence in degrees, 0 <= angle < 90');
    requireValue('admittance', 'plane', plane, isPlane, "'admittance' or 'reflection'");
    requireLayers('admittance', design, mode);
    requireResolved(design);
    const shown = withHerpinRecords(design);
    // pol 'avg' gives both polarizations, s first, as the window computes them.
    const series = buildDiagramData(shown, { lambda_nm: lambda, theta_deg: angle, pol: 'avg', side: mode, view: plane });
    const names = buildMaterialNames(shown, sideStackLayers(shown, mode).filter(layer => layer.thickness > 0));
    const rows = buildAdmittanceTableRows(series, names, shown);
    const perPol = rows.length / series.length;
    const substrate = design.substrate?.material;
    const [s, p] = series.map((one, i) => locusOf(one, rows.slice(i * perPol, (i + 1) * perPol), substrate));
    return {
        mode, wavelength: lambda, angle, plane,
        incident: { material: mode === 'back' ? design.exitMedium : design.incidentMedium, name: rows[perPol - 1].material },
        substrate: { material: substrate, name: rows[0].material },
        s, p,
        outOfRange: designRangeCoverage(design, [lambda, lambda], mode).offenders,
    };
}
