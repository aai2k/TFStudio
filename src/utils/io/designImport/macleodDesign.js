/**
 * macleodDesign.js: Essential Macleod design (.dds) reader.
 *
 * A .dds file is XML with the root <EssentialMacleodDesign>. The parts that
 * describe the coating:
 *   <Parameters>
 *     <ReferenceWavelength>, <ThicknessType> O (full-wave optical) or P (physical),
 *     <IncidentAngle>, <Unit Name="Wavelength"><ScaleFactor> (1E-9 for nm)
 *   <Medium>, <Substrate>          material names; a bare number is a constant index
 *   <Layers><Layer LayerNumber="i">
 *     <Material>, <Thickness>, <PackingDensity>, <VoidMaterial>, <VoidDensity>, <Link>, <Lock>
 *   <Formula><Formula>text</Formula><Symbols>…   the stack formula, if any
 *   <Notes>
 * Targets, refinement settings, plot contexts and the like describe the
 * session and are skipped.
 *
 * Conventions (Essential Macleod manual, Conventions, p. 19 to 21, and The
 * Essential Macleod Structure, p. 30 to 31):
 *   layer 1 is next to the incident medium;
 *   an optical thickness is in full waves at the reference wavelength, so
 *   the physical thickness is d = T λ0 / n(λ0) with n the index the layer
 *   actually has, packing density included;
 *   the substrate is the emergent medium, so the design has no exit medium
 *   and the substrate is semi-infinite.
 *
 * A layer with a packing density other than 1 is the program's variable-index
 * mechanism: a rugate is modeled as a set of layers whose packing density
 * varies (manual, Modeling a Rugate, p. 102). TFStudio has no graded or
 * packed layer, so a design that uses one is refused.
 *
 * Output is the neutral imported-design description shared with the TFCalc
 * reader, with layers in TFStudio front storage order (incident medium
 * first). Optical thicknesses stay as full-wave values here; they become
 * nanometres once the materials are resolved.
 */

