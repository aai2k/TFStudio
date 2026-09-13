/**
 * The ready-made layouts offered in the Window menu, and the builder that turns
 * a list of tool ids into a docking tree.
 */

import { TOOL_CONFIGS } from './windowRegistry.js';

// ── Preset layouts ────────────────────────────────────────────────────────────

let _presetSeq = 100;
const presetId = () => `p${_presetSeq++}`;

export function makePresetTree(toolIds) {
    // Build a horizontal split with one tab group per tool.
    // For 1 tool: single group. For 2+: split evenly.
    const groups = toolIds.map(id => ({
        type: 'tabs', id: presetId(),
        activeTab: 0,
        tabs: [{ id: presetId(), title: TOOL_CONFIGS[id]?.title || id, toolId: id }]
    }));
    if (groups.length === 1) return groups[0];
    // Make a balanced binary split
    const sizes = groups.map(() => 100 / groups.length);
    return { type: 'split', id: presetId(), direction: 'h', children: groups, sizes };
}

export const LAYOUT_PRESETS = {
    'filter-design': {
        label: 'Filter Design',
        description: 'Design Editor + Optical Evaluation',
        tools: ['design-editor', 'optical-eval']
    },
    'full-analysis': {
        label: 'Full Analysis',
        description: 'Design Editor + Evaluation + Admittance',
        tools: ['design-editor', 'optical-eval', 'admittance']
    },
    'synthesis': {
        label: 'Synthesis',
        description: 'Design Editor + Evaluation + Refinement',
        tools: ['design-editor', 'optical-eval', 'refinement']
    }
};
