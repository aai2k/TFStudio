import { makeDefaultDesign } from '../../../../utils/io/newDesign.js';
import { mirrorLayers } from '../../../../utils/physics/optimizer.js';
import { buildStackFromFormula } from '../../../../utils/synthesis/stackFormula.js';

function reId(layers, pfx) { return layers.map((l, i) => ({ ...l, id: `${pfx}${i}` })); }

// New-design object for the "New" apply mode. compiled.layers are in FRONT
// storage order (ambient→substrate); the back stack stores substrate→exit,
// so the same physical coating on the back is mirrorLayers(front) (reversed)
// — matching the Design Editor, where both sides list the substrate-touching
// layer first.
export function buildNewDesignFromFormula({
    newName, refLambda, incidentMat, substrateMat, exitMat, effSide,
    text, symbolMap, startFromSubstrate, resolvers, sourceMaterials,
}) {
    const base = makeDefaultDesign(newName);
    const seed = base.id;
    const rb = buildStackFromFormula({
        text, symbolMap, refLambda, startFromSubstrate, idSeed: seed, resolvers,
    });
    const f = rb.layers;
    const b = mirrorLayers(rb.layers, `b-${seed}-`);
    let frontLayers = [], backLayers = [], surfaceMode = 'front_only';
    if (effSide === 'front')      { frontLayers = f; surfaceMode = 'front_only'; }
    else if (effSide === 'back')  { backLayers = b;  surfaceMode = 'back_only'; }
    else                          { frontLayers = f; backLayers = b; surfaceMode = 'both_independent'; }
    return {
        ...base, name: newName, referenceWavelength: refLambda,
        incidentMedium: incidentMat, exitMedium: exitMat,
        substrate: { ...base.substrate, material: substrateMat },
        ...(sourceMaterials ? { materials: sourceMaterials } : {}),
        surfaceMode, frontLayers, backLayers, stackFormula: text,
        notes: `Generated from stack formula (${effSide}):\n${text}\nλ₀ = ${refLambda} nm`,
    };
}

function patchSymmetric({ design, mode, compiled, refLambda, substrateMat, incidentMat, text, stamp }) {
    const patch = {};
    if (mode === 'replace') {
        patch.referenceWavelength = refLambda;
        patch.substrate = { ...design.substrate, material: substrateMat };
        patch.stackFormula = text;
        patch.incidentMedium = incidentMat;
    }
    const f = mode === 'replace' ? compiled.layers : appendFront(design, compiled, stamp);
    patch.frontLayers = f;
    patch.backLayers  = mirrorLayers(f);
    return patch;
}

// Append puts the new layers on the outside of the existing coating, at the end
// of the Design Editor's substrate-first list, on either side, as the Coating
// Library does. The front is stored air side first, so they go before it.
function appendFront(design, compiled, stamp) {
    return [...reId(compiled.layers, `sf-${stamp}-f`), ...(design.frontLayers || [])];
}

function applyFrontSide(patch, { design, mode, compiled, incidentMat, stamp }) {
    if (mode === 'replace') patch.incidentMedium = incidentMat;
    patch.frontLayers = mode === 'replace' ? compiled.layers : appendFront(design, compiled, stamp);
}

function applyBackSide(patch, { design, mode, compiled, exitMat, stamp }) {
    if (mode === 'replace') patch.exitMedium = exitMat;
    const b = mirrorLayers(compiled.layers, `b-${stamp}-`);
    patch.backLayers = mode === 'replace'
        ? b
        : [...(design.backLayers || []), ...reId(b, `sf-${stamp}-b`)];
}

// Promote surfaceMode so a newly-populated side is visible/optimizable
// (never demote a deliberate both_independent / symmetric).
function promoteSurfaceMode(patch, design) {
    const cur = design.surfaceMode || 'front_only';
    const hasFront = (patch.frontLayers ?? design.frontLayers ?? []).length > 0;
    const hasBack  = (patch.backLayers  ?? design.backLayers  ?? []).length > 0;
    if (cur === 'front_only' && hasBack) patch.surfaceMode = hasFront ? 'both_independent' : 'back_only';
    else if (cur === 'back_only' && hasFront) patch.surfaceMode = hasBack ? 'both_independent' : 'front_only';
}

function patchAsymmetric({ design, mode, effSide, compiled, refLambda, substrateMat, incidentMat, exitMat, text, stamp }) {
    const patch = {};
    if (mode === 'replace') {
        patch.referenceWavelength = refLambda;
        patch.substrate = { ...design.substrate, material: substrateMat };
        patch.stackFormula = text;
    }
    const toFront = effSide === 'front' || effSide === 'both';
    const toBack  = effSide === 'back'  || effSide === 'both';
    if (toFront) applyFrontSide(patch, { design, mode, compiled, incidentMat, stamp });
    if (toBack)  applyBackSide(patch, { design, mode, compiled, exitMat, stamp });
    promoteSurfaceMode(patch, design);
    return patch;
}

// Design patch for the "Replace" / "Append" apply modes.
export function buildReplaceAppendPatch({
    design, mode, isSym, effSide, compiled, refLambda,
    substrateMat, incidentMat, exitMat, text, stamp,
}) {
    return isSym
        ? patchSymmetric({ design, mode, compiled, refLambda, substrateMat, incidentMat, text, stamp })
        : patchAsymmetric({ design, mode, effSide, compiled, refLambda, substrateMat, incidentMat, exitMat, text, stamp });
}