function unescapeXml(s) {
    return s.replace(/&(amp|lt|gt|quot|apos|#(\d+));/g, (m, e, d) =>
        e === 'amp' ? '&' : e === 'lt' ? '<' : e === 'gt' ? '>' : e === 'quot' ? '"' : e === 'apos' ? "'" : String.fromCharCode(+d));
}

// Text of the first <name> element inside `text`, trimmed; null when absent.
function textOf(text, name) {
    const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(text);
    return m ? unescapeXml(m[1]).trim() : null;
}

// Inner text of the first <name> element, null when absent. Attributes on the
// tag are allowed.
function innerOf(text, name) {
    const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(text);
    return m ? m[1] : null;
}

// Inner text of the first <name attr="value"> element. The block may hold a
// child element of the same name (a <Unit Name="…"> block has a <Unit> child
// naming the unit), so the closing tag is found by depth, not by the first
// </name>.
function blockNamed(text, name, attrValue) {
    const open = new RegExp(`<${name}\\s+Name="${attrValue}"[^>]*>`).exec(text);
    if (!open) return null;
    const start = open.index + open[0].length;
    const tags = new RegExp(`<(/?)${name}(?=[\\s>/])[^>]*>`, 'g');
    tags.lastIndex = start;
    let depth = 1;
    for (let m = tags.exec(text); m; m = tags.exec(text)) {
        if (m[0].endsWith('/>')) continue;
        depth += m[1] ? -1 : 1;
        if (depth === 0) return text.slice(start, m.index);
    }
    return null;
}

const num = v => (v == null || v === '') ? NaN : Number(v);

// Names Essential Macleod accepts as a constant refractive index.
export function isConstantIndexName(name) {
    return /^\s*\d*\.?\d+\s*$/.test(name || '');
}

// Nanometres per wavelength unit of the file. Essential Macleod's default
// unit is the nanometre; a file that names no unit is read that way and says
// so in its notes, unless its reference wavelength cannot be nanometres.
function wavelengthScale(params, fileName, notes) {
    const unit = blockNamed(params, 'Unit', 'Wavelength');
    if (!unit) {
        if (!(num(textOf(params, 'ReferenceWavelength')) >= 100)) {
            throw new Error(`"${fileName}" names no wavelength unit and its reference wavelength is not in nanometres`);
        }
        notes.push({ code: 'unitAssumed' });
        return 1;
    }
    const factor = num(textOf(unit, 'ScaleFactor'));
    if (!(factor > 0)) throw new Error(`"${fileName}": the wavelength unit has no scale factor`);
    // Metres per unit → nanometres per unit.
    return factor * 1e9;
}

function readLayer(inner, index, thicknessType, toNm, fileName) {
    const material = textOf(inner, 'Material');
    const thickness = num(textOf(inner, 'Thickness'));
    if (!material || !Number.isFinite(thickness)) {
        throw new Error(`"${fileName}": layer ${index} has no material or thickness`);
    }
    const density = textOf(inner, 'PackingDensity');
    const p = density == null ? 1 : num(density);
    if (Number.isFinite(p) && p !== 1) {
        throw new Error(`"${fileName}" uses packing density (layer ${index}), the program's rugate and variable-index mechanism, which TFStudio does not model`);
    }
    const link = num(textOf(inner, 'Link') ?? '0');
    return {
        material,
        thicknessNm: thicknessType === 'P' ? toNm(thickness) : null,
        optical: thicknessType === 'P' ? null : { kind: 'fwot', value: thickness },
        locked: /^yes$/i.test(textOf(inner, 'Lock') || ''),
        link: link > 0 ? link : 0,
    };
}

/**
 * @param {string} text      file content
 * @param {string} fileName  used for the design name and messages
 * @returns {object} imported-design description (see designFileImport.js)
 */
export function parseMacleodDesign(text, fileName) {
    if (!/<EssentialMacleodDesign[\s>]/.test(text)) throw new Error(`"${fileName}" is not an Essential Macleod design file`);
    const params = innerOf(text, 'Parameters') || '';
    const notes = [];
    const nmPerUnit = wavelengthScale(params, fileName, notes);
    const toNm = w => w * nmPerUnit;

    const referenceWavelengthNm = toNm(num(textOf(params, 'ReferenceWavelength')));
    if (!(referenceWavelengthNm > 0)) throw new Error(`"${fileName}" has no reference wavelength`);
    const thicknessType = (textOf(params, 'ThicknessType') || 'O').toUpperCase();
    if (thicknessType !== 'O' && thicknessType !== 'P') {
        throw new Error(`"${fileName}" uses thickness type ${thicknessType}, which this reader does not know`);
    }
    const angleDeg = num(textOf(params, 'IncidentAngle'));

    const incidentMedium = textOf(text, 'Medium');
    const substrate = textOf(text, 'Substrate');
    if (!incidentMedium || !substrate) throw new Error(`"${fileName}" names no medium or substrate`);

    const layersBlock = innerOf(text, 'Layers');
    const layerMatches = layersBlock ? [...layersBlock.matchAll(/<Layer\s+LayerNumber="(\d+)"[^>]*>([\s\S]*?)<\/Layer>/g)] : [];
    const front = layerMatches
        .map(m => ({ index: Number(m[1]), layer: readLayer(m[2], m[1], thicknessType, toNm, fileName) }))
        .sort((a, b) => a.index - b.index)
        .map(x => x.layer);
    if (front.length === 0) throw new Error(`"${fileName}" has no layers`);

    const constants = Object.create(null);
    for (const name of [incidentMedium, substrate, ...front.map(l => l.material)]) {
        if (isConstantIndexName(name)) constants[name] = Number(name);
    }

    const formulaBlock = /<Formula>\s*<Formula>([\s\S]*?)<\/Formula>/.exec(text);
    const formula = formulaBlock ? unescapeXml(formulaBlock[1]).trim() || null : null;
    const symbols = {};
    const symbolsBlock = innerOf(text, 'Symbols');
    if (symbolsBlock) {
        for (const m of symbolsBlock.matchAll(/<Symbol\s[^>]*>([\s\S]*?)<\/Symbol>/g)) {
            const name = textOf(m[1], 'Name'), material = textOf(m[1], 'Material');
            if (name && material) symbols[name] = material;
        }
    }

    const links = new Set(front.map(l => l.link).filter(Boolean));
    if (links.size > 0) notes.push({ code: 'linkedLayers', count: links.size });
    const targets = (text.match(/<Target\s[^>]*>/g) || []).length;
    if (targets > 0) notes.push({ code: 'targets', count: targets });
    const comments = [textOf(text, 'Notes')].filter(Boolean);

    const horizontal = blockNamed(text, 'HorizontalParameters', 'Wavelength');
    const lo = horizontal ? toNm(num(textOf(horizontal, 'Min'))) : NaN;
    const hi = horizontal ? toNm(num(textOf(horizontal, 'Max'))) : NaN;

    return {
        name: fileName.replace(/\.[^.]*$/, ''),
        program: 'macleod',
        file: fileName,
        referenceWavelengthNm,
        incidentMedium,
        substrate,
        substrateThicknessMm: null,
        exitMedium: null,
        backSurface: false,
        front,
        back: [],
        angleDeg: Number.isFinite(angleDeg) ? angleDeg : 0,
        matchAngleDeg: 0,
        matchMedium: 1,
        formula,
        symbols,
        constants,
        embedded: Object.create(null),
        comments,
        notes,
        spectrum: lo > 0 && hi > lo ? { fromNm: lo, toNm: hi } : null,
    };
}
