/**
 * Structural and physical checks on a coating library entry.
 *
 * An entry with no problems can be evaluated and shown. An empty list does
 * not mean the specification passes: `entrySpecResults` answers that.
 */
import { designMaterialIds, resolveDesignMaterial } from '../materials/designMaterials.js';
import { designRangeCoverage } from '../materials/materialRange.js';
import { COATING_TYPES, entryDesign, slugify } from './entryModel.js';

function isRange(range) {
    if (!Array.isArray(range)) return false;
    const [from, to] = range;
    const startsPositive = Number.isFinite(from) && from > 0;
    return startsPositive && Number.isFinite(to) && to > from;
}

function identityProblems(entry) {
    const problems = [];
    if (!entry.id || entry.id !== slugify(entry.id)) problems.push(`id "${entry.id}" is not a slug`);
    if (!entry.name) problems.push('name is empty');
    if (!COATING_TYPES.includes(entry.type)) {
        problems.push(`type "${entry.type}" is not one of ${COATING_TYPES.join(', ')}`);
    }
    for (const tag of entry.tags) {
        if (tag !== slugify(tag)) problems.push(`tag "${tag}" is not a slug`);
    }
    return problems;
}

function layerProblems(layers) {
    if (layers.length === 0) return ['no layers'];
    const problems = [];
    layers.forEach((layer, i) => {
        if (!layer.material) problems.push(`layer ${i + 1} has no material`);
        if (!(Number.isFinite(layer.thickness) && layer.thickness > 0)) {
            problems.push(`layer ${i + 1} thickness ${layer.thickness} is not a positive number`);
        }
    });
    return problems;
}

function conditionProblems(entry) {
    const problems = [];
    for (const band of entry.bands) {
        if (!isRange(band)) problems.push(`band [${band}] is not an increasing positive range`);
    }
    if (entry.preview && !isRange(entry.preview)) {
        problems.push(`preview [${entry.preview}] is not an increasing positive range`);
    }
    if (!(entry.aoi >= 0 && entry.aoi < 90)) problems.push(`aoi ${entry.aoi} is outside 0-90 degrees`);
    if (!(entry.referenceWavelength > 0)) problems.push('reference wavelength must be positive');
    return problems;
}

// Outside its data a material is held flat or extrapolated, so a claim made
// there is a claim about numbers nobody measured. Each design band is checked;
// the gaps between bands carry no claims and are not.
function materialProblems(entry) {
    const design = entryDesign(entry);
    const problems = designMaterialIds(design)
        .filter(id => resolveDesignMaterial(design, id).status === 'missing')
        .map(id => `material "${id}" cannot be resolved`);
    for (const band of entry.bands.filter(isRange)) {
        for (const { id, rangeNm } of designRangeCoverage(design, band).offenders) {
            problems.push(`material "${id}" has data on ${rangeNm[0].toFixed(0)}-${rangeNm[1].toFixed(0)} nm, `
                + `the band ${band[0]}-${band[1]} nm reaches outside it`);
        }
    }
    return problems;
}

/** Every problem with the entry, as message strings; empty when it is sound. */
export function validateEntry(entry) {
    return [
        ...identityProblems(entry),
        ...layerProblems(entry.layers),
        ...conditionProblems(entry),
        ...materialProblems(entry),
    ];
}
