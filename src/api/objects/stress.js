// The stress each film carries and what the coating does to the part, as
// design.stress() answers.

import fs from 'node:fs';
import { inspect } from 'node:util';
import { filmColumns, filmRows } from '../../components/windows/analysis/stressAnalysis/tableModel.js';
import en from '../../constants/locales/en.js';

// The text of a CSV cell as the window's Copy CSV writes it (csvFromRows): a
// number as it is, a name with each comma made a semicolon, an empty cell for
// none.
const cell = value => (value == null ? '' : typeof value === 'number' ? String(value) : String(value).replace(/,/g, ';'));

// A film in the window's row names, which its table reads.
const windowRow = film => ({
    side: film.side, layerNumber: film.number, materialName: film.name, thicknessNm: film.thickness,
    stressMPa: film.stress, strainEnergy: film.strainEnergy, delamination: film.delamination, shearMPa: film.shear,
});

/**
 * The stress each film carries and what the coating does to the part, as
 * design.stress() computes them and the Stress window shows them: `s.films`
 * the per-film table and `s.whole` the whole part.
 *
 * @example
 * const design = tf.newDesign('Mirror');
 * design.stack('(HL)^4 H');
 * const s = design.stress();
 * console.log(s.mode, 'force', s.whole.force, 'N/m;', s.missing.map(m => m.material).join(', '), 'state no constants');
 */
export class Stress {
    constructor(result) {
        this._result = result;
    }

    /**
     * The coatings counted: `'front'`, `'back'` or `'total'`, both faces.
     *
     * @example
     * const design = tf.newDesign('Two-sided');
     * design.sides = 'both';
     * console.log(design.stress().mode);
     */
    get mode() { return this._result.mode; }

    /**
     * The temperatures, `{ temperature, depositionTemperature }` in °C, the
     * one not set reading 20, or null when the design sets neither and each
     * film carries its intrinsic stress alone.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.depositionTemperature = 250;
     * console.log(design.stress().run);
     */
    get run() { return this._result.run; }

    /**
     * The substrate, `{ material, thickness, diameter }`: the material by id,
     * the thickness and the diameter in mm, the diameter null when it is not
     * set.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.substrate.diameter = 25.4;
     * console.log(design.stress().substrate);
     */
    get substrate() { return this._result.substrate; }

    /**
     * The part: `force`, Σ σ·d over the films counted, N/m; `radius`, the
     * radius of curvature, m, null at no force; `deflection`, the centre
     * deflection, µm, null without a diameter; `strainEnergy`, the films'
     * total, J/m²; `cracking`, the sum over the films of U/2γ. With coatings
     * on both faces the force is F_front − F_back; a coating on one face alone
     * reads the same on the back as on the front. The radius and the
     * deflection are positive for the convex face a compressive coating
     * leaves. Each null when a constant it needs is missing; a film that
     * states no stress counts as carrying none.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^4 H');
     * console.log(design.stress().whole);
     */
    get whole() { return this._result.whole; }

    /**
     * One per film counted, front first, each `{ side, number, material,
     * name, thickness, stress, strainEnergy, delamination, shear }`: number
     * from 1 at the substrate, as `layers` numbers them; material by id and
     * name as the window shows it; thickness in nm; stress in MPa, tensile
     * positive; strainEnergy in J/m²; delamination, at 1 the energy to let go
     * at the interface below the film; shear, the peak shear at the coating's
     * edge, MPa. stress is null when the material states none, and the
     * others then count the film as carrying none; each is null when another
     * constant it needs is missing.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^2 H');
     * for (const film of design.stress().films) console.log(film.number, film.name, film.thickness.toFixed(2), 'nm', film.stress);
     */
    get films() { return this._result.films; }

    /**
     * The materials that leave a constant out, the substrate's included, an
     * array of `{ material, name, fields }`: material by id, and fields the
     * constants it lacks by their names on the material's mechanical record.
     * Empty when every material states every constant.
     *
     * @example
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^2 H');
     * for (const m of design.stress().missing) console.log(m.material, m.fields.join(', '));
     */
    get missing() { return this._result.missing; }

    /**
     * Writes the films to a CSV file as the window's Copy CSV writes its
     * per-film table: the side when both faces are counted, then the layer,
     * the material, d (nm), the stress (MPa), U (J/m²), the delamination
     * factor and the edge shear (MPa), an empty cell where a constant is
     * missing. A file that is there is written over.
     *
     * @param path The file to write, by its full path. A relative path is taken from the folder the program was started from: in the Script Console, the folder TFStudio was started from, often its install folder.
     * @example
     * const file = require('path').join(require('os').homedir(), `stress-${Date.now()}.csv`);
     * const design = tf.newDesign('Mirror');
     * design.stack('(HL)^4 H');
     * design.stress().saveCsv(file);
     * console.log('Wrote', file);
     */
    saveCsv(path) {
        const sa = en.stressAnalysis;
        const rows = filmRows(this._result.films.map(windowRow), sa);
        const columns = filmColumns(sa, rows.some(row => row.side === 'front') && rows.some(row => row.side === 'back'));
        const lines = [columns.map(column => column.label), ...rows.map(row => columns.map(column => cell(row[column.key])))];
        fs.writeFileSync(path, lines.map(line => line.join(',')).join('\n'), 'utf8');
    }

    // What console.log prints for the result.
    [inspect.custom]() {
        const { mode, films, whole, missing } = this._result;
        return `<Stress ${mode}: ${films.length} film${films.length === 1 ? '' : 's'}, force ${whole.force} N/m, ${missing.length} material${missing.length === 1 ? '' : 's'} missing constants>`;
    }
}
