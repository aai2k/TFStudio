// Tools for the Needle Manual window's profile scan and its insertion of one
// needle.

import { designView } from './designStore.js';
import { object, num, int, str, bool, list, oneOf, DESIGN_ID } from './schemaParts.js';

const SIDE = oneOf(['front', 'back'], "The side scanned. Default: the front, or the back of a back_only design. A side the window does not scan is refused: the back of a symmetric design, or the uncoated side of a one-sided design");
const CANDIDATE_TEXT = "Each candidate is { material (id), kind ('gap' or 'inside'), layer (for 'inside', the number of the layer split, 1 next to the substrate; else null), position (for 'gap', how many layers lie between the gap and the substrate; else null), fraction (for 'inside', where the layer is split, from the side light reaches first: the incident medium on the front, the substrate on the back; else null), depth (nm from that same side), gradient (the slope of the optical merit against the needle's thickness, per nm; negative where a needle lowers the merit) }. The needle becomes layer position + 1 or layer + 1.";

// The steepest candidate of each material: the one with the lowest gradient,
// by material id in the order the scan first gives them.
function steepestByMaterial(candidates) {
    const best = new Map();
    for (const cand of candidates) {
        const held = best.get(cand.material);
        if (!held || cand.gradient < held.gradient) best.set(cand.material, cand);
    }
    return [...best.values()];
}

export function needleTools({ api, store }) {
    return [
        {
            name: 'needleProfile', title: 'Needle profile',
            description: `Where a thin layer of each pool material would lower the merit, as the Needle Manual window's Compute P-function finds it: the slope of the optical merit against the thickness of a needle put in at each interface of one side's layers and at points inside each layer. The scan scores the enabled merit rows less the MNT, MXT and PPEF rows. ${CANDIDATE_TEXT} Answers with mode (the side scanned), mf0 (the optical merit as the scan scores it, null when there is no candidate), count, improving (how many have a negative gradient) and steepest, the candidate with the lowest gradient of each material; with values true, also candidates, every one in the scan's order. None means the design is needle-optimal there. insertNeedle puts a candidate in.`,
            inputSchema: object({
                designId: DESIGN_ID,
                pool: list(str('A material id'), 'The materials a needle may be, by id: one or more, none twice'),
                side: SIDE,
                step: num("The probe needle's thickness in nm, 0.05 or more, over which a slope with no exact formula is differenced: the window's Probe δ. Default 0.5"),
                intraSamples: int("Points inside each layer, 2 to 60: the window's Profile pts / layer. Default 16"),
                values: bool('Answer with every candidate too. Default false'),
            }, ['designId', 'pool']),
            run: ({ designId, values = false, ...options }) => {
                const { candidates, ...profile } = api.needleProfile(store.get(designId), options);
                const summary = { count: candidates.length, improving: candidates.filter(c => c.gradient < 0).length, steepest: steepestByMaterial(candidates) };
                return { designId, ...profile, ...summary, ...(values ? { candidates } : {}) };
            },
        },
        {
            name: 'insertNeedle', title: 'Insert a needle',
            description: "Puts one needle in a design, as the Needle Manual window's Apply puts in the candidate picked from its profile: a layer of the candidate's material at its gap, or splitting its layer in two at its fraction; a symmetric design's back follows its front. Without thickness the needle starts where the window starts it: at the thickness between 1 and 60 nm where golden-section search finds the optical merit lowest, or at 1 nm. To do what Apply does with Refine after insert, add an MNT row at 1 nm with setMerit and refine with method 'sqp' and maxIter 80. Answers with the design.",
            inputSchema: object({
                designId: DESIGN_ID,
                candidate: { type: 'object', description: 'A candidate as needleProfile gives it, on this design and side' },
                thickness: num("The needle's thickness in nm, from 1 to 200 at a gap and from 1 to the split layer's thickness less 1 inside one (at least 2). Default: the window's starting thickness"),
                side: SIDE,
            }, ['designId', 'candidate']),
            run: ({ designId, candidate, ...options }) => {
                store.set(designId, api.insertNeedle(store.get(designId), candidate, options));
                return designView(designId, store.get(designId));
            },
        },
    ];
}
