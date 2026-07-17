/**
 * Shared shell state for the deposition-monitoring wizards.
 *
 * Derives, from the active design, everything both wizards need before their
 * per-page logic: the evaluation mode + active side (mirrors the Optical
 * Evaluation plot via resolveEvalMode), the deposited-coating design
 * (`simDesign` — in back_only mode the reversed back stack grown from the exit
 * side), its layer list + distinct material ids, and the resolved-material
 * context (`ctx`) shared by every page.
 */

import { resolveEvalMode }  from '../../../../utils/physics/optimizer.js';
import { resolveMat, medId } from '../wizardShared.js';

const { useMemo } = React;

export function useWizardShell(design) {
    const evalMode   = resolveEvalMode(design);
    const activeSide = (design?.surfaceMode === 'back_only') ? 'back' : 'front';

    // back_only deposits the BACK stack, simulated as a front coating grown from
    // the exit side: reversed storage order + the exit medium as the incident.
    const simDesign = useMemo(() => {
        if (!design) return null;
        if (activeSide === 'back') {
            return { ...design,
                frontLayers: [...(design.backLayers || [])].reverse(),
                incidentMedium: design.exitMedium };
        }
        return design;
    }, [design, activeSide]);

    // Active stack in storage order, index-aligned to the run arrays.
    const layers = useMemo(() => (simDesign?.frontLayers || []).map(l => ({ ...l })), [simDesign]);
    const materialIds = useMemo(() => {
        const s = []; const seen = new Set();
        for (const l of layers) if (!seen.has(l.material)) { seen.add(l.material); s.push(l.material); }
        return s;
    }, [layers]);

    const ctx = useMemo(() => design ? {
        design, simDesign, evalMode, activeSide,
        incMat: resolveMat(medId(design.incidentMedium)),
        subMat: resolveMat(design.substrate?.material),
        exitMat: resolveMat(design.exitMedium),
        subThk: design.substrate?.thickness || 1.0,
        // Incident medium of the coating actually being deposited (the exit
        // medium in back mode) — drives the in-chamber MONITOR signal, which is
        // the active coating on a semi-infinite substrate (no back surface).
        incidentMatActive: resolveMat(medId(simDesign.incidentMedium)),
        // The opposite, static coating in ITS storage order (front: top→substrate,
        // back: substrate→exit), resolved at nominal thickness.
        otherStored: (activeSide === 'back' ? (design.frontLayers || []) : (design.backLayers || []))
            .map(l => ({ material: resolveMat(l.material), thickness: l.thickness })),
    } : null, [design, simDesign, evalMode, activeSide]);

    return { evalMode, activeSide, simDesign, layers, materialIds, ctx };
}
